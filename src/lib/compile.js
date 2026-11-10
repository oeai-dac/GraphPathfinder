/**
 * Sketch + catalog → an OntoCartographer Studio project file (version 6).
 *
 * The project file is what the Studio and the OntoGraphNavigator share, and the
 * OntoGraphNavigator turns it into Graph JSON (see explore.js). So this is the only place
 * that has to know the Studio's format; everything it must get right was checked in their
 * code (2026-10-23, see the plan):
 *
 * - A node is its URI, whatever its class. Each type therefore writes its values with a
 *   prefix of its own, into a computed column next to the original (`su_id__su`): se:SU1001.
 *   The original column stays untouched and serves as the label. Joins compare the computed
 *   columns too: the OntoGraphNavigator writes a join cell with the identifier it lists
 *   (phase order, pickers, the matrix), so both must be written alike.
 * - A column merged into a type whose records live in another table becomes no node of its
 *   own but an edge to that table's node, with both join keys (the Studio guesses without
 *   them, the OntoGraphNavigator drops the edge). The OntoGraphNavigator then offers a picker
 *   of those records in its forms.
 * - The first row seen fixes a node's type and label, so nodes and edges of a type's own
 *   table come first.
 * - Inverse names are what the OntoGraphNavigator lists incoming edges under; without one a
 *   node shows no incoming edges.
 * - Every top-level field is written: the Studio keeps the previous session's values for any
 *   that are missing.
 */

import { slugify } from '../core/keys'
import { expandSketch } from './expand'
import { iriLocal } from './ids'
import { bindingById, homeBinding, typeById } from './sketch'

const XSD = 'http://www.w3.org/2001/XMLSchema#'
const GEO = 'http://www.opengis.net/ont/geosparql#'
const CRM = 'http://www.cidoc-crm.org/cidoc-crm/'

/**
 * Roles: the few relations the GraphExplorer and the OntoGraphNavigator recognise by their
 * CIDOC CRM property — phase bands, phase order, object frames, unit types. Only these edges
 * carry a CRM URI; everything else stays in the sketch's own namespace.
 */
export const ROLE_PROPERTIES = {
  phase: `${CRM}P10_falls_within`,
  phaseOrder: `${CRM}P120_occurs_before`,
  object: `${CRM}P46i_forms_part_of`,
  group: `${CRM}P46i_forms_part_of`,
  unitType: `${CRM}P2_has_type`,
}

