#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][uri]$BaseUri,
    [string]$WorkerServiceName = 'ConfigHub.Worker'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$liveUri = [uri]::new($BaseUri, '/health/live')
$readyUri = [uri]::new($BaseUri, '/health/ready')
$versionUri = [uri]::new($BaseUri, '/api/v1/system/version')

$checks = @(
    [pscustomobject]@{ Name = 'Live'; Uri = $liveUri },
    [pscustomobject]@{ Name = 'Ready'; Uri = $readyUri },
    [pscustomobject]@{ Name = 'API'; Uri = $versionUri }
)

$results = foreach ($check in $checks) {
    try {
        $response = Invoke-WebRequest -Uri $check.Uri -TimeoutSec 10
        [pscustomobject]@{ Check = $check.Name; Status = 'PASS'; Detail = "HTTP $($response.StatusCode)" }
    } catch {
        [pscustomobject]@{ Check = $check.Name; Status = 'FAIL'; Detail = $_.Exception.Message }
    }
}

$service = Get-Service -Name $WorkerServiceName -ErrorAction SilentlyContinue
$results += [pscustomobject]@{
    Check = 'Worker'
    Status = if ($service -and $service.Status -eq 'Running') { 'PASS' } else { 'FAIL' }
    Detail = if ($service) { $service.Status.ToString() } else { 'Service not found' }
}

$results | Format-Table -AutoSize
if ($results.Status -contains 'FAIL') { exit 1 }
