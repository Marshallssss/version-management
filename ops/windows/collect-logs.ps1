#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$OutputPath,
    [string]$InstallRoot = 'C:\Program Files\ConfigHub',
    [string]$SiteName = 'ConfigHub',
    [int]$LookbackDays = 3
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$paths = Get-ConfigHubPaths -InstallRoot $InstallRoot
$staging = Join-Path ([IO.Path]::GetTempPath()) ("ConfigHub-diagnostics-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging -Force | Out-Null

try {
    Get-ComputerInfo -Property WindowsProductName, WindowsVersion, OsBuildNumber, OsArchitecture |
        ConvertTo-Json | Set-Content -Path (Join-Path $staging 'system.json') -Encoding UTF8

    Get-Service -Name 'ConfigHub.Worker', 'W3SVC', 'postgresql*' -ErrorAction SilentlyContinue |
        Select-Object Name, Status, StartType |
        ConvertTo-Json | Set-Content -Path (Join-Path $staging 'services.json') -Encoding UTF8

    $startTime = (Get-Date).AddDays(-$LookbackDays)
    Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $startTime } -ErrorAction SilentlyContinue |
        Where-Object { $_.ProviderName -match 'ConfigHub|IIS|ASP.NET Core|PostgreSQL' } |
        Select-Object TimeCreated, LevelDisplayName, ProviderName, Id, Message |
        Export-Csv -Path (Join-Path $staging 'application-events.csv') -NoTypeInformation -Encoding UTF8

    if (Test-Path $paths.Logs) {
        Copy-Item -Path $paths.Logs -Destination (Join-Path $staging 'application-logs') -Recurse -Force
    }

    Import-Module WebAdministration -ErrorAction SilentlyContinue
    $site = Get-Website -Name $SiteName -ErrorAction SilentlyContinue
    if ($site) {
        [pscustomobject]@{
            name = $site.Name
            state = $site.State
            id = $site.Id
            physicalPath = $site.PhysicalPath
        } | ConvertTo-Json | Set-Content -Path (Join-Path $staging 'iis-site.json') -Encoding UTF8
    }

    if (Test-Path $OutputPath) { throw "Diagnostic output already exists: $OutputPath" }
    $outputDirectory = Split-Path -Parent $OutputPath
    if ($outputDirectory) { New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null }
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $OutputPath -CompressionLevel Optimal
    Write-Host "Diagnostics created without application configuration or credentials: $OutputPath"
} finally {
    Remove-Item -Path $staging -Recurse -Force -ErrorAction SilentlyContinue
}
