#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$')][string]$Version,
    [string]$Runtime = 'win-x64',
    [string]$OutputRoot = (Join-Path $PSScriptRoot '..\..\artifacts\release'),
    [string]$NuGetConfigFile,
    [string]$NpmRegistry,
    [switch]$SkipRestore,
    [switch]$SkipFrontendBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-Command dotnet
if (-not $SkipFrontendBuild) { Assert-Command npm }

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$solutionPath = Join-Path $repositoryRoot 'src\server\ConfigHub.slnx'
$webRoot = Join-Path $repositoryRoot 'src\web'
$webIndex = Join-Path $repositoryRoot 'src\server\Host\wwwroot\index.html'
$releaseRoot = Join-Path $OutputRoot $Version
$hostOutput = Join-Path $releaseRoot 'host'
$workerOutput = Join-Path $releaseRoot 'worker'

if (Test-Path $releaseRoot) {
    throw "Release output already exists: $releaseRoot"
}

if (-not $SkipRestore) {
    $restoreArguments = @('restore', $solutionPath, '--runtime', $Runtime)
    if (-not [string]::IsNullOrWhiteSpace($NuGetConfigFile)) {
        $resolvedNuGetConfig = Resolve-Path $NuGetConfigFile -ErrorAction SilentlyContinue
        if ($null -eq $resolvedNuGetConfig) { throw "NuGet config file was not found: $NuGetConfigFile" }
        $restoreArguments += @('--configfile', $resolvedNuGetConfig.Path)
        Write-Host "Restoring .NET packages from the configured package source."
    } else {
        Write-Host "Restoring .NET packages from the default configured package sources."
    }
    & dotnet @restoreArguments
    if ($LASTEXITCODE -ne 0) { throw 'NuGet restore failed.' }
} else {
    $assetFiles = @(
        (Join-Path $repositoryRoot 'src\server\Host\obj\project.assets.json'),
        (Join-Path $repositoryRoot 'src\server\Worker\obj\project.assets.json')
    )
    $missingRuntimeAssets = @($assetFiles | Where-Object { -not (Test-Path $_ -PathType Leaf) -or -not (Select-String -Path $_ -SimpleMatch "net10.0/$Runtime" -Quiet) })
    if ($missingRuntimeAssets.Count -gt 0) {
        throw "Skipping restore requires pre-warmed $Runtime assets. Run 'dotnet restore $solutionPath --runtime $Runtime' through the approved internal NuGet source first."
    }
    Write-Host 'Skipping .NET restore; the build machine must already contain matching NuGet packages.'
}

if (-not $SkipFrontendBuild) {
    $npmInstallArguments = @('ci', '--no-audit', '--no-fund')
    if (-not [string]::IsNullOrWhiteSpace($NpmRegistry)) {
        $npmInstallArguments += "--registry=$NpmRegistry"
        Write-Host "Installing frontend packages from the configured npm registry."
    } else {
        Write-Host 'Installing frontend packages from the default configured npm registry.'
    }
    Push-Location $webRoot
    try {
        & npm @npmInstallArguments
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    } finally {
        Pop-Location
    }
} elseif (-not (Test-Path $webIndex -PathType Leaf)) {
    throw "Skipping frontend build requires an existing SPA build: $webIndex"
} else {
    Write-Host 'Skipping frontend build; packaging the existing SPA assets.'
}

New-Item -ItemType Directory -Path $hostOutput, $workerOutput -Force | Out-Null

& dotnet publish (Join-Path $repositoryRoot 'src\server\Host\ConfigHub.Host.csproj') `
    --configuration Release `
    --runtime $Runtime `
    --no-restore `
    --self-contained false `
    -p:SkipClientBuild=true `
    -p:Version=$Version `
    --output $hostOutput
if ($LASTEXITCODE -ne 0) { throw 'Host publish failed.' }

& dotnet publish (Join-Path $repositoryRoot 'src\server\Worker\ConfigHub.Worker.csproj') `
    --configuration Release `
    --runtime $Runtime `
    --no-restore `
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
