$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path node_modules)) { npm ci }
npx next build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
# Loopback only, like the B FastAPI server.
npx next start -p 3000 -H 127.0.0.1
