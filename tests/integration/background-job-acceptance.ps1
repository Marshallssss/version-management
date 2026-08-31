#Requires -Version 7.4
[CmdletBinding()]
param(
    [uri]$BaseUri = 'http://127.0.0.1:5080',
    [Parameter(Mandatory)][string]$Email,
    [Parameter(Mandatory)][string]$Password,
    [Parameter(Mandatory)][string]$ConnectionString,
    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'

$login = Invoke-WebRequest -UseBasicParsing -SessionVariable session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/auth/login')) -ContentType 'application/json' -Body (@{ email = $Email; password = $Password } | ConvertTo-Json)
if ($login.StatusCode -ne 204) { throw 'Login did not succeed.' }

$job = Invoke-RestMethod -WebSession $session -Method Post -Uri ([uri]::new($BaseUri, '/api/v1/system/jobs/noop')) -Headers @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() } -ContentType 'application/json' -Body (@{ reason = '后台任务状态机自动化验收' } | ConvertTo-Json)
$deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
$processedJob = $null

do {
    $status = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, '/api/v1/system/status'))
    $processedJob = @($status.jobs | Where-Object { $_.id -eq $job.id }) | Select-Object -First 1
    if ($null -ne $processedJob -and $processedJob.status -eq 'Succeeded') { break }
    Start-Sleep -Milliseconds 500
} while ([DateTimeOffset]::UtcNow -lt $deadline)

if ($null -eq $processedJob -or $processedJob.status -ne 'Succeeded') { throw 'No-op job did not reach Succeeded; ensure ConfigHub Worker is running.' }
if ($processedJob.attempts -ne 1 -or $null -eq $processedJob.lastAttemptAt -or $null -eq $processedJob.completedAt) { throw 'Succeeded job must retain one attempt, lastAttemptAt, and completedAt.' }
if (@($status.queue | Where-Object { $_.status -in @('Processing', 'Completed') }).Count -ne 0) { throw 'Legacy background job state names are still exposed.' }

$psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
if (-not (Test-Path $psql)) { throw 'psql.exe is required to verify the retry transition.' }
$psqlConnection = ($ConnectionString -replace ';', ' ') -replace '(?i)\bHost=', 'host=' -replace '(?i)\bPort=', 'port=' -replace '(?i)\bDatabase=', 'dbname=' -replace '(?i)\bUsername=', 'user=' -replace '(?i)\bPassword=', 'password='
$retryJobId = [Guid]::NewGuid()

try {
    $insert = "INSERT INTO background_jobs (id, job_type, payload, status, available_at, attempts, created_at) VALUES ('$retryJobId', 'acceptance.unhandled', '{}'::jsonb, 'Pending', now(), 0, now())"
    & $psql "--dbname=$psqlConnection" -v ON_ERROR_STOP=1 -c $insert | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the retry-state acceptance job.' }

    $retryDeadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    $retryJob = $null
    do {
        $retryStatus = Invoke-RestMethod -WebSession $session -Uri ([uri]::new($BaseUri, '/api/v1/system/status'))
        $retryJob = @($retryStatus.jobs | Where-Object { $_.id -eq $retryJobId.ToString() }) | Select-Object -First 1
        if ($null -ne $retryJob -and $retryJob.status -eq 'Retry') { break }
        Start-Sleep -Milliseconds 500
    } while ([DateTimeOffset]::UtcNow -lt $retryDeadline)

    if ($null -eq $retryJob -or $retryJob.status -ne 'Retry' -or $retryJob.attempts -ne 1 -or $null -eq $retryJob.lastAttemptAt -or [string]::IsNullOrWhiteSpace($retryJob.lastError)) {
        throw 'Unhandled job must transition from Running to Retry with its error and attempt time recorded.'
    }
}
finally {
    & $psql "--dbname=$psqlConnection" -v ON_ERROR_STOP=1 -c "DELETE FROM background_jobs WHERE id = '$retryJobId'" | Out-Null
}

Write-Host "Background job acceptance passed for job $($job.id)."
