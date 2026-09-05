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
try {
    Invoke-WebRequest -UseBasicParsing -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/system/jobs/noop')) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ reason = '匿名任务拒绝验收' } | ConvertTo-Json) -ErrorAction Stop | Out-Null
    throw 'Unauthenticated system job unexpectedly succeeded.'
} catch {
    if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }
    if ($_.Exception.Response.StatusCode.value__ -ne 401) { throw }
}
try {
    Invoke-WebRequest -UseBasicParsing -Uri ([uri]::new($BaseUri, '/api/v1/projects')) -ErrorAction Stop | Out-Null
    throw 'Unauthenticated catalog read unexpectedly succeeded.'
} catch {
    if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }
    if ($_.Exception.Response.StatusCode.value__ -ne 401) { throw }
}

$loginBody = @{ email = $Email; password = $Password } | ConvertTo-Json
$login = Invoke-WebRequest -UseBasicParsing -SessionVariable session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/auth/login')) -ContentType 'application/json' -Body $loginBody
if ($login.StatusCode -ne 204) { throw 'Login did not succeed.' }
$users = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, '/api/v1/admin/users'))
if (@($users | Where-Object { $_.email -eq $Email -and $_.roles -contains 'Admin' }).Count -ne 1) { throw 'Administrator user directory must expose the authenticated admin and role.' }
$jobHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "job-$suffix" }
$jobBody = @{ reason = '自动化后台任务验收' } | ConvertTo-Json
$job = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/system/jobs/noop')) -Headers $jobHeaders -ContentType 'application/json' -Body $jobBody
$jobReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/system/jobs/noop')) -Headers $jobHeaders -ContentType 'application/json' -Body $jobBody
if ($job.id -ne $jobReplay.id) { throw 'System job enqueue must be idempotent.' }
$jobAudit = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/audit?entityId=$($job.id)"))
if (@($jobAudit | Where-Object { $_.action -eq 'SystemNoopJobEnqueued' -and $_.actor -eq $Email -and $_.correlationId -eq "job-$suffix" }).Count -ne 1) { throw 'System job enqueue must write an authenticated audit event.' }
$viewerEmail = "viewer-$suffix@example.test"
$viewerPassword = "Viewer-$suffix!"
$viewerHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }
$viewerBody = @{ email = $viewerEmail; displayName = '自动化只读用户'; password = $viewerPassword; role = 'Viewer'; reason = '自动化 RBAC 验收' } | ConvertTo-Json
$viewer = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/admin/users')) -Headers $viewerHeaders -ContentType 'application/json' -Body $viewerBody
$viewerReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/admin/users')) -Headers $viewerHeaders -ContentType 'application/json' -Body $viewerBody
if ($viewer.id -ne $viewerReplay.id) { throw 'Administrator user creation must be idempotent.' }
$viewerLogin = Invoke-WebRequest -UseBasicParsing -SessionVariable viewerSession -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/auth/login')) -ContentType 'application/json' -Body (@{ email = $viewerEmail; password = $viewerPassword } | ConvertTo-Json)
if ($viewerLogin.StatusCode -ne 204) { throw 'Created Viewer could not log in.' }
try { Invoke-RestMethod -WebSession $viewerSession -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/projects')) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body $projectBody | Out-Null; throw 'Viewer project creation unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw } }
try { Invoke-RestMethod -WebSession $viewerSession -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$([Guid]::NewGuid())/bulk-facts")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ machineIds = @([Guid]::NewGuid()); operationType = 'Observation'; coverage = 'Partial'; reason = '自动化批量事实权限拒绝'; items = @(@{ componentId = [Guid]::NewGuid(); versionId = [Guid]::NewGuid(); absent = $false; knownInstalledAt = $null }) } | ConvertTo-Json -Depth 5) | Out-Null; throw 'Viewer bulk fact recording unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw } }
$roleHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }
$roleBody = @{ role = 'Engineer'; reason = '自动化角色变更验收' } | ConvertTo-Json
$roleChange = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/admin/users/$($viewer.id)/role")) -Headers $roleHeaders -ContentType 'application/json' -Body $roleBody
$roleReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/admin/users/$($viewer.id)/role")) -Headers $roleHeaders -ContentType 'application/json' -Body $roleBody
if ($roleChange.role -ne 'Engineer' -or $roleChange.id -ne $roleReplay.id) { throw 'Administrator role change must be idempotent.' }
$viewerLogin = Invoke-WebRequest -UseBasicParsing -SessionVariable viewerSession -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/auth/login')) -ContentType 'application/json' -Body (@{ email = $viewerEmail; password = $viewerPassword } | ConvertTo-Json)
if ($viewerLogin.StatusCode -ne 204) { throw 'Updated Engineer could not log in.' }

