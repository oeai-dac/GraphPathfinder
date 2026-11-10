// Step 4: Harris matrix and roles. A German-language recording database (tests/fixtures/
// harris-tables.mjs) with the stratigraphy as columns of the unit table, a phase table naming
// the next phase, objects, groups and unit types: what is suggested, what the
// OntoGraphNavigator's editors find in the project file, and what the graph says.
//
// The OntoGraphNavigator's conditions are mirrored here, not imported (its repo is not a
// dependency): src/lib/phaseEditor.js phaseSetup, objectEditor.js objectSetup,
// unitTypeEditor.js unitTypeSetup, matrixEditor.js patternOf (OGN 1.0.0). A cross-check outside
// this repository runs the real ones, also writing.
import { readProjectFile } from '../src/core/projectFile'
import { compile } from '../src/lib/compile'
import { buildSketch } from '../src/lib/defaultSketch'
import { readingOf, setRole, setSettings, setValueMap } from '../src/lib/edit'
import { explore } from '../src/lib/explore'
import { hmeMapping, hmeTypeOf, phaseOrderOfName, relationOfName, roleOfName } from '../src/lib/roles'
import { typeById } from '../src/lib/sketch'
import { applySuggestion } from '../src/lib/suggestions'
import { done, eq, ok, section } from './check.mjs'
import { catalog as fourTables, sketch as fourSketch } from './fixtures/four-tables.mjs'
import { catalog as harris, catalogReversed } from './fixtures/harris-tables.mjs'

const BASE = 'https://example.org/graph/'
const CRM = 'http://www.cidoc-crm.org/cidoc-crm/'
const acceptAll = (sketch, suggestions) => suggestions.reduce(applySuggestion, sketch)
// The graph without the sketch's ids: nodes, labels, edges.
const canon = (graph) => Object.keys(graph.nodes).sort().map((id) => {
  const n = graph.nodes[id]
  return [id, n.l, Object.keys(n.o ?? {}).sort().map((k) => [k, [...n.o[k]].sort()])]
})
const P120 = (graph, id) => Object.entries(graph.nodes[id].o ?? {}).filter(([k]) => k.includes('P120_occurs_before')).flatMap(([, ts]) => ts.map((x) => graph.nodes[x].l))
const built = buildSketch(harris())
const accepted = acceptAll(built.sketch, built.suggestions)

// ─── the OntoGraphNavigator's view of a project (mirrored, see above) ───
function ognView(project) {
  const model = readProjectFile(JSON.parse(JSON.stringify(project)))
  const joined = (r) => !!(r?.joinSource && r?.joinTarget)
  const entity = (id) => model.entities.get(id)
  const unitEntity = (typeKey) => {
    for (const rel of model.dot1Relations) if (entity(rel.source)?.typeKey === typeKey) return entity(rel.source)
    return [...model.entities.values()].find((e) => e.typeKey === typeKey) || null
  }
  const rule = model.dot1Relations.map((rel) => ({ rel, source: entity(rel.source), target: entity(rel.target) })).find((r) => r.source && r.target)
  const pattern = ({ rel, source, target }) => {
    if (!joined(rel)) return source.tableId === target.tableId && rel.valueTableId === source.tableId ? 'same-row' : null
    if (rel.valueTableId === source.tableId) return 'source-row'
    if (rel.valueTableId === target.tableId) return 'relation-row'
    return null
  }
  const typeKey = rule?.source.typeKey
  const unit = typeKey && unitEntity(typeKey)
  const phaseRel = model.relations.find((r) => /P10_falls_within/.test(r.propertyUri) && entity(r.source)?.typeKey === typeKey && joined(r))
  const phase = phaseRel && entity(phaseRel.target)
  const orderRel = phase && model.relations.find((r) => /P120_occurs_before/.test(r.propertyUri) && r.source === phase.nodeId && joined(r))
  const partOf = (fromType, notTypes) => model.relations.find((r) => {
    if (!/P46i_forms_part_of/.test(r.propertyUri) || r.dot1) return false
    const s = entity(r.source)
    const t = entity(r.target)
    return s?.typeKey === fromType && t && !notTypes.includes(t.typeKey) && (joined(r) || s.tableId === t.tableId)
  })
  const objectRel = typeKey && partOf(typeKey, [typeKey])
  const object = objectRel && entity(objectRel.target)
  const groupRel = object && partOf(object.typeKey, [typeKey, object.typeKey])
  const unitTypeRel = unit && model.relations.find((r) => {
    if (r.source !== unit.nodeId || r.joinSource || !/P2_has_type/.test(r.propertyUri)) return false
    const t = entity(r.target)
    return t && t.tableId === unit.tableId && t.labelColumn && /unit.?type|einheitstyp/i.test(`${r.explorerLabel} ${t.explorerLabel} ${t.labelColumn}`)
  })
  return { model, rule, pattern: rule && pattern(rule), unit, phaseRel, phase, orderRel, objectRel, object, groupRel, unitTypeRel }
}

