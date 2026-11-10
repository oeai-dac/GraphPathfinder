// Heuristics: keys, labels and languages, attribute or type, lists, references between tables,
// junction and stratigraphic relation tables — and how many actions remain against a reference.
import { readdirSync, readFileSync } from 'node:fs'
import { addTables, emptyCatalog, makeTable } from '../src/lib/catalog'
import { buildSketch } from '../src/lib/defaultSketch'
import { explore } from '../src/lib/explore'
import { compile } from '../src/lib/compile'
import { guessForeignKeys, keyIndex } from '../src/lib/guess'
import { assignLanguages, classifyColumn, detectKey, detectLabels, detectSplit, humanize, languageSuffix, nameStem, relationName } from '../src/lib/heuristics'
import { profileColumn, profileTable } from '../src/lib/profile'
import { applySuggestion } from '../src/lib/suggestions'
import { readSource } from '../src/sources/index'
import { bytesOf, done, eq, ok, section } from './check.mjs'
import { catalog as fourTables, sketch as fourReference } from './fixtures/four-tables.mjs'
import { referenceSketch } from './fixtures/serpents-reference.mjs'
import { syntheticCatalog } from './fixtures/synthetic.mjs'
import { sketchDistance } from './sketch-distance.mjs'

const csv = (file, text) => readSource(file, bytesOf(text)).tables[0]
const p = (values) => profileColumn(values.map((v) => ({ c: v })), 'c')
const col = (name, declared = null) => ({ name, declared })
const acceptAll = (sketch, suggestions) => suggestions.reduce(applySuggestion, sketch)

section('Names')
{
  eq(humanize('stratigraphic_unit'), 'Stratigraphic unit', 'humanize')
  eq(humanize('SE_Rel'), 'SE rel', 'abbreviations keep their capitals')
  eq([relationName('material_code'), relationName('su_id'), relationName('parent_site_id'), relationName('fk_site')], ['material', 'su', 'parent site', 'site'], 'relation names without id/code affixes')
  eq([nameStem('finds'), nameStem('material_code'), nameStem('object_types')], ['find', 'material', 'objecttype'], 'stems for comparing names')
  eq([languageSuffix('name_de'), languageSuffix('Bezeichnung (EN)'), languageSuffix('su_id'), languageSuffix('code_no')], [{ base: 'name', lang: 'de' }, { base: 'Bezeichnung', lang: 'en' }, null, null], 'language suffixes, not _id or _no')
}

section('Keys')
{
  const t = (columns, rows, extra = {}) => ({ name: extra.name ?? 'finds', columns: columns.map((c) => col(c)), rows, primaryKey: extra.primaryKey ?? [], ...extra })
  const key = (table) => detectKey(table, profileTable(table))
  eq(key(t(['a', 'b'], [{ a: '1', b: 'x' }], { primaryKey: ['b'] })), { column: 'b', declared: true }, 'declared primary key wins')
  eq(key(t(['label', 'find_id'], [{ label: 'A', find_id: 'F1' }, { label: 'B', find_id: 'F2' }])).column, 'find_id', 'an identifier name beats the leftmost column, a name column is no key')
  eq(key(t(['von', 'nach'], [{ von: 'a', nach: 'b' }, { von: 'b', nach: 'c' }], { name: 'rel' })), { column: 'von', weak: true }, 'unique by chance: a weak key')
  eq(key(t(['x', 'y'], [{ x: '1', y: 'a' }, { x: '1', y: 'b' }, { x: '2', y: 'a' }])), { composite: ['x', 'y'], column: '#row' }, 'a pair unique together')
  eq(key(t(['x'], [{ x: 'a' }, { x: 'a' }])), { column: '#row' }, 'nothing unique: the row number')
  eq(key(t(['weight'], [{ weight: '1.5' }, { weight: '2.5' }])), { column: '#row' }, 'decimals are no keys')
}

