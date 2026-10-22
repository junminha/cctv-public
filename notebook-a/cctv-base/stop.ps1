$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (Test-Path 'runtime/base.pid') {
    $baseProcessId = [int](Get-Content 'runtime/base.pid')
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$baseProcessId"
    if ($process -and $process.CommandLine -match 'app.py') {
        # Local authenticated-by-loopback shutdown flushes FFmpeg before MediaMTX stops.
        Invoke-RestMethod -Method Post 'http://127.0.0.1:8765/api/shutdown' -Headers @{'Origin'='http://127.0.0.1:8765'}
    }
}
