"""B-only YOLO + MediaPipe Pose clip analysis. Models load lazily, never at import.

VisionEngine(settings).analyze_clip(path, output_dir, sample_fps=1.0, max_seconds=15.0,
incident_type='OTHER') returns observations, evidence (file names inside output_dir),
relevance_score (0..1), processed_frames, elapsed_seconds, device and warnings.
Findings are observable candidates only: never identity, medical state or violations.
"""
import math
from pathlib import Path
import threading
import time

PERSON = 0


def keyframes(path, count=2, max_seconds=15.0, width=640):
    """Evenly spaced frames of a clip: [(seconds, BGR image)]. The clip is not modified."""
    import cv2
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise VisionUnavailable('Video could not be opened for key frames')
    try:
        fps = capture.get(cv2.CAP_PROP_FPS) or 0
        fps = fps if 0 < fps < 240 else 10.0
        total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0) or int(max_seconds * fps)
        last = max(0, min(total - 1, int(max_seconds * fps)))
        frames = []
        for target in (int(last * (n + 1) / (count + 1)) for n in range(count)):
            capture.set(cv2.CAP_PROP_POS_FRAMES, target)
            ok, image = capture.read()
            if not ok:
                continue
            if image.shape[1] > width:
                image = cv2.resize(image, (width, round(image.shape[0] * width / image.shape[1])))
            frames.append((round(target / fps, 2), image))
    finally:
        capture.release()
    if not frames:
        raise VisionUnavailable('No decodable key frames in the clip')
    return frames


# Open-vocabulary words baked into runtime/models/yolo-world-cctv.pt by setup_models.py (YOLO-World,
# local, no API). Each reported situation is checked only against its own words.
SCENE_VOCAB = {
    'ILLEGAL_DUMPING': {'trash bag': '쓰레기 봉투', 'garbage pile': '쓰레기 더미', 'plastic bag': '비닐봉지', 'litter': '버려진 쓰레기'},
    'ABANDONED_OBJECT': {'suitcase': '여행 가방', 'backpack': '배낭', 'handbag': '손가방', 'cardboard box': '종이 상자'},
    'SMOKING': {'cigarette': '담배', 'person smoking': '흡연하는 사람'},
    'POTHOLE': {'pothole': '포트홀', 'road crack': '도로 균열'},
    'VANDALISM': {'graffiti': '낙서', 'broken glass': '깨진 유리', 'broken bench': '부서진 벤치'},
    'FIRE_SMOKE': {'fire': '불꽃', 'smoke': '연기'},
    'SAFETY_THREAT': {'people fighting': '다투는 사람들', 'knife': '칼'},
}
# Classes of the model fine-tuned on public data (D-Fire, pothole, crack-seg; see shared/API.md v0.13).
# Where it covers a situation it is used instead of YOLO-World; without the file YOLO-World stays.
TRAINED_VOCAB = {
    'FIRE_SMOKE': {'smoke': '연기', 'fire': '불꽃'},
    'POTHOLE': {'pothole': '포트홀', 'road_crack': '도로 균열'},
}
TRAINED_MIN_CONFIDENCE = 0.35
SCENE_TYPES = set(SCENE_VOCAB)
SCENE_WORDS = [word for words in SCENE_VOCAB.values() for word in words]
SCENE_MIN_CONFIDENCE = 0.25  # open-vocabulary scores run lower than COCO classes

VEHICLES = {1: '자전거', 2: '승용차', 3: '오토바이', 5: '버스', 7: '트럭'}
LABELS = {PERSON: '사람', **VEHICLES}


class VisionUnavailable(RuntimeError):
    """Models or libraries are missing; analysis really could not run."""


def iou(a, b):
    left, top = max(a[0], b[0]), max(a[1], b[1])
    right, bottom = min(a[2], b[2]), min(a[3], b[3])
    overlap = max(0.0, right - left) * max(0.0, bottom - top)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - overlap
    return overlap / union if union > 0 else 0.0


def torso_horizontal(landmarks):
    """True when the shoulder-to-hip axis is closer to horizontal than vertical."""
    if len(landmarks) < 25:
        return None
    shoulders, hips = (landmarks[11], landmarks[12]), (landmarks[23], landmarks[24])
    if min(point.visibility for point in (*shoulders, *hips)) < 0.3:
        return None
    dx = (hips[0].x + hips[1].x - shoulders[0].x - shoulders[1].x) / 2
    dy = (hips[0].y + hips[1].y - shoulders[0].y - shoulders[1].y) / 2
    return math.degrees(math.atan2(abs(dx), abs(dy))) > 60