section('Attribute or type')
{
  const r = (name, values, declared) => classifyColumn(col(name, declared), p(values))
  eq(r('weight_g', ['10', '12', '10', '30']), { attribute: 'xsd:integer' }, 'integer measurement')
  eq(r('sondage_no', ['1', '2', '1', '2']), { type: true }, 'integer code')
  eq(r('phase', ['1', '2', '1', '2', '1', '2']), { type: true }, 'few integers, many times: a category')
  eq(r('weight', ['10.5', '12,25']), { attribute: 'xsd:decimal' }, 'decimals, also with decimal comma')
  eq(r('found_on', ['2024-07-03', '2024-07-04']), { attribute: 'xsd:date' }, 'ISO dates')
  eq(r('datum', ['03.07.2024', '04.07.2024']), { attribute: 'xsd:string' }, 'dotted dates stay text (xsd:date would be invalid)')
  eq(r('complete', ['ja', 'nein', 'ja']), { attribute: 'xsd:boolean' }, 'yes/no')
  eq(r('geom', ['POINT (1 2)', 'POLYGON ((0 0, 1 0, 1 1, 0 0))']), { attribute: 'geo:wktLiteral' }, 'WKT')
  eq(r('description', ['Nail, iron', 'Sherd, ceramic', 'Nail, iron']), { attribute: 'xsd:string' }, 'free text by name, however short')
  eq(r('material', ['Bronze', 'Eisen', 'Bronze', 'Keramik']), { type: true }, 'a vocabulary')
  eq(r('size', ['10 × 10 m', '8 × 6 m', '12 × 12 m']), { attribute: 'xsd:string' }, 'measurements written as text')
  eq(r('x', ['a'], 'geometry'), { attribute: 'geo:wktLiteral' }, 'a declared type wins')
}

section('Labels and languages')
{
  const site = csv('site.csv', 'site_id,name,name_de\nSA,Serpent\'s Meadow,Schlangenau\nTSP,The Secret Place,\nWOS,The Well of Souls,\n')
  const labels = detectLabels(site, 'site_id', profileTable(site))
  eq(labels, [{ column: 'name', lang: null }, { column: 'name_de', lang: 'de' }], 'label columns by name')
  const all = labels.map((l) => ({ ...l, tableId: 'site', filled: profileTable(site)[l.column].filled, rows: 3 }))
  eq(assignLanguages(all), { primary: 'en', additional: ['de'] }, '"name" beside "name_de" is English, and the fuller language is primary')
  eq(all.map((l) => l.lang), ['en', 'de'], 'languages assigned')
  const small = csv('x.csv', 'id,material\n1,Bronze\n2,Eisen\n')
  eq(detectLabels(small, 'id', profileTable(small)), [], 'in a small table a unique column is no label')
  eq(assignLanguages([]), { primary: 'de', additional: [] }, 'no labels: German, the Studio\'s default')
}

section('Several values in a cell')
{
  const split = (values, name = 'material') => {
    const rows = values.map((v) => ({ [name]: v }))
    return detectSplit(rows, name, profileColumn(rows, name))
  }
  eq(split(['Bronze; Eisen', 'Bronze', 'Eisen; Glas', 'Bronze']), '; ', 'semicolon list')
  eq(split(['a | b', 'b', 'a | c', 'c | b']), ' | ', 'bar list')
  eq(split(['Bronze, Eisen', 'Bronze, Glas', 'Eisen, Glas', 'Bronze, Eisen', 'Glas', 'Bronze, Glas']), ', ', 'comma list with repeating parts')
  eq(split(['12,5', '3,0', '7,25']), null, 'decimal commas are no list')
  eq(split(['Nail, iron, complete', 'Sherd, ceramic', 'Nail, iron, complete'], 'description'), null, 'a description is never split')
}

// ─── the example: tables only, everything guessed ───
const dir = new URL('../0_exampleData/serpents_meadow_tables/', import.meta.url)
let serpents = emptyCatalog()
for (const f of readdirSync(dir).filter((f) => f.endsWith('.csv')).sort()) serpents = addTables(serpents, readSource(f, new Uint8Array(readFileSync(new URL(f, dir)))).tables)
const model = JSON.parse(readFileSync(new URL('../0_exampleData/make_databases/model.json', import.meta.url), 'utf8'))

