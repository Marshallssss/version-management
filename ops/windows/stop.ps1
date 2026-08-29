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

Stop-Service -Name $WorkerServiceName -Force
Stop-Website -Name $SiteName
Stop-WebAppPool -Name $AppPoolName
Write-Host 'ConfigHub application and Worker stopped.'
