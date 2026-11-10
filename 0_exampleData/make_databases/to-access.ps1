# model.json → serpents_meadow.accdb (ACE) and serpents_meadow.mdb (Jet4), the same tables,
# keys and relationships as the PostgreSQL version. Access has no schemas and no geometry type:
# the vocabularies lose their schema, geometries are stored as WKT in MEMO fields.
#
# Needs the Microsoft Access Database Engine (ACE OLEDB 16, 64-bit), which comes with Office.
param([string]$OutDir = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
$model = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'model.json'), [System.Text.Encoding]::UTF8) | ConvertFrom-Json

$ddlType = @{ key = 'TEXT(40)'; text = 'TEXT(255)'; longtext = 'MEMO'; integer = 'LONG'; decimal = 'DOUBLE'; identity = 'COUNTER'; geometry = 'MEMO' }
$oleType = @{
  key = [System.Data.OleDb.OleDbType]::VarWChar; text = [System.Data.OleDb.OleDbType]::VarWChar
  longtext = [System.Data.OleDb.OleDbType]::LongVarWChar; geometry = [System.Data.OleDb.OleDbType]::LongVarWChar
  integer = [System.Data.OleDb.OleDbType]::Integer; identity = [System.Data.OleDb.OleDbType]::Integer
  decimal = [System.Data.OleDb.OleDbType]::Double
}

function Build([string]$path, [string]$engine) {
  if (Test-Path $path) { Remove-Item $path -Force }
  $cat = New-Object -ComObject ADOX.Catalog
  $cat.Create("Provider=Microsoft.ACE.OLEDB.16.0;Data Source=$path;$engine") | Out-Null
  $cat.ActiveConnection.Close()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($cat) | Out-Null
  $db = New-Object System.Data.OleDb.OleDbConnection("Provider=Microsoft.ACE.OLEDB.16.0;Data Source=$path")
  $db.Open()
  $exec = { param($sql) $c = $db.CreateCommand(); $c.CommandText = $sql; [void]$c.ExecuteNonQuery() }

  foreach ($t in $model.tables) {
    $defs = @($t.columns | ForEach-Object { "[$($_.name)] $($ddlType[$_.type])" })
    $defs += "CONSTRAINT [pk_$($t.name)] PRIMARY KEY ($(($t.primaryKey | ForEach-Object { "[$_]" }) -join ', '))"
    foreach ($u in @($t.uniques)) { if ($u) { $defs += "CONSTRAINT [uq_$($t.name)_$($u -join '_')] UNIQUE ($(($u | ForEach-Object { "[$_]" }) -join ', '))" } }
    & $exec "CREATE TABLE [$($t.name)] ($($defs -join ', '))"
  }

  $tx = $db.BeginTransaction()
  foreach ($t in $model.tables) {
    $cols = @($t.columns)
    $cmd = $db.CreateCommand(); $cmd.Transaction = $tx
    $cmd.CommandText = "INSERT INTO [$($t.name)] ($(($cols | ForEach-Object { "[$($_.name)]" }) -join ', ')) VALUES ($((@('?') * $cols.Count) -join ', '))"
    foreach ($c in $cols) { [void]$cmd.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter($c.name, $oleType[$c.type]))) }
    foreach ($r in $t.rows) {
      for ($i = 0; $i -lt $cols.Count; $i++) {
        $v = $r.($cols[$i].name)
        $cmd.Parameters[$i].Value = if ($null -eq $v) { [DBNull]::Value } else { $v }
      }
      [void]$cmd.ExecuteNonQuery()
    }
  }
  $tx.Commit()

  # Relationships after the data, as a database that grew over time would have them.
  foreach ($t in $model.tables) {
    foreach ($fk in $t.foreignKeys) {
      & $exec ("ALTER TABLE [$($t.name)] ADD CONSTRAINT [$($fk.name)] FOREIGN KEY ($(($fk.columns | ForEach-Object { "[$_]" }) -join ', ')) " +
        "REFERENCES [$($fk.refTable)] ($(($fk.refColumns | ForEach-Object { "[$_]" }) -join ', '))")
    }
  }
  $db.Close()
  '{0,-26} {1,10:N0} bytes' -f (Split-Path $path -Leaf), (Get-Item $path).Length
}

Build (Join-Path $OutDir 'serpents_meadow.accdb') ''
Build (Join-Path $OutDir 'serpents_meadow.mdb') 'Jet OLEDB:Engine Type=5'
