param([Parameter(Mandatory)][guid]$ProjectId, [Parameter(Mandatory)][guid]$RootId, [Parameter(Mandatory)][guid]$OtherRootId, [Parameter(Mandatory)][guid]$VersionId, [Parameter(Mandatory)][guid]$RevisionId, [Parameter(Mandatory)][guid]$BaselineId)
$ErrorActionPreference = 'Stop'
$config = Get-Content (Join-Path $env:LOCALAPPDATA 'ConfigHub/appsettings.local.json') -Raw | ConvertFrom-Json
$settings = [System.Data.Common.DbConnectionStringBuilder]::new()
$connection = if ($env:ConnectionStrings__ConfigHub) { $env:ConnectionStrings__ConfigHub } else { $config.ConnectionStrings.ConfigHub }
$settings.set_ConnectionString($connection)
$psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
if (-not (Test-Path $psql)) { $psql = Join-Path $env:LOCALAPPDATA 'Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/ConfigHub/PostgreSQL17/bin/psql.exe' }
function Assert-Rejected([string]$sql, [string]$expected) {
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
    if ($process.ExitCode -eq 0 -or $output -notmatch $expected) { throw "Database guard failed: $output" }
    $process.Dispose()
}
Assert-Rejected "UPDATE configuration_components SET is_pm_root=true WHERE id='$OtherRootId' AND project_id='$ProjectId'" 'ux_project_pm_root'
Assert-Rejected "UPDATE configuration_components SET parent_component_id='$OtherRootId' WHERE id='$RootId'" 'ck_pm_root'
Assert-Rejected "INSERT INTO machine_chamber_versions (id,chamber_id,component_id,version_id,revision_id,sequence,history_id,is_unknown) SELECT gen_random_uuid(),chamber_id,component_id,'$VersionId','$RevisionId',sequence+1000,history_id,false FROM machine_chamber_versions WHERE revision_id='$RevisionId' LIMIT 1" 'component_version_revisions'
Assert-Rejected "INSERT INTO machine_chamber_versions (id,chamber_id,component_id,version_id,revision_id,sequence,history_id,is_unknown) SELECT gen_random_uuid(),chamber_id,component_id,version_id,revision_id,sequence+1000,history_id,true FROM machine_chamber_versions WHERE revision_id='$RevisionId' LIMIT 1" 'ck_chamber_revision_state'
Assert-Rejected "UPDATE baseline_items SET revision_id='$RevisionId' WHERE configuration_baseline_id='$BaselineId' AND component_version_id IS NOT NULL" 'released baseline'
Write-Output 'PM/revision database constraints passed; all attempted writes rolled back.'
