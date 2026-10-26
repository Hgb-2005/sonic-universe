param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$siteRoot = Join-Path $taskRoot 'outputs'
$logRoot = Join-Path $taskRoot 'work'
$siteUrl = 'http://127.0.0.1:8765/?v=11'
try {
    if (-not (Test-Path -LiteralPath (Join-Path $siteRoot 'index.html'))) { throw 'Missing outputs/index.html.' }
    function Test-UniverseServer {
        try {
            $page = Invoke-WebRequest -Uri $siteUrl -UseBasicParsing -TimeoutSec 2
            return ($page.StatusCode -eq 200 -and $page.Content.Contains('id="instrumentDialog"'))
        } catch { return $false }
    }
    if (-not (Test-UniverseServer)) {
        $occupied = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
        if ($occupied) { throw 'Port 8765 is used by another service. Close that service and retry.' }
        $python = Get-Command python.exe -ErrorAction Stop
        New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
        $pythonWindowless = Join-Path (Split-Path $python.Source) 'pythonw.exe'
        if (-not (Test-Path -LiteralPath $pythonWindowless)) { $pythonWindowless = $python.Source }
        $serverScript = Join-Path $taskRoot 'serve-universe.py'
        $serverCommand = ('"' + $pythonWindowless + '" "' + $serverScript + '"')
        $started = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$serverCommand}
        if ($started.ReturnValue -ne 0) { throw ('Preview server launch failed: ' + $started.ReturnValue) }
        $ready = $false
        for ($attempt = 0; $attempt -lt 10; $attempt++) {
            Start-Sleep -Milliseconds 300
            if (Test-UniverseServer) { $ready = $true; break }
        }
        if (-not $ready) { throw 'Preview server did not start. See work/server-errors.log.' }
    }
    Write-Host ('Ready: ' + $siteUrl)
    if (-not $NoBrowser) { Start-Process $siteUrl }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    if (-not $NoBrowser) { Read-Host 'Press Enter to close' | Out-Null }
    exit 1
}
