param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\release'),
    [string]$ExpectedPublisher = $env:SONIC_WINDOWS_PUBLISHER
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ExpectedPublisher)) {
    throw 'Set SONIC_WINDOWS_PUBLISHER to the authorized certificate publisher name.'
}
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1')

$package = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$appName = $package.build.productName
$executables = @(
    (Join-Path $OutputDirectory "Sonic-Universe-$($package.version)-x64.exe"),
    (Join-Path $OutputDirectory "win-unpacked\$appName.exe")
)

foreach ($file in $executables) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid') {
        throw "Invalid Windows signature ($($signature.Status)) on $file"
    }
    $publisher = $signature.SignerCertificate.GetNameInfo(
        [System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if ($publisher -cne $ExpectedPublisher) {
        throw "Unexpected Windows publisher '$publisher' on $file"
    }
    Write-Output "Valid Windows signature from '$publisher' on $file"
}
