#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$')][string]$Version,
    [string]$Runtime = 'win-x64',
    [string]$OutputRoot = (Join-Path $PSScriptRoot '..\..\artifacts\release')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-Command dotnet
Assert-Command npm

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$releaseRoot = Join-Path $OutputRoot $Version
$hostOutput = Join-Path $releaseRoot 'host'
$workerOutput = Join-Path $releaseRoot 'worker'

if (Test-Path $releaseRoot) {
    throw "Release output already exists: $releaseRoot"
}

New-Item -ItemType Directory -Path $hostOutput, $workerOutput -Force | Out-Null

& dotnet publish (Join-Path $repositoryRoot 'src\server\Host\ConfigHub.Host.csproj') `
    --configuration Release `
    --runtime $Runtime `
    --self-contained false `
    -p:Version=$Version `
    --output $hostOutput
if ($LASTEXITCODE -ne 0) { throw 'Host publish failed.' }

& dotnet publish (Join-Path $repositoryRoot 'src\server\Worker\ConfigHub.Worker.csproj') `
    --configuration Release `
    --runtime $Runtime `
    --self-contained false `
    -p:Version=$Version `
    --output $workerOutput
if ($LASTEXITCODE -ne 0) { throw 'Worker publish failed.' }

$files = Get-ChildItem -Path $releaseRoot -File -Recurse | ForEach-Object {
    [pscustomobject]@{
        path = [IO.Path]::GetRelativePath($releaseRoot, $_.FullName)
        length = $_.Length
        sha256 = (Get-FileHash -Path $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

[ordered]@{
    product = 'ConfigHub'
    version = $Version
    runtime = $Runtime
    createdAt = [DateTimeOffset]::UtcNow.ToString('O')
    files = $files
} | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $releaseRoot 'release-manifest.json') -Encoding UTF8

Write-Host "Release created: $releaseRoot"
