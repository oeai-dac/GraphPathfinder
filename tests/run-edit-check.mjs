// Edits on the canvas and in the inspector, and the sketch file: what each gesture does, that the
// gestures alone reach the reference sketch, and that a saved sketch opens on the same tables.
import { readdirSync, readFileSync } from 'node:fs'
import { adoptTables } from '../src/lib/adopt'
import { addTables, emptyCatalog } from '../src/lib/catalog'
import { CARD_WIDTH, cardHeight, layoutTables } from '../src/lib/layout'
import { profileTable } from '../src/lib/profile'
import { resultSchema } from '../src/lib/resultSchema'
import { buildSketch } from '../src/lib/defaultSketch'
import {
  makeKey, mergeColumns, readingOf, relateColumns, removeRelation, renameType, rowsAsEdges, setReading, setRole, unmerge, updateRelation,
} from '../src/lib/edit'
import { explore } from '../src/lib/explore'
import { keyBinding, typeById } from '../src/lib/sketch'
import { bindSketch, readSketchFile, writeSketchFile } from '../src/lib/sketchFile'
import { applySuggestion } from '../src/lib/suggestions'
import { readSource } from '../src/sources/index'
import { bytesOf, done, eq, ok, section } from './check.mjs'
import { catalog as four } from './fixtures/four-tables.mjs'
import { referenceSketch } from './fixtures/serpents-reference.mjs'
import { sketchDistance } from './sketch-distance.mjs'

const csv = (file, text) => readSource(file, bytesOf(text)).tables[0]
const dir = new URL('../0_exampleData/serpents_meadow_tables/', import.meta.url)
let serpents = emptyCatalog()
for (const f of readdirSync(dir).filter((f) => f.endsWith('.csv')).sort()) serpents = addTables(serpents, readSource(f, new Uint8Array(readFileSync(new URL(f, dir)))).tables)
const start = buildSketch(serpents)
const kind = (s, t, c) => readingOf(s, t, c).kind
const typeName = (s, t, c) => readingOf(s, t, c).type?.name
const throws = (fn) => { try { fn(); return false } catch { return true } }

section('Reading a column')
{
  const s = start.sketch
  eq(kind(s, 'find', 'find_id'), 'key', 'key')
  eq(readingOf(s, 'find', 'inventory_no'), { relations: [], split: null, star: null, kind: 'label', lang: 'en' }, 'label with its language')
  eq(kind(s, 'find', 'weight_g'), 'attribute', 'attribute')
  eq([kind(s, 'find', 'su_id'), typeName(s, 'find', 'su_id')], ['type', 'Su id'], 'a vocabulary of its own until merged')
  eq(kind(s, 'su_relation', 'relation_id'), 'key', 'relation table still keyed before its suggestion')
}

section('Dragging between tables')
{
  let s = mergeColumns(start.sketch, { tableId: 'find', column: 'su_id' }, { tableId: 'stratigraphic_unit', column: 'su_id' })
  eq([kind(s, 'find', 'su_id'), typeName(s, 'find', 'su_id')], ['reference', 'Stratigraphic unit'], 'onto another table\'s key: a reference to its records')
  ok(!s.types.some((t) => t.name === 'Su id'), 'the vocabulary it was is gone')
  const reverse = mergeColumns(start.sketch, { tableId: 'stratigraphic_unit', column: 'su_id' }, { tableId: 'find', column: 'su_id' })
  eq(sketchDistance(serpents, reverse, s).count, 0, 'the key dragged onto the column means the same')
  eq(mergeColumns(s, { tableId: 'find', column: 'su_id' }, { tableId: 'stratigraphic_unit', column: 'su_id' }), s, 'again: nothing changes')
  s = mergeColumns(s, { tableId: 'find', column: 'weight_g' }, { tableId: 'stratigraphic_unit', column: 'su_id' })
  eq(kind(s, 'find', 'weight_g'), 'reference', 'an attribute dragged onto a key becomes a reference too')

  let f = buildSketch(four).sketch
  f = mergeColumns(f, { tableId: 'Funde', column: 'material' }, { tableId: 'Proben', column: 'material' })
  eq([kind(f, 'Funde', 'material'), kind(f, 'Proben', 'material')], ['shared', 'shared'], 'two value columns: one vocabulary')
  eq(readingOf(f, 'Funde', 'material').type.id, readingOf(f, 'Proben', 'material').type.id, 'the same type')

  const keys = mergeColumns(start.sketch, { tableId: 'person', column: 'person_id' }, { tableId: 'excavation_person', column: 'person_id' })
  eq(readingOf(keys, 'person', 'person_id').type.id, readingOf(keys, 'excavation_person', 'person_id').type.id, 'key onto key: the same records')
}

