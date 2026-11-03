"""Download B-only AI model files into runtime/models and record their SHA256 receipts."""
import hashlib
import json
from pathlib import Path
import shutil
import urllib.request

from models import utc

ROOT = Path(__file__).resolve().parent
FOLDER = ROOT / 'runtime/models'
POSE_URL = ('https://storage.googleapis.com/mediapipe-models/pose_landmarker/'
            'pose_landmarker_lite/float16/latest/pose_landmarker_lite.task')


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def main():
    FOLDER.mkdir(parents=True, exist_ok=True)
    receipt_path = FOLDER / 'manifest.json'
    receipt = json.loads(receipt_path.read_text(encoding='utf-8')) if receipt_path.exists() else {}
    yolo = FOLDER / 'yolo26n.pt'
    if not yolo.exists():
        from ultralytics.utils.downloads import attempt_download_asset
        # Ultralytics resolves the official GitHub release asset for this file name.
        downloaded = Path(attempt_download_asset('yolo26n.pt'))
        shutil.move(str(downloaded), yolo)
    pose = FOLDER / 'pose_landmarker_lite.task'
    if not pose.exists():
        partial = pose.with_suffix('.partial')
        with urllib.request.urlopen(POSE_URL, timeout=120) as response, partial.open('wb') as output:
            shutil.copyfileobj(response, output)
        partial.rename(pose)
    scene = FOLDER / 'yolo-world-cctv.pt'
    if not scene.exists():
        # YOLO-World with the words in vision.SCENE_VOCAB baked in, so runtime needs neither CLIP nor an API.
        from ultralytics import YOLOWorld
        from ultralytics.utils.downloads import attempt_download_asset
        from vision import SCENE_WORDS
        base = Path(attempt_download_asset('yolov8s-worldv2.pt'))
        model = YOLOWorld(str(base))
        model.set_classes(SCENE_WORDS)
        model.save(str(scene))
        base.unlink(missing_ok=True)
    for path, source in ((yolo, 'ultralytics GitHub release asset yolo26n.pt'), (pose, POSE_URL),
                         (scene, 'yolov8s-worldv2.pt (ultralytics release) + vision.SCENE_VOCAB via CLIP set_classes')):
        value = digest(path)
        previous = receipt.get(path.name)
        if previous and previous['sha256'] != value:
            raise SystemExit(f'{path.name} changed since it was recorded; inspect before use')
        receipt.setdefault(path.name, {'sha256': value, 'bytes': path.stat().st_size,
                                       'source': source, 'retrieved_at': utc()})
    receipt_path.write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()
