#Requires -Version 7.4
[CmdletBinding()]
param(
    [string]$OperationsPath = (Join-Path $PSScriptRoot '..\..\ops\windows')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$requiredScripts = @(
    'Common.ps1',
    'preflight.ps1',
    'export-offline-nuget-source.ps1',
    'publish.ps1',
    'install.ps1',
    'start.ps1',
    'stop.ps1',
    'health-check.ps1',
    'backup.ps1',
    'restore.ps1',
    'upgrade.ps1',
    'collect-logs.ps1'
)

foreach ($scriptName in $requiredScripts) {
    $scriptPath = Join-Path $OperationsPath $scriptName
    if (-not (Test-Path $scriptPath -PathType Leaf)) {
        throw "Required Windows operation script was not found: $scriptName"
    }

    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errors) | Out-Null
    if ($errors.Count -gt 0) {
        throw "Windows operation script parse error in ${scriptName}: $($errors[0].Message)"
    }
}

$readinessReport = & (Join-Path $OperationsPath 'preflight.ps1') -Stage PreInstall -HostName localhost -BackupRoot $env:TEMP -ReportOnly
if ($readinessReport.Count -lt 10 -or @($readinessReport | Where-Object { $_.Check -eq 'Windows 部署主机' }).Count -ne 1 -or @($readinessReport | Where-Object { $_.Check -eq 'PostgreSQL 客户端工具' }).Count -ne 1 -or @($readinessReport | Where-Object { $_.Check -eq 'TLS 证书' }).Count -ne 1) {
    throw 'Windows production preflight must emit its structured readiness report in ReportOnly mode.'
}

Write-Host "Windows operations preflight passed for $($requiredScripts.Count) scripts."
