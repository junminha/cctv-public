$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force logs | Out-Null
$python = (Get-Command python.exe).Source
Start-Process $python -ArgumentList 'adapter.py' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput 'logs/adapter.stdout.log' -RedirectStandardError 'logs/adapter.stderr.log'
