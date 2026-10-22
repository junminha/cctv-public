$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path 'cameras.json')) { python register.py; if ($LASTEXITCODE -ne 0) { throw 'Camera registration failed' } }
try {
    $null = Invoke-RestMethod 'http://127.0.0.1:8765/api/status' -TimeoutSec 2
    Write-Host 'Already running: http://127.0.0.1:8765'
} catch {
    New-Item -ItemType Directory -Force logs | Out-Null
    $python = (Get-Command python.exe).Source
    Start-Process $python -ArgumentList 'app.py' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput 'logs/base.stdout.log' -RedirectStandardError 'logs/base.stderr.log'
    Start-Sleep -Seconds 4
    $null = Invoke-RestMethod 'http://127.0.0.1:8765/api/status' -TimeoutSec 5
}
Start-Process 'http://127.0.0.1:8765'
