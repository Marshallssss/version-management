#Requires -Version 7.4
[CmdletBinding()]
param(
    [uri]$BaseUri = 'http://127.0.0.1:5080',
    [Parameter(Mandatory)][string]$Email,
    [Parameter(Mandatory)][string]$Password
)

$ErrorActionPreference = 'Stop'
$suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8).ToUpperInvariant()
$projectBody = @{ code = "TEST-$suffix"; name = 'Catalog acceptance project'; description = 'Created by integration test'; reason = '自动化验收' } | ConvertTo-Json

try {
    Invoke-WebRequest -UseBasicParsing -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/projects')) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body $projectBody -ErrorAction Stop | Out-Null
    throw 'Unauthenticated project creation unexpectedly succeeded.'
} catch {
    if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }
    if ($_.Exception.Response.StatusCode.value__ -ne 401) { throw }
}

$loginBody = @{ email = $Email; password = $Password } | ConvertTo-Json
$login = Invoke-WebRequest -UseBasicParsing -SessionVariable session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/auth/login')) -ContentType 'application/json' -Body $loginBody
if ($login.StatusCode -ne 204) { throw 'Login did not succeed.' }

$idempotencyKey = [Guid]::NewGuid().ToString()
$headers = @{ 'Idempotency-Key' = $idempotencyKey; 'X-Correlation-ID' = "catalog-$suffix" }
$project = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/projects')) -Headers $headers -ContentType 'application/json' -Body $projectBody
$replay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/projects')) -Headers $headers -ContentType 'application/json' -Body $projectBody
if ($project.id -ne $replay.id) { throw 'Idempotent replay did not return the original project.' }

function Invoke-JsonPost([string]$Path, [hashtable]$Body) {
    Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, $Path)) -ContentType 'application/json' -Body ($Body | ConvertTo-Json)
}

$component = Invoke-JsonPost "/api/v1/projects/$($project.id)/components" @{ code = 'CONTROL'; name = 'Control'; parentComponentId = $null }
$firstVersion = Invoke-JsonPost "/api/v1/components/$($component.id)/versions" @{ versionNumber = 'opaque-a' }
$secondVersion = Invoke-JsonPost "/api/v1/components/$($component.id)/versions" @{ versionNumber = 'opaque-b' }
if ($firstVersion.sequenceNo -ne 10 -or $secondVersion.sequenceNo -ne 20) { throw 'Expected version sequence 10/20.' }

$audit = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/audit?entityId=$($project.id)"))
if ($audit.Count -lt 1 -or $audit[0].actor -ne $Email -or [string]::IsNullOrWhiteSpace($audit[0].correlationId)) { throw 'Expected authenticated audit event.' }
Write-Host "Catalog acceptance passed for project $($project.id)."