section('Dragging within a table')
{
  let s = relateColumns(start.sketch, 'site', 'parent_site_id', 'site_id')
  eq([kind(s, 'site', 'parent_site_id'), typeName(s, 'site', 'parent_site_id')], ['reference', 'Site'], 'onto the own key: a parent')
  let m = buildSketch(addTables(emptyCatalog(), [csv('M.csv', 'id,material,group\n1,Bronze,Metal\n2,Eisen,Metal\n3,Keramik,Ceramic\n4,Glas,Ceramic\n')])).sketch
  m = relateColumns(m, 'M', 'material', 'group')
  const key = keyBinding(m, 'M')
  const material = readingOf(m, 'M', 'material').binding, group = readingOf(m, 'M', 'group').binding
  ok(m.relations.some((r) => r.from === material.id && r.to === group.id), 'material → group')
  ok(!m.relations.some((r) => r.from === key.id && r.to === group.id), 'the key\'s own edge to group gives way')
  ok(m.relations.some((r) => r.from === key.id && r.to === material.id), 'the key keeps its edge to material')
  eq(readingOf(m, 'M', 'material').relations.length, 1, 'material lists its further relation')
}

section('Inspector choices')
{
  let s = start.sketch
  s = setReading(s, 'find', 'preservation', { kind: 'attribute', datatype: 'xsd:string' })
  eq(kind(s, 'find', 'preservation'), 'attribute', 'type → attribute')
  ok(!s.types.some((t) => t.name === 'Preservation'), 'its type is gone')
  s = setReading(s, 'find', 'preservation', { kind: 'type', name: 'Erhaltung' })
  eq([kind(s, 'find', 'preservation'), typeName(s, 'find', 'preservation')], ['type', 'Erhaltung'], 'attribute → type with a name')
  s = setReading(s, 'find', 'description', { kind: 'label', lang: 'de' })
  eq(keyBinding(s, 'find').labels, { en: 'inventory_no', de: 'description' }, 'a label in another language')
  s = setReading(s, 'find', 'description', { kind: 'unused' })
  eq([kind(s, 'find', 'description'), keyBinding(s, 'find').labels], ['unused', { en: 'inventory_no' }], 'unused: also its label is gone')
  ok(throws(() => setReading(s, 'find', 'find_id', { kind: 'unused' })), 'the key cannot be dropped')

  const before = keyBinding(s, 'find')
  s = makeKey(s, 'find', 'inventory_no')
  eq([s.keys.find, keyBinding(s, 'find').id, keyBinding(s, 'find').labels], ['inventory_no', before.id, {}], 'another key: the same records, the column is no label any more')
  eq(kind(s, 'find', 'find_id'), 'unused', 'the old key column is free')
  ok(s.attributes.some((a) => a.owner === before.id && a.column === 'weight_g'), 'attributes stay with the records')
  s = makeKey(s, 'find', '#row')
  eq(s.keys.find, '#row', 'rows by number')

  let r = mergeColumns(start.sketch, { tableId: 'find', column: 'su_id' }, { tableId: 'stratigraphic_unit', column: 'su_id' })
  r = unmerge(r, 'find', 'su_id')
  eq(kind(r, 'find', 'su_id'), 'type', 'unmerge: a vocabulary of its own again')

  let t = renameType(start.sketch, keyBinding(start.sketch, 'find').typeId, 'Fund', 'de')
  eq(typeById(t, keyBinding(t, 'find').typeId).nameI18n, { de: 'Fund' }, 'a type name in another language')
  t = renameType(t, keyBinding(t, 'find').typeId, 'Finding')
  eq(typeById(t, keyBinding(t, 'find').typeId).name, 'Finding', 'renamed')
  const rel = t.relations[0]
  t = updateRelation(t, rel.id, { name: 'has', inverseName: 'of' })
  eq([t.relations[0].name, t.relations[0].inverseName], ['has', 'of'], 'relation renamed, with an inverse name')
  eq(removeRelation(t, rel.id).relations.length, t.relations.length - 1, 'relation removed')
}

