[CmdletBinding()]
param(
    [ValidateSet('Staging', 'LocalValidation')]
    [string]$Mode,
    [switch]$Install
)

$ErrorActionPreference = 'Stop'

$stagingBackendUrl = 'https://notiventabe-staging.up.railway.app'
$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE."
    }
}

function Select-PackageMode {
    Write-Host ''
    Write-Host 'Choose a package target:'
    Write-Host '  1. Staging (staging branch, Railway backend)'
    Write-Host '  2. Local VM validation (dev branch, Mac-host local backend)'

    $selection = Read-Host 'Enter 1 or 2'
    switch ($selection) {
        '1' { return 'Staging' }
        '2' { return 'LocalValidation' }
        default { throw 'Choose 1 for Staging or 2 for Local VM validation.' }
    }
}

Set-Location $repositoryRoot

if (-not $Mode) {
    $Mode = Select-PackageMode
}

if (git status --porcelain) {
    throw 'The checkout has local changes. This script will not overwrite work.'
}

$branch = if ($Mode -eq 'Staging') { 'staging' } else { 'dev' }

Invoke-CheckedCommand -Command 'git' -Arguments @('fetch', 'origin')
Invoke-CheckedCommand -Command 'git' -Arguments @('switch', $branch)
Invoke-CheckedCommand -Command 'git' -Arguments @('pull', '--ff-only', 'origin', $branch)

$architecture = (& node -p 'process.arch').Trim()
if ($LASTEXITCODE -ne 0) {
    throw 'Could not determine the installed Node architecture.'
}
if ($architecture -notin @('arm64', 'x64')) {
    throw "Only Windows ARM64 and x64 Node installations are supported. Current Node architecture: $architecture."
}
Write-Host ''
Write-Host "Mode: $Mode"
Write-Host "Git branch: $branch"
Write-Host "Node architecture: $architecture"
if ($Mode -eq 'Staging') {
    Write-Host "Embedded backend: $stagingBackendUrl"
    $env:NOTIVENTA_AGENT_STAGING_BACKEND_URL = $stagingBackendUrl
    $packageCommand = "package:staging:win:$architecture"
    $installerDirectory = Join-Path $repositoryRoot 'dist\staging'
    $installerPattern = "NotiVenta-Staging-Setup-*-$architecture.exe"
} else {
    Write-Host 'Embedded backend: http://192.168.64.1:8000'
    $packageCommand = "package:local-validation:win:$architecture"
    $installerDirectory = Join-Path $repositoryRoot 'dist\local-validation'
    $installerPattern = "NotiVenta-Local-Validation-Setup-*-$architecture.exe"
}

Invoke-CheckedCommand -Command 'npm.cmd' -Arguments @('ci')
Invoke-CheckedCommand -Command 'npm.cmd' -Arguments @('test')
Invoke-CheckedCommand -Command 'npm.cmd' -Arguments @('run', $packageCommand)

$installer = Get-ChildItem -Path $installerDirectory -Filter $installerPattern |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $installer) {
    throw 'The installer was not found after packaging.'
}

Write-Host ''
Write-Host 'Installer created:' -ForegroundColor Green
Write-Host $installer.FullName

if (-not $Install) {
    $Install = (Read-Host 'Install this package now? [y/N]') -match '^(?i:y|yes)$'
}
if ($Install) {
    Start-Process -FilePath $installer.FullName -Verb RunAs -Wait
}
