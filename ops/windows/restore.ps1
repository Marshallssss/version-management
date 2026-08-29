#Requires -Version 7.4
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)][string]$BackupPath,
    [Parameter(Mandatory)][string]$FileStoreRoot,
    [Parameter(Mandatory)][string]$DatabaseHost,
    [Parameter(Mandatory)][string]$DatabaseName,
    [Parameter(Mandatory)][string]$DatabaseOwner,
    [Parameter(Mandatory)][string]$DatabaseAdminUser,
    [int]$DatabasePort = 5432,
    [string]$InstallRoot = 'C:\Program Files\ConfigHub',
    [string]$SiteName = 'ConfigHub',
    [string]$AppPoolName = 'ConfigHub',
    [string]$WorkerServiceName = 'ConfigHub.Worker',
    [string]$PgRestoreCommand = 'pg_restore',
    [string]$CreateDatabaseCommand = 'createdb',
    [string]$DropDatabaseCommand = 'dropdb'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

Assert-Administrator
Assert-Command $PgRestoreCommand
Assert-Command $CreateDatabaseCommand
Assert-Command $DropDatabaseCommand
Import-Module WebAdministration

$resolvedBackup = (Resolve-Path $BackupPath).Path
$manifestPath = Join-Path $resolvedBackup 'manifest.json'
$manifestHashPath = Join-Path $resolvedBackup 'manifest.sha256'
$databaseDump = Join-Path $resolvedBackup 'database.dump'
$backupFiles = Join-Path $resolvedBackup 'files'
$paths = Get-ConfigHubPaths -InstallRoot $InstallRoot

foreach ($required in @($manifestPath, $manifestHashPath, $databaseDump, $backupFiles, $paths.Host)) {
    if (-not (Test-Path $required)) { throw "Required restore input was not found: $required" }
}
if ($FileStoreRoot.Length -lt 8 -or [IO.Path]::GetPathRoot($FileStoreRoot) -eq $FileStoreRoot) {
    throw "Unsafe file-store restore target: $FileStoreRoot"
}

$expectedManifestHash = (Get-Content -Path $manifestHashPath -Raw).Trim()
$actualManifestHash = (Get-FileHash -Path $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualManifestHash -ne $expectedManifestHash) { throw 'Backup manifest checksum does not match.' }

$manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
foreach ($entry in $manifest.files) {
    $candidate = Join-Path $resolvedBackup $entry.path
    if (-not (Test-Path $candidate -PathType Leaf)) { throw "Backup file is missing: $($entry.path)" }
    $actual = (Get-FileHash -Path $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $entry.sha256) { throw "Backup checksum mismatch: $($entry.path)" }
}

if (-not $PSCmdlet.ShouldProcess("database '$DatabaseName' and file store '$FileStoreRoot'", "Restore from '$resolvedBackup'")) {
    return
}

$restoreSucceeded = $false
Enter-ConfigHubMaintenance -HostPath $paths.Host
Stop-Service -Name $WorkerServiceName -Force -ErrorAction SilentlyContinue
Stop-Website -Name $SiteName -ErrorAction SilentlyContinue
Stop-WebAppPool -Name $AppPoolName -ErrorAction SilentlyContinue

try {
    & $DropDatabaseCommand --host=$DatabaseHost --port=$DatabasePort --username=$DatabaseAdminUser --if-exists --force --no-password $DatabaseName
    if ($LASTEXITCODE -ne 0) { throw 'dropdb failed.' }

    & $CreateDatabaseCommand --host=$DatabaseHost --port=$DatabasePort --username=$DatabaseAdminUser --owner=$DatabaseOwner --no-password $DatabaseName
    if ($LASTEXITCODE -ne 0) { throw 'createdb failed.' }

    & $PgRestoreCommand --host=$DatabaseHost --port=$DatabasePort --username=$DatabaseAdminUser --dbname=$DatabaseName --no-owner --no-password $databaseDump
    if ($LASTEXITCODE -ne 0) { throw 'pg_restore failed.' }

    New-Item -ItemType Directory -Path $FileStoreRoot -Force | Out-Null
    & robocopy.exe $backupFiles $FileStoreRoot /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:3 /NFL /NDL /NJH /NJS
    if ($LASTEXITCODE -gt 7) { throw "File store restore failed with robocopy exit code $LASTEXITCODE." }

    $restoreSucceeded = $true
} finally {
    if ($restoreSucceeded) {
        Exit-ConfigHubMaintenance -HostPath $paths.Host
        Start-WebAppPool -Name $AppPoolName
        Start-Website -Name $SiteName
        Start-Service -Name $WorkerServiceName
        Write-Host 'Restore completed and ConfigHub restarted.'
    } else {
        Write-Warning 'Restore failed. ConfigHub remains in maintenance mode for operator investigation.'
    }
}
