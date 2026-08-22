param([string]$BackupPath)
$ErrorActionPreference='Stop'
function Get-Sha256([string]$Path){$stream=[IO.File]::OpenRead($Path);try{$sha=[Security.Cryptography.SHA256]::Create();try{return([BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant())}finally{$sha.Dispose()}}finally{$stream.Dispose()}}
$backupRoot=Join-Path $env:LOCALAPPDATA 'FlashDelivery\backups'
if(-not $BackupPath){$BackupPath=(Get-ChildItem -LiteralPath $backupRoot -Filter 'flash-*.dump'|Sort-Object LastWriteTime -Descending|Select-Object -First 1).FullName}
if(-not $BackupPath -or -not(Test-Path -LiteralPath $BackupPath)){throw 'No se encontró un backup para verificar'}
$resolvedBackup=(Resolve-Path -LiteralPath $BackupPath).Path
$pgRestore=Join-Path $env:LOCALAPPDATA 'FlashDelivery\postgres17\bin\pg_restore.exe'
if(-not(Test-Path -LiteralPath $pgRestore)){throw 'pg_restore no está instalado'}
$manifestPath="$resolvedBackup.json"
if(Test-Path -LiteralPath $manifestPath){$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json;$actual=Get-Sha256 $resolvedBackup;if($actual-ne $manifest.sha256){throw 'El SHA256 del backup no coincide con su manifiesto'};if($manifest.includesPrivileges-ne $true){throw 'El backup no incluye privilegios y no sirve para recuperación completa'}}
$toc=& $pgRestore --list $resolvedBackup
if($LASTEXITCODE-ne 0){throw 'pg_restore no pudo leer el archivo'}
foreach($required in @('TABLE public users','TABLE public jobs','TABLE public ledger_entries','TABLE public schema_migrations')){if(-not($toc|Select-String -SimpleMatch $required)){throw "El backup no contiene $required"}}
$schemaCheck=Join-Path ([IO.Path]::GetTempPath()) "flash-schema-check-$([Guid]::NewGuid().ToString('N')).sql"
try{& $pgRestore --schema-only --no-owner --no-acl --file $schemaCheck $resolvedBackup;if($LASTEXITCODE-ne 0){throw 'No se pudo extraer el esquema del backup'};if((Get-Item -LiteralPath $schemaCheck).Length-lt 1000){throw 'El esquema extraído está incompleto'}
  [pscustomobject]@{Backup=$resolvedBackup;ArchiveReadable=$true;ChecksumValid=(Test-Path -LiteralPath $manifestPath);PrivilegesIncluded=$true;RequiredTables=$true;SchemaBytes=(Get-Item -LiteralPath $schemaCheck).Length}|Format-List
}finally{if(Test-Path -LiteralPath $schemaCheck){Remove-Item -LiteralPath $schemaCheck -Force}}
