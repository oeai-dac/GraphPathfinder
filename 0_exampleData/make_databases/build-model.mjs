// Derives a normalised excavation database from the fictional Serpent's Meadow example of the
// GraphExplorer (its 0_exampleData/GraphExplorer_Example.json) — the way a project would keep it in
// Access or PostgreSQL, not the way the graph models it. Writes model.json, the source of all other
// example files (to-tables.mjs, to-postgres.mjs, to-access.ps1) and the truth the tests compare with.
// Needed only when the GraphExplorer's example changes; the graph file is not copied here.
//
//   npm run example-model                              # from ../GraphExplorer
//   npm run example-model -- --from D:/repos/GraphExplorer
//
// Tables: site (self-reference), person, excavation, excavation_person (junction), sondage,
// stratigraphic_unit, su_relation (Harris matrix), find, and the vocabularies material,
// object_type, interpretation (name_en / name_de). CRM detours become plain columns:
// the identifier becomes site_id, the production's dates become find.date_from/date_to.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fromArg = process.argv.indexOf('--from')
const explorer = resolve(fromArg >= 0 ? process.argv[fromArg + 1] : fileURLToPath(new URL('../../../GraphExplorer', import.meta.url)))
const example = join(explorer, '0_exampleData', 'GraphExplorer_Example.json')
if (!existsSync(example)) {
  console.error(`No GraphExplorer example at ${example}. Pass --from <path to the GraphExplorer>.`)
  process.exit(2)
}
const g = JSON.parse(readFileSync(example, 'utf8'))
const TL = g.schema.typeLabels, EL = g.schema.edgeLabels
const local = (id) => id.replace(/^.*[/#]/, '')
const ofType = (label) => Object.entries(g.nodes).filter(([, n]) => (TL[n.t] ?? n.t) === label).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
const out = (n, label) => Object.entries(n.o ?? {}).filter(([k]) => (EL[k] ?? k) === label).flatMap(([, v]) => v)
const one = (n, label) => out(n, label)[0] ?? null
const ownerOf = (id, type, label) => ofType(type).find(([, n]) => out(n, label).includes(id))?.[0] ?? null
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v))

const T = (name, columns, primaryKey, foreignKeys, rows, extra = {}) => ({ name, columns, primaryKey, foreignKeys, rows, ...extra })
const col = (name, type, more = {}) => ({ name, type, ...more })

// ─── vocabularies ───
const vocab = (type, table, code) => T(table,
  [col(code, 'key'), col('name_en', 'text'), col('name_de', 'text')], [code], [],
  ofType(type).map(([id, n]) => ({ [code]: local(id), name_en: n.l, name_de: n.l_i18n?.de ?? null })), { schema: 'vocab' })
const material = vocab('Material', 'material', 'material_code')
const objectType = vocab('Object Type', 'object_type', 'object_type_code')
const interpretation = vocab('Interpretation', 'interpretation', 'interpretation_code')

// ─── sites, people, excavations ───
const siteCode = (id) => g.nodes[one(g.nodes[id], 'has identifier')]?.l ?? local(id)
const siteRows = ofType('Site').map(([id, n]) => {
  const parent = ownerOf(id, 'Site', 'is composed of')
  return { site_id: siteCode(id), parent_site_id: parent ? siteCode(parent) : null, name: n.l, name_de: n.l_i18n?.de ?? null, description: n.a?.Description ?? null }
}).sort((a, b) => (a.parent_site_id ? 1 : 0) - (b.parent_site_id ? 1 : 0)) // parents first
const site = T('site',
  [col('site_id', 'key'), col('parent_site_id', 'key'), col('name', 'text'), col('name_de', 'text'), col('description', 'longtext')],
  ['site_id'], [{ name: 'site_parent_fk', columns: ['parent_site_id'], refTable: 'site', refColumns: ['site_id'] }], siteRows)

const people = ofType('Person')
const personId = new Map(people.map(([id], i) => [id, i + 1]))
const person = T('person', [col('person_id', 'identity'), col('full_name', 'text')], ['person_id'], [],
  people.map(([id, n]) => ({ person_id: personId.get(id), full_name: n.l })))