$idempotencyKey = [Guid]::NewGuid().ToString()
$headers = @{ 'Idempotency-Key' = $idempotencyKey; 'X-Correlation-ID' = "catalog-$suffix" }
$project = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/projects')) -Headers $headers -ContentType 'application/json' -Body $projectBody
$replay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/projects')) -Headers $headers -ContentType 'application/json' -Body $projectBody
if ($project.id -ne $replay.id) { throw 'Idempotent replay did not return the original project.' }
$membershipHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }
$membershipBody = @{ userId = $viewer.id; role = 'Engineer'; reason = '自动化项目成员验收' } | ConvertTo-Json
$membership = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/members")) -Headers $membershipHeaders -ContentType 'application/json' -Body $membershipBody
$membershipReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/members")) -Headers $membershipHeaders -ContentType 'application/json' -Body $membershipBody
$members = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/members"))
if ($membership.id -ne $membershipReplay.id -or @($members | Where-Object { $_.userId -eq $viewer.id -and $_.role -eq 'Engineer' }).Count -ne 1) { throw 'Project membership assignment must be idempotent and visible.' }
try { Invoke-RestMethod -WebSession $viewerSession -Uri ([uri]::new($BaseUri, '/api/v1/admin/users')) | Out-Null; throw 'Engineer administrator directory access unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw } }
$memberComponent = Invoke-RestMethod -WebSession $viewerSession -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/components")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ name = 'Engineer member component'; parentComponentId = $null; reason = '自动化工程师项目写入许可' } | ConvertTo-Json)
if ($null -eq $memberComponent.id) { throw 'Scoped Engineer component creation must succeed.' }
$memberVersion = Invoke-RestMethod -WebSession $viewerSession -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/components/$($memberComponent.id)/versions")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ versionNumber = 'member-initial'; reason = '自动化工程师版本写入许可' } | ConvertTo-Json)
if ($null -eq $memberVersion.id -or $memberVersion.sequenceNo -ne 10) { throw 'Scoped Engineer version creation must succeed.' }
try { Invoke-RestMethod -WebSession $viewerSession -Uri ([uri]::new($BaseUri, '/api/v1/system/status')) | Out-Null; throw 'Engineer system status access unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw } }
try { Invoke-RestMethod -WebSession $viewerSession -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/system/jobs/noop')) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ reason = '自动化工程师后台任务拒绝' } | ConvertTo-Json) | Out-Null; throw 'Engineer system job enqueue unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw } }
$unscopedProject = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/projects')) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ code = "UNSCOPED-$suffix"; name = 'Unscoped project'; description = ''; reason = '自动化项目范围授权验收' } | ConvertTo-Json)
try { Invoke-RestMethod -WebSession $viewerSession -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($unscopedProject.id)/components")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ name = 'Denied'; parentComponentId = $null; reason = '自动化范围拒绝' } | ConvertTo-Json) | Out-Null; throw 'Unscoped Engineer component creation unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw } }
$unscopedComponent = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($unscopedProject.id)/components")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ name = 'Private'; parentComponentId = $null; reason = '自动化受限组件创建' } | ConvertTo-Json)
try { Invoke-RestMethod -WebSession $viewerSession -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/components/$($unscopedComponent.id)/versions")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ versionNumber = 'denied'; reason = '自动化版本范围拒绝' } | ConvertTo-Json) | Out-Null; throw 'Unscoped Engineer version creation unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw } }
try { Invoke-RestMethod -WebSession $viewerSession -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/components/$($unscopedComponent.id)/move")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ parentComponentId = $null; reason = '自动化移动范围拒绝' } | ConvertTo-Json) | Out-Null; throw 'Unscoped Engineer component move unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw } }
$unscopedVersion = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/components/$($unscopedComponent.id)/versions")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ versionNumber = 'admin-created'; reason = '自动化受限版本创建' } | ConvertTo-Json)
$unscopedReleasedVersion = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/components/$($unscopedComponent.id)/versions")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ versionNumber = 'admin-released'; maturity = 'Released'; reason = '自动化直接登记已发布版本' } | ConvertTo-Json)
$unscopedDetail = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($unscopedProject.id)"))
if (@($unscopedDetail.components | Where-Object { $_.id -eq $unscopedComponent.id -and @($_.versions | Where-Object { $_.id -eq $unscopedReleasedVersion.id -and $_.maturity -eq 'Released' }).Count -eq 1 }).Count -ne 1) { throw 'Directly registering a released version must preserve the legal maturity result.' }
$supersededTestingVersion = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/components/$($unscopedComponent.id)/versions")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ versionNumber = 'first-testing'; maturity = 'Testing'; reason = '自动化首个测试版本' } | ConvertTo-Json)
$currentTestingVersion = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/components/$($unscopedComponent.id)/versions")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ versionNumber = 'replacement-testing'; maturity = 'Testing'; reason = '自动化替换测试版本' } | ConvertTo-Json)
$testingConstraintDetail = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($unscopedProject.id)"))
if (@($testingConstraintDetail.components | Where-Object { $_.id -eq $unscopedComponent.id -and @($_.versions | Where-Object { $_.id -eq $supersededTestingVersion.id -and $_.maturity -eq 'Deprecated' }).Count -eq 1 -and @($_.versions | Where-Object { $_.id -eq $currentTestingVersion.id -and $_.maturity -eq 'Testing' }).Count -eq 1 }).Count -ne 1) { throw 'A replacement testing version must automatically deprecate the former testing version.' }
$unscopedImport = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/imports')) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ projectId = $unscopedProject.id; sourceFileName = 'private.csv'; reason = '自动化预览读取范围验收'; rows = @(@{ componentName = 'Private'; versionNumber = 'preview-only' }) } | ConvertTo-Json -Depth 5)
try { Invoke-RestMethod -WebSession $viewerSession -Uri ([uri]::new($BaseUri, "/api/v1/imports/$($unscopedImport.id)")) | Out-Null; throw 'Unscoped Engineer import preview unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw } }
$seniorRoleHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }
$seniorRoleBody = @{ role = 'SeniorEngineer'; reason = '自动化高级工程师范围验收' } | ConvertTo-Json
Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/admin/users/$($viewer.id)/role")) -Headers $seniorRoleHeaders -ContentType 'application/json' -Body $seniorRoleBody | Out-Null
Invoke-WebRequest -UseBasicParsing -SessionVariable viewerSession -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/auth/login')) -ContentType 'application/json' -Body (@{ email = $viewerEmail; password = $viewerPassword } | ConvertTo-Json) | Out-Null
try { Invoke-RestMethod -WebSession $viewerSession -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/component-versions/$($unscopedVersion.id)/maturity")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ state = 'Testing'; reason = '自动化生命周期范围拒绝' } | ConvertTo-Json) | Out-Null; throw 'Unscoped SeniorEngineer lifecycle update unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw } }
try { Invoke-RestMethod -WebSession $viewerSession -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($unscopedProject.id)/baselines")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ seriesCode = "DENIED-$suffix"; baselineCode = "DENIED-$suffix"; description = ''; reason = '自动化基线范围拒绝' } | ConvertTo-Json) | Out-Null; throw 'Unscoped SeniorEngineer baseline creation unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw } }
try { Invoke-RestMethod -WebSession $viewerSession -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($unscopedProject.id)/clone")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ code = "DENIED-CLONE-$suffix"; name = 'Denied clone'; reason = '自动化克隆范围拒绝' } | ConvertTo-Json) | Out-Null; throw 'Unscoped SeniorEngineer project clone unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw } }
try { Invoke-RestMethod -WebSession $viewerSession -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/machines')) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ projectId = $unscopedProject.id; serialNumber = "DENIED-$suffix"; name = 'Denied machine'; machineType = 'Test'; reason = '自动化机台范围拒绝' } | ConvertTo-Json) | Out-Null; throw 'Unscoped SeniorEngineer machine creation unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw } }
try { Invoke-RestMethod -WebSession $viewerSession -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/imports')) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ projectId = $unscopedProject.id; sourceFileName = 'denied.csv'; reason = '自动化导入范围拒绝'; rows = @(@{ componentName = 'Private'; versionNumber = 'denied' }) } | ConvertTo-Json -Depth 5) | Out-Null; throw 'Unscoped SeniorEngineer import staging unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw } }

$machineHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }
$machineBody = @{ projectId = $project.id; serialNumber = "SN-$suffix"; name = 'Automation machine'; machineType = 'Test'; location = 'Automation lab A-01'; reason = '自动化机台登记' } | ConvertTo-Json
$machine = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/machines')) -Headers $machineHeaders -ContentType 'application/json' -Body $machineBody
$machineReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/machines')) -Headers $machineHeaders -ContentType 'application/json' -Body $machineBody
if ($machine.id -ne $machineReplay.id) { throw 'Expected idempotent machine creation.' }
$createdMachine = $null
foreach ($candidate in (Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, '/api/v1/machines')))) { if ($candidate.id -eq $machine.id) { $createdMachine = $candidate; break } }
if ($createdMachine.location -ne 'Automation lab A-01') { throw 'Machine location must be returned after creation.' }
$machineUpdateHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }
$machineUpdateBody = @{ serialNumber = "SN-$suffix"; name = 'Automation machine updated'; machineType = 'Verification'; location = 'Automation lab B-02'; status = 'Active'; reason = '自动化机台资料维护' } | ConvertTo-Json
$machineUpdate = Invoke-RestMethod -WebSession $session -Method Put -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)")) -Headers $machineUpdateHeaders -ContentType 'application/json' -Body $machineUpdateBody
$machineUpdateReplay = Invoke-RestMethod -WebSession $session -Method Put -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)")) -Headers $machineUpdateHeaders -ContentType 'application/json' -Body $machineUpdateBody
if ($machineUpdate.id -ne $machine.id -or $machineUpdateReplay.id -ne $machine.id) { throw 'Machine update must return the edited machine and support idempotent replay.' }
$updatedMachine = $null
foreach ($candidate in (Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, '/api/v1/machines')))) { if ($candidate.id -eq $machine.id) { $updatedMachine = $candidate; break } }
if ($updatedMachine.name -ne 'Automation machine updated' -or $updatedMachine.machineType -ne 'Verification' -or $updatedMachine.location -ne 'Automation lab B-02') { throw 'Machine metadata update was not persisted.' }
try { Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/machines')) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ projectId = $project.id; serialNumber = "sn-$suffix"; name = 'Duplicate'; machineType = 'Test'; reason = '自动化重复校验' } | ConvertTo-Json) | Out-Null; throw 'Duplicate machine serial unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 409) { throw } }

function Invoke-JsonPost([string]$Path, [hashtable]$Body) {
    Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, $Path)) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body ($Body | ConvertTo-Json)
}

$componentHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }
$componentBody = @{ name = 'Control'; parentComponentId = $null; reason = '自动化组件创建' } | ConvertTo-Json
$component = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/components")) -Headers $componentHeaders -ContentType 'application/json' -Body $componentBody
$componentReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/components")) -Headers $componentHeaders -ContentType 'application/json' -Body $componentBody
if ($component.id -ne $componentReplay.id) { throw 'Expected idempotent component creation.' }
$editable = Invoke-JsonPost "/api/v1/projects/$($project.id)/components" @{ name = 'Editable'; parentComponentId = $null; reason = '自动化组件编辑删除验收' }
$editableChild = Invoke-JsonPost "/api/v1/projects/$($project.id)/components" @{ name = 'Editable child'; parentComponentId = $editable.id; reason = '自动化子组件编辑删除验收' }
$updateHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }
$updateBody = @{ name = 'Edited component'; reason = '自动化组件编辑验收' } | ConvertTo-Json
$updated = Invoke-RestMethod -WebSession $session -Method Put -Uri ([uri]::new($BaseUri, "/api/v1/components/$($editable.id)")) -Headers $updateHeaders -ContentType 'application/json' -Body $updateBody
$updatedReplay = Invoke-RestMethod -WebSession $session -Method Put -Uri ([uri]::new($BaseUri, "/api/v1/components/$($editable.id)")) -Headers $updateHeaders -ContentType 'application/json' -Body $updateBody
if ($updated.id -ne $editable.id -or $updatedReplay.id -ne $editable.id) { throw 'Expected idempotent component update.' }
try {
    Invoke-RestMethod -WebSession $session -Method Delete -Uri ([uri]::new($BaseUri, "/api/v1/components/$($editable.id)")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ reason = '自动化非叶节点删除拒绝' } | ConvertTo-Json) | Out-Null
    throw 'Deleting a component with children unexpectedly succeeded.'
} catch {
    if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }
    if ($_.Exception.Response.StatusCode.value__ -ne 409) { throw }
}
$deleteChildHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }
$deleteChildBody = @{ reason = '自动化空叶节点删除' } | ConvertTo-Json
$deletedChild = Invoke-RestMethod -WebSession $session -Method Delete -Uri ([uri]::new($BaseUri, "/api/v1/components/$($editableChild.id)")) -Headers $deleteChildHeaders -ContentType 'application/json' -Body $deleteChildBody
$deletedChildReplay = Invoke-RestMethod -WebSession $session -Method Delete -Uri ([uri]::new($BaseUri, "/api/v1/components/$($editableChild.id)")) -Headers $deleteChildHeaders -ContentType 'application/json' -Body $deleteChildBody
if (-not $deletedChild.deleted -or -not $deletedChildReplay.deleted) { throw 'Expected idempotent empty leaf component deletion.' }
Invoke-RestMethod -WebSession $session -Method Delete -Uri ([uri]::new($BaseUri, "/api/v1/components/$($editable.id)")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ reason = '自动化空根组件删除' } | ConvertTo-Json) | Out-Null
$child = Invoke-JsonPost "/api/v1/projects/$($project.id)/components" @{ name = 'Child'; parentComponentId = $component.id; reason = '自动化子组件创建' }
try {
    Invoke-JsonPost "/api/v1/components/$($component.id)/move" @{ parentComponentId = $child.id; reason = '自动化环检测' } | Out-Null
    throw 'Component cycle unexpectedly succeeded.'
} catch {
    if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }
    if ($_.Exception.Response.StatusCode.value__ -ne 409) { throw }
}
Invoke-JsonPost "/api/v1/components/$($child.id)/move" @{ parentComponentId = $null; reason = '自动化移动到根节点' } | Out-Null
$category = Invoke-JsonPost "/api/v1/projects/$($project.id)/components" @{ name = '软件分类节点'; parentComponentId = $null; reason = '自动化无版本结构节点验收' }
$reorderHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "component-reorder-$suffix" }
$reordered = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/components/$($category.id)/reorder")) -Headers $reorderHeaders -ContentType 'application/json' -Body (@{ direction = 'Up'; reason = '自动化根组件前移' } | ConvertTo-Json)
$reorderedReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/components/$($category.id)/reorder")) -Headers $reorderHeaders -ContentType 'application/json' -Body (@{ direction = 'Up'; reason = '自动化根组件前移' } | ConvertTo-Json)
if ($reordered.id -ne $category.id -or $reordered.id -ne $reorderedReplay.id) { throw 'Root component reorder must be idempotent and retain the component identity.' }
$versionHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }
$versionBody = @{ versionNumber = 'opaque-a'; reason = '自动化版本创建' } | ConvertTo-Json
$firstVersion = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/components/$($component.id)/versions")) -Headers $versionHeaders -ContentType 'application/json' -Body $versionBody
$firstVersionReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/components/$($component.id)/versions")) -Headers $versionHeaders -ContentType 'application/json' -Body $versionBody
if ($firstVersion.id -ne $firstVersionReplay.id -or $firstVersion.sequenceNo -ne $firstVersionReplay.sequenceNo) { throw 'Expected idempotent version creation.' }
$secondVersion = Invoke-JsonPost "/api/v1/components/$($component.id)/versions" @{ versionNumber = 'opaque-b'; reason = '自动化版本创建' }
$childVersion = Invoke-JsonPost "/api/v1/components/$($child.id)/versions" @{ versionNumber = 'opaque-child'; maturity = 'Testing'; reason = '自动化实验室版本创建' }
if ($firstVersion.sequenceNo -ne 10 -or $secondVersion.sequenceNo -ne 20) { throw 'Expected version sequence 10/20.' }
$patchHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "patch-$suffix" }
$patchBody = @{ patchCode = "HF-$suffix"; title = '控制模块热修复'; issueDescription = '已发布版本在特定工况下会遗漏一次状态刷新。'; resolutionDescription = '部署独立热修复包以补齐状态刷新逻辑，软件版本号保持不变。'; status = 'Released' } | ConvertTo-Json
$patch = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/component-versions/$($secondVersion.id)/patches")) -Headers $patchHeaders -ContentType 'application/json' -Body $patchBody
$patchReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/component-versions/$($secondVersion.id)/patches")) -Headers $patchHeaders -ContentType 'application/json' -Body $patchBody
$patchDetail = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/component-versions/$($secondVersion.id)"))
$patchAudit = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/audit?entityId=$($patch.id)"))
if ($patch.id -ne $patchReplay.id -or $patch.status -ne 'Released' -or @($patchDetail.patches | Where-Object { $_.id -eq $patch.id -and $_.patchCode -eq "HF-$suffix" -and $_.status -eq 'Released' }).Count -ne 1 -or @($patchAudit | Where-Object { $_.action -eq 'VersionPatchRecorded' -and $_.actor -eq $Email -and $_.correlationId -eq "patch-$suffix" }).Count -ne 1) { throw 'Version patch registration must be idempotent, traceable and must not require a replacement version.' }

function Invoke-Lifecycle([string]$Path, [string]$State, [string]$Reason) {
    Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, $Path)) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ state = $State; reason = $Reason } | ConvertTo-Json)
}

$maturityHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }
$maturityBody = @{ state = 'Testing'; reason = '自动化提交测试' } | ConvertTo-Json
$testing = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/component-versions/$($firstVersion.id)/maturity")) -Headers $maturityHeaders -ContentType 'application/json' -Body $maturityBody
$testingReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/component-versions/$($firstVersion.id)/maturity")) -Headers $maturityHeaders -ContentType 'application/json' -Body $maturityBody
$released = Invoke-Lifecycle "/api/v1/component-versions/$($firstVersion.id)/maturity" 'Released' '自动化发布'
if ($testing.maturity -ne 'Testing' -or $testingReplay.maturity -ne 'Testing' -or $released.maturity -ne 'Released') { throw 'Expected idempotent Draft -> Testing -> Released lifecycle.' }
Invoke-Lifecycle "/api/v1/component-versions/$($firstVersion.id)/recommend" '' '自动化推荐' | Out-Null
$blocked = Invoke-Lifecycle "/api/v1/component-versions/$($firstVersion.id)/safety" 'Blocked' '自动化阻断'
$clear = Invoke-Lifecycle "/api/v1/component-versions/$($firstVersion.id)/safety" 'Clear' '自动化解除阻断'
if ($blocked.safety -ne 'Blocked' -or $clear.safety -ne 'Clear') { throw 'Expected independent safety transitions.' }
$testingProject = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)"))
if (@($testingProject.components | Where-Object { $_.id -eq $child.id -and @($_.versions | Where-Object { $_.id -eq $childVersion.id -and $_.maturity -eq 'Testing' }).Count -eq 1 }).Count -ne 1) { throw 'A version registered for Testing must be visible as an experimental version before release.' }
Invoke-Lifecycle "/api/v1/component-versions/$($secondVersion.id)/maturity" 'Testing' '自动化进入实验室测试' | Out-Null
Invoke-Lifecycle "/api/v1/component-versions/$($secondVersion.id)/maturity" 'Released' '自动化通过测试并发布' | Out-Null
Invoke-Lifecycle "/api/v1/component-versions/$($childVersion.id)/maturity" 'Released' '自动化实验室版本发布' | Out-Null
Invoke-Lifecycle "/api/v1/component-versions/$($memberVersion.id)/maturity" 'Testing' '自动化成员版本进入测试' | Out-Null
Invoke-Lifecycle "/api/v1/component-versions/$($memberVersion.id)/maturity" 'Released' '自动化成员版本发布' | Out-Null