// A join compares cells: both columns must write a record alike (the OntoGraphNavigator writes
// the identifier it lists into the join cell).
function joinsWrittenAlike(project, tables) {
  const node = (id) => project.nodes.find((n) => n.id === id)
  const prefixOf = (tableId, column) => {
    const v = tables.get(tableId).rows.map((r) => r[column]).find((x) => x)
    return v ? v.slice(0, v.indexOf(':') + 1) : null
  }
  const bad = []
  for (const e of project.edges.filter((e) => e.data.joinColumnSource)) {
    const from = node(e.source).data.tableId
    const to = e.data.isSplitSeg1 ? node(e.data.originalTarget).data.tableId : node(e.target).data.tableId
    const a = prefixOf(from, e.data.joinColumnSource)
    const b = prefixOf(to, e.data.joinColumnTarget)
    if (!a || a !== b) bad.push(`${e.data.label}: ${from}.${e.data.joinColumnSource} (${a}) ↔ ${to}.${e.data.joinColumnTarget} (${b})`)
  }
  return bad
}

section('Words')
{
  eq(['liegt_über', 'liegt unter', 'zeitgleich_mit', 'cut by', 'SE_über', 'Überlagert von', 'Beschreibung'].map(relationOfName),
    ['above', 'below', 'contemporary with', 'below', 'above', 'below', null], 'relation columns by name, longest phrase first')
  eq(['Einheitstyp', 'SE-Typ', 'Phase', 'Periode', 'Objekt', 'Objektgruppe', 'Bezeichnung'].map(roleOfName),
    ['unitType', 'unitType', 'phase', 'phase', 'object', 'group', null], 'roles by name')
  eq(['nächste_Phase', 'Phase_before', 'vorherige_Phase', 'folgt auf', 'Phase'].map(phaseOrderOfName), ['next', 'next', 'previous', 'previous', null], 'phase order: next or previous')
  eq(['Schicht', 'Grubenverfüllung', 'Mauer', 'Pfostengrube', 'layer', 'Bodenprobe'].map(hmeTypeOf), ['layer', 'fill', 'structure', 'interface', 'layer', null], 'unit types of the Harris Matrix Editor')
  eq(hmeMapping(['Schicht', 'layer', 'Interface', 'Holz']), { Schicht: 'layer', Interface: 'interface' }, 'a mapping for the values that need one')
}

section('Suggestions')
{
  const kinds = built.suggestions.map((x) => (x.kind === 'role' ? `role:${x.role}` : x.kind)).sort()
  eq(kinds, ['matrixColumns', 'reference', 'reference', 'reference', 'role:group', 'role:object', 'role:phase', 'role:phaseOrder', 'role:unitType'], 'one matrix, three references, five roles')
  const m = built.suggestions.find((x) => x.kind === 'matrixColumns')
  eq(m.columns, [{ column: 'liegt_über', kind: 'above', separator: '; ' }, { column: 'liegt_unter', kind: 'below', separator: '; ' }, { column: 'zeitgleich_mit', kind: 'contemporary with', separator: null }], 'relation columns of the unit table, lists split')
  ok(!built.suggestions.some((x) => x.kind === 'reference' && ['liegt_über', 'liegt_unter', 'zeitgleich_mit'].includes(x.column)), 'no plain references for the relation columns')
  eq(built.suggestions.find((x) => x.role === 'unitType').valueMap, { Schicht: 'layer', Verfüllung: 'fill', Interface: 'interface', Mauer: 'structure', Ablagerung: 'deposit' }, 'unit types mapped to the HME\'s five')
  eq(built.suggestions.find((x) => x.role === 'group').from, 'Objekt', 'the group belongs to the object, not the unit')
  ok(!built.suggestions.some((x) => x.role === 'unitType' && x.column !== 'Einheitstyp'), 'no unit type read into Bezeichnung or Beschreibung')
  ok(built.suggestions.every((x) => applySuggestion(accepted, x) === accepted), 'all accepted: every suggestion settled')
  eq(canon(explore(harris(), acceptAll(built.sketch, [...built.suggestions].reverse())).graph), canon(explore(harris(), accepted).graph), 'the order of accepting does not matter')
}

