[CmdletBinding()]
param(
    [ValidateSet('Local', 'Staging')]
    [string]$Mode
)

$ErrorActionPreference = 'Stop'

$localBackendUrl = 'http://192.168.64.1:8000'
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

function Select-SourceMode {
    Write-Host ''
    Write-Host 'Choose an unpackaged Agent session:'
    Write-Host '  1. Local Mac DEV (dev branch, http://192.168.64.1:8000)'
    Write-Host '  2. Staging source session (staging branch, Railway backend)'

    $selection = Read-Host 'Enter 1 or 2'
    switch ($selection) {
        '1' { return 'Local' }
        '2' { return 'Staging' }
        default { throw 'Choose 1 for Local Mac DEV or 2 for Staging.' }
    }
}

Set-Location $repositoryRoot

if (-not $Mode) {
    $Mode = Select-SourceMode
}

if (git status --porcelain) {
    throw 'The checkout has local changes. This script will not overwrite work.'
}

$previousHead = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
    throw 'Could not determine the current Git revision.'
}

$branch = if ($Mode -eq 'Local') { 'dev' } else { 'staging' }

Invoke-CheckedCommand -Command 'git' -Arguments @('fetch', 'origin')
Invoke-CheckedCommand -Command 'git' -Arguments @('switch', $branch)
Invoke-CheckedCommand -Command 'git' -Arguments @('pull', '--ff-only', 'origin', $branch)

& git diff --quiet "$previousHead..HEAD" -- package.json package-lock.json
$dependencyDifferenceExitCode = $LASTEXITCODE
if ($dependencyDifferenceExitCode -gt 1) {
    throw 'Could not compare dependency files after updating the checkout.'
}

$nodeModulesPath = Join-Path $repositoryRoot 'node_modules'
if (-not (Test-Path $nodeModulesPath) -or $dependencyDifferenceExitCode -eq 1) {
    Invoke-CheckedCommand -Command 'npm.cmd' -Arguments @('ci')
}

$electronPackagePath = Join-Path $nodeModulesPath 'electron'
$electronPathFile = Join-Path $electronPackagePath 'path.txt'
$electronExecutable = if (Test-Path $electronPathFile) {
    Join-Path (Join-Path $electronPackagePath 'dist') (Get-Content $electronPathFile -Raw).Trim()
}
if (-not $electronExecutable -or -not (Test-Path $electronExecutable)) {
    Invoke-CheckedCommand -Command 'npx.cmd' -Arguments @('install-electron', '--no')
}

Write-Host ''
Write-Host "Mode: $Mode"
Write-Host "Git branch: $branch"
if ($Mode -eq 'Local') {
    Write-Host "Backend: $localBackendUrl"
    $env:NOTIVENTA_AGENT_ENV = 'development'
    $env:NOTIVENTA_AGENT_BACKEND_URL = $localBackendUrl
    $env:NOTIVENTA_AGENT_ALLOW_INSECURE_LOCAL_NETWORK = 'true'
} else {
    Write-Host "Backend: $stagingBackendUrl"
    $env:NOTIVENTA_AGENT_ENV = 'staging'
    $env:NOTIVENTA_AGENT_BACKEND_URL = $stagingBackendUrl
    Remove-Item Env:NOTIVENTA_AGENT_ALLOW_INSECURE_LOCAL_NETWORK -ErrorAction SilentlyContinue
}

Write-Host 'Starting the unpackaged Electron Agent. Press Ctrl+C to stop it.'
Invoke-CheckedCommand -Command 'npm.cmd' -Arguments @('run', 'dev')
