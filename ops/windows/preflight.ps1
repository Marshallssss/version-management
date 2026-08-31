#Requires -Version 7.4
[CmdletBinding()]
param(
    [ValidateSet('PreInstall', 'PostInstall')]
    [string]$Stage = 'PreInstall',
    [string]$HostName = $env:COMPUTERNAME,
    [int]$HttpsPort = 443,
    [string]$WorkerServiceName = 'ConfigHub.Worker',
    [string]$PostgreSqlServicePattern = 'postgresql*',
    [string]$PostgreSqlBinDirectory,
    [string]$CertificateThumbprint,
    [string]$BackupRoot,
    [switch]$ReportOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$results = [System.Collections.Generic.List[object]]::new()
function Add-Check([string]$Name, [bool]$Passed, [string]$Detail) {
    $results.Add([pscustomobject]@{
        Check = $Name
        Status = if ($Passed) { 'Pass' } else { 'Fail' }
        Detail = $Detail
    })
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Add-Check '管理员会话' $isAdministrator '安装和恢复必须在提升权限 PowerShell 中运行。'

$operatingSystem = Get-CimInstance Win32_OperatingSystem
$isSupportedWindowsHost = $operatingSystem.Caption -match 'Windows 1[01]|Windows Server'
Add-Check 'Windows 部署主机' $isSupportedWindowsHost "$($operatingSystem.Caption)（版本 $($operatingSystem.Version)）；支持 Windows 11 Pro/Enterprise 或 Windows Server。"
Add-Check 'PowerShell 7.4' ($PSVersionTable.PSVersion -ge [version]'7.4') "当前版本 $($PSVersionTable.PSVersion)"

$webServerFeature = Get-Command Get-WindowsFeature -ErrorAction SilentlyContinue
if ($null -ne $webServerFeature) {
    $iisInstalled = (Get-WindowsFeature Web-Server).Installed
    Add-Check 'IIS Web Server' $iisInstalled '需要 Web Server 角色。'
} else {
    try {
        $iisFeature = Get-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole -ErrorAction Stop
        $iisInstalled = $iisFeature.State -eq 'Enabled'
        Add-Check 'IIS Web Server' $iisInstalled "Windows Optional Feature IIS-WebServerRole: $($iisFeature.State)"
    } catch {
        Add-Check 'IIS Web Server' $false "无法读取 IIS 安装状态：$($_.Exception.Message)"
    }
}

$aspNetCoreRuntime = (& dotnet --list-runtimes 2>$null | Where-Object { $_ -match '^Microsoft\.AspNetCore\.App 10\.' } | Select-Object -First 1)
$aspNetCoreModule = Test-Path 'HKLM:\SOFTWARE\Microsoft\IIS Extensions\AspNetCore Module V2'
Add-Check '.NET 10 Hosting Bundle' ($null -ne $aspNetCoreRuntime -and $aspNetCoreModule) "Runtime: $aspNetCoreRuntime；ANCM: $aspNetCoreModule"

$postgresCommands = @('pg_dump', 'pg_restore', 'createdb', 'dropdb')
$postgresBinCandidates = @()
if (-not [string]::IsNullOrWhiteSpace($PostgreSqlBinDirectory)) {
    $postgresBinCandidates += $PostgreSqlBinDirectory
}
$postgresBinCandidates += Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'ConfigHub\PostgreSQL17\bin'
$postgresBinCandidates += Get-ChildItem (Join-Path $env:ProgramFiles 'PostgreSQL') -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName 'bin' }

$postgresBinDirectory = $null
foreach ($candidateDirectory in $postgresBinCandidates) {
    if (-not (Test-Path $candidateDirectory -PathType Container)) { continue }
    $missingFromCandidate = @($postgresCommands | Where-Object {
        -not (Test-Path (Join-Path $candidateDirectory "$_.exe") -PathType Leaf)
    })
    if ($missingFromCandidate.Count -eq 0) {
        $postgresBinDirectory = $candidateDirectory
        break
    }
}
$missingCommands = @($postgresCommands | Where-Object {
    $candidate = if ($null -ne $postgresBinDirectory) { Join-Path $postgresBinDirectory "$_.exe" } else { $null }
    $null -eq $candidate -and $null -eq (Get-Command $_ -ErrorAction SilentlyContinue)
})
$postgresCommandDetail = if ($missingCommands.Count -eq 0) {
    if ($null -ne $postgresBinDirectory) { "pg_dump、pg_restore、createdb、dropdb 均可用：$postgresBinDirectory" } else { 'pg_dump、pg_restore、createdb、dropdb 均可通过 PATH 调用。' }
} else { "缺少：$($missingCommands -join '、')；可传入 -PostgreSqlBinDirectory 指向 PostgreSQL bin 目录。" }
Add-Check 'PostgreSQL 客户端工具' ($missingCommands.Count -eq 0) $postgresCommandDetail
$postgresService = @(Get-Service -Name $PostgreSqlServicePattern -ErrorAction SilentlyContinue)
$postgresServiceDetail = if ($postgresService.Count -gt 0) { ($postgresService | ForEach-Object { "$($_.Name): $($_.Status)" }) -join '; ' } else { "未找到服务：$PostgreSqlServicePattern" }
Add-Check 'PostgreSQL Windows Service' ($postgresService.Count -gt 0) $postgresServiceDetail

$connectionVariables = @('ConnectionStrings__ConfigHub', 'ConnectionStrings__ConfigHubMigration')
$missingVariables = @($connectionVariables | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_, 'Machine')) })
$connectionDetail = if ($missingVariables.Count -eq 0) { '应用和 Migration 连接配置均已设置（不显示值）。' } else { "缺少：$($missingVariables -join '、')" }
Add-Check '受保护的机器连接配置' ($missingVariables.Count -eq 0) $connectionDetail

