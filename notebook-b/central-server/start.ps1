$ErrorActionPreference = 'Stop'
$serverRoot = $PSScriptRoot
$pythonPath = Join-Path $serverRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw 'Create the Python 3.11 environment and install requirements first; see README.md.'
}
& $pythonPath (Join-Path $serverRoot 'configure.py')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $pythonPath -m uvicorn server:application --factory --app-dir $serverRoot --host 127.0.0.1 --port 8000
exit $LASTEXITCODE