const withSlash = (base) => (/[/#]$/.test(base) ? base : `${base}/`)

function uniqueColumn(name, taken) {
  let c = name
  for (let n = 2; taken.has(c); n++) c = `${name}_${n}`
  taken.add(c)
  return c
}

/**
 * @param {{ tables }} catalog
 * @param {object} sketch
 * @param {{ rowsOnce?: boolean }} options
 *   rowsOnce: table rows only on the first node of each table. The OntoGraphNavigator reads
 *   that; the Studio only once its tables are loaded. Off by default: the Studio's own format
 *   repeats the rows on every node of the table.
 * @returns {{ project, tables, report }}
 */
export function compile(source, original, { rowsOnce = false } = {}) {
  // Row-number keys and split cells become real columns and tables first.
  const { catalog, sketch, report: expanded } = expandSketch(source, original)
  const base = withSlash(sketch.settings.base)
  const primary = sketch.settings.languages.primary
  const report = { warnings: [...expanded], invisibleTypes: [] }
  const classUri = (type) => `${base}class/${type.prefix}`
  const propUri = (name) => `${base}prop/${slugify(name)}`

  const prefixMap = { data: `${base}data/`, xsd: XSD, geo: GEO, crm: CRM }
  for (const t of sketch.types) prefixMap[t.prefix] = `${base}${t.prefix}/`

  // ─── which bindings become a node, which become an edge to their type's home ───
  const usedAsSource = new Set(sketch.relations.map((r) => r.from))
  // Edges with join keys of their own (the phase order) keep their target node.
  const usedWithKind = new Set(sketch.relations.filter((r) => r.kind || r.join).map((r) => r.to))
  const owners = new Set(sketch.attributes.map((a) => a.owner))
  const joinsTo = new Map() // binding id -> home binding (another table)
  for (const b of sketch.bindings) {
    const home = homeBinding(sketch, b.typeId)
    // Within one table the Studio pairs rows and ignores join keys; the OntoGraphNavigator
    // would join. A node of its own on the same table means the same to both.
    if (!home || home.tableId === b.tableId) continue
    if (usedAsSource.has(b.id) || usedWithKind.has(b.id) || owners.has(b.id)) continue
    joinsTo.set(b.id, home)
  }
  // A relation table's "from" column: the Dot-One edge starts at the unit's own node and joins the
  // relation table ("relation-row"). The OntoGraphNavigator takes a matrix's units from the source
  // of its Dot-One rule; on the relation table that would be a node no unit type or phase hangs on.
  const joinsFrom = new Map() // binding id -> home binding (another table)
  for (const r of sketch.relations.filter((r) => r.kind)) {
    const b = bindingById(sketch, r.from)
    const home = homeBinding(sketch, b.typeId)
    const elsewhere = sketch.relations.some((x) => x.id !== r.id && (x.from === b.id || x.to === b.id))
    if (home && home.tableId !== b.tableId && !elsewhere && !owners.has(b.id)) joinsFrom.set(b.id, home)
  }

  // ─── tables, with a prefixed id column per type ───
  const tables = new Map()
  const idColumnOf = new Map() // binding id -> computed column
  for (const t of catalog.tables) tables.set(t.id, { id: t.id, name: t.name, file: `${t.name}.tsv`, columns: t.columns.map((c) => c.name), rows: t.rows, extra: [] })
  const kindColumns = new Map() // relation id -> { column, prefix }
  // A column's values as a type writes them (one computed column per column and prefix).
  function prefixed(tableId, source, type) {
    const t = tables.get(tableId)
    const key = `${source}\u0000${type.prefix}`
    const existing = t.extra.find((x) => x.key === key)
    if (existing) return existing.column
    const column = uniqueColumn(`${source}__${type.prefix}`, new Set([...t.columns, ...t.extra.map((x) => x.column)]))
    t.extra.push({ key, column, source, value: (v) => `${type.prefix}:${iriLocal(v)}` })
    return column
  }
  // Every binding, also those without a node of their own: their column is a join key.
  for (const b of sketch.bindings) {
    if (!tables.has(b.tableId)) { report.warnings.push(`binding ${b.id}: no table ${b.tableId}`); continue }
    idColumnOf.set(b.id, prefixed(b.tableId, b.column, typeById(sketch, b.typeId)))
  }
  // The phase order joins a column without a binding of its own (expand.js).
  const joinColumnsOf = new Map() // relation id -> { source, target }
  for (const r of sketch.relations.filter((r) => r.join)) {
    const from = bindingById(sketch, r.from)
    const to = bindingById(sketch, r.to)
    joinColumnsOf.set(r.id, { source: prefixed(from.tableId, r.join.source, typeById(sketch, to.typeId)), target: idColumnOf.get(to.id) })
  }
  // A node standing for a record of another table or row (Finds.su_id as a unit, site.parent_site_id
  // as a site) carries that record's labels, looked up by value: the first row a node is seen in
  // fixes its label, and that row may be this one — "SA" would never become "Serpent's Meadow".
  const labelColumnsOf = new Map() // binding id -> { lang: column }
  for (const b of sketch.bindings) {
    const home = homeBinding(sketch, b.typeId)
    if (!home || home.id === b.id || joinsTo.has(b.id) || joinsFrom.has(b.id) || !idColumnOf.has(b.id)) continue
    const langs = Object.entries(home.labels ?? {}).filter(([, column]) => column)
    if (!langs.length) continue
    const homeRows = tables.get(home.tableId).rows
    const t = tables.get(b.tableId)
    const columns = {}
    for (const [lang, column] of langs) {
      const lookup = new Map()
      for (const r of homeRows) if (r[home.column] !== '' && !lookup.has(r[home.column])) lookup.set(r[home.column], r[column])
      const name = uniqueColumn(`${b.column}__label_${lang}`, new Set([...t.columns, ...t.extra.map((x) => x.column)]))
      // Without a translation the other languages stay empty; the primary falls back to the value.
      const fallback = lang === primary
      t.extra.push({ key: `label:${b.id}:${lang}`, column: name, source: b.column, value: (v) => lookup.get(v) || (fallback ? v : '') })
      columns[lang] = name
    }
    labelColumnsOf.set(b.id, columns)
  }
  for (const r of sketch.relations.filter((r) => r.kind)) {
    const b = bindingById(sketch, r.from)
    const t = tables.get(b.tableId)
    const prefix = `${slugify(r.name)}_kind`
    prefixMap[prefix] = `${base}${prefix}/`
    const column = uniqueColumn(`${r.kind}__kind`, new Set([...t.columns, ...t.extra.map((x) => x.column)]))
    // Spaces become underscores, which the Dot-One readers of the Studio and the
    // OntoGraphNavigator read as spaces again: "contemporary with" stays recognisable.
    t.extra.push({ key: `kind:${r.id}`, column, source: r.kind, value: (v) => `${prefix}:${iriLocal(v.trim().replace(/\s+/g, '_'))}` })
    kindColumns.set(r.id, { column })
  }
  for (const t of tables.values()) {
    if (!t.extra.length) continue
    t.rows = t.rows.map((row) => {
      const out = { ...row }
      for (const x of t.extra) out[x.column] = row[x.source] ? x.value(row[x.source]) : ''
      return out
    })
    t.columns = [...t.columns, ...t.extra.map((x) => x.column)]
  }

  // ─── nodes ───
  const nodes = []
  const nodeOf = new Map() // binding id / attribute id / relation id (kind) -> node id
  const tableOrder = catalog.tables.map((t) => t.id)
  const placed = new Map() // table id -> count, for a readable layout in the Studio
  const rowsGiven = new Set()
  let counter = 0
  function node(tableId, data, type = 'ontologyNode') {
    const id = `n${++counter}`
    const t = tables.get(tableId)
    const i = placed.get(tableId) ?? 0
    placed.set(tableId, i + 1)
    let tableRows = t.rows
    if (rowsOnce) { tableRows = rowsGiven.has(tableId) ? [] : t.rows; rowsGiven.add(tableId) }
    nodes.push({
      id, type,
      position: { x: tableOrder.indexOf(tableId) * 380, y: i * 130 },
      data: { tableId, tableName: t.file, tableRows, ...data },
    })
    return id
  }

  const isHome = (b) => sketch.keys[b.tableId] === b.column
  const bindings = [...sketch.bindings].sort((a, b) => Number(isHome(b)) - Number(isHome(a)))
  for (const b of bindings) {
    if (joinsTo.has(b.id) || joinsFrom.has(b.id) || !idColumnOf.has(b.id)) continue
    const type = typeById(sketch, b.typeId)
    const { [primary]: label, ...more } = labelColumnsOf.get(b.id) ?? b.labels ?? {}
    nodeOf.set(b.id, node(b.tableId, {
      uri: classUri(type),
      label: type.name,
      explorerLabel: type.name,
      ...(Object.keys(type.nameI18n ?? {}).length ? { explorerLabelI18n: { ...type.nameI18n } } : {}),
      mappedColumn: idColumnOf.get(b.id),
      // Without a label column of its own a node is called by its value, not by "se:SU1001".
      labelColumn: label || b.column,
      ...(Object.keys(more).length ? { labelColumnI18n: more } : {}),
      noPrefix: false,
      nodeColor: type.color || '',
    }))
  }
  for (const a of sketch.attributes) {
    if (!tables.has(a.tableId)) continue
    nodeOf.set(a.id, node(a.tableId, { uri: a.datatype, label: a.name, explorerLabel: a.name, mappedColumn: a.column, noPrefix: true }))
  }

  // ─── edges ───
  const edges = []
  const edge = (id, source, target, data, handles = ['r-s', 'l-t']) => {
    edges.push({ id, source, target, sourceHandle: handles[0], targetHandle: handles[1], label: data.label ?? '', data })
  }

  // An inverse named after the source type, unless that type reaches the target type by
  // more than one relation: then the relation's name tells them apart.
  const pairCount = new Map()
  const pairOf = (r) => `${bindingById(sketch, r.from).typeId}>${bindingById(sketch, r.to).typeId}`
  for (const r of sketch.relations) pairCount.set(pairOf(r), (pairCount.get(pairOf(r)) ?? 0) + 1)
  const inverseOf = (r) => {
    if (r.inverseName !== null && r.inverseName !== undefined) return r.inverseName
    const source = typeById(sketch, bindingById(sketch, r.from).typeId).name
    return pairCount.get(pairOf(r)) > 1 ? `${source} (${r.name})` : source
  }

  const relations = [...sketch.relations].sort((a, b) =>
    Number(isHome(bindingById(sketch, b.from))) - Number(isHome(bindingById(sketch, a.from))))
  for (const r of relations) {
    const fromHome = joinsFrom.get(r.from)
    const source = fromHome ? nodeOf.get(fromHome.id) : nodeOf.get(r.from)
    const toBinding = bindingById(sketch, r.to)
    const home = joinsTo.get(r.to)
    const target = home ? nodeOf.get(home.id) : nodeOf.get(r.to)
    if (!source || !target) { report.warnings.push(`relation ${r.name}: a column has no node`); continue }
    const inverse = inverseOf(r)
    const data = {
      label: r.name,
      explorerLabel: r.name,
      propertyUri: ROLE_PROPERTIES[r.role] ?? propUri(r.name),
      ...(inverse ? { inversePropertyUri: inverse } : { noInverse: true }),
      ...(home ? { joinColumnSource: idColumnOf.get(r.to), joinColumnTarget: idColumnOf.get(home.id) } : {}),
      ...(fromHome ? { joinColumnSource: idColumnOf.get(fromHome.id), joinColumnTarget: idColumnOf.get(r.from) } : {}),
      ...(r.join ? { joinColumnSource: joinColumnsOf.get(r.id).source, joinColumnTarget: joinColumnsOf.get(r.id).target } : {}),
    }
    if (!r.kind) { edge(r.id, source, target, data); continue }

    // Dot-One in the Studio's split form: source → midpoint → target, and midpoint → the node
    // that carries each edge's kind (above, below …) — the shape the Harris matrix reads.
    const kindNode = node(toBinding.tableId, {
      uri: `${base}class/${slugify(r.name)}_kind`,
      label: `${r.name} (kind)`,
      explorerLabel: `${r.name} (kind)`,
      mappedColumn: kindColumns.get(r.id).column,
      labelColumn: r.kind,
      noPrefix: false,
    })
    const mid = `mid_${r.id}`
    nodes.push({ id: mid, type: 'dotOneMidpoint', position: { x: 0, y: 0 }, data: { parentEdgeLabel: r.name }, width: 14, height: 14 })
    const kindProp = `${propUri(r.name)}_kind`
    edge(`${r.id}_seg1`, source, mid, { ...data, isSplitSeg1: true, originalTarget: target, dotOneProp: kindProp, dotOnePropUri: kindProp, dotOneNodeId: kindNode, dotOneEdgeId: `${r.id}_dot1` }, ['r-s', 'mid-t-l'])
    edge(`${r.id}_seg2`, mid, target, { label: '', isSplitSeg2: true }, ['mid-s-r', 'l-t'])
    edge(`${r.id}_dot1`, mid, kindNode, { label: `${r.name} (kind)`, isDotOne: true }, ['dot-s', 't-t'])
  }
  for (const a of sketch.attributes) {
    const source = nodeOf.get(a.owner)
    if (!source || !nodeOf.has(a.id)) continue
    edge(a.id, source, nodeOf.get(a.id), { label: a.name, explorerLabel: a.name, propertyUri: propUri(a.name) })
  }

  // Types without any relation: the Studio and the OntoGraphNavigator only make nodes along
  // edges, so their records would not appear in the graph at all.
  const related = new Set(sketch.relations.flatMap((r) => [bindingById(sketch, r.from).typeId, bindingById(sketch, r.to).typeId]))
  report.invisibleTypes = sketch.types.filter((t) => !related.has(t.id)).map((t) => t.name)

  const project = {
    version: 6,
    idPrefix: 'data',
    prefixMap,
    wideningParent: true,
    wideningChild: false,
    wideningAll: false,
    namedGraphs: [],
    languages: { primary, additional: [...sketch.settings.languages.additional] },
    tables: [...tables.values()].map((t) => ({ tableId: t.id, name: t.file, headers: t.columns, rowCount: t.rows.length })),
    nodes,
    edges,
  }
  return { project, tables, report }
}
