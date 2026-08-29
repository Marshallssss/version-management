#Requires -Version 7.4
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)][string]$PackageRoot,
    [Parameter(Mandatory)][string]$HostName,
    [Parameter(Mandatory)][string]$CertificateThumbprint,
    [string]$InstallRoot = 'C:\Program Files\ConfigHub',
    [string]$FileStoreRoot = 'D:\ConfigHubData\files',
    [string]$SiteName = 'ConfigHub',
    [string]$AppPoolName = 'ConfigHub',
    [string]$WorkerServiceName = 'ConfigHub.Worker',
    [int]$HttpsPort = 443
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

Assert-Administrator
Import-Module WebAdministration
[void](Get-RequiredMachineEnvironmentVariable 'ConnectionStrings__ConfigHub')
[void](Get-RequiredMachineEnvironmentVariable 'ConnectionStrings__ConfigHubMigration')

$package = Resolve-Path $PackageRoot
$paths = Get-ConfigHubPaths -InstallRoot $InstallRoot
$hostSource = Join-Path $package 'host'
$workerSource = Join-Path $package 'worker'
$workerExecutable = Join-Path $paths.Worker 'ConfigHub.Worker.exe'
$certificatePath = "Cert:\LocalMachine\My\$CertificateThumbprint"

foreach ($requiredPath in @($hostSource, $workerSource, (Join-Path $hostSource 'ConfigHub.Host.exe'), (Join-Path $workerSource 'ConfigHub.Worker.exe'), $certificatePath)) {
    if (-not (Test-Path $requiredPath)) { throw "Required install input was not found: $requiredPath" }
}

if (-not $PSCmdlet.ShouldProcess($InstallRoot, 'Install ConfigHub and configure IIS/Windows Service')) {
    return
}

New-Item -ItemType Directory -Path $paths.Host, $paths.Worker, $paths.Logs, $paths.Rollback, $FileStoreRoot -Force | Out-Null
Copy-Item -Path (Join-Path $hostSource '*') -Destination $paths.Host -Recurse -Force
Copy-Item -Path (Join-Path $workerSource '*') -Destination $paths.Worker -Recurse -Force

if (-not (Test-Path "IIS:\AppPools\$AppPoolName")) {
    New-WebAppPool -Name $AppPoolName | Out-Null
}
Set-ItemProperty "IIS:\AppPools\$AppPoolName" -Name managedRuntimeVersion -Value ''
Set-ItemProperty "IIS:\AppPools\$AppPoolName" -Name startMode -Value AlwaysRunning

if (Test-Path "IIS:\Sites\$SiteName") {
    Set-ItemProperty "IIS:\Sites\$SiteName" -Name physicalPath -Value $paths.Host
    Set-ItemProperty "IIS:\Sites\$SiteName" -Name applicationPool -Value $AppPoolName
} else {
    New-WebSite -Name $SiteName -PhysicalPath $paths.Host -ApplicationPool $AppPoolName -Port 80 -HostHeader $HostName | Out-Null
}

Get-WebBinding -Name $SiteName | Remove-WebBinding
New-WebBinding -Name $SiteName -Protocol https -Port $HttpsPort -HostHeader $HostName -SslFlags 1
$sslBindingPath = "IIS:\SslBindings\!$HttpsPort!$HostName"
if (Test-Path $sslBindingPath) { Remove-Item $sslBindingPath -Force }
Get-Item $certificatePath | New-Item $sslBindingPath -SSLFlags 1 | Out-Null

& icacls.exe $paths.Host /grant "IIS AppPool\${AppPoolName}:(OI)(CI)(RX)" /T /Q | Out-Null
& icacls.exe $paths.Logs /grant 'NT AUTHORITY\NETWORK SERVICE:(OI)(CI)(M)' /T /Q | Out-Null
& icacls.exe $FileStoreRoot /grant 'NT AUTHORITY\NETWORK SERVICE:(OI)(CI)(M)' /T /Q | Out-Null

if (Get-Service -Name $WorkerServiceName -ErrorAction SilentlyContinue) {
    Stop-Service -Name $WorkerServiceName -Force -ErrorAction SilentlyContinue
    & sc.exe delete $WorkerServiceName | Out-Null
    Start-Sleep -Seconds 2
}

& sc.exe create $WorkerServiceName "binPath= `"$workerExecutable`"" 'start= auto' 'obj= NT AUTHORITY\NetworkService' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Windows Worker service creation failed.' }
& sc.exe description $WorkerServiceName 'ConfigHub database-backed background job worker.' | Out-Null
& sc.exe failure $WorkerServiceName 'reset= 86400' 'actions= restart/5000/restart/15000/restart/60000' | Out-Null

& (Join-Path $paths.Host 'ConfigHub.Host.exe') --migrate
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }

Start-WebAppPool -Name $AppPoolName
Start-Website -Name $SiteName
Start-Service -Name $WorkerServiceName

Write-Host "ConfigHub installed at https://$HostName`:$HttpsPort/"