$baselineBody = @{ seriesCode = "SERIES-$suffix"; baselineCode = "BL-$suffix"; description = 'Created by integration test'; reason = '自动化基线快照验收' } | ConvertTo-Json
$baselineHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "baseline-$suffix" }
$baseline = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/baselines")) -Headers $baselineHeaders -ContentType 'application/json' -Body $baselineBody
$baselineReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/baselines")) -Headers $baselineHeaders -ContentType 'application/json' -Body $baselineBody
if ($baseline.itemCount -ne 4 -or $baseline.revisionNo -ne 1 -or $baseline.id -ne $baselineReplay.id) { throw 'Expected idempotent complete baseline draft snapshot including structural nodes.' }
$baselineDetail = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)"))
if ($baselineDetail.baseline.id -ne $baseline.id -or $baselineDetail.baseline.state -ne 'Draft' -or $baselineDetail.items.Count -ne 4 -or @($baselineDetail.items | Where-Object { $_.componentName -eq 'Control' -and $_.versionNumber -eq 'opaque-b' }).Count -ne 1 -or @($baselineDetail.items | Where-Object { $_.componentId -eq $category.id -and $_.versionId -eq $null -and $_.versionNumber -eq $null }).Count -ne 1) { throw 'Baseline detail must retain named structural nodes without a software version.' }
$controlBaselineItem = @($baselineDetail.items | Where-Object { $_.componentName -eq 'Control' })[0]
$categoryBaselineItem = @($baselineDetail.items | Where-Object { $_.componentId -eq $category.id })[0]
try { Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)/items/$($categoryBaselineItem.id)/requirement")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ requirement = 'Optional'; reason = '结构节点不应设置必需性' } | ConvertTo-Json) | Out-Null; throw 'Structural baseline item requirement update unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 409) { throw } }
$requirementHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "baseline-requirement-$suffix" }
$requirementBody = @{ requirement = 'Optional'; reason = '自动化可选项验收' } | ConvertTo-Json
$optionalRequirement = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)/items/$($controlBaselineItem.id)/requirement")) -Headers $requirementHeaders -ContentType 'application/json' -Body $requirementBody
$optionalRequirementReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)/items/$($controlBaselineItem.id)/requirement")) -Headers $requirementHeaders -ContentType 'application/json' -Body $requirementBody
$baselineDetail = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)"))
if ($optionalRequirement.id -ne $controlBaselineItem.id -or $optionalRequirement.requirement -ne 'Optional' -or $optionalRequirement.id -ne $optionalRequirementReplay.id -or @($baselineDetail.items | Where-Object { $_.id -eq $controlBaselineItem.id -and $_.requirement -eq 'Optional' }).Count -ne 1) { throw 'Draft baseline item requirement must be authorized, auditable and idempotent.' }
try { Invoke-RestMethod -WebSession $viewerSession -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)/release")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ reason = '自动化基线发布范围拒绝' } | ConvertTo-Json) | Out-Null; throw 'Project Engineer baseline release unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw } }
try { Invoke-RestMethod -WebSession $viewerSession -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/standard")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ configurationBaselineId = $baseline.id; reason = '自动化项目标准范围拒绝' } | ConvertTo-Json) | Out-Null; throw 'Project Engineer standard assignment unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw } }
$releaseBody = @{ reason = '自动化基线发布验收' } | ConvertTo-Json
$releaseHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "release-$suffix" }
try { Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)/release")) -Headers $releaseHeaders -ContentType 'application/json' -Body $releaseBody | Out-Null; throw 'Unreviewed baseline release unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 409) { throw } }
$reviewHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "review-$suffix" }
$reviewBody = @{ reason = '自动化基线评审送审' } | ConvertTo-Json
$review = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)/review")) -Headers $reviewHeaders -ContentType 'application/json' -Body $reviewBody
$reviewReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)/review")) -Headers $reviewHeaders -ContentType 'application/json' -Body $reviewBody
if ($review.status -ne 'Pending' -or $review.id -ne $reviewReplay.id) { throw 'Baseline review request must be idempotent and pending.' }
try { Invoke-RestMethod -WebSession $viewerSession -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)/review/approve")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ reason = '非管理员不得批准' } | ConvertTo-Json) | Out-Null; throw 'Non-admin baseline review approval unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw } }
$approvalHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "review-approve-$suffix" }
$approvalBody = @{ reason = '自动化基线评审通过' } | ConvertTo-Json
$approval = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)/review/approve")) -Headers $approvalHeaders -ContentType 'application/json' -Body $approvalBody
$approvalReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)/review/approve")) -Headers $approvalHeaders -ContentType 'application/json' -Body $approvalBody
$baselineDetail = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)"))
if ($approval.status -ne 'Approved' -or $approval.id -ne $approvalReplay.id -or $baselineDetail.review.status -ne 'Approved' -or [string]::IsNullOrWhiteSpace($baselineDetail.baseline.approvedBy)) { throw 'Approved review must be visible on the baseline and retain the approver.' }
$releasedBaseline = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)/release")) -Headers $releaseHeaders -ContentType 'application/json' -Body $releaseBody
$releasedReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)/release")) -Headers $releaseHeaders -ContentType 'application/json' -Body $releaseBody
if ($releasedBaseline.state -ne 'Released' -or $releasedBaseline.id -ne $releasedReplay.id) { throw 'Expected idempotent baseline release.' }
try { Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)/items/$($controlBaselineItem.id)/requirement")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ requirement = 'Required'; reason = '自动化发布后修改拒绝' } | ConvertTo-Json) | Out-Null; throw 'Released baseline item requirement update unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 409) { throw } }
$thirdVersion = Invoke-JsonPost "/api/v1/components/$($component.id)/versions" @{ versionNumber = 'opaque-c'; reason = '自动化版本创建' }
Invoke-Lifecycle "/api/v1/component-versions/$($thirdVersion.id)/maturity" 'Testing' '自动化比较版本进入测试' | Out-Null
Invoke-Lifecycle "/api/v1/component-versions/$($thirdVersion.id)/maturity" 'Released' '自动化比较版本发布' | Out-Null
$labVersion = Invoke-JsonPost "/api/v1/components/$($component.id)/versions" @{ versionNumber = 'opaque-lab'; reason = '自动化实验室基线版本创建' }
Invoke-Lifecycle "/api/v1/component-versions/$($labVersion.id)/maturity" 'Testing' '自动化实验室基线版本进入测试' | Out-Null
$labBaselineHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "baseline-lab-$suffix" }
$labBaselineBody = @{ seriesCode = "LAB-$suffix"; baselineCode = "BL-LAB-$suffix"; description = 'Generated from testing version'; reason = '自动化实验室版本生成基线'; testingVersionIds = @($labVersion.id); versionSelections = @(@{ componentId = $component.id; versionId = $labVersion.id }, @{ componentId = $child.id; versionId = $childVersion.id }, @{ componentId = $memberComponent.id; versionId = $memberVersion.id }) } | ConvertTo-Json -Depth 5
$labBaseline = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/baselines")) -Headers $labBaselineHeaders -ContentType 'application/json' -Body $labBaselineBody
$labBaselineReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/baselines")) -Headers $labBaselineHeaders -ContentType 'application/json' -Body $labBaselineBody
$labVersionDetail = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/component-versions/$($labVersion.id)"))
if ($labBaseline.id -ne $labBaselineReplay.id -or $labVersionDetail.version.maturity -ne 'Released') { throw 'Selected testing versions must be atomically released and frozen into an idempotent baseline draft.' }
$undoBaselineHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "baseline-undo-$suffix" }
$undoBaselineBody = @{ reason = '自动化撤回误生成基线' } | ConvertTo-Json
$undoneBaseline = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($labBaseline.id)/undo-creation")) -Headers $undoBaselineHeaders -ContentType 'application/json' -Body $undoBaselineBody
$undoneBaselineReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($labBaseline.id)/undo-creation")) -Headers $undoBaselineHeaders -ContentType 'application/json' -Body $undoBaselineBody
$restoredLabVersion = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/component-versions/$($labVersion.id)"))
if (-not $undoneBaseline.undone -or -not $undoneBaselineReplay.undone -or $restoredLabVersion.version.maturity -ne 'Testing') { throw 'A testing-generated draft baseline must be safely undoable within one minute and restore its testing version.' }
$labBaseline = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/baselines")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "baseline-lab-recreated-$suffix" } -ContentType 'application/json' -Body $labBaselineBody
$labVersionDetail = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/component-versions/$($labVersion.id)"))
if ($labVersionDetail.version.maturity -ne 'Released') { throw 'Recreating a withdrawn testing baseline must publish the selected testing version again.' }
$maintenanceHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "baseline-maintenance-$suffix" }
$maintenanceBody = @{ createdAt = '2001-02-03T04:05:00+00:00'; versionSelections = @(@{ componentId = $component.id; versionId = $thirdVersion.id }); reason = '自动化维护模式构造历史'; maintenanceMode = $true } | ConvertTo-Json -Depth 5
Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($labBaseline.id)/maintenance")) -Headers $maintenanceHeaders -ContentType 'application/json' -Body $maintenanceBody | Out-Null
$maintainedDetail = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($labBaseline.id)"))
if (([DateTimeOffset]$maintainedDetail.baseline.createdAt).Year -ne 2001 -or @($maintainedDetail.items | Where-Object { $_.componentId -eq $component.id -and $_.versionId -eq $thirdVersion.id }).Count -ne 1) { throw 'Maintenance mode must only update a draft baseline with explicit audit-friendly historical data.' }
try { Invoke-RestMethod -WebSession $viewerSession -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)/maintenance")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body $maintenanceBody | Out-Null; throw 'Non-super-admin historical maintenance unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw } }
$releasedMaintenanceBody = @{ createdAt = '2002-03-04T05:06:00+00:00'; versionSelections = @(@{ componentId = $component.id; versionId = $secondVersion.id }); reason = '自动化已发布历史补录'; maintenanceMode = $true } | ConvertTo-Json -Depth 5
Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)/maintenance")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body $releasedMaintenanceBody | Out-Null
$releasedMaintenance = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)"))
if (([DateTimeOffset]$releasedMaintenance.baseline.createdAt).Year -ne 2002 -or @($releasedMaintenance.items | Where-Object { $_.componentId -eq $component.id -and $_.versionId -eq $secondVersion.id }).Count -ne 1) { throw 'SuperAdmin historical maintenance must update an already released baseline through the guarded transaction.' }
$explicitBaselineBody = @{ seriesCode = "EXPLICIT-$suffix"; baselineCode = "BL-EXPLICIT-$suffix"; description = 'Explicit released version selection'; reason = '自动化显式基线编排验收'; versionSelections = @(@{ componentId = $component.id; versionId = $secondVersion.id }, @{ componentId = $child.id; versionId = $childVersion.id }, @{ componentId = $memberComponent.id; versionId = $memberVersion.id }) } | ConvertTo-Json -Depth 5
$explicitBaselineHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "baseline-explicit-$suffix" }
$explicitBaseline = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/baselines")) -Headers $explicitBaselineHeaders -ContentType 'application/json' -Body $explicitBaselineBody
$explicitBaselineReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/baselines")) -Headers $explicitBaselineHeaders -ContentType 'application/json' -Body $explicitBaselineBody
$explicitBaselineDetail = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($explicitBaseline.id)"))
if ($explicitBaseline.id -ne $explicitBaselineReplay.id -or @($explicitBaselineDetail.items | Where-Object { $_.componentId -eq $component.id -and $_.versionId -eq $secondVersion.id -and $_.versionNumber -eq 'opaque-b' }).Count -ne 1) { throw 'Explicit baseline composition must retain the selected older released version and be idempotent.' }
$secondBaselineCode = "BL2-$suffix"
$secondBaselineBody = @{ seriesCode = "SERIES2-$suffix"; baselineCode = $secondBaselineCode; description = 'Comparison baseline'; reason = '自动化基线比较验收'; versionSelections = @(@{ componentId = $component.id; versionId = $thirdVersion.id }, @{ componentId = $child.id; versionId = $childVersion.id }, @{ componentId = $memberComponent.id; versionId = $memberVersion.id }) } | ConvertTo-Json -Depth 5
$secondBaseline = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/baselines")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body $secondBaselineBody
$secondReviewHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }
Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($secondBaseline.id)/review")) -Headers $secondReviewHeaders -ContentType 'application/json' -Body $reviewBody | Out-Null
Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($secondBaseline.id)/review/approve")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body $approvalBody | Out-Null
Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($secondBaseline.id)/release")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body $releaseBody | Out-Null
$compare = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($baseline.id)/compare/$($secondBaseline.id)"))
if (@($compare.items | Where-Object { $_.componentId -eq $component.id -and $_.status -eq 'Changed' -and $_.componentName -eq 'Control' -and $_.leftVersionNumber -eq 'opaque-b' -and $_.rightVersionNumber -eq 'opaque-c' }).Count -ne 1) { throw 'Baseline comparison must return frozen readable snapshots and changed versions.' }
$baselineList = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/baselines"))
if ($baselineList.Count -ne 4 -or @($baselineList | Where-Object { $_.state -eq 'Released' }).Count -ne 2 -or @($baselineList | Where-Object { $_.id -in @($explicitBaseline.id, $labBaseline.id) -and $_.state -eq 'Draft' }).Count -ne 2) { throw 'Expected released baseline history plus the testing and explicit draft compositions.' }
$seniorMembership = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/members")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ userId = $viewer.id; role = 'SeniorEngineer'; reason = '自动化高级工程师项目授权' } | ConvertTo-Json)
if ($seniorMembership.role -ne 'SeniorEngineer') { throw 'Project SeniorEngineer membership assignment must succeed.' }
$seniorBaseline = Invoke-RestMethod -WebSession $viewerSession -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/baselines")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ seriesCode = "SENIOR-$suffix"; baselineCode = "SENIOR-$suffix"; description = 'Senior member draft'; reason = '自动化高级工程师基线许可' } | ConvertTo-Json)
$seniorBaselineDetail = Invoke-RestMethod -WebSession $viewerSession -Uri ([uri]::new($BaseUri, "/api/v1/baselines/$($seniorBaseline.id)"))
if ($null -eq $seniorBaseline.id -or $seniorBaselineDetail.baseline.state -ne 'Draft') { throw 'Scoped SeniorEngineer baseline creation must succeed.' }
$standardBody = @{ configurationBaselineId = $baseline.id; reason = '自动化项目标准验收' } | ConvertTo-Json
$standardHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "standard-$suffix" }
$standard = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/standard")) -Headers $standardHeaders -ContentType 'application/json' -Body $standardBody
$standardReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/standard")) -Headers $standardHeaders -ContentType 'application/json' -Body $standardBody
$currentStandard = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/standard"))
if ($standard.baselineId -ne $baseline.id -or $standard.id -ne $standardReplay.id -or $currentStandard.baselineId -ne $baseline.id) { throw 'Expected idempotent current project standard assignment.' }
$targetHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }
$targetBody = @{ configurationBaselineId = $baseline.id; reason = '自动化机台目标验收' } | ConvertTo-Json
$target = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/target")) -Headers $targetHeaders -ContentType 'application/json' -Body $targetBody
$targetReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/target")) -Headers $targetHeaders -ContentType 'application/json' -Body $targetBody
if ($target.baselineId -ne $baseline.id -or $target.id -ne $targetReplay.id) { throw 'Expected idempotent explicit machine target assignment.' }
$newStandard = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/standard")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ configurationBaselineId = $secondBaseline.id; reason = '自动化更新项目标准验收' } | ConvertTo-Json)
$currentMachineTarget = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/target"))
if ($newStandard.baselineId -ne $secondBaseline.id -or $currentMachineTarget.baselineId -ne $baseline.id) { throw 'Changing the project standard must not implicitly change an existing machine target.' }
$knownInstalledAt = [DateTimeOffset]::UtcNow.AddDays(-1)
$fullFacts = @{ operationType = 'InitialSnapshot'; coverage = 'Full'; sourceType = 'automation'; reason = '自动化完整快照'; items = @(@{ componentId = $component.id; versionId = $secondVersion.id; absent = $false; knownInstalledAt = $knownInstalledAt }, @{ componentId = $child.id; versionId = $childVersion.id; absent = $false; knownInstalledAt = $null }, @{ componentId = $memberComponent.id; versionId = $memberVersion.id; absent = $false; knownInstalledAt = $null }) } | ConvertTo-Json -Depth 5
Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/facts")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body $fullFacts | Out-Null
$blockedForRisk = Invoke-Lifecycle "/api/v1/component-versions/$($secondVersion.id)/safety" 'Blocked' '自动化风险验收'
$drift = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/drift"))
if ($drift.matchStatus -ne 'Matched' -or $drift.riskSeverity -ne 'Critical') { throw "Expected Matched + Critical but received $($drift | ConvertTo-Json -Compress)." }
$machineSummary = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/drift-summary"))
if ($machineSummary.matchStatus -ne 'Matched' -or $machineSummary.riskSeverity -ne 'Critical') { throw 'Expected persisted machine drift summary to preserve Match and Risk independently.' }
$dashboard = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, '/api/v1/dashboard'))
if ($dashboard.machineCount -lt 1 -or $dashboard.matchedCount -lt 1 -or $dashboard.criticalRiskCount -lt 1) { throw 'Dashboard must aggregate persisted machine drift summaries.' }
$rebuildHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }
$rebuildBody = @{ reason = '自动化投影重建验收' } | ConvertTo-Json
$rebuild = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/admin/drift-summaries/rebuild')) -Headers $rebuildHeaders -ContentType 'application/json' -Body $rebuildBody
$rebuildReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/admin/drift-summaries/rebuild')) -Headers $rebuildHeaders -ContentType 'application/json' -Body $rebuildBody
if ($rebuild.machineCount -lt 1 -or $rebuild.id -ne $rebuildReplay.id) { throw 'Drift summary rebuild must be administrator-only and idempotent.' }
Invoke-Lifecycle "/api/v1/component-versions/$($secondVersion.id)/safety" 'Clear' '自动化恢复风险状态' | Out-Null
$partialFacts = @{ operationType = 'Observation'; coverage = 'Partial'; sourceType = 'automation'; reason = '自动化局部观察'; items = @(@{ componentId = $component.id; versionId = $firstVersion.id; absent = $false; knownInstalledAt = $null }) } | ConvertTo-Json -Depth 5
Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/facts")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body $partialFacts | Out-Null
$actual = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/configuration"))
$actualComponent = @($actual | Where-Object { $_.componentId -eq $component.id })
if ($actual.Count -ne 3 -or $actualComponent.Count -ne 1 -or $null -eq $actualComponent[0].knownInstalledAt -or (([DateTimeOffset]$actualComponent[0].knownInstalledAt).ToUniversalTime() - $knownInstalledAt.ToUniversalTime()).Duration().TotalSeconds -gt 1 -or @($actual | Where-Object { $_.componentId -eq $child.id -and $_.versionId -eq $childVersion.id -and $_.state -eq 'Present' }).Count -ne 1 -or @($actual | Where-Object { $_.componentId -eq $memberComponent.id -and $_.versionId -eq $memberVersion.id -and $_.state -eq 'Present' }).Count -ne 1) { throw 'Partial observation must preserve unobserved current components and must not turn observation time into installed time.' }
$fullObservation = @{ operationType = 'Observation'; coverage = 'Full'; sourceType = 'automation'; reason = '自动化完整观察缺失验收'; items = @(@{ componentId = $component.id; versionId = $firstVersion.id; absent = $false; knownInstalledAt = $null }) } | ConvertTo-Json -Depth 5
Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/facts")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body $fullObservation | Out-Null
$fullActual = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/configuration"))
if (@($fullActual | Where-Object { $_.componentId -eq $child.id -and $_.state -eq 'Absent' -and $_.versionId -eq $null }).Count -ne 1 -or @($fullActual | Where-Object { $_.componentId -eq $category.id }).Count -ne 0) { throw 'Full observation must project omitted configured components as absent without recording structural nodes.' }
$staleObservation = @{ operationType = 'Observation'; coverage = 'Partial'; sourceType = 'automation'; effectiveAt = [DateTimeOffset]::UtcNow.AddDays(-7); reason = '自动化迟到观察验收'; items = @(@{ componentId = $component.id; versionId = $secondVersion.id; absent = $false; knownInstalledAt = $null }) } | ConvertTo-Json -Depth 5
Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/facts")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body $staleObservation | Out-Null
$afterStaleObservation = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/configuration"))
if (@($afterStaleObservation | Where-Object { $_.componentId -eq $component.id -and $_.versionId -eq $firstVersion.id -and $_.state -eq 'Present' }).Count -ne 1) { throw 'An earlier observation must not overwrite a newer current configuration state.' }
$historicalAt = [DateTimeOffset]::UtcNow.AddDays(-6).ToString('O')
$historicalConfiguration = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/configuration-at?at=$([Uri]::EscapeDataString($historicalAt))"))
if (@($historicalConfiguration.items | Where-Object { $_.componentId -eq $component.id -and $_.versionId -eq $secondVersion.id -and $_.state -eq 'Present' -and $_.knownInstalledAt -eq $null }).Count -ne 1) { throw 'Historical configuration must rebuild the effective fact state without substituting the current projection or observation time for installed time.' }
$currentHistoricalComparison = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/compare-history?at=$([Uri]::EscapeDataString($historicalAt))"))
Invoke-Lifecycle "/api/v1/component-versions/$($firstVersion.id)/safety" 'Blocked' '自动化当前历史比对风险验收' | Out-Null
$criticalCurrentHistoricalComparison = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/compare-history?at=$([Uri]::EscapeDataString($historicalAt))"))
Invoke-Lifecycle "/api/v1/component-versions/$($firstVersion.id)/safety" 'Clear' '自动化当前历史比对恢复安全状态' | Out-Null
if ($currentHistoricalComparison.matchStatus -ne 'Mismatch' -or $currentHistoricalComparison.riskSeverity -ne 'None' -or $criticalCurrentHistoricalComparison.matchStatus -ne 'Mismatch' -or $criticalCurrentHistoricalComparison.riskSeverity -ne 'Critical') { throw 'Current-versus-historical comparison must keep version difference separate from blocked-version risk.' }
$rollbackHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "rollback-$suffix" }
$rollbackBody = @{ operationType = 'Rollback'; coverage = 'Partial'; sourceType = 'automation'; reason = '自动化组件回退验收'; items = @(@{ componentId = $component.id; versionId = $secondVersion.id; absent = $false; knownInstalledAt = $null }) } | ConvertTo-Json -Depth 5
$rollback = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/facts")) -Headers $rollbackHeaders -ContentType 'application/json' -Body $rollbackBody
$rollbackReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/facts")) -Headers $rollbackHeaders -ContentType 'application/json' -Body $rollbackBody
$afterRollback = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/configuration"))
if ($rollback.id -ne $rollbackReplay.id -or @($afterRollback | Where-Object { $_.componentId -eq $component.id -and $_.versionId -eq $secondVersion.id -and $_.state -eq 'Present' }).Count -ne 1) { throw 'Rollback must append an idempotent fact and update Current Actual to the restored version.' }
$correctionHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "correction-$suffix" }
$correctionBody = @{ operationType = 'Correction'; coverage = 'Partial'; sourceType = 'automation'; correctsDeploymentBatchId = $rollback.id; reason = '自动化回退事实更正验收'; items = @(@{ componentId = $component.id; versionId = $firstVersion.id; absent = $false; knownInstalledAt = $null }) } | ConvertTo-Json -Depth 5
$correction = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/facts")) -Headers $correctionHeaders -ContentType 'application/json' -Body $correctionBody
$correctionReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/facts")) -Headers $correctionHeaders -ContentType 'application/json' -Body $correctionBody
$afterCorrection = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/configuration"))
$factsAfterCorrection = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/facts"))
if ($correction.id -ne $correctionReplay.id -or @($afterCorrection | Where-Object { $_.componentId -eq $component.id -and $_.versionId -eq $firstVersion.id -and $_.state -eq 'Present' }).Count -ne 1 -or @($factsAfterCorrection | Where-Object { $_.id -eq $correction.id -and $_.operationType -eq 'Correction' -and $_.correctsDeploymentBatchId -eq $rollback.id }).Count -ne 1 -or @($factsAfterCorrection | Where-Object { $_.id -eq $rollback.id -and $_.operationType -eq 'Rollback' }).Count -ne 1) { throw 'Correction must append a linked fact, preserve the original rollback and restore the corrected state at the original effective time.' }
try { Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/facts")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ operationType = 'Rollback'; coverage = 'Full'; sourceType = 'automation'; reason = '无效完整回退'; items = @(@{ componentId = $component.id; versionId = $firstVersion.id; absent = $false; knownInstalledAt = $null }) } | ConvertTo-Json -Depth 5) | Out-Null; throw 'Full rollback unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 400) { throw } }
$externalEventFacts = @{ operationType = 'Observation'; coverage = 'Partial'; sourceType = 'agent-automation'; externalEventId = "acceptance-$suffix"; reason = '自动化外部事件去重验收'; items = @(@{ componentId = $component.id; versionId = $firstVersion.id; absent = $false; knownInstalledAt = $null }) } | ConvertTo-Json -Depth 5
Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/facts")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body $externalEventFacts | Out-Null
try { Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/facts")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body $externalEventFacts | Out-Null; throw 'Duplicate external fact unexpectedly succeeded.' } catch { if ($_.Exception.Message -match 'unexpectedly succeeded') { throw }; if ($_.Exception.Response.StatusCode.value__ -ne 409) { throw } }
$bulkMachineOne = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/machines')) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ projectId = $project.id; serialNumber = "BULK-1-$suffix"; name = 'Bulk machine one'; machineType = 'Test'; reason = '自动化批量事实机台一' } | ConvertTo-Json)
$bulkMachineTwo = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/machines')) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ projectId = $project.id; serialNumber = "BULK-2-$suffix"; name = 'Bulk machine two'; machineType = 'Test'; reason = '自动化批量事实机台二' } | ConvertTo-Json)
$bulkFactHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "bulk-facts-$suffix" }
$bulkFactBody = @{ machineIds = @($bulkMachineOne.id, $bulkMachineTwo.id); operationType = 'Observation'; coverage = 'Partial'; reason = '自动化批量局部观察'; items = @(@{ componentId = $component.id; versionId = $firstVersion.id; absent = $false; knownInstalledAt = $null }) } | ConvertTo-Json -Depth 5
$bulkFacts = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/bulk-facts")) -Headers $bulkFactHeaders -ContentType 'application/json' -Body $bulkFactBody
$bulkFactsReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/bulk-facts")) -Headers $bulkFactHeaders -ContentType 'application/json' -Body $bulkFactBody
$bulkOneConfiguration = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($bulkMachineOne.id)/configuration"))
$bulkTwoFacts = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($bulkMachineTwo.id)/facts"))
$bulkFactAudit = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/audit?entityId=$($bulkFacts.id)"))
if ($bulkFacts.id -ne $bulkFactsReplay.id -or $bulkFacts.succeeded -ne 2 -or $bulkFacts.failed -ne 0 -or @($bulkOneConfiguration | Where-Object { $_.componentId -eq $component.id -and $_.versionId -eq $firstVersion.id -and $_.state -eq 'Present' }).Count -ne 1 -or @($bulkTwoFacts | Where-Object { $_.operationType -eq 'Observation' -and $_.coverage -eq 'Partial' -and $_.sourceType -eq 'bulk-ui' }).Count -ne 1 -or @($bulkFactAudit | Where-Object { $_.action -eq 'BulkMachineFactsRecorded' -and $_.correlationId -eq "bulk-facts-$suffix" }).Count -ne 1) { throw 'Bulk facts must replay idempotently, use the single-machine fact semantics, and retain aggregate audit.' }
$upgradeAt = [DateTimeOffset]::UtcNow.AddMinutes(1)
$bulkUpgradeHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "bulk-upgrade-$suffix" }
$bulkUpgradeBody = @{ configurationBaselineId = $secondBaseline.id; machineIds = @($bulkMachineOne.id, $bulkMachineTwo.id); effectiveAt = $upgradeAt; reason = '自动化批量基线升级验收' } | ConvertTo-Json -Depth 5
$bulkUpgrade = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/bulk-baseline-upgrades")) -Headers $bulkUpgradeHeaders -ContentType 'application/json' -Body $bulkUpgradeBody
$bulkUpgradeReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/bulk-baseline-upgrades")) -Headers $bulkUpgradeHeaders -ContentType 'application/json' -Body $bulkUpgradeBody
$upgradedOneConfiguration = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($bulkMachineOne.id)/configuration"))
$upgradedOneFacts = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($bulkMachineOne.id)/facts"))
$bulkUpgradeAudit = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/audit?entityId=$($bulkUpgrade.id)"))
$upgradedMachineTarget = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($bulkMachineOne.id)/target"))
$hasUnexpectedTarget = $null -ne $upgradedMachineTarget -and -not [string]::IsNullOrWhiteSpace([string]$upgradedMachineTarget)
$upgradeChecks = [ordered]@{
    idempotent = $bulkUpgrade.id -eq $bulkUpgradeReplay.id
    succeeded = $bulkUpgrade.succeeded -eq 2
    failed = $bulkUpgrade.failed -eq 0
    controlProjected = @($upgradedOneConfiguration | Where-Object { $_.componentId -eq $component.id -and $_.versionId -eq $thirdVersion.id -and $_.state -eq 'Present' -and (([DateTimeOffset]$_.knownInstalledAt).ToUniversalTime() - $upgradeAt.ToUniversalTime()).Duration().TotalSeconds -lt 1 }).Count -eq 1
    childProjected = @($upgradedOneConfiguration | Where-Object { $_.componentId -eq $child.id -and $_.versionId -eq $childVersion.id -and $_.state -eq 'Present' }).Count -eq 1
    sourceRecorded = @($upgradedOneFacts | Where-Object { $_.operationType -eq 'Upgrade' -and $_.coverage -eq 'Full' -and $_.sourceBaselineId -eq $secondBaseline.id -and $_.sourceBaselineCode -eq $secondBaselineCode }).Count -eq 1
    audited = @($bulkUpgradeAudit | Where-Object { $_.action -eq 'BulkMachineBaselineUpgradeRecorded' -and $_.correlationId -eq "bulk-upgrade-$suffix" }).Count -eq 1
    targetUnchanged = -not $hasUnexpectedTarget
}
if ($upgradeChecks.Values -contains $false) { throw ("Bulk baseline upgrade checks failed: " + ($upgradeChecks | ConvertTo-Json -Compress)) }
$machineComparison = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($bulkMachineOne.id)/compare/$($bulkMachineTwo.id)"))
Invoke-Lifecycle "/api/v1/component-versions/$($thirdVersion.id)/safety" 'Blocked' '自动化机台比对风险验收' | Out-Null
$criticalMachineComparison = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($bulkMachineOne.id)/compare/$($bulkMachineTwo.id)"))
$exposureSnapshots = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/component-versions/$($thirdVersion.id)/exposures"))
$latestExposure = @($exposureSnapshots | Select-Object -First 1)
$exposureAudit = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/audit?entityId=$($latestExposure.id)"))
Invoke-Lifecycle "/api/v1/component-versions/$($thirdVersion.id)/safety" 'Clear' '自动化机台比对恢复安全状态' | Out-Null
if ($machineComparison.matchStatus -ne 'Matched' -or $machineComparison.riskSeverity -ne 'None' -or $criticalMachineComparison.matchStatus -ne 'Matched' -or $criticalMachineComparison.riskSeverity -ne 'Critical' -or $latestExposure.currentMachineCount -lt 2 -or $latestExposure.historicalMachineCount -lt 2 -or @($exposureAudit | Where-Object { $_.action -eq 'VersionExposureSnapshotCaptured' }).Count -ne 1) { throw 'Machine comparison must keep version match separate from blocked-version risk, and blocking must retain an auditable exposure snapshot.' }
$factHistory = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/facts"))
if (@($factHistory | Where-Object { $_.operationType -eq 'InitialSnapshot' -and $_.coverage -eq 'Full' }).Count -ne 1 -or @($factHistory | Where-Object { $_.operationType -eq 'Observation' -and $_.coverage -eq 'Partial' }).Count -ne 3 -or @($factHistory | Where-Object { $_.operationType -eq 'Observation' -and $_.coverage -eq 'Full' }).Count -ne 1 -or @($factHistory | Where-Object { $_.operationType -eq 'Rollback' -and $_.coverage -eq 'Partial' }).Count -ne 1 -or @($factHistory | Where-Object { $_.operationType -eq 'Correction' -and $_.correctsDeploymentBatchId -eq $rollback.id }).Count -ne 1 -or @($factHistory | Where-Object { $_.sourceType -eq 'agent-automation' }).Count -ne 1) { throw 'Machine fact history must retain operation, coverage, rollback, correction and external event semantics.' }
$impact = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/component-versions/$($secondVersion.id)/impact"))
if (@($impact.usedBaselineIds | Where-Object { $_ -eq $baseline.id }).Count -ne 1 -or @($impact.targetMachineIds | Where-Object { $_ -eq $machine.id }).Count -ne 1 -or @($impact.historicalMachineIds | Where-Object { $_ -eq $machine.id }).Count -ne 1) { throw 'Version impact must trace baseline, target machine and historical deployment facts.' }
$bulkTargetHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "bulk-target-$suffix" }
$bulkTargetBody = @{ configurationBaselineId = $secondBaseline.id; machineIds = @($machine.id); reason = '自动化批量目标历史验收' } | ConvertTo-Json
$replacementTarget = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/bulk-machine-targets")) -Headers $bulkTargetHeaders -ContentType 'application/json' -Body $bulkTargetBody
$replacementTargetReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/bulk-machine-targets")) -Headers $bulkTargetHeaders -ContentType 'application/json' -Body $bulkTargetBody
$targetHistory = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/machines/$($machine.id)/target-history"))
$bulkTargetSkipped = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/bulk-machine-targets")) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body $bulkTargetBody
if ($replacementTarget.succeeded -ne 1 -or $replacementTarget.id -ne $replacementTargetReplay.id -or $bulkTargetSkipped.succeeded -ne 0 -or $bulkTargetSkipped.skipped -ne 1 -or $targetHistory.Count -ne 2 -or $targetHistory[0].baselineId -ne $secondBaseline.id -or $null -eq $targetHistory[1].validTo -or $targetHistory[1].baselineId -ne $baseline.id) { throw 'Bulk target assignment must be idempotent, skip already-targeted machines and retain the closed prior assignment.' }
$versionDetail = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/component-versions/$($secondVersion.id)"))
if ($versionDetail.version.sequenceNo -ne 20 -or $versionDetail.version.componentId -ne $component.id -or $versionDetail.transitions.Count -lt 2) { throw 'Version detail must expose the opaque version identity and lifecycle history.' }
$search = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/search?query=TEST-$suffix"))
if (@($search | Where-Object { $_.type -eq 'Project' -and $_.id -eq $project.id }).Count -ne 1) { throw 'Catalog search must find the created project.' }
$machineSearch = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/search?query=SN-$suffix"))
$baselineSearch = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/search?query=BL-$suffix"))
$patchSearch = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/search?query=HF-$suffix"))
if (@($machineSearch | Where-Object { $_.type -eq 'Machine' -and $_.id -eq $machine.id }).Count -ne 1 -or @($baselineSearch | Where-Object { $_.type -eq 'Baseline' -and $_.id -eq $baseline.id }).Count -ne 1 -or @($patchSearch | Where-Object { $_.type -eq 'Patch' -and $_.id -eq $patch.id -and $_.versionId -eq $secondVersion.id }).Count -ne 1) { throw 'Catalog search must find the created machine, baseline and version patch.' }
$importHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }
$importBody = @{ projectId = $project.id; sourceFileName = 'acceptance.csv'; reason = '自动化导入预览'; rows = @(@{ componentName = 'Control'; versionNumber = 'import-preview' }, @{ componentName = 'Control'; versionNumber = 'opaque-b' }) } | ConvertTo-Json -Depth 5
$import = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/imports')) -Headers $importHeaders -ContentType 'application/json' -Body $importBody
$importReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/imports')) -Headers $importHeaders -ContentType 'application/json' -Body $importBody
$preview = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/imports/$($import.id)"))
if ($import.errorCount -ne 1 -or $import.id -ne $importReplay.id -or $preview.rows.Count -ne 2 -or [string]::IsNullOrWhiteSpace($preview.rows[1].validationError)) { throw 'Import preview must stage and validate rows without committing them.' }
$validImport = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/imports')) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ projectId = $project.id; sourceFileName = 'commit.csv'; reason = '自动化导入提交'; rows = @(@{ componentName = 'Control'; versionNumber = 'import-commit' }) } | ConvertTo-Json -Depth 5)
$commitHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }
$committed = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/imports/$($validImport.id)/commit")) -Headers $commitHeaders
$committedReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/imports/$($validImport.id)/commit")) -Headers $commitHeaders
$committedPreview = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/imports/$($validImport.id)"))
if ($committed.committed -ne 1 -or $committed.id -ne $committedReplay.id -or $committedPreview.status -ne 'Committed') { throw 'Import commit must be idempotent and transition the staged batch to Committed.' }

