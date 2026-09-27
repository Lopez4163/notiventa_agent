$ErrorActionPreference = 'Stop'

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    try {
        return (& $Command @Arguments 2>$null | Select-Object -First 1)
    }
    catch {
        return 'NOT AVAILABLE'
    }
}

$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$packagePath = Join-Path $repositoryRoot 'package.json'
$electronPackagePath = Join-Path $repositoryRoot 'node_modules\electron\package.json'
$nodeModulesPath = Join-Path $repositoryRoot 'node_modules'

$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
$agentPackage = Get-Content $packagePath -Raw | ConvertFrom-Json
$electronVersion = if (Test-Path $electronPackagePath) {
    (Get-Content $electronPackagePath -Raw | ConvertFrom-Json).version
} else {
    'NOT INSTALLED'
}

Write-Output "Windows version: $($os.Caption) $($os.Version) (build $($os.BuildNumber))"
Write-Output "OS architecture: $($os.OSArchitecture)"
Write-Output "System architecture: $($computer.SystemType)"
Write-Output "Node version: $(Invoke-CheckedCommand -Command 'node' -Arguments @('--version'))"
Write-Output "npm version: $(Invoke-CheckedCommand -Command 'npm' -Arguments @('--version'))"
Write-Output "Node process.arch: $(Invoke-CheckedCommand -Command 'node' -Arguments @('-p', 'process.arch'))"
Write-Output "Electron version: $electronVersion"
Write-Output "Agent package version: $($agentPackage.version)"
Write-Output "Hostname/systemName: $([System.Net.Dns]::GetHostName())"
Write-Output "Current user: $([Environment]::UserName)"
Write-Output "Dependencies installed: $(if (Test-Path $nodeModulesPath) { 'YES' } else { 'NO' })"
