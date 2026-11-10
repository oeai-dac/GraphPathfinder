# Turns model.json into an SQL script (to-postgres.mjs), loads it into a temporary PostgreSQL
# cluster of its own and writes the example dumps: plain SQL with COPY next to the other example
# data, and with --inserts into tests/fixtures/ (only the tests read that one). Then it stops the
# cluster and deletes it, script included. An installed PostgreSQL service is not touched.
#
# Needs Node.js and PostgreSQL with PostGIS (tested with 17.5 / PostGIS 3.5.2). The cluster lives
# in the temp folder, listens on 127.0.0.1 only and trusts the local user "example".
param(
  [string]$Bin = 'C:\Program Files\PostgreSQL\17\bin',
  [int]$Port = 54329
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$outDir = Split-Path $here -Parent
$fixtures = Join-Path (Split-Path $outDir -Parent) 'tests\fixtures'
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('example-pg-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$load = Join-Path $tmp 'load.sql'
$data = Join-Path $tmp 'data'
$env:PGCLIENTENCODING = 'UTF8'
$conn = @('-h', '127.0.0.1', '-p', $Port, '-U', 'example')

New-Item -ItemType Directory -Force $tmp | Out-Null
& node (Join-Path $here 'to-postgres.mjs') $load
if ($LASTEXITCODE) { Remove-Item -Recurse -Force $tmp; throw 'to-postgres.mjs failed' }
& "$Bin\initdb.exe" -D $data -U example -A trust -E UTF8 --locale=C | Out-Null
if ($LASTEXITCODE) { throw 'initdb failed' }
# Not "& pg_ctl … | Out-Null": the server inherits pg_ctl's stdout pipe and the pipeline then waits
# until the server exits. Start-Process with redirected output and WaitForExit on pg_ctl alone.
$p = Start-Process -FilePath "$Bin\pg_ctl.exe" -ArgumentList @('-D', "`"$data`"", '-o', "`"-p $Port -c listen_addresses=127.0.0.1`"", '-l', "`"$(Join-Path $tmp 'pg.log')`"", '-w', 'start') `
  -NoNewWindow -PassThru -RedirectStandardOutput (Join-Path $tmp 'pg_ctl.out') -RedirectStandardError (Join-Path $tmp 'pg_ctl.err')
$p.WaitForExit()
if ($p.ExitCode) { throw "pg_ctl start failed ($($p.ExitCode)), see $tmp\pg.log" }
try {
  & "$Bin\psql.exe" @conn -d postgres -q -c 'CREATE DATABASE serpents_meadow'
  & "$Bin\psql.exe" @conn -d serpents_meadow -q -v ON_ERROR_STOP=1 -f $load | Out-Null
  if ($LASTEXITCODE) { throw 'loading the SQL script failed' }
  & "$Bin\psql.exe" @conn -d serpents_meadow -At -c "SELECT 'PostGIS ' || postgis_lib_version()" -c "SELECT format('%s.%s: %s rows', table_schema, table_name, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', table_schema, table_name), false, true, '')))[1]::text) FROM information_schema.tables WHERE table_schema IN ('public','vocab') AND table_type = 'BASE TABLE' AND table_name <> 'spatial_ref_sys' ORDER BY 1"
  & "$Bin\pg_dump.exe" @conn -d serpents_meadow --no-owner -f (Join-Path $outDir 'serpents_meadow.pgdump.sql')
  & "$Bin\pg_dump.exe" @conn -d serpents_meadow --no-owner --inserts -f (Join-Path $fixtures 'serpents_meadow.pgdump-inserts.sql')
  if ($LASTEXITCODE) { throw 'pg_dump failed' }
  Get-ChildItem $outDir, $fixtures -Filter 'serpents_meadow.pgdump*' | ForEach-Object { '{0,-36} {1,8:N0} bytes' -f $_.Name, $_.Length }
} finally {
  & "$Bin\pg_ctl.exe" -D $data -m fast -w stop | Out-Null
  Remove-Item -Recurse -Force $tmp
  'temporary cluster stopped and removed'
}