if (-not [string]::IsNullOrWhiteSpace($ConnectionString)) {
    $psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
    if (-not (Test-Path $psql)) { throw 'psql.exe is required to verify the baseline immutability trigger.' }
    $psqlConnection = ($ConnectionString -replace ';', ' ') -replace '(?i)\bHost=', 'host=' -replace '(?i)\bPort=', 'port=' -replace '(?i)\bDatabase=', 'dbname=' -replace '(?i)\bUsername=', 'user=' -replace '(?i)\bPassword=', 'password='
    $result = & $psql "--dbname=$psqlConnection" -v ON_ERROR_STOP=1 -c "UPDATE baseline_items SET sort_order = sort_order + 1000 WHERE configuration_baseline_id = '$($baseline.id)'" 2>&1
    if ($LASTEXITCODE -eq 0 -or ($result -join [Environment]::NewLine) -notmatch 'Items of released baseline cannot be modified') {
        throw 'Released baseline item update was not rejected by the PostgreSQL trigger.'
    }
    $overlap = & $psql "--dbname=$psqlConnection" -v ON_ERROR_STOP=1 -c "INSERT INTO project_standard_assignments (id, project_id, configuration_baseline_id, valid_from, valid_to, assigned_by, reason) VALUES (gen_random_uuid(), '$($project.id)', '$($baseline.id)', now() - interval '1 minute', now() + interval '1 minute', 'test', 'overlap test')" 2>&1
    if ($LASTEXITCODE -eq 0 -or ($overlap -join [Environment]::NewLine) -notmatch 'ex_project_standard_assignments_no_overlap') {
        throw 'Overlapping project standard assignment was not rejected by the PostgreSQL exclusion constraint.'
    }
    $secondCurrentTarget = & $psql "--dbname=$psqlConnection" -v ON_ERROR_STOP=1 -c "INSERT INTO machine_target_assignments (id, machine_id, configuration_baseline_id, valid_from, valid_to, assigned_by, reason) VALUES (gen_random_uuid(), '$($machine.id)', '$($baseline.id)', now(), NULL, 'test', 'second current target test')" 2>&1
    if ($LASTEXITCODE -eq 0 -or ($secondCurrentTarget -join [Environment]::NewLine) -notmatch 'ux_machine_target_assignments_current_machine') {
        throw 'A second current machine target was not rejected by the PostgreSQL unique constraint.'
    }
    $targetOverlap = & $psql "--dbname=$psqlConnection" -v ON_ERROR_STOP=1 -c "INSERT INTO machine_target_assignments (id, machine_id, configuration_baseline_id, valid_from, valid_to, assigned_by, reason) VALUES (gen_random_uuid(), '$($machine.id)', '$($baseline.id)', now() - interval '1 minute', now() + interval '1 minute', 'test', 'overlap target test')" 2>&1
    if ($LASTEXITCODE -eq 0 -or ($targetOverlap -join [Environment]::NewLine) -notmatch 'ex_machine_target_assignments_no_overlap') {
        throw 'Overlapping machine target assignment was not rejected by the PostgreSQL exclusion constraint.'
    }
}

