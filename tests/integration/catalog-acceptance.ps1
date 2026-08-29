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
$child = Invoke-JsonPost "/api/v1/projects/$($project.id)/components" @{ code = 'CHILD'; name = 'Child'; parentComponentId = $component.id }
try {
    Invoke-JsonPost "/api/v1/components/$($component.id)/move" @{ parentComponentId = $child.id; reason = '自动化环检测' } | Out-Null
    throw 'Component cycle unexpectedly succeeded.'
} catch {
    if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }
    if ($_.Exception.Response.StatusCode.value__ -ne 409) { throw }
}
Invoke-JsonPost "/api/v1/components/$($child.id)/move" @{ parentComponentId = $null; reason = '自动化移动到根节点' } | Out-Null
$firstVersion = Invoke-JsonPost "/api/v1/components/$($component.id)/versions" @{ versionNumber = 'opaque-a' }
$secondVersion = Invoke-JsonPost "/api/v1/components/$($component.id)/versions" @{ versionNumber = 'opaque-b' }
$childVersion = Invoke-JsonPost "/api/v1/components/$($child.id)/versions" @{ versionNumber = 'opaque-child' }
if ($firstVersion.sequenceNo -ne 10 -or $secondVersion.sequenceNo -ne 20) { throw 'Expected version sequence 10/20.' }

function Invoke-Lifecycle([string]$Path, [string]$State, [string]$Reason) {
    Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, $Path)) -ContentType 'application/json' -Body (@{ state = $State; reason = $Reason } | ConvertTo-Json)
}

$testing = Invoke-Lifecycle "/api/v1/component-versions/$($firstVersion.id)/maturity" 'Testing' '自动化提交测试'
$released = Invoke-Lifecycle "/api/v1/component-versions/$($firstVersion.id)/maturity" 'Released' '自动化发布'
if ($testing.maturity -ne 'Testing' -or $released.maturity -ne 'Released') { throw 'Expected Draft -> Testing -> Released lifecycle.' }
Invoke-Lifecycle "/api/v1/component-versions/$($firstVersion.id)/recommend" '' '自动化推荐' | Out-Null
$blocked = Invoke-Lifecycle "/api/v1/component-versions/$($firstVersion.id)/safety" 'Blocked' '自动化阻断'
$clear = Invoke-Lifecycle "/api/v1/component-versions/$($firstVersion.id)/safety" 'Clear' '自动化解除阻断'
if ($blocked.safety -ne 'Blocked' -or $clear.safety -ne 'Clear') { throw 'Expected independent safety transitions.' }

$baselineBody = @{ seriesCode = "SERIES-$suffix"; baselineCode = "BL-$suffix"; description = 'Created by integration test'; reason = '自动化基线快照验收' } | ConvertTo-Json
$baselineHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "baseline-$suffix" }
$baseline = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/baselines")) -Headers $baselineHeaders -ContentType 'application/json' -Body $baselineBody
$baselineReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/baselines")) -Headers $baselineHeaders -ContentType 'application/json' -Body $baselineBody
if ($baseline.itemCount -ne 2 -or $baseline.revisionNo -ne 1 -or $baseline.id -ne $baselineReplay.id) { throw 'Expected idempotent complete baseline draft snapshot.' }
$baselineList = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/baselines"))
if ($baselineList.Count -ne 1 -or $baselineList[0].itemCount -ne 2 -or $baselineList[0].state -ne 'Draft') { throw 'Expected listed baseline draft snapshot.' }

$audit = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/audit?entityId=$($project.id)"))
if ($audit.Count -lt 1 -or $audit[0].actor -ne $Email -or [string]::IsNullOrWhiteSpace($audit[0].correlationId)) { throw 'Expected authenticated audit event.' }

$clone = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/clone")) -ContentType 'application/json' -Body (@{ code = "CLONE-$suffix"; name = 'Cloned project'; reason = '自动化克隆验收' } | ConvertTo-Json)
$cloneDetail = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($clone.id)"))
if ($cloneDetail.components.Count -ne 2 -or @($cloneDetail.components | Where-Object { $_.versions.Count -ne 0 }).Count -ne 0) { throw 'Clone must copy the complete component tree but not versions.' }
Write-Host "Catalog acceptance passed for project $($project.id)."
