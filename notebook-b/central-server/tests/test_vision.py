"""Real YOLO/MediaPipe inference on synthetic clips built from Ultralytics sample images.

These are not CCTV results: they check that the installed models run and rank clips.
"""
from pathlib import Path
import subprocess

import pytest

from vision import VisionEngine, VisionUnavailable

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / 'runtime/models'


@pytest.fixture(scope='module')
def clips(tmp_path_factory):
    ffmpeg = next((ROOT / 'tools/ffmpeg').rglob('ffmpeg.exe'), None)
    if ffmpeg is None or not (MODELS / 'yolo26n.pt').is_file() or not (MODELS / 'pose_landmarker_lite.task').is_file():
        pytest.skip('Run setup_tools.py and setup_models.py to enable real inference tests')
    import ultralytics
    assets = Path(ultralytics.__file__).parent / 'assets'
    folder = tmp_path_factory.mktemp('vision')
    filters = {'standing': (assets / 'bus.jpg', 'scale=640:-2'),
               'lying': (assets / 'zidane.jpg', 'transpose=1,scale=-2:640')}
    result = {}
    for name, (image, scale) in filters.items():
        result[name] = folder / f'{name}.mp4'
        subprocess.run([str(ffmpeg), '-v', 'error', '-loop', '1', '-i', str(image), '-t', '3', '-r', '10',
                        '-vf', scale + ',format=yuv420p', '-c:v', 'libx264', str(result[name])],
                       check=True, capture_output=True, timeout=60)
    result['empty'] = folder / 'empty.mp4'
    subprocess.run([str(ffmpeg), '-v', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=320x240:r=10', '-t', '3',
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(result['empty'])],
                   check=True, capture_output=True, timeout=60)
    return result


@pytest.fixture(scope='module')
def engine():
    class Settings:
        yolo_model = str(MODELS / 'yolo26n.pt')
        pose_model = str(MODELS / 'pose_landmarker_lite.task')
        scene_model = str(MODELS / 'yolo-world-cctv.pt')
        trained_scene_model = str(MODELS / 'cctv-scene.pt')
        ai_device = 'auto'
    return VisionEngine(Settings())


def test_fall_report_ranks_lying_person_above_standing_and_empty(engine, clips, tmp_path):
    scores = {}
    for name, path in clips.items():
        result = engine.analyze_clip(path, tmp_path / name, sample_fps=2, max_seconds=3,
                                     incident_type='FALL_SUSPECTED')
        scores[name] = result['relevance_score']
        assert result['processed_frames'] >= 5
        assert all(observation['verified'] is False for observation in result['observations'])
        for evidence in result['evidence']:
            assert '/' not in evidence['file'] and (tmp_path / name / evidence['file']).is_file()
    assert scores['lying'] > scores['standing'] > scores['empty'] == 0
    assert scores['lying'] >= 0.7


def test_vehicle_report_detects_stationary_vehicle(engine, clips, tmp_path):
    result = engine.analyze_clip(clips['standing'], tmp_path, sample_fps=2, max_seconds=3,
                                 incident_type='VEHICLE_OBSTRUCTION')
    kinds = {observation['kind'] for observation in result['observations']}
    assert {'vehicle', 'stationary_vehicle'} <= kinds
    assert result['relevance_score'] > 0.5


def test_missing_models_and_unreadable_video_fail_explicitly(tmp_path, clips):
    class Missing:
        yolo_model = str(tmp_path / 'absent.pt')
        pose_model = str(tmp_path / 'absent.task')
        ai_device = 'cpu'
    with pytest.raises(VisionUnavailable, match='Model file missing'):
        VisionEngine(Missing()).analyze_clip(clips['empty'], tmp_path)
    broken = tmp_path / 'broken.mp4'
    broken.write_bytes(b'not a video')
    class Present:
        yolo_model = str(MODELS / 'yolo26n.pt')
        pose_model = str(MODELS / 'pose_landmarker_lite.task')
        ai_device = 'cpu'
    with pytest.raises(VisionUnavailable):
        VisionEngine(Present()).analyze_clip(broken, tmp_path / 'out')


@pytest.mark.skipif(not (MODELS / 'yolo-world-cctv.pt').is_file(), reason='scene model not built (setup_models.py)')
def test_local_scene_check_runs_yolo_world_without_any_api(engine, clips):
    result = engine.scene_check(clips['empty'], 'SMOKING', max_seconds=3)
    assert result['source'] == 'yolo-world:yolo-world-cctv.pt' and result['warnings'] == []
    assert isinstance(result['visible'], bool) and 0 <= result['confidence'] <= 1
    assert (result['image'] is not None) == result['visible']
    assert engine.scene_check(clips['empty'], 'FALL_SUSPECTED')['source'] == 'none'


def test_missing_scene_model_falls_back_with_a_warning(clips):
    from types import SimpleNamespace
    from vision import VisionEngine
    engine_ = VisionEngine(SimpleNamespace(scene_model='missing/yolo-world-cctv.pt'))
    result = engine_.scene_check(clips['empty'], 'SMOKING')
    assert result['visible'] is False and result['source'] == 'unavailable' and 'setup_models.py' in result['warnings'][0]


@pytest.mark.skipif(not (MODELS / 'cctv-scene.pt').is_file(), reason='fine-tuned scene model not installed')
def test_fine_tuned_model_covers_fire_road_damage_and_litter_and_yolo_world_the_rest(engine, clips):
    assert engine.scene_check(clips['empty'], 'FIRE_SMOKE', max_seconds=3)['source'] == 'trained:cctv-scene.pt'
    assert engine.scene_check(clips['empty'], 'POTHOLE', max_seconds=3)['source'] == 'trained:cctv-scene.pt'
    assert engine.scene_check(clips['empty'], 'ILLEGAL_DUMPING', max_seconds=3)['source'] == 'trained:cctv-scene.pt'
    assert engine.scene_check(clips['empty'], 'SMOKING', max_seconds=3)['source'].startswith('yolo-world:')


def test_without_the_fine_tuned_file_fire_falls_back_to_yolo_world(clips):
    from types import SimpleNamespace
    from vision import VisionEngine
    engine_ = VisionEngine(SimpleNamespace(scene_model='missing/yolo-world-cctv.pt', trained_scene_model='missing/cctv-scene.pt'))
    result = engine_.scene_check(clips['empty'], 'FIRE_SMOKE')
    assert result['source'] == 'unavailable' and 'yolo-world-cctv.pt' in result['warnings'][0]
