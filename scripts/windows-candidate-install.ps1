param(
    [Parameter(Mandatory=$true)][string]$CandidateExe,
    [string]$PreviousInstaller
)
$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $project
$pkg=Get-Content -LiteralPath 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$version=[string]$pkg.version
$payload=Split-Path -Parent (Resolve-Path -LiteralPath $CandidateExe)
$isolation=Join-Path ([IO.Path]::GetTempPath()) ('sonic-windows-qa-'+[guid]::NewGuid().ToString('N'))
$installRoot=Join-Path $isolation ([string]$pkg.name)
$id=[guid]::NewGuid().ToString()
$registry='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$qaKey=Join-Path $registry $id
$normalKey=Join-Path $registry 'fab1b5db-e09d-506f-b7d2-3bfceda9a33d'
$normalBefore=Get-ItemProperty -LiteralPath $normalKey -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $isolation | Out-Null
$builder=@('--win','nsis','--x64','--publish','never',
    '--config.appId=com.sonicuniverse.desktop.installerqa',
    "--config.nsis.guid=$id",
    '--config.nsis.shortcutName=Sonic Universe installer QA',
    '--config.nsis.createDesktopShortcut=false',
    '--config.nsis.createStartMenuShortcut=false',
    "--config.directories.output=$isolation")
function File-Sha256([string]$file){
    $algorithm=[Security.Cryptography.SHA256]::Create()
    $inputFile=[IO.File]::OpenRead($file)
    try{return [Convert]::ToBase64String($algorithm.ComputeHash($inputFile))}
    finally{$inputFile.Dispose();$algorithm.Dispose()}
}
function Build-QA([string]$folder,[string]$targetVersion){
    node 'node_modules/electron-builder/cli.js' @builder --prepackaged $folder "--config.extraMetadata.version=$targetVersion"
    if($LASTEXITCODE){throw "Building QA NSIS $targetVersion failed"}
}
function Install-QA([string]$targetVersion,[string]$step){
    $installer=Join-Path $isolation "Sonic-Universe-$targetVersion-x64.exe"
    $process=Start-Process -FilePath $installer -ArgumentList "/S /currentuser /D=$installRoot" -WindowStyle Hidden -Wait -PassThru
    if($process.ExitCode){throw "$step installer exited with $($process.ExitCode)"}
    $entry=Get-ItemProperty -LiteralPath $qaKey
    if($entry.DisplayVersion -ne $targetVersion -or !(Test-Path -LiteralPath $env:SONIC_DESKTOP_EXECUTABLE)){
        throw "$step identity or install directory mismatch for $targetVersion"
    }
    $activeNormal=Get-ItemProperty -LiteralPath $normalKey -ErrorAction SilentlyContinue
    if($activeNormal.DisplayVersion -ne $normalBefore.DisplayVersion -or $activeNormal.UninstallString -ne $normalBefore.UninstallString){
        throw 'Existing installation changed during isolated installation'
    }
    Write-Output "PASS $step NSIS $targetVersion, isolated registry $id"
}
$beforeVersion=$version
if($PreviousInstaller){
    $prior=(Resolve-Path -LiteralPath $PreviousInstaller).Path
    if((Split-Path -Leaf $prior) -notmatch '^Sonic-Universe-(\d+\.\d+\.\d+)-x64\.exe$'){
        throw 'Previous installer name must identify the version'
    }
    $beforeVersion=$Matches[1]
    $older=Join-Path $isolation 'prior'
    New-Item -ItemType Directory -Path $older | Out-Null
    tar.exe -xf $prior -C $older
    if($LASTEXITCODE){throw "Extracting previous installer $beforeVersion failed"}
    Build-QA $older $beforeVersion
}
Build-QA $payload $version
$oldExe=$env:SONIC_DESKTOP_EXECUTABLE
$oldProfile=$env:SONIC_QA_PROFILE
$oldPort=$env:SONIC_QA_PORT
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
try{
    $listener.Start()
    $env:SONIC_QA_PORT=[string]$listener.LocalEndpoint.Port
}finally{$listener.Stop()}
try{
    $env:SONIC_DESKTOP_EXECUTABLE=Join-Path $installRoot ([string]$pkg.build.productName+'.exe')
    $env:SONIC_QA_PROFILE=Join-Path $isolation 'profile'
    Install-QA $beforeVersion 'Clean install'
    node 'scripts/windows-candidate-local.cjs' --seed-only
    if($LASTEXITCODE){throw 'Clean install playback or data write failed'}
    Install-QA $version 'Overwrite'
    if((File-Sha256 $CandidateExe) -cne (File-Sha256 $env:SONIC_DESKTOP_EXECUTABLE)){
        throw 'Installed EXE does not match the candidate payload'
    }
    node 'scripts/windows-candidate-local.cjs' --resume-only
    if($LASTEXITCODE){throw 'After overwrite: playlist, lyric or resume verification failed'}
}finally{
    $uninstall=Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall *.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if($uninstall -and $uninstall.Directory.FullName -eq $installRoot -and (Test-Path -LiteralPath $qaKey)){
        $remove=Start-Process -FilePath $uninstall.FullName -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
        if($remove.ExitCode -or (Test-Path -LiteralPath $qaKey)){Write-Warning "QA uninstall could not finish at $installRoot"}
    }
    $env:SONIC_DESKTOP_EXECUTABLE=$oldExe
    $env:SONIC_QA_PROFILE=$oldProfile
    $env:SONIC_QA_PORT=$oldPort
}

