#Requires -Version 7.4
[CmdletBinding()]
param(
    [uri]$BaseUri = 'http://127.0.0.1:5080'
)

$ErrorActionPreference = 'Stop'
$suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8).ToUpperInvariant()
$headers = @{ 'X-ConfigHub-Actor' = 'acceptance-test'; 'X-Correlation-ID' = "catalog-$suffix" }

function Invoke-JsonPost([string]$Path, [hashtable]$Body) {
    Invoke-RestMethod -Method Post -Uri ([uri]::new($BaseUri, $Path)) -Headers $headers -ContentType 'application/json' -Body ($Body | ConvertTo-Json)
}

$project = Invoke-JsonPost '/api/v1/projects' @{ code = "TEST-$suffix"; name = 'Catalog acceptance project'; description = 'Created by integration test' }
$component = Invoke-JsonPost "/api/v1/projects/$($project.id)/components" @{ code = 'CONTROL'; name = 'Control'; parentComponentId = $null }
$firstVersion = Invoke-JsonPost "/api/v1/components/$($component.id)/versions" @{ versionNumber = 'opaque-a' }
$secondVersion = Invoke-JsonPost "/api/v1/components/$($component.id)/versions" @{ versionNumber = 'opaque-b' }

if ($firstVersion.sequenceNo -ne 10 -or $secondVersion.sequenceNo -ne 20) {
    throw "Expected version sequence 10/20, received $($firstVersion.sequenceNo)/$($secondVersion.sequenceNo)."
}

try {
    Invoke-JsonPost "/api/v1/components/$($component.id)/versions" @{ versionNumber = 'opaque-a' } | Out-Null
    throw 'Duplicate version unexpectedly succeeded.'
} catch {
    if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }
    if ($_.Exception.Response.StatusCode.value__ -ne 409) { throw }
}

$audit = Invoke-RestMethod -Uri ([uri]::new($BaseUri, "/api/v1/audit?entityId=$($component.id)")) -Headers $headers
if ($audit.Count -lt 1 -or [string]::IsNullOrWhiteSpace($audit[0].correlationId)) {
    throw 'Expected an audit event with a correlation ID.'
}

Write-Host "Catalog acceptance passed for project $($project.id)."