class VisionEngine:
    def __init__(self, settings):
        self.yolo_path = Path(getattr(settings, 'yolo_model', 'runtime/models/yolo26n.pt'))
        self.pose_path = Path(getattr(settings, 'pose_model', 'runtime/models/pose_landmarker_lite.task'))
        self.scene_path = Path(getattr(settings, 'scene_model', 'runtime/models/yolo-world-cctv.pt'))
        self.trained_path = Path(getattr(settings, 'trained_scene_model', 'runtime/models/cctv-scene.pt'))
        self.scene = self.trained = None
        self.requested_device = getattr(settings, 'ai_device', 'auto')
        self.yolo = self.pose = self.device = None
        self.lock = threading.Lock()

    def load(self):
        if self.yolo is not None:
            return
        for path in (self.yolo_path, self.pose_path):
            if not path.is_file():
                raise VisionUnavailable(f'Model file missing: {path.name}; run setup_models.py')
        try:
            import torch
            from ultralytics import YOLO
            import mediapipe as mp
            from mediapipe.tasks.python import BaseOptions, vision
        except ImportError as exc:
            raise VisionUnavailable(f'AI library missing: {exc.name}') from None
        cuda = torch.cuda.is_available()
        if self.requested_device == 'cuda' and not cuda:
            raise VisionUnavailable('CUDA was requested but PyTorch reports no CUDA device')
        self.device = 'cuda:0' if cuda and self.requested_device != 'cpu' else 'cpu'
        self.torch, self.mp = torch, mp
        self.yolo = YOLO(str(self.yolo_path))
        self.pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(self.pose_path)), num_poses=1))

    def status(self):
        return {'yolo_model': self.yolo_path.name, 'pose_model': self.pose_path.name,
                'scene_model': self.scene_path.name if self.scene_path.is_file() else None,
                'trained_scene_model': self.trained_path.name if self.trained_path.is_file() else None,
                'models_present': self.yolo_path.is_file() and self.pose_path.is_file(),
                'loaded': self.yolo is not None, 'device': self.device}

    def scene_check(self, path, incident_type, *, max_seconds=15.0, count=4):
        """Look for what YOLO's people/vehicle classes cannot see (dumping, smoke, damage…): the fine-tuned model
        where it covers the situation, otherwise local YOLO-World.

        Returns {visible, confidence, finding, timestamp_seconds, source, warnings, image}; `image` is the
        annotated JPEG of the best frame (bytes) or None. A candidate only, never a verdict."""
        import cv2
        empty = {'visible': False, 'confidence': 0.0, 'finding': '', 'timestamp_seconds': None, 'image': None}
        words = SCENE_VOCAB.get(incident_type)
        if not words:
            return {**empty, 'source': 'none', 'warnings': []}
        trained = incident_type in TRAINED_VOCAB and self.trained_path.is_file()
        if trained:
            words, model_path, attribute, minimum = TRAINED_VOCAB[incident_type], self.trained_path, 'trained', TRAINED_MIN_CONFIDENCE
        else:
            model_path, attribute, minimum = self.scene_path, 'scene', SCENE_MIN_CONFIDENCE
        if not model_path.is_file():
            return {**empty, 'source': 'unavailable',
                    'warnings': [f'장면 확인 모델 {model_path.name}이 없어 YOLO 결과만 썼습니다(setup_models.py 실행).']}
        frames = keyframes(path, count, max_seconds)
        with self.lock:
            self.load()
            if getattr(self, attribute) is None:
                from ultralytics import YOLO
                setattr(self, attribute, YOLO(str(model_path)))
            model = getattr(self, attribute)
            names = model.names
            wanted = [index for index, name in names.items() if name in words]
            best = None
            for seconds, image in frames:
                prediction = model.predict(image, device=self.device, conf=0.15, imgsz=640, verbose=False,
                                           classes=wanted)[0]
                for box in prediction.boxes:
                    confidence = float(box.conf[0])
                    if best is None or confidence > best[0]:
                        best = (confidence, seconds, image, names[int(box.cls[0])], box.xyxy[0].tolist())
        source = ('trained:' if trained else 'yolo-world:') + model_path.name
        if best is None or best[0] < minimum:
            return {**empty, 'confidence': round(best[0], 3) if best else 0.0, 'source': source, 'warnings': []}
        confidence, seconds, image, word, (x1, y1, x2, y2) = best
        overlay = image.copy()
        cv2.rectangle(overlay, (int(x1), int(y1)), (int(x2), int(y2)), (0, 165, 255), 2)
        cv2.putText(overlay, f'{word} {confidence:.2f}', (int(x1), max(12, int(y1) - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                    (0, 165, 255), 1)
        ok, buffer = cv2.imencode('.jpg', overlay, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return {'visible': True, 'confidence': round(confidence, 3), 'timestamp_seconds': seconds,
                'finding': f'{words[word]} 후보 (신뢰도 {confidence:.2f})', 'source': source, 'warnings': [],
                'image': buffer.tobytes() if ok else None}

    def analyze_clip(self, path, output_dir, *, sample_fps=1.0, max_seconds=15.0, incident_type='OTHER'):
        with self.lock:
            self.load()
            return self._analyze(Path(path), Path(output_dir), sample_fps, max_seconds, incident_type)

    def _analyze(self, path, output_dir, sample_fps, max_seconds, incident_type):
        import cv2
        started = time.perf_counter()
        warnings = []
        if self.device.startswith('cuda'):
            self.torch.cuda.reset_peak_memory_stats()
        capture = cv2.VideoCapture(str(path))
        if not capture.isOpened():
            raise VisionUnavailable('Video could not be opened for analysis')
        fps = capture.get(cv2.CAP_PROP_FPS) or 0
        if not 0 < fps < 240:
            fps = 10.0
            warnings.append('컨테이너 FPS를 읽지 못해 10fps로 가정했습니다.')
        step = max(1, round(fps / max(sample_fps, 0.01)))
        limit = int(max_seconds * fps)
        frames, index, best = [], 0, []
        try:
            while index <= limit:
                ok, image = capture.read()
                if not ok:
                    break
                if index % step == 0:
                    frames.append(self._frame(image, index / fps, incident_type, best))
                index += 1
        finally:
            capture.release()
        if not frames:
            raise VisionUnavailable('No decodable frames in the clip')
        return self._result(frames, best, output_dir, incident_type, sample_fps, started, warnings)

    def analyze_image(self, path, output_dir, *, incident_type='OTHER'):
        """A reporter's photo: the same detectors on one frame."""
        import cv2
        with self.lock:
            self.load()
            started = time.perf_counter()
            if self.device.startswith('cuda'):
                self.torch.cuda.reset_peak_memory_stats()
            image = cv2.imread(str(path))
            if image is None:
                raise VisionUnavailable('Image could not be opened for analysis')
            best = []
            frames = [self._frame(image, 0.0, incident_type, best)]
            return self._result(frames, best, Path(output_dir), incident_type, 1.0, started, [])

    def _result(self, frames, best, output_dir, incident_type, sample_fps, started, warnings):
        import cv2
        output_dir.mkdir(parents=True, exist_ok=True)
        evidence = []
        for number, (score, timestamp, image, boxes) in enumerate(sorted(best, key=lambda row: -row[0])[:3], 1):
            name = f'evidence-{number:02d}.jpg'
            # Draw on a copy: the received clip itself is never modified.
            overlay = image.copy()
            for box in boxes:
                x1, y1, x2, y2 = map(int, box['box'])
                color = (0, 0, 255) if box.get('lying') else (0, 200, 0)
                cv2.rectangle(overlay, (x1, y1), (x2, y2), color, 2)
                cv2.putText(overlay, f"{box['class']} {box['confidence']:.2f}", (x1, max(12, y1 - 4)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
            cv2.imwrite(str(output_dir / name), overlay, [cv2.IMWRITE_JPEG_QUALITY, 85])
            evidence.append({'file': name, 'timestamp_seconds': round(timestamp, 2),
                             'findings': [self._describe(box) for box in boxes][:8]})
        observations, score = self._summarize(frames, incident_type, sample_fps)
        result = {'observations': observations, 'evidence': evidence, 'relevance_score': score,
                  'processed_frames': len(frames), 'elapsed_seconds': round(time.perf_counter() - started, 3),
                  'device': self.device, 'warnings': warnings, 'frames': frames,
                  'models': {'yolo': self.yolo_path.name, 'pose': self.pose_path.name}}
        if self.device.startswith('cuda'):
            result['gpu_memory_peak_mb'] = round(self.torch.cuda.max_memory_allocated() / 1024 ** 2, 1)
        return result

    @staticmethod
    def _describe(box):
        text = f"{box['class']} 후보 (신뢰도 {box['confidence']:.2f})"
        return text + ', 누운 자세 후보' if box.get('lying') else text

    def _frame(self, image, timestamp, incident_type, best):
        prediction = self.yolo.predict(image, device=self.device, conf=0.35, imgsz=640, verbose=False,
                                       classes=[PERSON, *VEHICLES])[0]
        boxes = []
        height, width = image.shape[:2]
        for box, cls, confidence in zip(prediction.boxes.xyxy.tolist(), prediction.boxes.cls.tolist(),
                                        prediction.boxes.conf.tolist()):
            row = {'class': LABELS[int(cls)], 'class_id': int(cls), 'confidence': round(confidence, 3),
                   'box': [round(value, 1) for value in box]}
            if int(cls) == PERSON:
                row['lying'] = self._lying(image, box, width, height, incident_type)
            boxes.append(row)
        persons = [box for box in boxes if box['class_id'] == PERSON]
        lying = [box for box in persons if box['lying']]
        vehicles = [box for box in boxes if box['class_id'] in VEHICLES]
        frame_score = len(lying) * 2 + len(persons) + len(vehicles) * 0.5
        if boxes:
            best.append((frame_score, timestamp, image, boxes))
            best.sort(key=lambda row: -row[0])
            del best[3:]
        return {'timestamp_seconds': round(timestamp, 2), 'persons': len(persons), 'lying': len(lying),
                'vehicles': len(vehicles), 'vehicle_boxes': [box['box'] for box in vehicles]}

    def _lying(self, image, box, width, height, incident_type):
        x1, y1, x2, y2 = box
        aspect = (x2 - x1) / max(1.0, y2 - y1)
        if incident_type != 'FALL_SUSPECTED':
            return aspect > 1.3
        pad_x, pad_y = (x2 - x1) * 0.1, (y2 - y1) * 0.1
        crop = image[int(max(0, y1 - pad_y)):int(min(height, y2 + pad_y)),
                     int(max(0, x1 - pad_x)):int(min(width, x2 + pad_x))]
        if crop.size == 0:
            return aspect > 1.3
        rgb = crop[:, :, ::-1].copy()
        result = self.pose.detect(self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb))
        horizontal = torso_horizontal(result.pose_landmarks[0]) if result.pose_landmarks else None
        # Pose wins when visible; the box shape is the fallback cue.
        return horizontal if horizontal is not None else aspect > 1.3

    @staticmethod
    def _summarize(frames, incident_type, sample_fps):
        total = len(frames)
        person_frames = sum(frame['persons'] > 0 for frame in frames)
        lying_frames = [frame for frame in frames if frame['lying'] > 0]
        vehicle_frames = sum(frame['vehicles'] > 0 for frame in frames)
        stationary = longest = 0
        for previous, current in zip(frames, frames[1:]):
            matched = any(iou(a, b) > 0.7 for a in previous['vehicle_boxes'] for b in current['vehicle_boxes'])
            stationary = stationary + 1 if matched else 0
            longest = max(longest, stationary)
        observations = []
        if person_frames:
            observations.append({'finding': f"사람 후보 감지 (최대 {max(f['persons'] for f in frames)}명, "
                                            f"{person_frames}/{total} 프레임)", 'kind': 'person',
                                 'timestamp_seconds': next(f['timestamp_seconds'] for f in frames if f['persons']),
                                 'verified': False})
        if lying_frames:
            observations.append({'finding': f'누운 자세로 보이는 사람 후보 ({len(lying_frames)}/{total} 프레임)',
                                 'kind': 'lying_person', 'timestamp_seconds': lying_frames[0]['timestamp_seconds'],
                                 'verified': False})
        if vehicle_frames:
            observations.append({'finding': f'차량 후보 감지 ({vehicle_frames}/{total} 프레임)', 'kind': 'vehicle',
                                 'timestamp_seconds': next(f['timestamp_seconds'] for f in frames if f['vehicles']),
                                 'verified': False})
        if longest >= 2:
            observations.append({'finding': f'같은 위치에 머문 차량 후보 (약 {longest / max(sample_fps, 0.01):.0f}초)',
                                 'kind': 'stationary_vehicle', 'timestamp_seconds': None, 'verified': False})
        person_ratio, lying_ratio = person_frames / total, len(lying_frames) / total
        vehicle_ratio, stationary_ratio = vehicle_frames / total, min(1.0, longest / max(1, total - 1))
        if incident_type == 'FALL_SUSPECTED':
            score = 0.25 * person_ratio + 0.75 * lying_ratio
        elif incident_type == 'VEHICLE_OBSTRUCTION':
            score = 0.4 * vehicle_ratio + 0.6 * stationary_ratio
        else:
            score = 0.6 * max(person_ratio, vehicle_ratio) + 0.4 * max(lying_ratio, stationary_ratio)
        return observations, round(min(1.0, score), 4)
