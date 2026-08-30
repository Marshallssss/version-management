#Requires -Version 7.4
[CmdletBinding()]
param(
    [uri]$BaseUri = 'http://127.0.0.1:5080',
    [Parameter(Mandatory)][string]$Email,
    [Parameter(Mandatory)][string]$Password,
    [string]$ConnectionString
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

$machine = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/machines')) -ContentType 'application/json' -Body (@{ projectId = $project.id; serialNumber = "SN-$suffix"; name = 'Automation machine'; machineType = 'Test'; reason = '自动化机台登记' } | ConvertTo-Json)
try { Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/machines')) -ContentType 'application/json' -Body (@{ projectId = $project.id; serialNumber = "sn-$suffix"; name = 'Duplicate'; machineType = 'Test'; reason = '自动化重复校验' } | ConvertTo-Json) | Out-Null; throw 'Duplicate machine serial unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 409) { throw } }

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
$releaseBody = @{ reason = '自动化基线发布验收' } | ConvertTo-Json
$releaseHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "release-$suffix" }
$releasedBaseline = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)/release")) -Headers $releaseHeaders -ContentType 'application/json' -Body $releaseBody
$releasedReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)/release")) -Headers $releaseHeaders -ContentType 'application/json' -Body $releaseBody
if ($releasedBaseline.state -ne 'Released' -or $releasedBaseline.id -ne $releasedReplay.id) { throw 'Expected idempotent baseline release.' }
$thirdVersion = Invoke-JsonPost "/api/v1/components/$($component.id)/versions" @{ versionNumber = 'opaque-c' }
$secondBaselineBody = @{ seriesCode = "SERIES2-$suffix"; baselineCode = "BL2-$suffix"; description = 'Comparison baseline'; reason = '自动化基线比较验收' } | ConvertTo-Json
$secondBaseline = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/baselines")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body $secondBaselineBody
Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($secondBaseline.id)/release")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body $releaseBody | Out-Null
$compare = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)/compare/$($secondBaseline.id)"))
if (@($compare.items | Where-Object { $_.componentId -eq $component.id -and $_.status -eq 'Changed' }).Count -ne 1) { throw 'Expected changed component in baseline comparison.' }
$baselineList = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/baselines"))
if ($baselineList.Count -ne 2 -or @($baselineList | Where-Object { $_.state -eq 'Released' }).Count -ne 2) { throw 'Expected listed released baseline snapshots.' }
$standardBody = @{ configurationBaselineId = $baseline.id; reason = '自动化项目标准验收' } | ConvertTo-Json
$standardHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "standard-$suffix" }
$standard = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/standard")) -Headers $standardHeaders -ContentType 'application/json' -Body $standardBody
$standardReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/standard")) -Headers $standardHeaders -ContentType 'application/json' -Body $standardBody
$currentStandard = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/standard"))
if ($standard.baselineId -ne $baseline.id -or $standard.id -ne $standardReplay.id -or $currentStandard.baselineId -ne $baseline.id) { throw 'Expected idempotent current project standard assignment.' }
$target = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/target")) -ContentType 'application/json' -Body (@{ configurationBaselineId = $baseline.id; reason = '自动化机台目标验收' } | ConvertTo-Json)
if ($target.baselineId -ne $baseline.id) { throw 'Expected explicit machine target assignment.' }
$fullFacts = @{ operationType = 'InitialSnapshot'; coverage = 'Full'; sourceType = 'automation'; reason = '自动化完整快照'; items = @(@{ componentId = $component.id; versionId = $secondVersion.id; absent = $false; knownInstalledAt = $null }, @{ componentId = $child.id; versionId = $childVersion.id; absent = $false; knownInstalledAt = $null }) } | ConvertTo-Json -Depth 5
Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/facts")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body $fullFacts | Out-Null
$blockedForRisk = Invoke-Lifecycle "/api/v1/component-versions/$($secondVersion.id)/safety" 'Blocked' '自动化风险验收'
$drift = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/drift"))
if ($drift.matchStatus -ne 'Matched' -or $drift.riskSeverity -ne 'Critical') { throw "Expected Matched + Critical but received $($drift | ConvertTo-Json -Compress)." }
$machineSummary = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/drift-summary"))
if ($machineSummary.matchStatus -ne 'Matched' -or $machineSummary.riskSeverity -ne 'Critical') { throw 'Expected persisted machine drift summary to preserve Match and Risk independently.' }
Invoke-Lifecycle "/api/v1/component-versions/$($secondVersion.id)/safety" 'Clear' '自动化恢复风险状态' | Out-Null
$partialFacts = @{ operationType = 'Observation'; coverage = 'Partial'; sourceType = 'automation'; reason = '自动化局部观察'; items = @(@{ componentId = $component.id; versionId = $firstVersion.id; absent = $false; knownInstalledAt = $null }) } | ConvertTo-Json -Depth 5
Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/facts")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body $partialFacts | Out-Null
$actual = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/configuration"))
if ($actual.Count -ne 2 -or @($actual | Where-Object { $_.componentId -eq $child.id -and $_.versionId -eq $childVersion.id -and $_.state -eq 'Present' }).Count -ne 1) { throw 'Partial observation must preserve unobserved current components.' }

if (-not [string]::IsNullOrWhiteSpace($ConnectionString)) {
    $psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
    if (-not (Test-Path $psql)) { throw 'psql.exe is required to verify the baseline immutability trigger.' }
    $psqlConnection = ($ConnectionString -replace ';', ' ') -replace '(?i)\bHost=', 'host=' -replace '(?i)\bPort=', 'port=' -replace '(?i)\bDatabase=', 'dbname=' -replace '(?i)\bUsername=', 'user=' -replace '(?i)\bPassword=', 'password='
    $result = & $psql $psqlConnection -v ON_ERROR_STOP=1 -c "UPDATE baseline_items SET sort_order = sort_order WHERE configuration_baseline_id = '$($baseline.id)'" 2>&1
    if ($LASTEXITCODE -eq 0 -or ($result -join [Environment]::NewLine) -notmatch 'Items of released baseline cannot be modified') {
        throw 'Released baseline item update was not rejected by the PostgreSQL trigger.'
    }
    $overlap = & $psql $psqlConnection -v ON_ERROR_STOP=1 -c "INSERT INTO project_standard_assignments (id, project_id, configuration_baseline_id, valid_from, valid_to, assigned_by, reason) VALUES (gen_random_uuid(), '$($project.id)', '$($baseline.id)', now() - interval '1 minute', now() + interval '1 minute', 'test', 'overlap test')" 2>&1
    if ($LASTEXITCODE -eq 0 -or ($overlap -join [Environment]::NewLine) -notmatch 'ex_project_standard_assignments_no_overlap') {
        throw 'Overlapping project standard assignment was not rejected by the PostgreSQL exclusion constraint.'
    }
}

$audit = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/audit?entityId=$($project.id)"))
if ($audit.Count -lt 1 -or $audit[0].actor -ne $Email -or [string]::IsNullOrWhiteSpace($audit[0].correlationId)) { throw 'Expected authenticated audit event.' }

$clone = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/clone")) -ContentType 'application/json' -Body (@{ code = "CLONE-$suffix"; name = 'Cloned project'; reason = '自动化克隆验收' } | ConvertTo-Json)
$cloneDetail = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($clone.id)"))
if ($cloneDetail.components.Count -ne 2 -or @($cloneDetail.components | Where-Object { $_.versions.Count -ne 0 }).Count -ne 0) { throw 'Clone must copy the complete component tree but not versions.' }
Write-Host "Catalog acceptance passed for project $($project.id)."
