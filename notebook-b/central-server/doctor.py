"""Read-only diagnostics; NVIDIA driver visibility is not an inference benchmark."""
import importlib.util
import json
import platform
import shutil
import subprocess


def diagnose():
    result = {'python': platform.python_version(), 'platform': platform.system(),
              'nvidia_driver': 'NOT_TESTED', 'pytorch_cuda': 'NOT_INSTALLED',
              'ffmpeg': bool(shutil.which('ffmpeg')), 'tailscale': bool(shutil.which('tailscale')),
              'a_external_connection': 'NOT_TESTED'}
    command = shutil.which('nvidia-smi')
    if command:
        try:
            process = subprocess.run([command, '--query-gpu=name,memory.total,driver_version',
                                      '--format=csv,noheader'], capture_output=True, text=True,
                                     timeout=10, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            result['nvidia_driver'] = process.stdout.strip() if process.returncode == 0 else 'UNAVAILABLE'
        except (OSError, subprocess.TimeoutExpired):
            result['nvidia_driver'] = 'UNAVAILABLE'
    if importlib.util.find_spec('torch') is not None:
        try:
            import torch
            result['pytorch_cuda'] = {'version': torch.__version__, 'built_cuda': torch.version.cuda,
                                      'available': torch.cuda.is_available()}
        except (ImportError, OSError):
            result['pytorch_cuda'] = 'IMPORT_FAILED'
    return result


if __name__ == '__main__':
    print(json.dumps(diagnose(), ensure_ascii=False, indent=2))
