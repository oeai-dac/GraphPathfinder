// Sketch → Studio project → the OntoGraphNavigator's chain → Graph JSON, on four small CSV tables.
// Covers what the code review of the Studio and the OntoGraphNavigator flagged: one namespace per
// type, join edges to a type's own table, first-seen labels, inverse names, Dot-One, roles.
import { readProjectFile } from '../src/core/projectFile'
import { addTables, emptyCatalog } from '../src/lib/catalog'
import { compile } from '../src/lib/compile'
import { defaultSketch } from '../src/lib/defaultSketch'
import { explore } from '../src/lib/explore'
import { addRelation, addType, bindColumn, createSketch, setKey } from '../src/lib/sketch'
import { readSource } from '../src/sources/index'
import { bytesOf, done, eq, ok, section } from './check.mjs'
import { BASE, catalog, ids, sketch as s } from './fixtures/four-tables.mjs'

const csv = (file, text) => readSource(file, bytesOf(text)).tables[0]
const { se, fund } = ids

section('Sketch')
{
  eq(s.types.map((t) => [t.name, t.prefix]), [['SE', 'se'], ['Phase', 'phase'], ['Fund', 'fund'], ['Material', 'material'], ['Probe', 'probe']], 'types and their prefixes; the merged type is gone')
  let threw = false
  try { addRelation(s, fund, se) } catch { threw = true }
  ok(threw, 'a relation across tables is refused (merge a column instead)')
}

section('Studio project')
const { project, tables } = compile(catalog, s)
{
  const top = ['version', 'idPrefix', 'prefixMap', 'wideningParent', 'wideningChild', 'wideningAll', 'namedGraphs', 'languages', 'tables', 'nodes', 'edges']
  eq(Object.keys(project), top, 'every top-level field, as the Studio writes them')
  ok(project.prefixMap[project.idPrefix], 'the Data ID prefix is in the prefix map')
  for (const t of s.types) eq(project.prefixMap[t.prefix], `${BASE}${t.prefix}/`, `namespace of ${t.name}`)
  ok(project.nodes.every((n) => /^n\d+$/.test(n.id) || n.type === 'dotOneMidpoint'), 'node ids n<number>, as the Studio mints them')
  const onFunde = project.nodes.filter((n) => n.data.tableId === 'Funde')
  eq(onFunde.map((n) => n.data.mappedColumn), ['find_id__fund', 'material__material', 'gewicht'], 'Funde.se_id has no node of its own')
  const join = project.edges.find((e) => e.data.label === 'found in')
  eq([join.data.joinColumnSource, join.data.joinColumnTarget], ['se_id__se', 'se_id__se'], 'merged column → edge to the SE table with both join keys (prefixed alike)')
  eq(project.nodes.find((n) => n.id === join.target).data.tableId, 'SE', 'the join edge ends at the node of the SE table')
  eq(tables.get('Funde').rows[1], { find_id: '2', se_id: 'SU1002', material: 'Keramik grob', gewicht: '80.25', find_id__fund: 'fund:2', material__material: 'material:Keramik%20grob', se_id__se: 'se:SU1002' }, 'prefixed id columns next to the untouched originals (also the join key); spaces escaped')
  ok(project.nodes.filter((n) => n.data.tableId === 'Funde').every((n) => n.data.tableRows.length === 3), 'rows on every node of a table (the Studio\'s format)')
  const once = compile(catalog, s, { rowsOnce: true }).project
  eq(once.nodes.filter((n) => n.data.tableId === 'Funde' && n.data.tableRows.length).length, 1, 'rowsOnce: rows on the first node only')
  eq(project.tables.map((t) => [t.tableId, t.name]), [['SE', 'SE.tsv'], ['Funde', 'Funde.tsv'], ['Proben', 'Proben.tsv'], ['SE_Rel', 'SE_Rel.tsv'], ['phase__list', 'Phase list.tsv']], 'table summary for the Studio\'s placeholders (and the phase list derived for the OntoGraphNavigator)')
  const firstSE = project.nodes.find((n) => n.data.uri === `${BASE}class/se`)
  eq(firstSE.data.tableId, 'SE', 'the first SE node is the one of its own table (first row seen decides the label)')
  const p10 = project.edges.find((e) => e.data.label === 'Phase')
  eq(p10.data.propertyUri, 'http://www.cidoc-crm.org/cidoc-crm/P10_falls_within', 'role phase → P10')
  const seg1 = project.edges.find((e) => e.data.isSplitSeg1)
  ok(seg1 && project.edges.some((e) => e.data.isSplitSeg2) && project.edges.some((e) => e.data.isDotOne), 'Dot-One in split form')
  const unit = project.nodes.find((n) => n.id === seg1.source)
  eq([unit.data.tableId, unit.data.mappedColumn, seg1.data.joinColumnSource, seg1.data.joinColumnTarget], ['SE', 'se_id__se', 'se_id__se', 'von__se'], 'the Dot-One edge starts at the unit\'s own node and joins the relation table')
  const reread = readProjectFile(JSON.parse(JSON.stringify(project)))
  // 8 entity nodes: SE, Phase, Fund, Material ×2, Probe, SE_Rel nach, the Dot-One kind (von is the SE node).
  // 5 relations; the stratigraphic relation counts as Dot-One.
  eq([reread.entities.size, reread.literals.size, reread.relations.length, reread.dot1Relations.length], [8, 2, 5, 1], 'the OntoGraphNavigator reads the file back from JSON')
}