const excavations = ofType('Archaeological Excavation')
const excavationId = new Map(excavations.map(([id], i) => [id, i + 1]))
const excavation = T('excavation',
  [col('excavation_id', 'identity'), col('site_id', 'key'), col('title', 'text'), col('start_year', 'integer'), col('end_year', 'integer')],
  ['excavation_id'], [{ name: 'excavation_site_fk', columns: ['site_id'], refTable: 'site', refColumns: ['site_id'] }],
  excavations.map(([id, n]) => ({ excavation_id: excavationId.get(id), site_id: siteCode(ownerOf(id, 'Site', 'was investigated by')), title: n.l, start_year: num(n.a?.start_date), end_year: num(n.a?.end_date) })))

const excavationPerson = T('excavation_person',
  [col('excavation_id', 'integer'), col('person_id', 'integer')], ['excavation_id', 'person_id'],
  [{ name: 'ep_excavation_fk', columns: ['excavation_id'], refTable: 'excavation', refColumns: ['excavation_id'] },
   { name: 'ep_person_fk', columns: ['person_id'], refTable: 'person', refColumns: ['person_id'] }],
  excavations.flatMap(([id, n]) => out(n, 'carried out by').map(p => ({ excavation_id: excavationId.get(id), person_id: personId.get(p) }))))

// ─── sondages, units, relations, finds ───
const sondage = T('sondage',
  [col('sondage_id', 'key'), col('site_id', 'key'), col('excavation_id', 'integer'), col('label', 'text'), col('size', 'text'), col('geom', 'geometry')],
  ['sondage_id'],
  [{ name: 'sondage_site_fk', columns: ['site_id'], refTable: 'site', refColumns: ['site_id'] },
   { name: 'sondage_excavation_fk', columns: ['excavation_id'], refTable: 'excavation', refColumns: ['excavation_id'] }],
  ofType('Sondage').map(([id, n]) => ({ sondage_id: local(id), site_id: siteCode(ownerOf(id, 'Site', 'is composed of')), excavation_id: excavationId.get(ownerOf(id, 'Archaeological Excavation', 'investigated')) ?? null, label: n.l, size: n.a?.Size ?? null, geom: n.a?.Geometry ?? null })))

const units = ofType('Stratigraphic Unit')
const su = T('stratigraphic_unit',
  [col('su_id', 'key'), col('su_number', 'text'), col('sondage_id', 'key'), col('interpretation_code', 'key'), col('description', 'longtext'),
   col('elevation_top', 'decimal'), col('elevation_bottom', 'decimal'), col('volume_m3', 'decimal'), col('period', 'text'), col('geom', 'geometry')],
  ['su_id'],
  [{ name: 'su_sondage_fk', columns: ['sondage_id'], refTable: 'sondage', refColumns: ['sondage_id'] },
   { name: 'su_interpretation_fk', columns: ['interpretation_code'], refSchema: 'vocab', refTable: 'interpretation', refColumns: ['interpretation_code'] }],
  units.map(([id, n]) => ({ su_id: local(id), su_number: n.l, sondage_id: local(ownerOf(id, 'Sondage', 'is composed of')), interpretation_code: one(n, 'has interpretation') ? local(one(n, 'has interpretation')) : null,
    description: n.a?.Description ?? null, elevation_top: num(n.a?.['Elevation top (m)']), elevation_bottom: num(n.a?.['Elevation bottom (m)']), volume_m3: num(n.a?.['Volume (m³)']), period: n.a?.Period ?? null, geom: n.a?.Geometry ?? null })))