section('What the OntoGraphNavigator finds')
{
  const { project, tables, report } = compile(harris(), accepted)
  eq(report.warnings, [], 'no warnings')
  const v = ognView(project)
  eq(v.pattern, 'relation-row', 'matrix editable: a row of the relation table per relation')
  eq([v.unit.tableId, v.unit.idColumn], ['SE', 'SE_Nr__se'], 'the matrix\'s units are the unit table\'s own node')
  eq([v.phaseRel?.joinSource, v.phase?.tableId], ['Phase__phasen', 'Phasen'], 'phases: P10 joined to the phase table')
  eq([v.orderRel?.joinSource, v.orderRel?.joinTarget], ['nächste_Phase__phasen', 'Phase_ID__phasen'], 'order: P120 from the phase, joined by the next phase')
  eq([v.object?.tableId, v.objectRel?.joinSource ?? null], ['SE', null], 'objects: P46i on the unit\'s row')
  ok(!!v.groupRel, 'groups: P46i from the object')
  eq(v.model.entities.get(v.unitTypeRel?.target)?.labelColumn, 'Einheitstyp__mapped', 'unit types: P2 on the unit\'s row, named for the OntoGraphNavigator')
  eq(joinsWrittenAlike(project, tables), [], 'every join compares cells written alike')
  const order = tables.get('Phasen__order')
  ok(order && order.rows.length === 3, 'a slim order table for the phases (the Studio pairs one row with itself)')
}

section('Graph')
{
  const { graph, diagnostics, report } = explore(harris(), accepted)
  eq(diagnostics.typeCollisions.length + diagnostics.unpairable.length, 0, 'no diagnostics')
  eq(report.invisibleTypes, [], 'every type in the graph')
  const N = (type, id) => graph.nodes[`${BASE}${type}/${id}`]
  const out = (n, key) => Object.entries(n.o ?? {}).filter(([k]) => k.includes(key)).flatMap(([, ts]) => ts.map((t) => graph.nodes[t]?.l))
  const se2 = N('se', 'SE2')
  eq(out(se2, '#dot1:above').sort(), ['Grube', 'Grubenverfüllung'], 'SE2 above SE3 and SE4 (one cell, split)')
  eq(out(se2, '#dot1:below'), ['Humus'], 'SE2 below SE1')
  eq(out(N('se', 'SE5'), '#dot1:contemporary with'), ['Fundament'], 'contemporary')
  eq([out(se2, 'P10_falls_within'), out(se2, 'P2_has_type')], [['Neuzeit'], ['layer']], 'phase and unit type')
  eq(out(N('se', 'SE3'), 'P46i_forms_part_of'), ['Grube 1'], 'object')
  eq(out(N('objekt', 'Grube%201'), 'P46i_forms_part_of'), ['Gehöft A'], 'group of the object')
  eq(['P1', 'P2', 'P3'].map((p) => out(N('phasen', p), 'P120_occurs_before')), [['Spätantik'], ['Neuzeit'], []], 'Römisch before Spätantik before Neuzeit')
  const unitTypes = Object.entries(graph.nodes).filter(([id]) => id.startsWith(`${BASE}einheitstyp/`)).map(([, n]) => n.l).sort()
  eq(unitTypes, ['deposit', 'fill', 'interface', 'layer', 'structure'], 'unit types the GraphExplorer draws')
  eq(Object.keys(N('se', 'SE7').o).filter((k) => k.includes('#dot1:below')).length, 1, 'SE7 below SE5 and SE6 under one kind')
  eq(out(N('se', 'SE7'), '#dot1:below').sort(), ['Fundament', 'Mauer'], 'a list cell in liegt_unter')
}