section('Graph JSON (through the OntoGraphNavigator\'s chain)')
const { graph, diagnostics, report } = explore(catalog, s)
{
  const typeName = (n) => graph.schema.typeLabels[n.t]
  const byType = {}
  for (const n of Object.values(graph.nodes)) (byType[typeName(n)] ??= []).push(n.l)
  eq(Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.length])), { SE: 4, Phase: 3, Fund: 3, Material: 4, Probe: 2 }, 'nodes per type: find 1 and sample 1 are two nodes')
  eq(diagnostics.typeCollisions.length, 0, 'no type collisions')
  eq(diagnostics.unpairable.length, 0, 'no unpairable edges')
  const N = (type, value) => graph.nodes[`${BASE}${type}/${value}`]
  eq([N('se', 'SU1002').l, N('se', 'SU1002').l_i18n], ['Grubenverfüllung', { en: 'Pit fill' }], 'SE label from its own table, with the English one')
  eq(N('fund', '1').l, '1', 'a node without a label column is called by its value')
  eq(N('material', 'Keramik%20grob').l, 'Keramik grob', 'escaped id, readable label')
  const bronze = N('material', 'Bronze')
  eq(Object.keys(bronze.i).sort(), ['Fund', 'Probe'], 'Material merged across two tables; incoming edges listed under the source types')
  eq(N('se', 'SU1001').a, { Geometry: 'POLYGON ((16.4160 48.2030, 16.4161 48.2030, 16.4161 48.2031, 16.4160 48.2030))' }, 'attribute')
  eq(N('fund', '1').a, { 'Weight (g)': '12.5' }, 'attribute named by the sketch')
  const seKeys = Object.keys(N('se', 'SU1002').o).map((k) => k.replace(BASE, ''))
  ok(seKeys.includes('http://www.cidoc-crm.org/cidoc-crm/P10_falls_within#as:phase'), 'phase edge on the unit')
  ok(seKeys.some((k) => k.endsWith('#dot1:ueber')) && seKeys.some((k) => k.endsWith('#dot1:unter')), 'Dot-One above/below, both directions')
  ok(Object.keys(N('se', 'SU1003').o).some((k) => k.endsWith('#dot1:contemporary with')), 'Dot-One value with a space recognised')
  eq(Object.keys(N('se', 'SU1002').i), ['Fund'], 'incoming finds on the unit')
  eq(graph.schema.edgeLabels[Object.keys(N('fund', '1').o).find((k) => k.includes('found_in'))], 'found in', 'edge label from the sketch, not the property\'s local name')
  eq(graph.meta.generated_by, 'GraphPathfinder', 'meta names this tool')
  eq(graph.languages, { primary: 'de', additional: ['en'] }, 'languages')
  eq(report.invisibleTypes, [], 'every type takes part in a relation')
}

section('Inverse names')
{
  let t = createSketch({ base: BASE })
  const cat = addTables(emptyCatalog(), [csv('F.csv', 'id,a,b\n1,X,Y\n')])
  let ft, f, ut, a, b
  ;[t, ft] = addType(t, 'Find')
  t = setKey(t, 'F', 'id')
  ;[t, f] = bindColumn(t, 'F', 'id', ft)
  ;[t, ut] = addType(t, 'Unit')
  ;[t, a] = bindColumn(t, 'F', 'a', ut)
  ;[t, b] = bindColumn(t, 'F', 'b', ut)
  ;[t] = addRelation(t, f, a, { name: 'found in' })
  ;[t] = addRelation(t, f, b, { name: 'stored in', inverseName: '' })
  const edges = compile(cat, t).project.edges
  eq(edges.find((e) => e.data.label === 'found in').data.inversePropertyUri, 'Find (found in)', 'two relations between the same types: the inverse names the relation')
  ok(edges.find((e) => e.data.label === 'stored in').data.noInverse, 'an empty inverse name switches the inverse off')
  ;[t] = addType(t, 'Lonely')
  eq(compile(cat, t).report.invisibleTypes, ['Lonely'], 'a type without relations is reported: it would not appear in the graph')
}

section('Default sketch')
{
  const d = defaultSketch(catalog, { settings: { base: BASE } })
  eq(d.keys, { SE: 'se_id', Funde: 'find_id', Proben: 'probe_id', SE_Rel: 'von' }, 'key: the first column without repeats or gaps')
  const attr = Object.fromEntries(d.attributes.map((a) => [`${a.tableId}.${a.column}`, a.datatype]))
  eq(attr, { 'SE.geom': 'geo:wktLiteral', 'Funde.gewicht': 'xsd:decimal' }, 'geometry and numbers become attributes')
  const { diagnostics: dd } = explore(catalog, d)
  eq(dd.unpairable.length + dd.typeCollisions.length, 0, 'the default sketch compiles without diagnostics')
}

done('compile')
