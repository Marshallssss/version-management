param([Parameter(Mandatory)][guid]$DeletedVersionId, [Parameter(Mandatory)][guid]$CurrentVersionId, [Parameter(Mandatory)][guid]$MachineId)
$ErrorActionPreference = 'Stop'
$config = Get-Content (Join-Path $env:LOCALAPPDATA 'ConfigHub/appsettings.local.json') -Raw | ConvertFrom-Json
$settings = [System.Data.Common.DbConnectionStringBuilder]::new()
$connection = if ($env:ConnectionStrings__ConfigHub) { $env:ConnectionStrings__ConfigHub } else { $config.ConnectionStrings.ConfigHub }
$settings.set_ConnectionString($connection)
$psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
if (-not (Test-Path $psql)) { $psql = Join-Path $env:LOCALAPPDATA 'Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/ConfigHub/PostgreSQL17/bin/psql.exe' }
function Assert-DatabaseRejects([string]$sql) {
    $info = [System.Diagnostics.ProcessStartInfo]::new($psql)
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    foreach ($pair in @{ PGHOST='Host'; PGPORT='Port'; PGDATABASE='Database'; PGUSER='Username'; PGPASSWORD='Password' }.GetEnumerator()) {
        if ($settings.ContainsKey($pair.Value)) { $info.Environment[$pair.Key] = [string]$settings[$pair.Value] }
    }
    foreach ($argument in @('-w','-v','ON_ERROR_STOP=1','-c',"BEGIN; $sql; ROLLBACK;")) { $info.ArgumentList.Add($argument) }
    $process = [System.Diagnostics.Process]::Start($info)
    $output = $process.StandardOutput.ReadToEnd() + $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -eq 0 -or $output -notmatch 'Deleted version|Version is in use') { throw "Retained version database guard failed: $output" }
    $process.Dispose()
}
Assert-DatabaseRejects "UPDATE component_versions SET deleted_at=now() WHERE id='$CurrentVersionId'"
Assert-DatabaseRejects "UPDATE component_versions SET deleted_at=NULL WHERE id='$DeletedVersionId'"
Assert-DatabaseRejects "UPDATE machine_current_configurations SET component_version_id='$DeletedVersionId' WHERE machine_id='$MachineId'"
Write-Output 'Retained version database guards passed (all writes rolled back).'