section('Phase order the other way round')
{
  const b = buildSketch(catalogReversed())
  const order = b.suggestions.find((x) => x.role === 'phaseOrder')
  eq([order?.column, order?.reverse], ['vorherige_Phase', true], '"vorherige_Phase" names the phase before')
  const s = acceptAll(b.sketch, b.suggestions)
  const { graph } = explore(catalogReversed(), s)
  eq(['P1', 'P2', 'P3'].map((p) => P120(graph, `${BASE}phasen/${p}`)), [['Spätantik'], ['Neuzeit'], []], 'the same order: P120 from the earlier phase')
  const v = ognView(compile(catalogReversed(), s).project)
  ok(v.orderRel?.joinSource?.startsWith('vorherige_Phase__next'), 'the OntoGraphNavigator finds the order in a column turned round')
}

section('Phases without a table of their own')
{
  // four tables: "phase" is a column of SE only.
  const { project, tables } = compile(fourTables, fourSketch)
  const v = ognView(project)
  eq([v.phase?.tableId, v.phaseRel?.joinSource], ['phase__list', 'phase__phase'], 'a phase list is derived, P10 joins it')
  eq(tables.get('phase__list').rows.map((r) => r.phase).sort(), ['Bronzezeit', 'Neuzeit', 'Römisch'], 'one row per phase')
  eq(joinsWrittenAlike(project, tables), [], 'joins written alike')
  const { graph, diagnostics } = explore(fourTables, fourSketch)
  eq(diagnostics.typeCollisions.length + diagnostics.unpairable.length, 0, 'no diagnostics')
  const phases = Object.entries(graph.nodes).filter(([id]) => id.includes('/phase/')).map(([, n]) => n.l).sort()
  eq(phases, ['Bronzezeit', 'Neuzeit', 'Römisch'], 'the same phases in the graph')
  eq(graph.nodes['https://example.org/test/se/SU1002'].o[`${CRM}P10_falls_within#as:phase`].map((x) => graph.nodes[x].l), ['Römisch'], 'the unit falls within its phase')
}

section('Roles in the inspector')
{
  const s = accepted
  const unitType = readingOf(s, 'SE', 'Einheitstyp').star
  eq(setRole(s, unitType.id, 'unitType', { valueMap: typeById(s, s.bindings.find((b) => b.id === unitType.to).typeId).valueMap }), s, 'setting what is set changes nothing')
  // A unit type column named otherwise is renamed, so the OntoGraphNavigator recognises it.
  let t = built.sketch
  const art = readingOf(t, 'SE', 'Einheitstyp').star
  const typeId = t.bindings.find((b) => b.id === art.to).typeId
  t = { ...t, types: t.types.map((x) => (x.id === typeId ? { ...x, name: 'Art' } : x)) }
  t = setRole(t, art.id, 'unitType', { valueMap: { Schicht: 'layer' } })
  eq([typeById(t, typeId).name, typeById(t, typeId).valueMap], ['Unit type', { Schicht: 'layer' }], 'unit type: renamed, value map set')
  eq(typeById(setValueMap(t, typeId, {}), typeId).valueMap, null, 'an empty value map is none')
  // Turned round by hand: the order flips.
  const order = readingOf(s, 'Phasen', 'nächste_Phase').star
  const flipped = setRole(s, order.id, 'phaseOrder', { reverse: true })
  const { graph } = explore(harris(), flipped)
  eq(['P1', 'P2', 'P3'].map((p) => P120(graph, `${BASE}phasen/${p}`)), [[], ['Römisch'], ['Spätantik']], 'reverse: read as the phase before, the order flips')
  eq(setRole(s, 'nope', 'phase'), s, 'an unknown relation changes nothing')
}

section('German words where German is a further language')
{
  const s = setSettings(accepted, { languages: { primary: 'en', additional: ['de'] } })
  const { graph } = explore(harris(), s)
  eq([graph.nodes[`${BASE}einheitstyp/layer`].l, graph.nodes[`${BASE}einheitstyp/layer`].l_i18n], ['layer', { de: 'Schicht' }], 'the HME type, with the German word')
}

done('matrix')