section('References guessed from values (Serpent\'s Meadow as CSV)')
const built = buildSketch(serpents)
{
  const profiles = Object.fromEntries(serpents.tables.map((t) => [t.id, profileTable(t)]))
  const fks = guessForeignKeys(serpents, built.sketch.keys, profiles, keyIndex(serpents, built.sketch.keys))
  const got = fks.map((f) => `${f.tableId}.${f.column} → ${f.refTable}.${f.refColumn}`).sort()
  const declared = model.tables.flatMap((t) => t.foreignKeys.map((f) => `${t.name}.${f.columns[0]} → ${f.refTable}.${f.refColumns[0]}`)).sort()
  eq(got, declared, 'exactly the 13 foreign keys the database declares, no more')
  const kinds = built.suggestions.map((x) => x.kind)
  eq([kinds.filter((k) => k === 'matrix').length, kinds.filter((k) => k === 'junction').length, kinds.filter((k) => k === 'reference').length], [1, 1, 9], 'one matrix, one junction, nine references')
  ok(!built.suggestions.some((x) => x.kind === 'reference' && ['excavation_person', 'su_relation'].includes(x.tableId)), 'no references from tables that become edges')
  eq(built.sketch.settings.languages, { primary: 'en', additional: ['de'] }, 'languages of the example')
}

section('Actions left (against the reference)')
{
  const reference = referenceSketch()
  const before = sketchDistance(serpents, built.sketch, reference)
  const after = sketchDistance(serpents, acceptAll(built.sketch, built.suggestions), reference)
  console.log(`  Serpent's Meadow as CSV: ${before.count} columns differ before, ${after.count} after accepting all ${built.suggestions.length} suggestions`)
  ok(before.count <= 15, `at most 15 actions without suggestions (got ${before.count})`)
  eq(after.differences, [], 'nothing left once the suggestions are accepted')
  const twice = sketchDistance(serpents, acceptAll(acceptAll(built.sketch, built.suggestions), built.suggestions), reference)
  eq(twice.count, 0, 'accepting twice changes nothing')
  const reversed = sketchDistance(serpents, acceptAll(built.sketch, [...built.suggestions].reverse()), reference)
  eq(reversed.count, 0, 'the order of accepting does not matter')

  const four = buildSketch(fourTables)
  eq(four.suggestions.map((x) => x.kind).sort(), ['matrix', 'reference', 'reference', 'role', 'shared'], 'four tables: matrix, two references, Material shared, phase role')
  eq(sketchDistance(fourTables, acceptAll(four.sketch, four.suggestions), fourReference).differences, [], 'four tables: the hand-drawn sketch once accepted')

  // A database declares what CSV leaves to guessing (simulated here from the model; step 5 reads the files).
  const declaredCatalog = addTables(emptyCatalog(), model.tables.map((t) => makeTable({
    name: t.name, source: { kind: 'database' },
    columns: t.columns.map((c) => ({ name: c.name, declared: { key: 'text', text: 'text', longtext: 'text', identity: 'integer' }[c.type] ?? c.type })),
    rows: t.rows, primaryKey: t.primaryKey, uniques: t.uniques ?? [],
    foreignKeys: t.foreignKeys.map((f) => ({ columns: f.columns, refTable: f.refTable, refColumns: f.refColumns })),
  })))
  const db = buildSketch(declaredCatalog)
  eq(db.suggestions.map((x) => x.kind), ['matrix', 'role'], 'database: only the matrix and the phase role are left to suggest (both guesses)')
  const dbBefore = sketchDistance(declaredCatalog, db.sketch, reference)
  console.log(`  Serpent's Meadow as database: ${dbBefore.count} columns differ before, ${sketchDistance(declaredCatalog, acceptAll(db.sketch, db.suggestions), reference).count} after`)
  // The four columns of the relation table (key, from, to, kind), all settled by the one suggestion.
  eq(dbBefore.differences.map((d) => d.column.split('.')[0]), ['su_relation', 'su_relation', 'su_relation', 'su_relation'], 'database: only the relation table differs before the suggestion')
  eq(sketchDistance(declaredCatalog, acceptAll(db.sketch, db.suggestions), reference).differences, [], 'database: nothing left after the one suggestion')
}

