param([string]$OutputDirectory = (Join-Path $env:LOCALAPPDATA 'FlashDelivery\backups'))
$ErrorActionPreference='Stop'
function Get-Sha256([string]$Path){$stream=[IO.File]::OpenRead($Path);try{$sha=[Security.Cryptography.SHA256]::Create();try{return([BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant())}finally{$sha.Dispose()}}finally{$stream.Dispose()}}
$projectRoot=Split-Path -Parent $PSScriptRoot
$envFile=Join-Path $projectRoot '.env.local'
$databaseLine=Get-Content -LiteralPath $envFile|Where-Object{$_ -match '^MIGRATION_DATABASE_URL='}|Select-Object -First 1
if(-not $databaseLine){throw 'MIGRATION_DATABASE_URL no está configurada'}
$databaseUri=[Uri]($databaseLine.Substring('MIGRATION_DATABASE_URL='.Length))
$credentials=$databaseUri.UserInfo.Split(':',2)
if($credentials.Count-ne 2){throw 'La URL de migración no contiene credenciales completas'}
$postgresRoot=Join-Path $env:LOCALAPPDATA 'FlashDelivery\postgres17'
$pgDump=Join-Path $postgresRoot 'bin\pg_dump.exe'
if(-not(Test-Path -LiteralPath $pgDump)){throw 'pg_dump no está instalado en el runtime local'}
New-Item -ItemType Directory -Path $OutputDirectory -Force|Out-Null
$resolvedOutput=(Resolve-Path -LiteralPath $OutputDirectory).Path
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath=Join-Path $resolvedOutput "flash-$stamp.dump"
$temporaryPath="$backupPath.partial"
$env:PGPASSWORD=[Uri]::UnescapeDataString($credentials[1])
try{
  & $pgDump --host $databaseUri.Host --port $databaseUri.Port --username ([Uri]::UnescapeDataString($credentials[0])) --dbname $databaseUri.AbsolutePath.TrimStart('/') --format custom --compress 9 --no-owner --file $temporaryPath
  if($LASTEXITCODE-ne 0){throw "pg_dump terminó con código $LASTEXITCODE"}
  Move-Item -LiteralPath $temporaryPath -Destination $backupPath
  $hash=Get-Sha256 $backupPath
  $manifest=[ordered]@{file=[IO.Path]::GetFileName($backupPath);sha256=$hash;bytes=(Get-Item -LiteralPath $backupPath).Length;database=$databaseUri.AbsolutePath.TrimStart('/');createdAt=(Get-Date).ToUniversalTime().ToString('o');format='postgres-custom';includesPrivileges=$true}
  $manifestPath="$backupPath.json"
  $manifest|ConvertTo-Json|Set-Content -LiteralPath $manifestPath -Encoding utf8
  [pscustomobject]@{Backup=$backupPath;Manifest=$manifestPath;SHA256=$hash;Bytes=$manifest.bytes}|Format-List
}finally{Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue;if(Test-Path -LiteralPath $temporaryPath){Remove-Item -LiteralPath $temporaryPath -Force}}