section('The gestures alone reach the reference')
{
  let s = start.sketch
  const drag = (t, c, rt) => { s = mergeColumns(s, { tableId: t, column: c }, { tableId: rt, column: s.keys[rt] }) }
  drag('excavation', 'site_id', 'site')
  drag('find', 'su_id', 'stratigraphic_unit')
  drag('find', 'object_type_code', 'object_type')
  drag('find', 'material_code', 'material')
  s = relateColumns(s, 'site', 'parent_site_id', 'site_id')
  drag('sondage', 'site_id', 'site')
  drag('sondage', 'excavation_id', 'excavation')
  drag('stratigraphic_unit', 'sondage_id', 'sondage')
  drag('stratigraphic_unit', 'interpretation_code', 'interpretation')
  s = rowsAsEdges(s, 'excavation_person', { column: 'excavation_id', refTable: 'excavation' }, { column: 'person_id', refTable: 'person' }, { name: 'carried out by' })
  s = rowsAsEdges(s, 'su_relation', { column: 'su_from', refTable: 'stratigraphic_unit' }, { column: 'su_to', refTable: 'stratigraphic_unit' }, { name: 'stratigraphic relation', kind: 'relation' })
  eq(sketchDistance(serpents, s, referenceSketch()).differences, [], '9 drags and 2 tables read as edges: the reference')
  s = setRole(s, readingOf(s, 'stratigraphic_unit', 'period').star.id, 'phase') // the role, set in the inspector
  ok(start.suggestions.every((x) => applySuggestion(s, x) === s), 'every suggestion is then settled (applying it changes nothing)')
  const { diagnostics } = explore(serpents, s)
  eq(diagnostics.typeCollisions.length + diagnostics.unpairable.length, 0, 'and compiles without diagnostics')
}

section('Sketch file')
{
  const all = start.suggestions.reduce(applySuggestion, start.sketch)
  const file = JSON.parse(JSON.stringify(writeSketchFile(all, serpents, { layout: { find: { x: 1, y: 2 } } })))
  const read = readSketchFile(file)
  eq(read.ui.layout.find, { x: 1, y: 2 }, 'layout kept')
  const same = bindSketch(read, serpents)
  eq([same.missing, same.warnings], [[], []], 'opens on the same tables without loss')
  eq(sketchDistance(serpents, same.sketch, all).count, 0, 'the same sketch')

  // The finds again, from a renamed file with a column more: matched by its columns.
  const findTable = serpents.tables.find((t) => t.id === 'find')
  const renamed = { ...findTable, id: 'Funde_2024', name: 'Funde_2024', columns: [...findTable.columns, { name: 'extra', declared: null }] }
  const other = addTables(emptyCatalog(), [...serpents.tables.filter((t) => t.id !== 'find'), renamed])
  const moved = bindSketch(read, other)
  eq([moved.mapping.get('find'), moved.missing], ['Funde_2024', []], 'a renamed table is found by its columns')
  eq(kind(moved.sketch, 'Funde_2024', 'su_id'), 'reference', 'and keeps its reading')

  const without = addTables(emptyCatalog(), serpents.tables.filter((t) => t.id !== 'person').map((t) => (t.id === 'sondage' ? { ...t, columns: t.columns.filter((c) => c.name !== 'size') } : t)))
  const partial = bindSketch(read, without)
  eq(partial.missing, ['person'], 'a missing table is named')
  ok(partial.warnings.some((w) => w.includes('sondage.size')), 'a missing column is named')
  ok(!partial.sketch.attributes.some((a) => a.column === 'size') && !partial.sketch.bindings.some((b) => b.tableId === 'person'), 'what used them is left out')
  ok(partial.sketch.types.some((t) => t.name === 'Person'), 'a type still used elsewhere (the junction) stays, without its records')
  eq(file.format, 'graphpathfinder-sketch', 'written under the tool\'s name')
  eq(sketchDistance(serpents, bindSketch(readSketchFile({ ...file, format: 'noname-sketch' }), serpents).sketch, all).count, 0, 'a sketch saved under the working title opens too')
  ok(throws(() => readSketchFile({ format: 'other' })), 'a file of another kind is refused')
  ok(throws(() => readSketchFile({ ...file, version: 99 })), 'a newer version is refused with a hint')
}