$audit = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/audit?entityId=$($project.id)"))
if ($audit.Count -lt 1 -or $audit[0].actor -ne $Email -or [string]::IsNullOrWhiteSpace($audit[0].correlationId)) { throw 'Expected authenticated audit event.' }

$cloneHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }
$cloneBody = @{ code = "CLONE-$suffix"; name = 'Cloned project'; reason = '自动化克隆验收' } | ConvertTo-Json
$clone = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/clone")) -Headers $cloneHeaders -ContentType 'application/json' -Body $cloneBody
$cloneReplay = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($project.id)/clone")) -Headers $cloneHeaders -ContentType 'application/json' -Body $cloneBody
if ($clone.id -ne $cloneReplay.id) { throw 'Expected idempotent project clone.' }
$cloneDetail = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($clone.id)"))
if ($cloneDetail.components.Count -ne 4 -or @($cloneDetail.components | Where-Object { $_.versions.Count -ne 0 }).Count -ne 0) { throw 'Clone must copy the complete component tree, including structural nodes, but not versions.' }
$archiveHeaders = @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString(); 'X-Correlation-ID' = "project-archive-$suffix" }
$archivedProject = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, "/api/v1/projects/$($unscopedProject.id)/archive")) -Headers $archiveHeaders -ContentType 'application/json' -Body (@{ reason = '自动化项目归档验收' } | ConvertTo-Json)
$remainingProjects = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, '/api/v1/projects'))
if ($archivedProject.status -ne 'Archived' -or @($remainingProjects | Where-Object { $_.id -eq $unscopedProject.id }).Count -ne 0) { throw 'Project archive must preserve history while removing the project from the active selector.' }
Write-Host "Catalog acceptance passed for project $($project.id)."
