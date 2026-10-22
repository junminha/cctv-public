$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
foreach ($name in @('adapter','relay')) {
    $pidFile = Join-Path $PSScriptRoot "runtime/$name.pid"
    if (Test-Path $pidFile) {
        $ownedProcessId = [int](Get-Content $pidFile)
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ownedProcessId"
        if ($process -and (($name -eq 'adapter' -and $process.CommandLine -match 'adapter.py') -or ($name -eq 'relay' -and $process.CommandLine -like "*$PSScriptRoot*mediamtx.generated.yml*"))) {
            Stop-Process -Id $ownedProcessId
        }
        Remove-Item -LiteralPath $pidFile
    }
}