// The graph states every relation from both sides; a database records it once.
const relRows = []
const seen = new Set()
for (const [id, n] of units) {
  for (const [label, word, symmetric] of [['lies above', 'above', false], ['equals', 'equals', true], ['is contemporary with', 'contemporary with', true]]) {
    for (const other of out(n, label)) {
      const [a, b] = symmetric && local(other) < local(id) ? [local(other), local(id)] : [local(id), local(other)]
      const k = `${a}|${b}|${word}`
      if (seen.has(k)) continue
      seen.add(k)
      relRows.push({ relation_id: relRows.length + 1, su_from: a, su_to: b, relation: word })
    }
  }
}
const below = units.reduce((s, [, n]) => s + out(n, 'lies below').length, 0)
const above = units.reduce((s, [, n]) => s + out(n, 'lies above').length, 0)
const suRelation = T('su_relation',
  [col('relation_id', 'identity'), col('su_from', 'key'), col('su_to', 'key'), col('relation', 'text')], ['relation_id'],
  [{ name: 'rel_from_fk', columns: ['su_from'], refTable: 'stratigraphic_unit', refColumns: ['su_id'] },
   { name: 'rel_to_fk', columns: ['su_to'], refTable: 'stratigraphic_unit', refColumns: ['su_id'] }], relRows)

const find = T('find',
  [col('find_id', 'key'), col('inventory_no', 'key'), col('su_id', 'key'), col('object_type_code', 'key'), col('material_code', 'key'),
   col('description', 'longtext'), col('preservation', 'text'), col('weight_g', 'decimal'), col('date_from', 'integer'), col('date_to', 'integer'), col('find_spot', 'geometry')],
  ['find_id'],
  [{ name: 'find_su_fk', columns: ['su_id'], refTable: 'stratigraphic_unit', refColumns: ['su_id'] },
   { name: 'find_object_type_fk', columns: ['object_type_code'], refSchema: 'vocab', refTable: 'object_type', refColumns: ['object_type_code'] },
   { name: 'find_material_fk', columns: ['material_code'], refSchema: 'vocab', refTable: 'material', refColumns: ['material_code'] }],
  ofType('Find').map(([id, n]) => {
    const prod = g.nodes[one(n, 'was produced by')]
    return { find_id: local(id), inventory_no: n.a?.['Inventory number'] ?? null, su_id: local(ownerOf(id, 'Stratigraphic Unit', 'contains find')),
      object_type_code: one(n, 'has type') ? local(one(n, 'has type')) : null, material_code: one(n, 'consists of') ? local(one(n, 'consists of')) : null,
      description: n.a?.Description ?? null, preservation: n.a?.Preservation ?? null, weight_g: num(n.a?.['Weight (g)']),
      date_from: num(prod?.a?.begin_of_the_begin), date_to: num(prod?.a?.end_of_the_end), find_spot: n.a?.['Find spot'] ?? null }
  }), { uniques: [['inventory_no']] })

// Geometry type and dimension per column, for PostGIS typmods.
const tables = [material, objectType, interpretation, site, person, excavation, excavationPerson, sondage, su, suRelation, find]
for (const t of tables) for (const c of t.columns.filter(c => c.type === 'geometry')) {
  const kinds = new Set(t.rows.map(r => r[c.name]).filter(Boolean).map(w => w.match(/^[A-Z]+( Z)?/)[0]))
  c.geometryType = kinds.size === 1 ? [...kinds][0].replace(' Z', '') : 'GEOMETRY'
  c.hasZ = [...kinds].some(k => k.endsWith(' Z'))
  c.srid = 4326
}

writeFileSync(new URL('./model.json', import.meta.url), JSON.stringify({ source: 'Serpent\'s Meadow (fictional), GraphExplorer_Example.json', srid: 4326, tables }, null, 1))
for (const t of tables) console.log(`${((t.schema ? t.schema + '.' : '') + t.name).padEnd(24)} ${String(t.rows.length).padStart(4)} rows  PK(${t.primaryKey})  FK ${t.foreignKeys.map(f => `${f.columns}→${f.refTable}`).join(', ') || '—'}`)
console.log(`relations: ${above} "above" in the graph vs ${below} "below" (mirrors), ${relRows.length} rows kept`)
console.log('geometry columns:', tables.flatMap(t => t.columns.filter(c => c.type === 'geometry').map(c => `${t.name}.${c.name} ${c.geometryType}${c.hasZ ? ' Z' : ''}`)).join(', '))
console.log('finds without dating:', find.rows.filter(r => r.date_from === null).length, '| without object type:', find.rows.filter(r => !r.object_type_code).length)
