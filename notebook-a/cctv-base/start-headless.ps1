$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$python = (Get-Command python.exe).Source
& $python app.py
exit $LASTEXITCODE
