#Requires -Version 7.4
[CmdletBinding()]
param(
    [string]$SiteName = 'ConfigHub',
    [string]$AppPoolName = 'ConfigHub',
    [string]$WorkerServiceName = 'ConfigHub.Worker'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-Administrator
Import-Module WebAdministration

Start-WebAppPool -Name $AppPoolName
Start-Website -Name $SiteName
Start-Service -Name $WorkerServiceName
Write-Host 'ConfigHub application and Worker started.'
