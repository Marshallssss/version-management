Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'This operation requires an elevated PowerShell session.'
    }
}

function Assert-Command {
    param([Parameter(Mandatory)][string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found."
    }
}

function Get-RequiredMachineEnvironmentVariable {
    param([Parameter(Mandatory)][string]$Name)

    $value = [Environment]::GetEnvironmentVariable($Name, 'Machine')
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Required machine environment variable '$Name' is not configured."
    }

    return $value
}

function Enter-ConfigHubMaintenance {
    param([Parameter(Mandatory)][string]$HostPath)

    $offlinePath = Join-Path $HostPath 'app_offline.htm'
    @'
<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><title>ConfigHub Maintenance</title>
<body style="font-family:Segoe UI,Microsoft YaHei,sans-serif;background:#101a1d;color:#dce5e5;padding:8vw">
<h1>ConfigHub 正在维护</h1><p>系统升级或恢复进行中，请稍后重试。</p></body></html>
'@ | Set-Content -Path $offlinePath -Encoding UTF8
}

function Exit-ConfigHubMaintenance {
    param([Parameter(Mandatory)][string]$HostPath)

    $offlinePath = Join-Path $HostPath 'app_offline.htm'
    if (Test-Path $offlinePath) {
        Remove-Item -Path $offlinePath -Force
    }
}

function Get-ConfigHubPaths {
    param([string]$InstallRoot = 'C:\Program Files\ConfigHub')

    return [pscustomobject]@{
        Root = $InstallRoot
        Host = Join-Path $InstallRoot 'app\host'
        Worker = Join-Path $InstallRoot 'app\worker'
        Logs = Join-Path $InstallRoot 'logs'
        Rollback = Join-Path $InstallRoot 'rollback'
    }
}
