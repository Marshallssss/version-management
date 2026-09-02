#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$')][string]$Version,
    [string]$Runtime = 'win-x64',
    [string]$OutputRoot = (Join-Path $PSScriptRoot '..\..\artifacts\release'),
    [string]$PackagePath,
    [string]$NuGetConfigFile,
    [string]$NpmRegistry,
    [switch]$SkipRestore,
    [switch]$SkipFrontendBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Common.ps1')

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
function Resolve-ConfigHubPath([string]$Path) {
    if ([IO.Path]::IsPathFullyQualified($Path)) {
        return [IO.Path]::GetFullPath($Path)
    }

    return [IO.Path]::GetFullPath((Join-Path $repositoryRoot $Path))
}

$resolvedOutputRoot = Resolve-ConfigHubPath $OutputRoot
$releaseRoot = Join-Path $resolvedOutputRoot $Version

if ([string]::IsNullOrWhiteSpace($PackagePath)) {
    $PackagePath = Join-Path $repositoryRoot "artifacts\ConfigHub-release-$Version-$Runtime.zip"
}
$resolvedPackagePath = Resolve-ConfigHubPath $PackagePath
$checksumPath = "$resolvedPackagePath.sha256"

if (Test-Path $resolvedPackagePath -PathType Leaf) {
    throw "Release package already exists: $resolvedPackagePath"
}
if (Test-Path $checksumPath -PathType Leaf) {
    throw "Release package checksum already exists: $checksumPath"
}

$publishArguments = @{
    Version = $Version
    Runtime = $Runtime
    OutputRoot = $resolvedOutputRoot
}
if (-not [string]::IsNullOrWhiteSpace($NuGetConfigFile)) { $publishArguments.NuGetConfigFile = $NuGetConfigFile }
if (-not [string]::IsNullOrWhiteSpace($NpmRegistry)) { $publishArguments.NpmRegistry = $NpmRegistry }
if ($SkipRestore) { $publishArguments.SkipRestore = $true }
if ($SkipFrontendBuild) { $publishArguments.SkipFrontendBuild = $true }

& (Join-Path $PSScriptRoot 'publish.ps1') @publishArguments

$manifestPath = Join-Path $releaseRoot 'release-manifest.json'
if (-not (Test-Path $manifestPath -PathType Leaf)) {
    throw "Release manifest was not generated: $manifestPath"
}

$manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
if ($manifest.version -ne $Version -or $manifest.runtime -ne $Runtime) {
    throw 'Release manifest version or runtime does not match the requested package.'
}

$expectedExecutablePaths = @('host/ConfigHub.Host.exe', 'worker/ConfigHub.Worker.exe')
foreach ($expectedExecutablePath in $expectedExecutablePaths) {
    $executablePath = Join-Path $releaseRoot ($expectedExecutablePath -replace '/', [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path $executablePath -PathType Leaf)) {
        throw "Windows executable is missing from release output: $expectedExecutablePath"
    }
}

foreach ($file in @($manifest.files)) {
    $filePath = Join-Path $releaseRoot ($file.path -replace '/', [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path $filePath -PathType Leaf)) {
        throw "Manifest file is missing: $($file.path)"
    }
    $actualHash = (Get-FileHash -Path $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $file.sha256) {
        throw "Manifest checksum does not match: $($file.path)"
    }
}

New-Item -ItemType Directory -Path (Split-Path $resolvedPackagePath -Parent) -Force | Out-Null
Compress-Archive -Path (Join-Path $releaseRoot '*') -DestinationPath $resolvedPackagePath -CompressionLevel Optimal

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($resolvedPackagePath)
try {
    $archivedPaths = @($archive.Entries | Where-Object { $_.Name } | ForEach-Object { $_.FullName.Replace('\', '/') })
    $expectedPaths = @($manifest.files | ForEach-Object { $_.path.Replace('\', '/') }) + 'release-manifest.json'
    $difference = Compare-Object -ReferenceObject ($expectedPaths | Sort-Object) -DifferenceObject ($archivedPaths | Sort-Object)
    if ($null -ne $difference) {
        throw 'Release ZIP contents do not match release-manifest.json.'
    }
} finally {
    $archive.Dispose()
}

$packageHash = (Get-FileHash -Path $resolvedPackagePath -Algorithm SHA256).Hash.ToLowerInvariant()
"$packageHash *$([IO.Path]::GetFileName($resolvedPackagePath))" | Set-Content -Path $checksumPath -Encoding ASCII -NoNewline

Write-Host "Release package created: $resolvedPackagePath"
Write-Host "Release package checksum: $checksumPath"
