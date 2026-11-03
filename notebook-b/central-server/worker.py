"""Single GPU worker: report -> radius candidates -> low-FPS scan -> focused analysis -> summary.

Only approved A webcams (cam-01/02/03) reach this code through Store.candidates. Analysis
clips are an automatic cache under analysis_dir, separate from manually preserved clips.
Unavailable inputs are recorded as explicit outcomes; nothing is reported as detected
unless the models actually produced a candidate.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
import shutil
import threading
import time

from adapter import AdapterError
from clips import download_export, ranges_cover
from evidence import report_lock, safe_path
import guidance
from media import capture_live
from models import DEMO_CAMERA_IDS, AnalyzeInput, PreserveInput, utc
from vision import VisionUnavailable

RECORDING_LAG_SECONDS = 70  # A lists only finalized 60 s segments.
EXPAND_STEP_M = 100  # Design doc 6.2: widen 100 -> 200 -> 300 m when the radius has no camera.
MAX_RADIUS_M = 5000


def parse(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def compact(result):
    """Keep per-frame counts but drop raw boxes before storing an analysis."""
    frames = [{key: frame[key] for key in ('timestamp_seconds', 'persons', 'lying', 'vehicles')}
              for frame in result.get('frames', [])]
    return {**{key: value for key, value in result.items() if key != 'frames'}, 'frames': frames}


class Pipeline:
    def __init__(self, settings, store, adapter, vision, intelligence):
        self.settings, self.store, self.adapter = settings, store, adapter
        self.vision, self.intelligence = vision, intelligence
        self.analysis_dir = Path(getattr(settings, 'analysis_dir', settings.database_path.parent / 'analysis'))
        self.attachments_dir = Path(getattr(settings, 'attachments_dir',
                                            settings.database_path.parent / 'attachments'))

    def run(self, job):
        report = self.store.report(job['report_id'])
        params = AnalyzeInput.model_validate(job['params'])
        with report_lock(self.analysis_dir, report['report_id']):
            folder = safe_path(self.analysis_dir, report['report_id'])
            if folder.exists():
                shutil.rmtree(folder)
            folder.mkdir(parents=True)
        started = time.monotonic()
        result = {'report_id': report['report_id'], 'mode': params.mode, 'params': params.model_dump(),
                  'started_at': utc(),
                  'warnings': [], 'cameras': [], 'selected_camera_ids': [], 'phone': []}

        def stage(name, progress):
            self.store.update_job(job['id'], name, progress)
            self.store.event(report['report_id'], 'stage', name)

        try:
            self._run(report, params, folder, result, stage)
            state, error = 'completed', None
        except VisionUnavailable as exc:
            result['outcome'] = 'MANUAL_REVIEW_REQUIRED'
            state, error = 'failed', f'영상 분석 불가: {exc}'
        except Exception as exc:  # noqa: BLE001 - a worker failure must surface, not crash the loop
            result['outcome'] = 'MANUAL_REVIEW_REQUIRED'
            state, error = 'failed', f'분석 중 오류({type(exc).__name__})'
        if error:
            result['warnings'].append(error)
            result.setdefault('summary', self.intelligence.local_summary(
                {**report, 'incident_type': result.get('classification', {}).get('incident_type', 'OTHER')}, []))
        try:
            result['best_camera'] = guidance.best_camera(result)
            result['response_plan'] = guidance.plan(report, result)
        except Exception as exc:  # noqa: BLE001
            result['warnings'].append(f'대응 방안 추천 실패({type(exc).__name__})')
        result['finished_at'] = utc()
        result['processing_seconds'] = round(time.monotonic() - started, 3)
        result['requested_at'] = job.get('requested_at') or report['created_at']
        result['latency_seconds'] = round((parse(result['finished_at']) - parse(result['requested_at'])).total_seconds(), 3)
        self.store.save_analysis(report['report_id'], result)
        self.store.update_job(job['id'], result['outcome'], 1.0, state=state, error=error)
        self.store.event(report['report_id'], 'analysis_finished', result['outcome'],
                         {'state': state, 'selected': result['selected_camera_ids']})
        return result

    def _run(self, report, params, folder, result, stage):
        # Voice first: a location-only report may describe the incident only in its recording.
        transcripts = self._transcripts(report, result)
        context = ' '.join([report.get('details', ''), *transcripts]).strip()
        classification = self.intelligence.classify(report.get('description', ''), context)
        result['classification'] = classification
        incident = classification['incident_type']
        stage('CLASSIFIED', 0.1)
        images = self._media(report, folder, incident, result)
        try:
            self.store.sync(self.adapter.cameras())
        except AdapterError as exc:
            self.store.invalidate_cameras()
            result['warnings'].append(f'카메라 상태 확인 실패: {exc.message}')
        candidates, result['search'] = self._search(report, params)
        # The stored report radius stays as reported; this analysis uses the widened one.
        searched = {**report, 'radius_m': result['search']['radius_m']}
        result['candidates'] = [{'camera_id': row['id'], 'distance_m': row['distance_m'], 'zone': row.get('zone')}
                                for row in candidates]
        try:
            result['nearby'] = guidance.nearby(searched, incident, classification.get('keywords'), candidates)
        except Exception as exc:  # noqa: BLE001 - the radius guide must not cost the video analysis
            result['warnings'].append(f'반경 CCTV 안내 실패({type(exc).__name__})')
        if not candidates:
            result['outcome'] = 'CAMERA_UNAVAILABLE' if result['warnings'] else 'NO_CAMERA_IN_RANGE'
            result['summary'] = self._summary(report, incident, [], images, transcripts, result)
            return
        stage('CANDIDATES_FOUND', 0.2)
        clips = self._acquire(report, params, candidates, folder / 'clips', result)
        available = [row for row in result['cameras'] if row['status'] == 'available']
        if not available:
            result['outcome'] = ('RECORDING_UNAVAILABLE' if params.source == 'recording' else 'CAMERA_UNAVAILABLE')
            result['summary'] = self._summary(report, incident, [], images, transcripts, result)
            return
        focus = {}
        if params.mode in ('selective', 'benchmark'):
            stage('SCANNING', 0.35)
            scan_started = time.monotonic()
            for row in available:
                row['scan'] = compact(self.vision.analyze_clip(
                    clips[row['camera_id']], folder / 'scan' / row['camera_id'], sample_fps=params.sample_fps,
                    max_seconds=params.duration, incident_type=incident))
                row['event_score'] = row['scan']['relevance_score']
                row['rank_score'] = self._rank(searched, row)
            scan_seconds = time.monotonic() - scan_started
            ranked = sorted(available, key=lambda item: -item['rank_score'])
            selected = [row for row in ranked if row['event_score'] > 0][:params.top_k]
            stage('FOCUSED_ANALYSIS', 0.6)
            focus_started = time.monotonic()
            for row in selected:
                row['focus'] = compact(self.vision.analyze_clip(
                    clips[row['camera_id']], folder / 'focus' / row['camera_id'], sample_fps=params.focus_fps,
                    max_seconds=params.duration, incident_type=incident))
                focus[row['camera_id']] = ('focus', row['focus'])
            result['selected_camera_ids'] = [row['camera_id'] for row in selected]
            selective = {'frames': sum(row['scan']['processed_frames'] + row.get('focus', {}).get('processed_frames', 0)
                                       for row in available),
                         'seconds': round(scan_seconds + time.monotonic() - focus_started, 3),
                         'selected': result['selected_camera_ids']}
        if params.mode in ('all', 'benchmark'):
            if params.mode == 'all':
                stage('FOCUSED_ANALYSIS', 0.5)
            all_started = time.monotonic()
            for row in available:
                row['all'] = compact(self.vision.analyze_clip(
                    clips[row['camera_id']], folder / 'all' / row['camera_id'], sample_fps=params.focus_fps,
                    max_seconds=params.duration, incident_type=incident))
            ranked_all = sorted(available, key=lambda item: -item['all']['relevance_score'])
            all_selected = [row['camera_id'] for row in ranked_all if row['all']['relevance_score'] > 0][:params.top_k]
            full = {'frames': sum(row['all']['processed_frames'] for row in available),
                    'seconds': round(time.monotonic() - all_started, 3), 'selected': all_selected}
            if params.mode == 'all':
                result['selected_camera_ids'] = all_selected
                for row in available:
                    if row['camera_id'] in all_selected:
                        focus[row['camera_id']] = ('all', row['all'])
        if params.mode == 'benchmark':
            result['benchmark'] = {
                'selective': selective, 'all': full, 'same_selection': selective['selected'] == full['selected'],
                'frame_reduction': round(1 - selective['frames'] / full['frames'], 4) if full['frames'] else None,
                'note': '같은 클립을 두 방식으로 처리한 결과입니다. 영상 수신·디코딩 비용은 양쪽 모두 포함됩니다.'}
        observations, evidence_images = [], []
        for row in available:
            if row['camera_id'] not in focus:
                continue
            kind, analysis = focus[row['camera_id']]
            window_start = parse(row['window']['start'])
            for item in analysis['observations']:
                seconds = item.get('timestamp_seconds')
                observations.append({**item, 'camera_id': row['camera_id'],
                                     'timestamp': utc(window_start + timedelta(seconds=seconds))
                                     if seconds is not None else None})
            for evidence in analysis['evidence'][:2]:
                evidence['path'] = f"{kind}/{row['camera_id']}/{evidence['file']}"
                evidence_images.append(folder / evidence['path'])
        result['outcome'] = 'REVIEW_REQUIRED' if result['selected_camera_ids'] else 'VIDEO_NOT_VISIBLE'
        stage('SUMMARIZING', 0.85)
        result['summary'] = self._summary(report, incident, observations, evidence_images + images,
                                          transcripts, result)

    def _search(self, report, params):
        base = report['radius_m']
        attempts, found, radius = [], [], base
        for step in range(params.expand_steps + 1):
            radius = min(MAX_RADIUS_M, base + EXPAND_STEP_M * step)
            found = self.store.candidates({**report, 'radius_m': radius})
            attempts.append({'radius_m': radius, 'webcams': len(found)})
            if found or radius >= MAX_RADIUS_M:
                break
        search = {'base_radius_m': base, 'radius_m': radius, 'step_m': EXPAND_STEP_M,
                  'expanded': radius > base, 'attempts': attempts}
        if search['expanded']:
            self.store.event(report['report_id'], 'radius_expanded', f'검색 반경 자동 확대 {base:g}m → {radius:g}m',
                             {'from': base, 'to': radius, 'webcams': len(found)})
        return found, search

    def _rank(self, report, row):
        # Initial weights from the design doc; attachment context is renormalized out.
        proximity = max(0.0, 1 - row['distance_m'] / max(report['radius_m'], 1))
        time_match = 1.0 if row['window'].get('covers_report_time') else 0.5
        return round((0.20 * proximity + 0.15 * time_match + 0.45 * row['event_score']) / 0.80, 4)

    def _acquire(self, report, params, candidates, folder, result):
        folder.mkdir(parents=True, exist_ok=True)
        now = datetime.now(timezone.utc)
        reference = parse(report.get('occurred_at') or report['created_at'])
        clips = {}

        def live(camera):
            target = folder / f"{camera['id']}.mp4"
            start = datetime.now(timezone.utc)
            capture_live(self.adapter.stream(camera['id']), getattr(self.settings, 'rtsp_user', ''),
                         getattr(self.settings, 'rtsp_password', ''), params.duration, target)
            return target, start, abs((start - reference).total_seconds()) <= 300

        def recording(camera):
            start = min(reference - timedelta(seconds=params.duration / 2),
                        now - timedelta(seconds=RECORDING_LAG_SECONDS + params.duration))
            end = start + timedelta(seconds=params.duration)
            ranges = self.adapter.recordings(camera['id'], utc(start), utc(end))['ranges']
            if not ranges_cover(ranges, start, end):
                raise AdapterError(409, 'Recording ranges do not cover the analysis window')
            exported = self.adapter.export(PreserveInput(camera_id=camera['id'], start=start,
                                                         duration=params.duration))
            target = folder / f"{camera['id']}.mp4"
            partial = target.with_suffix('.partial')
            try:
                download_export(self.adapter, exported, partial)
                partial.rename(target)
            finally:
                partial.unlink(missing_ok=True)
            return target, start, start <= reference <= end

        def acquire(camera):
            if camera['id'] not in DEMO_CAMERA_IDS:  # Defense in depth; candidates already filter.
                raise AdapterError(403, 'Only the three demo webcams may provide video')
            return (live if params.source == 'live' else recording)(camera)

        # Live captures run in parallel (each blocks for `duration`); A allows one export at a time.
        workers = len(candidates) if params.source == 'live' else 1
        with ThreadPoolExecutor(max_workers=workers) as pool:
            outcomes = list(zip(candidates, pool.map(self._guard(acquire), candidates)))
        for camera, (value, error) in outcomes:
            row = {'camera_id': camera['id'], 'distance_m': camera['distance_m'], 'zone': camera.get('zone')}
            if error is None:
                path, start, covers = value
                clips[camera['id']] = path
                row.update(status='available', window={'start': utc(start), 'duration': params.duration,
                                                       'source': params.source, 'covers_report_time': covers})
            else:
                unavailable = 'RECORDING_UNAVAILABLE' if error.status == 409 else 'CAMERA_UNAVAILABLE'
                row.update(status=unavailable, detail=error.message)
            result['cameras'].append(row)
        return clips

    @staticmethod
    def _guard(function):
        def call(argument):
            try:
                return function(argument), None
            except AdapterError as exc:
                return None, exc
        return call

    def _files(self, report, result, kinds):
        for attachment in self.store.attachments(report['report_id']):
            if attachment['kind'] not in kinds:
                continue
            path = self.attachments_dir / report['report_id'] / attachment['stored_name']
            if not path.is_file():
                result['warnings'].append(f"첨부 {attachment['attachment_id']} 파일 없음")
                continue
            yield attachment, path

    def _transcripts(self, report, result):
        transcripts = []
        for attachment, path in self._files(report, result, ('audio',)):
            transcribed = self.intelligence.transcribe(path)
            transcripts.append(transcribed['text'])
            result['phone'].append({'attachment_id': attachment['attachment_id'], 'kind': 'audio',
                                    'transcript': transcribed['text'], 'source': transcribed['source'],
                                    'warnings': transcribed['warnings']})
        return [text for text in transcripts if text]

    def _media(self, report, folder, incident, result):
        images = []
        for attachment, path in self._files(report, result, ('image', 'video')):
            output = folder / 'phone' / attachment['attachment_id']
            entry = {'attachment_id': attachment['attachment_id'], 'kind': attachment['kind']}
            try:
                if attachment['kind'] == 'video':
                    analysis = self.vision.analyze_clip(path, output, sample_fps=1, max_seconds=15,
                                                        incident_type=incident)
                else:
                    images.append(path)
                    analysis = self.vision.analyze_image(path, output, incident_type=incident)
            except VisionUnavailable as exc:
                # One unreadable phone file must not cost the CCTV analysis.
                result['warnings'].append(f"첨부 {attachment['attachment_id']} 분석 불가: {exc}")
                result['phone'].append(entry)
                continue
            analysis = compact(analysis)
            for evidence in analysis['evidence']:
                evidence['path'] = f"phone/{attachment['attachment_id']}/{evidence['file']}"
            result['phone'].append({**entry, 'analysis': analysis})
        return images[:2]

    def _summary(self, report, incident, observations, images, transcripts, result):
        label = {'video': '신고자 영상', 'image': '신고자 사진'}
        phone_findings = [f"{label[entry['kind']]}: {item['finding']}" for entry in result['phone']
                          if entry.get('analysis') for item in entry['analysis']['observations']]
        summary = self.intelligence.summarize({**report, 'incident_type': incident}, observations,
                                              image_paths=images, transcripts=transcripts)
        if phone_findings and summary.get('source') == 'local_rules':
            summary['phone_observations'] = [*summary['phone_observations'], *phone_findings]
        return summary


class Worker:
    def __init__(self, pipeline, store, interval=1.0):
        self.pipeline, self.store, self.interval = pipeline, store, interval
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self.loop, name='cctv-analysis-worker', daemon=True)
        self.current = None

    def start(self):
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.thread.join(timeout=30)

    def loop(self):
        while not self.stop_event.is_set():
            job = self.store.claim_job()
            if job is None:
                self.stop_event.wait(self.interval)
                continue
            self.current = job['report_id']
            try:
                self.pipeline.run(job)
            except Exception as exc:  # noqa: BLE001 - keep serving other reports
                self.store.update_job(job['id'], 'MANUAL_REVIEW_REQUIRED', 1.0, state='failed',
                                      error=f'worker error({type(exc).__name__})')
            finally:
                self.current = None
                self.store.take_rerun(job['report_id'])
