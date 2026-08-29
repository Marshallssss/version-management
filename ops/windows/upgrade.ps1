#Requires -Version 7.4
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)][string]$ReleasePath,
    [Parameter(Mandatory)][string]$BackupRoot,
    [Parameter(Mandatory)][string]$DatabaseHost,
    [Parameter(Mandatory)][string]$DatabaseName,
    [Parameter(Mandatory)][string]$DatabaseUser,
    [int]$DatabasePort = 5432,
    [string]$InstallRoot = 'C:\Program Files\ConfigHub',
    [string]$FileStoreRoot = 'D:\ConfigHubData\files',
    [string]$SiteName = 'ConfigHub',
    [string]$AppPoolName = 'ConfigHub',
    [string]$WorkerServiceName = 'ConfigHub.Worker'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

Assert-Administrator
Import-Module WebAdministration
[void](Get-RequiredMachineEnvironmentVariable 'ConnectionStrings__ConfigHub')
[void](Get-RequiredMachineEnvironmentVariable 'ConnectionStrings__ConfigHubMigration')

$release = (Resolve-Path $ReleasePath).Path
$paths = Get-ConfigHubPaths -InstallRoot $InstallRoot
$manifestPath = Join-Path $release 'release-manifest.json'
foreach ($required in @($manifestPath, (Join-Path $release 'host\ConfigHub.Host.exe'), (Join-Path $release 'worker\ConfigHub.Worker.exe'), $paths.Host, $paths.Worker)) {
    if (-not (Test-Path $required)) { throw "Required upgrade input was not found: $required" }
}

$manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
foreach ($entry in $manifest.files) {
    $candidate = Join-Path $release $entry.path
    if (-not (Test-Path $candidate -PathType Leaf)) { throw "Release file is missing: $($entry.path)" }
    $actual = (Get-FileHash -Path $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $entry.sha256) { throw "Release checksum mismatch: $($entry.path)" }
}

if (-not $PSCmdlet.ShouldProcess($InstallRoot, "Upgrade ConfigHub to $($manifest.version)")) {
    return
}

$rollbackPath = Join-Path $paths.Rollback ([DateTimeOffset]::Now.ToString('yyyyMMdd-HHmmss'))
$upgradeSucceeded = $false
Enter-ConfigHubMaintenance -HostPath $paths.Host
Stop-Service -Name $WorkerServiceName -Force
Stop-Website -Name $SiteName
Stop-WebAppPool -Name $AppPoolName

try {
    & (Join-Path $PSScriptRoot 'backup.ps1') `
        -BackupRoot $BackupRoot `
        -FileStoreRoot $FileStoreRoot `
        -DatabaseHost $DatabaseHost `
        -DatabaseName $DatabaseName `
        -DatabaseUser $DatabaseUser `
        -DatabasePort $DatabasePort `
        -Mode Quiesced

    New-Item -ItemType Directory -Path (Join-Path $rollbackPath 'host'), (Join-Path $rollbackPath 'worker') -Force | Out-Null
    Copy-Item -Path (Join-Path $paths.Host '*') -Destination (Join-Path $rollbackPath 'host') -Recurse -Force
    Copy-Item -Path (Join-Path $paths.Worker '*') -Destination (Join-Path $rollbackPath 'worker') -Recurse -Force

    & robocopy.exe (Join-Path $release 'host') $paths.Host /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:3 /NFL /NDL /NJH /NJS
    if ($LASTEXITCODE -gt 7) { throw 'Host file deployment failed.' }
    & robocopy.exe (Join-Path $release 'worker') $paths.Worker /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:3 /NFL /NDL /NJH /NJS
    if ($LASTEXITCODE -gt 7) { throw 'Worker file deployment failed.' }

    & (Join-Path $paths.Host 'ConfigHub.Host.exe') --migrate
    if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }

    $upgradeSucceeded = $true
} catch {
    Write-Warning 'Upgrade failed; restoring previous binaries. Database migrations must remain backward-compatible.'
    if (Test-Path $rollbackPath) {
        & robocopy.exe (Join-Path $rollbackPath 'host') $paths.Host /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:3 /NFL /NDL /NJH /NJS | Out-Null
        & robocopy.exe (Join-Path $rollbackPath 'worker') $paths.Worker /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:3 /NFL /NDL /NJH /NJS | Out-Null
    }
    throw
} finally {
    Exit-ConfigHubMaintenance -HostPath $paths.Host
    Start-WebAppPool -Name $AppPoolName
    Start-Website -Name $SiteName
    Start-Service -Name $WorkerServiceName
}

if ($upgradeSucceeded) {
    Write-Host "ConfigHub upgraded to $($manifest.version). Previous binaries: $rollbackPath"
}