section('Graph from the accepted suggestions')
{
  const { graph, diagnostics, report } = explore(serpents, acceptAll(built.sketch, built.suggestions))
  eq(diagnostics.typeCollisions.length + diagnostics.unpairable.length, 0, 'no diagnostics')
  eq(report.invisibleTypes, [], 'every type in the graph')
  const byType = {}
  for (const n of Object.values(graph.nodes)) byType[graph.schema.typeLabels[n.t]] = (byType[graph.schema.typeLabels[n.t]] ?? 0) + 1
  eq([byType.Find, byType['Stratigraphic unit'], byType.Site, byType.Person], [203, 40, 3, 4], 'records per type')
  const unit = Object.values(graph.nodes).find((n) => n.l === 'SU1001')
  ok(Object.keys(unit.o).some((k) => k.includes('#dot1:above')), 'Harris matrix relations on the units')
  ok(Object.keys(unit.o).some((k) => graph.schema.edgeLabels[k] === 'sondage'), 'unit → sondage across tables')
  const site = Object.values(graph.nodes).find((n) => n.l === "Serpent's Meadow")
  eq(site.l_i18n, { de: 'Schlangenau' }, 'site with its German name')
  const excavation = Object.values(graph.nodes).find((n) => graph.schema.typeLabels[n.t] === 'Excavation')
  eq(Object.values(excavation.o).flat().filter((id) => graph.nodes[id] && graph.schema.typeLabels[graph.nodes[id].t] === 'Person').length, 2, 'excavation → its two persons (junction as edges)')
}

section('Lists and row numbers in the project file')
{
  const cat = addTables(emptyCatalog(), [csv('Funde.csv', 'find_id,material\nF1,Bronze; Eisen\nF2,Bronze\nF3,Eisen; Glas\nF4,Bronze\n'), csv('Notes.csv', 'text\nhello\nhello\n')])
  const { sketch } = buildSketch(cat)
  eq(sketch.splits, [{ tableId: 'Funde', column: 'material', separator: '; ' }], 'list column detected')
  eq(sketch.keys.Notes, '#row', 'no unique column: the row number')
  const { project, tables } = compile(cat, sketch)
  ok(tables.has('Funde__material'), 'a table of its own for the list')
  eq(tables.get('Funde__material').rows.map((r) => r.material), ['Bronze', 'Eisen', 'Bronze', 'Eisen', 'Glas', 'Bronze'], 'one row per value')
  ok(project.tables.some((t) => t.name === 'Funde__material.tsv'), 'listed in the project file')
  const { graph, diagnostics } = explore(cat, sketch)
  eq(diagnostics.typeCollisions.length + diagnostics.unpairable.length, 0, 'no diagnostics')
  const f1 = Object.values(graph.nodes).find((n) => n.l === 'F1')
  eq(Object.values(f1.o).flat().map((id) => graph.nodes[id].l).sort(), ['Bronze', 'Eisen'], 'F1 has both materials')
  eq(Object.values(graph.nodes).filter((n) => graph.schema.typeLabels[n.t] === 'Material').length, 3, 'three materials')
  ok(tables.get('Notes').columns.includes('__row'), 'row-number column added')
}

section('Scale')
{
  const big = syntheticCatalog(0.5)
  const rows = big.tables.reduce((s, t) => s + t.rows.length, 0)
  const t0 = performance.now()
  const { suggestions } = buildSketch(big)
  const ms = performance.now() - t0
  console.log(`  ${big.tables.length} tables, ${rows} rows: statistics + sketch in ${Math.round(ms)} ms, ${suggestions.length} suggestions`)
  ok(ms < 5000, `under 5 s (took ${Math.round(ms)} ms)`)
  ok(suggestions.some((x) => x.kind === 'matrix' && x.tableId === 'SE_Rel'), 'relation table found')
  eq(suggestions.filter((x) => x.kind === 'reference' && x.column === 'ref_find').length, 44, 'all 44 lists refer to the finds')
  eq(suggestions.filter((x) => x.kind === 'shared').map((x) => x.members.length).sort(), [2, 44], 'shared vocabularies grouped: material, and kategorie of all lists')
}

done('heuristics')
