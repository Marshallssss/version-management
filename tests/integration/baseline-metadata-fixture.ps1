param([Parameter(Mandatory=$true)][Guid]$BaselineId, [DateTimeOffset]$ReleasedAt, [switch]$VerifyRenameGuard)
$ErrorActionPreference = 'Stop'
$config = Get-Content "$env:LOCALAPPDATA/ConfigHub/appsettings.local.json" -Raw | ConvertFrom-Json
$connection = [System.Data.Common.DbConnectionStringBuilder]::new()
$connection.set_ConnectionString($config.ConnectionStrings.ConfigHubMigration)
$psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
if (-not (Test-Path $psql)) { $psql = Join-Path $env:LOCALAPPDATA 'ConfigHub/PostgreSQL17/bin/psql.exe' }
function Invoke-FixtureSql([string]$Sql, [switch]$ExpectGuard) {
    $info = [Diagnostics.ProcessStartInfo]::new($psql)
    $info.Arguments = '-w -X -A -t -v ON_ERROR_STOP=1'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($pair in @{ PGHOST='Host'; PGPORT='Port'; PGDATABASE='Database'; PGUSER='Username'; PGPASSWORD='Password' }.GetEnumerator()) { $info.EnvironmentVariables[$pair.Key] = [string]$connection[$pair.Value] }
    $info.EnvironmentVariables['PGCONNECT_TIMEOUT'] = '5'
    $process = [Diagnostics.Process]::Start($info)
    $process.StandardInput.WriteLine($Sql)
    $process.StandardInput.Close()
    $output = $process.StandardOutput.ReadToEnd()
    $errorText = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($ExpectGuard) {
        if ($process.ExitCode -eq 0 -or $errorText -notmatch 'cannot be modified') { throw 'Expected the frozen baseline trigger to reject metadata/content changes.' }
    } elseif ($process.ExitCode -ne 0) { throw $errorText }
    return $output
}
$code = Invoke-FixtureSql "SELECT p.code FROM projects p JOIN configuration_baselines b ON b.project_id=p.id WHERE b.id='$BaselineId';"
if ($code.Trim() -notmatch '^(BASELINE-FILTER-|META-)') { throw 'This fixture is restricted to its isolated acceptance projects.' }
if ($VerifyRenameGuard) {
    Invoke-FixtureSql "BEGIN; SET LOCAL confighub.baseline_rename='on'; UPDATE configuration_baselines SET description='must remain frozen' WHERE id='$BaselineId'; ROLLBACK;" -ExpectGuard | Out-Null
    Invoke-FixtureSql "BEGIN; UPDATE configuration_baselines SET baseline_code='unauthorized rename' WHERE id='$BaselineId'; ROLLBACK;" -ExpectGuard | Out-Null
    Write-Output 'Frozen content and unscoped rename guards passed.'
} else {
    if ($ReleasedAt -eq [DateTimeOffset]::MinValue) { throw 'ReleasedAt is required.' }
    $timestamp = $ReleasedAt.ToUniversalTime().ToString('o')
    Invoke-FixtureSql "BEGIN; SET LOCAL confighub.baseline_maintenance='on'; UPDATE configuration_baselines SET released_at='$timestamp' WHERE id='$BaselineId' AND state='Released'; COMMIT;" | Out-Null
}
