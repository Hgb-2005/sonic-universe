param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$siteRoot = Join-Path $taskRoot 'outputs'
$companionRoot = Join-Path $taskRoot 'companion'
$logRoot = Join-Path $taskRoot 'work'
$siteUrl = 'http://127.0.0.1:8765/?v=29'
$healthUrl = 'http://127.0.0.1:8765/health'

function Test-UniversePage {
    try {
        $page = Invoke-WebRequest -Uri $siteUrl -UseBasicParsing -TimeoutSec 2
        return ($page.StatusCode -eq 200 -and $page.Content.Contains('id="instrumentDialog"'))
    } catch {
        return $false
    }
}

function Test-CompanionHealth {
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
        return ($health.ok -eq $true -and $health.companion -eq $true)
    } catch {
        return $false
    }
}

function Find-Node24 {
    $candidates = @()
    if ($env:SONIC_UNIVERSE_NODE) { $candidates += $env:SONIC_UNIVERSE_NODE }
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { $candidates += $nodeCommand.Source }
    if ($env:USERPROFILE) {
        $candidates += (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not $candidate -or -not (Test-Path -LiteralPath $candidate)) { continue }
        try {
            $version = (& $candidate --version 2>$null).Trim()
            if ($version -match '^v(\d+)\.' -and [int]$Matches[1] -ge 24) { return $candidate }
        } catch {}
    }
    return $null
}

function Find-Npm {
    $command = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    return $null
}

function Stop-LegacyPreviewServer {
    $connection = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $connection) { return }
    $process = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $connection.OwningProcess) -ErrorAction SilentlyContinue
    if (-not $process) { return }
    $commandLine = [string]$process.CommandLine
    $isLegacyServer = ($commandLine -like '*serve-universe.py*') -or
        ($commandLine -like '*http.server*8765*' -and $commandLine -like ('*' + $siteRoot + '*'))
    if ($isLegacyServer) {
        Stop-Process -Id $connection.OwningProcess -Force
        for ($attempt = 0; $attempt -lt 10; $attempt++) {
            Start-Sleep -Milliseconds 150
            if (-not (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue)) { return }
        }
    }
}

function Start-Companion {
    $node = Find-Node24
    if (-not $node) { throw '需要 Node.js 24 或更高版本才能启动汽水音乐入口。' }
    $providerPackage = Join-Path $companionRoot 'node_modules\qishui-music-api\package.json'
    if (-not (Test-Path -LiteralPath $providerPackage)) {
        $npm = Find-Npm
        if (-not $npm) { throw '汽水音乐组件尚未安装，且没有找到 npm。请先运行 npm ci。' }
        Write-Host '首次启动：正在安装汽水音乐组件…'
        Push-Location $companionRoot
        try {
            & $npm ci --no-audit --no-fund *> (Join-Path $logRoot 'companion-install.log')
            if ($LASTEXITCODE -ne 0) { throw '汽水音乐组件安装失败，请查看 work\companion-install.log。' }
        } finally {
            Pop-Location
        }
    }
    $companionProcess = Start-Process -FilePath $node `
        -ArgumentList @('server.cjs') `
        -WorkingDirectory $companionRoot `
        -RedirectStandardOutput (Join-Path $logRoot 'companion.log') `
        -RedirectStandardError (Join-Path $logRoot 'companion-errors.log') `
        -WindowStyle Hidden `
        -PassThru
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 250
        if (Test-CompanionHealth) { return }
        if ($companionProcess.HasExited) { break }
    }
    $detail = ''
    $errorLog = Join-Path $logRoot 'companion-errors.log'
    if (Test-Path -LiteralPath $errorLog) {
        $detail = (Get-Content -LiteralPath $errorLog -Tail 4 -ErrorAction SilentlyContinue) -join ' '
    }
    throw ('汽水音乐入口没有启动成功。' + $detail).Trim()
}

function Start-FallbackPreview {
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if (-not $python) { throw '汽水音乐入口和 Python 预览服务都不可用。' }
    $pythonWindowless = Join-Path (Split-Path $python.Source) 'pythonw.exe'
    if (-not (Test-Path -LiteralPath $pythonWindowless)) { $pythonWindowless = $python.Source }
    $serverScript = Join-Path $taskRoot 'serve-universe.py'
    $serverCommand = ('"' + $pythonWindowless + '" "' + $serverScript + '"')
    $started = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$serverCommand}
    if ($started.ReturnValue -ne 0) { throw ('基础预览服务启动失败：' + $started.ReturnValue) }
}

try {
    if (-not (Test-Path -LiteralPath (Join-Path $siteRoot 'index.html'))) { throw '缺少 outputs\index.html。' }
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

    if (-not (Test-CompanionHealth)) {
        if (Test-UniversePage) { Stop-LegacyPreviewServer }
        $occupied = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
        if ($occupied) { throw '端口 8765 正被其他程序使用。请关闭该程序后重试。' }
        try {
            Start-Companion
        } catch {
            $companionError = $_.Exception.Message
            Write-Host ($companionError + ' 将先打开基础星空；在线音乐功能会显示离线。') -ForegroundColor Yellow
            for ($attempt = 0; $attempt -lt 20; $attempt++) {
                Start-Sleep -Milliseconds 200
                if (-not (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue)) { break }
            }
            if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) {
                throw '端口 8765 仍被占用，无法启动基础预览。'
            }
            Start-FallbackPreview
        }
    }

    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (Test-UniversePage) { $ready = $true; break }
        Start-Sleep -Milliseconds 250
    }
    if (-not $ready) { throw '声波宇宙没有启动成功，请查看 work 文件夹中的日志。' }

    $online = if (Test-CompanionHealth) { '汽水音乐在线入口已连接' } else { '当前为基础模式，在线音乐离线' }
    Write-Host ('Ready: ' + $siteUrl)
    Write-Host $online
    if (-not $NoBrowser) { Start-Process $siteUrl }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    if (-not $NoBrowser) { Read-Host '按 Enter 关闭' | Out-Null }
    exit 1
}
