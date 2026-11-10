// The example data in 0_exampleData/: the CSV tables and the workbook read back cell for cell as
// make_databases/model.json describes them, and the default sketch turns them into a graph.
import { readdirSync, readFileSync } from 'node:fs'
import { addTables, emptyCatalog } from '../src/lib/catalog'
import { defaultSketch } from '../src/lib/defaultSketch'
import { explore } from '../src/lib/explore'
import { readSource } from '../src/sources/index'
import { done, eq, ok, section } from './check.mjs'

const dir = new URL('../0_exampleData/', import.meta.url)
const model = JSON.parse(readFileSync(new URL('make_databases/model.json', dir), 'utf8'))
const asText = (v) => (v === null || v === undefined ? '' : String(v))

function compareWithModel(catalog, label) {
  eq(catalog.tables.map((t) => t.name).sort(), model.tables.map((t) => t.name).sort(), `${label}: one table per model table`)
  let cells = 0, same = 0
  for (const mt of model.tables) {
    const t = catalog.tables.find((x) => x.name === mt.name)
    if (!t) continue
    eq(t.columns.map((c) => c.name), mt.columns.map((c) => c.name), `${label} ${mt.name}: columns`)
    eq(t.rows.length, mt.rows.length, `${label} ${mt.name}: rows`)
    mt.rows.forEach((r, i) => {
      for (const c of mt.columns) { cells++; if (t.rows[i]?.[c.name] === asText(r[c.name])) same++ }
    })
  }
  eq(same, cells, `${label}: every cell as in the model`)
}

section('CSV tables')
const csvDir = new URL('serpents_meadow_tables/', dir)
let csv = emptyCatalog()
for (const f of readdirSync(csvDir).filter((f) => f.endsWith('.csv')).sort()) {
  csv = addTables(csv, readSource(f, new Uint8Array(readFileSync(new URL(f, csvDir)))).tables)
}
compareWithModel(csv, 'CSV')

section('Workbook')
const xlsx = addTables(emptyCatalog(), readSource('serpents_meadow.xlsx', new Uint8Array(readFileSync(new URL('serpents_meadow.xlsx', dir)))).tables)
compareWithModel(xlsx, 'XLSX')

section('Default sketch → Graph JSON')
{
  const sketch = defaultSketch(csv, { settings: { base: 'https://example.org/serpents-meadow/', title: "Serpent's Meadow" } })
  const { graph, diagnostics } = explore(csv, sketch)
  eq(diagnostics.unpairable.length + diagnostics.typeCollisions.length, 0, 'no diagnostics')
  const finds = Object.values(graph.nodes).filter((n) => graph.schema.typeLabels[n.t] === 'Find')
  eq(finds.length, 203, 'all 203 finds')
  ok(finds.every((n) => n.a?.['Find spot']?.startsWith('POINT Z')), 'find spots as geometry attributes')
  // person_id happens to be unique in this junction table (every person on one excavation), so
  // the plain rule takes it as the key. Recognising junction tables is step 2's job.
  eq(sketch.keys.excavation_person, 'person_id', 'key: first column without repeats, even in a junction table (for now)')
}

// As little as possible, as much as needed: the example a person loads and what makes it. Copies of
// the sister tools' example files (graph, map, 3D model, project file) stay in their repositories.
section('Contents of 0_exampleData/')
eq(readdirSync(dir).sort(), [
  'make_databases', 'serpents_meadow.accdb', 'serpents_meadow.mdb', 'serpents_meadow.pgdump.sql',
  'serpents_meadow.xlsx', 'serpents_meadow_tables',
].sort(), 'only the example and its generator')
eq(readdirSync(new URL('make_databases/', dir)).sort(), [
  'build-model.mjs', 'model.json', 'pg-roundtrip.ps1', 'to-access.ps1', 'to-postgres.mjs', 'to-tables.mjs',
], 'the generator: the model and the scripts, no intermediate files')
eq(readdirSync(csvDir).sort(), model.tables.map((t) => `${t.name}.csv`).sort(), 'one CSV per model table')

done('example data')
