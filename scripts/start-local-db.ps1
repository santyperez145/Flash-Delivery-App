$ErrorActionPreference = 'Stop'

$flashRoot = Join-Path $env:LOCALAPPDATA 'FlashDelivery'
$postgresRoot = Join-Path $flashRoot 'postgres17'
$dataRoot = Join-Path $flashRoot 'data17'
$pgCtl = Join-Path $postgresRoot 'bin\pg_ctl.exe'
$pgReady = Join-Path $postgresRoot 'bin\pg_isready.exe'
$logFile = Join-Path $flashRoot 'postgres.log'

if (-not (Test-Path -LiteralPath $pgCtl) -or -not (Test-Path -LiteralPath (Join-Path $dataRoot 'PG_VERSION'))) {
  throw 'La base local todavía no está instalada. Ejecutá la guía de docs/local-database.md.'
}

& $pgReady -h 127.0.0.1 -p 55432 *> $null
if ($LASTEXITCODE -ne 0) {
  & $pgCtl -D $dataRoot -l $logFile -o '-p 55432' start
}

& $pgReady -h 127.0.0.1 -p 55432
