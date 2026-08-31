#Requires -Version 7.4
[CmdletBinding()]
param(
    [string]$OutputRoot = (Join-Path $PSScriptRoot '..\..\.confighub\offline-nuget'),
    [string]$GlobalPackagesRoot = (Join-Path $env:USERPROFILE '.nuget\packages'),
    [string]$Runtime = 'win-x64'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$assetFiles = @(
    (Join-Path $repositoryRoot 'src\server\Host\obj\project.assets.json'),
    (Join-Path $repositoryRoot 'src\server\Worker\obj\project.assets.json'),
    (Join-Path $repositoryRoot 'src\server\Infrastructure\obj\project.assets.json')
)
$missingAssets = @($assetFiles | Where-Object { -not (Test-Path $_ -PathType Leaf) })
if ($missingAssets.Count -gt 0) {
    throw "Restore the solution on a connected or internally mirrored build machine before exporting an offline source. Missing assets: $($missingAssets -join '、')"
}
if (-not (Test-Path $GlobalPackagesRoot -PathType Container)) {
    throw "NuGet global packages directory was not found: $GlobalPackagesRoot"
}

$packages = @{}
foreach ($assetFile in $assetFiles) {
    $assets = Get-Content $assetFile -Raw | ConvertFrom-Json
    foreach ($property in $assets.libraries.PSObject.Properties) {
        if ($property.Value.type -ne 'package') { continue }
        $parts = $property.Name -split '/', 2
        if ($parts.Count -ne 2) { throw "Unexpected NuGet library key: $($property.Name)" }
        $packages[$property.Name] = [pscustomobject]@{ Id = $parts[0]; Version = $parts[1] }
    }
}

# RuntimeIdentifier-specific framework packs are resolved from the SDK runtime graph,
# not from the ordinary project library list. A fresh offline cache still needs them.
foreach ($runtimePackageId in @(
    "Microsoft.NETCore.App.Runtime.$Runtime",
    "Microsoft.AspNetCore.App.Runtime.$Runtime",
    "Microsoft.WindowsDesktop.App.Runtime.$Runtime"
)) {
    $runtimePackageRoot = Join-Path $GlobalPackagesRoot $runtimePackageId.ToLowerInvariant()
    $runtimeVersion = Get-ChildItem -Path $runtimePackageRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object { [version]$_.Name } -Descending |
        Select-Object -First 1
    if ($null -eq $runtimeVersion) {
        throw "Cached runtime package was not found for $runtimePackageId. Restore the solution with '--runtime $Runtime' before exporting."
    }
    $packages["$runtimePackageId/$($runtimeVersion.Name)"] = [pscustomobject]@{ Id = $runtimePackageId; Version = $runtimeVersion.Name }
}

$resolvedOutput = [IO.Path]::GetFullPath($OutputRoot)
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
$manifest = [System.Collections.Generic.List[object]]::new()
foreach ($package in $packages.Values | Sort-Object Id, Version) {
    $packageDirectory = Join-Path (Join-Path $GlobalPackagesRoot $package.Id.ToLowerInvariant()) $package.Version.ToLowerInvariant()
    $nupkg = Get-ChildItem -Path $packageDirectory -Filter '*.nupkg' -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $nupkg) {
        throw "Cached nupkg was not found for $($package.Id) $($package.Version): $packageDirectory"
    }
    $destination = Join-Path $resolvedOutput $nupkg.Name
    Copy-Item -LiteralPath $nupkg.FullName -Destination $destination -Force
    $manifest.Add([pscustomobject]@{
        id = $package.Id
        version = $package.Version
        file = $nupkg.Name
        sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    })
}

$configPath = Join-Path (Split-Path $resolvedOutput -Parent) 'NuGet.Config'
@"
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="ConfigHubOffline" value="offline-nuget" />
  </packageSources>
  <packageSourceMapping>
    <packageSource key="ConfigHubOffline">
      <package pattern="*" />
    </packageSource>
  </packageSourceMapping>
</configuration>
"@ | Set-Content -LiteralPath $configPath -Encoding UTF8

[ordered]@{
    product = 'ConfigHub'
    createdAt = [DateTimeOffset]::UtcNow.ToString('O')
    packageCount = $manifest.Count
    packages = $manifest
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $resolvedOutput 'offline-manifest.json') -Encoding UTF8

Write-Host "Offline NuGet source exported: $resolvedOutput"
Write-Host "NuGet config: $configPath"
Write-Host "Packages: $($manifest.Count)"