try {
    $addresses = [Net.Dns]::GetHostAddresses($HostName)
    Add-Check 'DNS 解析' ($addresses.Count -gt 0) "$HostName -> $($addresses.IPAddressToString -join '、')"
} catch {
    Add-Check 'DNS 解析' $false "$HostName 无法解析：$($_.Exception.Message)"
}

if (-not [string]::IsNullOrWhiteSpace($CertificateThumbprint)) {
    $certificate = Get-Item "Cert:\LocalMachine\My\$CertificateThumbprint" -ErrorAction SilentlyContinue
    $validCertificate = $null -ne $certificate -and $certificate.NotAfter -gt (Get-Date)
    $certificateDetail = if ($validCertificate) { "主题：$($certificate.Subject)；到期：$($certificate.NotAfter.ToString('u'))" } else { '未找到有效的 LocalMachine TLS 证书。' }
    Add-Check 'TLS 证书' $validCertificate $certificateDetail
} else {
    Add-Check 'TLS 证书' $false '请提供 -CertificateThumbprint。'
}

if (-not [string]::IsNullOrWhiteSpace($BackupRoot)) {
    Add-Check '备份根目录' (Test-Path $BackupRoot -PathType Container) $BackupRoot
} else {
    Add-Check '备份根目录' $false '请提供 -BackupRoot（建议 NAS UNC 路径）。'
}

if ($Stage -eq 'PostInstall') {
    $worker = Get-Service -Name $WorkerServiceName -ErrorAction SilentlyContinue
    $workerDetail = if ($worker) { "$($worker.Name): $($worker.Status)" } else { '未找到 Worker 服务。' }
    Add-Check 'ConfigHub Worker 服务' ($null -ne $worker -and $worker.Status -eq 'Running') $workerDetail
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "https://$HostName`:$HttpsPort/health/ready" -TimeoutSec 10
        Add-Check 'HTTPS Readiness' ($response.StatusCode -eq 200) "HTTP $($response.StatusCode)"
    } catch {
        Add-Check 'HTTPS Readiness' $false $_.Exception.Message
    }
}

$results
$failed = @($results | Where-Object Status -eq 'Fail')
if ($failed.Count -gt 0 -and -not $ReportOnly) {
    throw "Windows production preflight failed: $($failed.Check -join '、')"
}