section('Tables added to a sketch with work in it')
{
  // Work on the units first, then the finds arrive: the work stays, the new table is read.
  const first = addTables(emptyCatalog(), serpents.tables.filter((t) => t.id !== 'find'))
  let s = buildSketch(first).sketch
  s = renameType(s, keyBinding(s, 'stratigraphic_unit').typeId, 'SE')
  const both = addTables(first, [serpents.tables.find((t) => t.id === 'find')])
  const built = buildSketch(both)
  const adopted = adoptTables(s, built.sketch, ['find'])
  eq(typeById(adopted, keyBinding(adopted, 'stratigraphic_unit').typeId).name, 'SE', 'the rename survives')
  eq([kind(adopted, 'find', 'find_id'), kind(adopted, 'find', 'weight_g'), kind(adopted, 'find', 'inventory_no')], ['key', 'attribute', 'label'], 'the new table is read')
  const ref = built.suggestions.find((x) => x.kind === 'reference' && x.tableId === 'find' && x.column === 'su_id')
  ok(ref && applySuggestion(adopted, ref) !== adopted, 'its reference to the old table comes as a suggestion')
  eq(typeName(applySuggestion(adopted, ref), 'find', 'su_id'), 'SE', 'and points at the old table\'s type as it is now')
  eq(new Set(adopted.types.map((t) => t.id)).size, adopted.types.length, 'no id twice')
}

section('Result schema')
{
  const all = start.suggestions.reduce(applySuggestion, start.sketch)
  const profiles = Object.fromEntries(serpents.tables.map((t) => [t.id, profileTable(t)]))
  const { nodes, edges } = resultSchema(serpents, all, profiles)
  const node = (name) => nodes.find((n) => n.name === name)
  eq([node('Find').count, node('Stratigraphic unit').count, node('Person').count], [203, 40, 4], 'records per type from the key statistics')
  ok(node('Find').attributes.includes('Weight g') && node('Find').attributes.includes('Find spot'), 'attributes of a type')
  eq(node('Site').languages, ['en', 'de'], 'label languages')
  ok(nodes.every((n) => !n.invisible), 'nothing invisible once accepted')
  const strat = edges.find((e) => e.kind === 'relation')
  eq([node('Stratigraphic unit').id, node('Stratigraphic unit').id], [strat.from, strat.to], 'the stratigraphic edge, unit to unit, with its kind')
  ok(edges.some((e) => e.from === node('Excavation').id && e.to === node('Person').id), 'the junction as an edge between the types')
  const before = resultSchema(serpents, start.sketch, profiles)
  ok(before.nodes.some((n) => n.name === 'Su relation' && !n.invisible), 'before: the relation table is records of its own')
}

section('Layout')
{
  const tables = serpents.tables.map((t) => ({ id: t.id, rows: t.columns.length }))
  const links = start.suggestions.filter((x) => x.kind === 'reference').map((x) => [x.tableId, x.refTable])
  const pos = layoutTables(tables, links)
  eq(Object.keys(pos).sort(), serpents.tables.map((t) => t.id).sort(), 'every table placed')
  const boxes = tables.map((t) => ({ ...pos[t.id], w: CARD_WIDTH, h: cardHeight(t.rows) }))
  const overlaps = boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)).length
  eq(overlaps, 0, 'no cards on top of each other')
  const lonely = layoutTables(Array.from({ length: 50 }, (_, i) => ({ id: `t${i}`, rows: 5 })), [])
  ok(Math.max(...Object.values(lonely).map((p) => p.y)) < 2000, '50 unconnected tables wrap into rows, not one column')
}

done('edit')
