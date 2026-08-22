param([string]$BackupPath,[switch]$KeepFailed)
$ErrorActionPreference='Stop'

function Get-Sha256([string]$Path){$stream=[IO.File]::OpenRead($Path);try{$sha=[Security.Cryptography.SHA256]::Create();try{return([BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant())}finally{$sha.Dispose()}}finally{$stream.Dispose()}}
function Invoke-Psql([string]$Sql,[switch]$TuplesOnly){$args=@('--host','127.0.0.1','--port',"$port",'--username','flash_restore_admin','--dbname','flash_restore','--set','ON_ERROR_STOP=1','--quiet');if($TuplesOnly){$args+=@('--tuples-only','--no-align')};$args+=@('--command',$Sql);$output=& $psql @args;if($LASTEXITCODE-ne 0){throw "psql falló al validar el restore"};return ($output|Out-String).Trim()}

$flashRoot=Join-Path $env:LOCALAPPDATA 'FlashDelivery'
$backupRoot=Join-Path $flashRoot 'backups'
$drillsRoot=Join-Path $flashRoot 'restore-drills'
if(-not $BackupPath){$latest=Get-ChildItem -LiteralPath $backupRoot -Filter 'flash-*.dump'|Sort-Object LastWriteTime -Descending|Select-Object -First 1;if($latest){$BackupPath=$latest.FullName}}
if(-not $BackupPath -or -not(Test-Path -LiteralPath $BackupPath)){throw 'No se encontró un backup para restaurar'}
$resolvedBackup=(Resolve-Path -LiteralPath $BackupPath).Path
$resolvedBackupRoot=(Resolve-Path -LiteralPath $backupRoot).Path
if(-not $resolvedBackup.StartsWith($resolvedBackupRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'El backup debe estar dentro del directorio administrado de FlashDelivery'}
$manifestPath="$resolvedBackup.json"
if(-not(Test-Path -LiteralPath $manifestPath)){throw 'El backup no tiene manifiesto SHA-256'}
$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
if((Get-Sha256 $resolvedBackup)-ne $manifest.sha256){throw 'El checksum del backup no coincide'}
if($manifest.includesPrivileges-ne $true){throw 'El backup no contiene privilegios; generá uno nuevo antes del restore drill'}

$postgresRoot=Join-Path $flashRoot 'postgres17'
$initdb=Join-Path $postgresRoot 'bin\initdb.exe';$pgCtl=Join-Path $postgresRoot 'bin\pg_ctl.exe';$createdb=Join-Path $postgresRoot 'bin\createdb.exe';$pgRestore=Join-Path $postgresRoot 'bin\pg_restore.exe';$psql=Join-Path $postgresRoot 'bin\psql.exe'
foreach($tool in @($initdb,$pgCtl,$createdb,$pgRestore,$psql)){if(-not(Test-Path -LiteralPath $tool)){throw "Falta herramienta PostgreSQL: $tool"}}

New-Item -ItemType Directory -Path $drillsRoot -Force|Out-Null
$resolvedDrillsRoot=(Resolve-Path -LiteralPath $drillsRoot).Path
foreach($stale in Get-ChildItem -LiteralPath $resolvedDrillsRoot -Directory -Filter 'drill-*'){
  $stalePath=(Resolve-Path -LiteralPath $stale.FullName).Path
  if(-not $stalePath.StartsWith($resolvedDrillsRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){continue}
  $pidFile=Join-Path $stalePath 'data\postmaster.pid';$active=$false
  if(Test-Path -LiteralPath $pidFile){$stalePid=[int](Get-Content -LiteralPath $pidFile -TotalCount 1);$process=Get-Process -Id $stalePid -ErrorAction SilentlyContinue;$active=[bool]($process-and$process.ProcessName-eq'postgres')}
  if(-not$active){Remove-Item -LiteralPath $stalePath -Recurse -Force}
}
$drillPath=Join-Path $resolvedDrillsRoot ("drill-"+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $drillPath|Out-Null
$dataPath=Join-Path $drillPath 'data';$logPath=Join-Path $drillPath 'postgres.log'
$migrationFiles=Get-ChildItem -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) 'database\migrations') -Filter '*.sql'|Sort-Object Name
$expectedMigrationCount=$migrationFiles.Count;$expectedLatestMigration=$migrationFiles[-1].Name
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$listener.Start();$port=([Net.IPEndPoint]$listener.LocalEndpoint).Port;$listener.Stop()
$started=$false;$succeeded=$false
try{
  & $initdb --pgdata $dataPath --username flash_restore_admin --auth-local trust --auth-host trust --encoding UTF8 --no-locale *> $null
  if($LASTEXITCODE-ne 0){throw 'initdb no pudo crear el cluster temporal'}
  & $pgCtl --pgdata $dataPath --log $logPath --options "-h 127.0.0.1 -p $port" --wait start
  if($LASTEXITCODE-ne 0){throw 'No se pudo iniciar PostgreSQL temporal'};$started=$true
  & $createdb --host 127.0.0.1 --port $port --username flash_restore_admin flash_restore
  if($LASTEXITCODE-ne 0){throw 'No se pudo crear la base temporal'}
  Invoke-Psql "CREATE ROLE flash_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; CREATE ROLE flash_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; CREATE ROLE flash_rls_audit NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;"|Out-Null
  & $pgRestore --host 127.0.0.1 --port $port --username flash_restore_admin --dbname flash_restore --exit-on-error --no-owner $resolvedBackup
  if($LASTEXITCODE-ne 0){throw 'pg_restore no pudo restaurar el backup'}

  $migrationCount=[int](Invoke-Psql "SELECT count(*) FROM schema_migrations" -TuplesOnly)
  $latestMigration=Invoke-Psql "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1" -TuplesOnly
  $postgisVersion=Invoke-Psql "SELECT postgis_lib_version()" -TuplesOnly
  $invalidConstraints=[int](Invoke-Psql "SELECT count(*) FROM pg_constraint WHERE NOT convalidated" -TuplesOnly)
  $criticalTables=[int](Invoke-Psql "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN('users','addresses','jobs','ledger_transactions','ledger_entries','user_mfa','pricing_plans','map_provider_cache')" -TuplesOnly)
  $users=[int](Invoke-Psql "SELECT count(*) FROM users" -TuplesOnly);$jobs=[int](Invoke-Psql "SELECT count(*) FROM jobs" -TuplesOnly)
  $ledgerImbalances=[int](Invoke-Psql "SELECT count(*) FROM(SELECT transaction_id FROM ledger_entries GROUP BY transaction_id HAVING sum(CASE WHEN direction='debit' THEN amount_cents ELSE -amount_cents END)<>0)x" -TuplesOnly)
  $rlsMissing=[int](Invoke-Psql "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN('users','addresses','jobs','refresh_sessions','user_mfa') AND NOT c.relrowsecurity" -TuplesOnly)
  $runtimeRole=Invoke-Psql "SELECT rolsuper||','||rolcreatedb||','||rolcreaterole||','||rolbypassrls FROM pg_roles WHERE rolname='flash_runtime'" -TuplesOnly
  $auditRows=Invoke-Psql "SET ROLE flash_rls_audit; SELECT count(*) FROM users; RESET ROLE" -TuplesOnly
  $auditSecret=Invoke-Psql "SELECT has_column_privilege('flash_rls_audit','user_mfa','secret_ciphertext','SELECT')" -TuplesOnly
  $auditImmutable=Invoke-Psql "SELECT NOT has_table_privilege('flash_runtime','audit_events','UPDATE') AND NOT has_table_privilege('flash_runtime','audit_events','DELETE') AND NOT has_table_privilege('flash_runtime','audit_events','TRUNCATE') AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='audit_events'::regclass AND tgname='audit_events_append_only' AND tgenabled<>'D')" -TuplesOnly
  $auditChainInvalid=Invoke-Psql "SELECT app.audit_chain_invalid_count()" -TuplesOnly
  if($migrationCount-ne$expectedMigrationCount-or$latestMigration-ne$expectedLatestMigration-or-not$postgisVersion-or$invalidConstraints-ne 0-or$criticalTables-ne 8-or$users-lt 1-or$ledgerImbalances-ne 0-or$rlsMissing-ne 0-or$runtimeRole-ne'false,false,false,false'-or$auditRows-ne'0'-or$auditSecret-ne'f'-or$auditImmutable-ne't'-or$auditChainInvalid-ne'0'){
    [pscustomobject]@{MigrationCount=$migrationCount;LatestMigration=$latestMigration;PostGIS=$postgisVersion;InvalidConstraints=$invalidConstraints;CriticalTables=$criticalTables;Users=$users;Jobs=$jobs;LedgerImbalances=$ledgerImbalances;RlsMissing=$rlsMissing;RuntimeRole=$runtimeRole;AuditRowsWithoutContext=$auditRows;AuditMfaSecret=$auditSecret;AuditAppendOnly=$auditImmutable;AuditChainInvalid=$auditChainInvalid}|Format-List|Out-Host
    throw 'Las invariantes del restore no se cumplen'
  }
  $succeeded=$true
  [pscustomobject]@{Backup=$resolvedBackup;ChecksumValid=$true;TemporaryPort=$port;Migrations=$migrationCount;LatestMigration=$latestMigration;PostGIS=$postgisVersion;Users=$users;Jobs=$jobs;LedgerImbalances=$ledgerImbalances;InvalidConstraints=$invalidConstraints;RlsMissing=$rlsMissing;AuditRowsWithoutContext=$auditRows;AuditCanReadMfaSecret=$auditSecret;AuditAppendOnly=$auditImmutable;AuditChainInvalid=$auditChainInvalid;RestoreVerified=$true}|Format-List
}finally{
  if($started){& $pgCtl --pgdata $dataPath --mode fast --wait stop}
  $resolvedDrill=(Resolve-Path -LiteralPath $drillPath -ErrorAction SilentlyContinue).Path
  if($resolvedDrill-and$resolvedDrill.StartsWith($resolvedDrillsRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)-and($succeeded-or-not$KeepFailed)){Remove-Item -LiteralPath $resolvedDrill -Recurse -Force}
  elseif(-not$succeeded-and$KeepFailed){Write-Warning "Restore drill preservado en $drillPath"}
}
