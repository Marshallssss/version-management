#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$BackupRoot,
    [Parameter(Mandatory)][string]$FileStoreRoot,
    [Parameter(Mandatory)][string]$DatabaseHost,
    [Parameter(Mandatory)][string]$DatabaseName,
    [Parameter(Mandatory)][string]$DatabaseUser,
    [int]$DatabasePort = 5432,
    [ValidateSet('Online', 'Quiesced')][string]$Mode = 'Online',
    [string]$PgDumpCommand = 'pg_dump'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

Assert-Command $PgDumpCommand
if (-not (Test-Path $FileStoreRoot -PathType Container)) {
    throw "File store was not found: $FileStoreRoot"
}

$timestamp = [DateTimeOffset]::Now.ToString('yyyyMMdd-HHmmss')
$backupName = "ConfigHub-$timestamp"
$partialPath = Join-Path $BackupRoot "$backupName.partial"
$finalPath = Join-Path $BackupRoot $backupName
$databaseDump = Join-Path $partialPath 'database.dump'
$filesDestination = Join-Path $partialPath 'files'

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
if ((Test-Path $partialPath) -or (Test-Path $finalPath)) {
    throw "Backup target already exists: $backupName"
}
New-Item -ItemType Directory -Path $partialPath, $filesDestination -Force | Out-Null

try {
    Write-Host "Creating $Mode PostgreSQL backup..."
    & $PgDumpCommand `
        --host=$DatabaseHost `
        --port=$DatabasePort `
        --username=$DatabaseUser `
        --dbname=$DatabaseName `
        --format=custom `
        --no-password `
        --file=$databaseDump
    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE." }

    Write-Host 'Copying immutable file store...'
    & robocopy.exe $FileStoreRoot $filesDestination /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:3 /NFL /NDL /NJH /NJS
    if ($LASTEXITCODE -gt 7) { throw "File store copy failed with robocopy exit code $LASTEXITCODE." }

    $entries = Get-ChildItem -Path $partialPath -File -Recurse | Sort-Object FullName | ForEach-Object {
        [pscustomobject]@{
            path = [IO.Path]::GetRelativePath($partialPath, $_.FullName)
            length = $_.Length
            sha256 = (Get-FileHash -Path $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }

    $manifestPath = Join-Path $partialPath 'manifest.json'
    [ordered]@{
        formatVersion = 1
        product = 'ConfigHub'
        mode = $Mode
        createdAt = [DateTimeOffset]::UtcNow.ToString('O')
        database = [ordered]@{ host = $DatabaseHost; port = $DatabasePort; name = $DatabaseName }
        files = $entries
    } | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestPath -Encoding UTF8

    (Get-FileHash -Path $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() |
        Set-Content -Path (Join-Path $partialPath 'manifest.sha256') -Encoding ASCII

    foreach ($entry in $entries) {
        $actual = (Get-FileHash -Path (Join-Path $partialPath $entry.path) -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $entry.sha256) { throw "Backup verification failed for $($entry.path)." }
    }

    Move-Item -Path $partialPath -Destination $finalPath
    Write-Host "Verified backup completed: $finalPath"
    $finalPath
} catch {
    Write-Error "Backup failed. Incomplete data remains at: $partialPath"
    throw
}
