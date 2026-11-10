/**
 * What the sketch says in short, spelled out as tables before compiling:
 *
 * - A key '#row' becomes a real column `__row` holding the row number: the project file needs a
 *   column for every identifier.
 * - A column split into several values (Material "Bronze; Eisen") becomes a table of its own,
 *   `<table>__<column>`, with one row per value next to the record's key — the shape the Studio
 *   and the OntoGraphNavigator can read, since neither splits cells. Its bindings and attributes
 *   move there, and the record's type gets a binding on that table to start the edges from.
 *
 * For the Harris matrix, in the shape the GraphExplorer and the OntoGraphNavigator read and edit:
 *
 * - An edge with one fixed kind ("liegt über" → above) becomes a table of its own,
 *   `<table>__<column>`, one row per unit named, with the kind in a column `__kind` — the Dot-One
 *   form of a relation table.
 * - A unit type with a value map reads its values as the HME's five (Verfüllung → fill) from a
 *   computed column; the original stays as the German label where German is a further language.
 * - Phases without a table of their own get one (`<type> list`), so "falls within" is an edge to
 *   it with join keys — what the OntoGraphNavigator needs to edit phases.
 * - A phase order becomes an edge to a slim copy of the phases (`<table>__order`) with join keys,
 *   as the OntoGraphNavigator writes it itself: the Studio pairs two ends on one table row by row,
 *   and a phase would occur before itself. A column naming the phase *before* is turned round.
 *
 * The sketch the person edits stays as it is; only the copy handed to the compiler changes.
 */

import { addRelation, bindColumn, bindingAt, bindingById, homeBinding, keyBinding, typeById } from './sketch'

function freeName(name, taken) {
  let n = name
  for (let i = 2; taken.has(n); i++) n = `${name}_${i}`
  return n
}

export function expandSketch(catalog, sketch) {
  let tables = catalog.tables
  let s = sketch

  // ─── row numbers ───
  const rowColumn = new Map()
  tables = tables.map((t) => {
    if (s.keys[t.id] !== '#row' || !s.bindings.some((b) => b.tableId === t.id && b.column === '#row')) return t
    const column = freeName('__row', new Set(t.columns.map((c) => c.name)))
    rowColumn.set(t.id, column)
    return { ...t, columns: [...t.columns, { name: column, declared: 'integer' }], rows: t.rows.map((r, i) => ({ ...r, [column]: String(i + 1) })) }
  })
  if (rowColumn.size) {
    s = {
      ...s,
      keys: Object.fromEntries(Object.entries(s.keys).map(([id, k]) => [id, k === '#row' && rowColumn.has(id) ? rowColumn.get(id) : k])),
      bindings: s.bindings.map((b) => (b.column === '#row' && rowColumn.has(b.tableId) ? { ...b, column: rowColumn.get(b.tableId) } : b)),
    }
  }

  const report = []
  const addTable = (table) => { tables = [...tables, table]; return table }
  const tableOf = (id) => tables.find((t) => t.id === id)
  const freeId = (name) => freeName(name, new Set(tables.map((t) => t.id)))

  // ─── edges of one fixed kind ("liegt über"): a relation table of their own ───
  for (const r of s.relations.filter((r) => r.kindValue)) {
    const from = bindingById(s, r.from), to = bindingById(s, r.to)
    const base = tableOf(to.tableId)
    if (!base) continue
    const separator = (s.splits ?? []).find((x) => x.tableId === base.id && x.column === to.column)?.separator
    const id = freeId(`${base.id}__${to.column}`)
    const kindColumn = freeName('__kind', new Set([from.column, to.column]))
    const rows = []
    for (const row of base.rows) {
      if (!row[to.column] || !row[from.column]) continue
      const parts = separator ? row[to.column].split(separator).map((x) => x.trim()).filter(Boolean) : [row[to.column]]
      for (const part of parts) rows.push({ [from.column]: row[from.column], [to.column]: part, [kindColumn]: r.kindValue })
    }
    addTable({
      id, name: `${base.name}__${to.column}`, source: { kind: 'derived', from: base.id, relation: to.column },
      columns: [{ name: from.column, declared: null }, { name: to.column, declared: null }, { name: kindColumn, declared: null }], primaryKey: [], uniques: [], foreignKeys: [], rows,
    })
    let fromHere
    ;[s, fromHere] = bindColumn(s, id, from.column, from.typeId)
    s = {
      ...s,
      bindings: s.bindings.map((b) => (b.id === to.id ? { ...b, tableId: id } : b)),
      relations: s.relations.map((x) => (x.id === r.id ? { ...x, from: fromHere, kind: kindColumn, kindValue: null } : x)),
      splits: (s.splits ?? []).filter((x) => !(x.tableId === base.id && x.column === to.column)),
    }
  }

  // ─── split cells ───
  for (const split of s.splits ?? []) {
    const base = tables.find((t) => t.id === split.tableId)
    const key = s.keys[split.tableId]
    const home = keyBinding(s, split.tableId)
    if (!base || !home || !key || key === '#row') { report.push(`${split.tableId}.${split.column}: no key to split by`); continue }
    const id = freeName(`${base.id}__${split.column}`, new Set(tables.map((t) => t.id)))
    const rows = []
    for (const r of base.rows) {
      if (!r[split.column]) continue
      for (const part of r[split.column].split(split.separator).map((x) => x.trim()).filter(Boolean)) rows.push({ [key]: r[key], [split.column]: part })
    }
    tables = [...tables, {
      id, name: `${base.name}__${split.column}`, source: { kind: 'derived', from: base.id, split: split.column },
      columns: [{ name: key, declared: null }, { name: split.column, declared: null }], primaryKey: [], uniques: [], foreignKeys: [], rows,
    }]
    // The record's type on the new table, to start its edges from (no key: not a home).
    let owner = null
    const ownerOnSplit = () => {
      if (!owner) [s, owner] = bindColumn(s, id, key, home.typeId)
      return owner
    }
    const moved = bindingAt(s, split.tableId, split.column)
    if (moved) {
      const incoming = s.relations.filter((r) => r.to === moved.id)
      s = { ...s, bindings: s.bindings.map((b) => (b.id === moved.id ? { ...b, tableId: id } : b)) }
      for (const r of incoming) {
        const from = ownerOnSplit()
        s = { ...s, relations: s.relations.map((x) => (x.id === r.id ? { ...x, from } : x)) }
      }
      if (!incoming.length) [s] = addRelation(s, ownerOnSplit(), moved.id, { name: split.column })
    }
    s = {
      ...s,
      attributes: s.attributes.map((a) => (a.tableId === split.tableId && a.column === split.column ? { ...a, tableId: id, owner: ownerOnSplit() } : a)),
    }
  }
  s = { ...s, splits: [] }

  // ─── values read as other values (unit types → the HME's five) ───
  const { primary, additional } = s.settings.languages
  for (const type of s.types.filter((t) => t.valueMap)) {
    for (const b of s.bindings.filter((x) => x.typeId === type.id)) {
      const t = tableOf(b.tableId)
      const column = freeName(`${b.column}__mapped`, new Set(t.columns.map((c) => c.name)))
      const replaced = { ...t, columns: [...t.columns, { name: column, declared: null }], rows: t.rows.map((row) => ({ ...row, [column]: row[b.column] ? (type.valueMap[row[b.column]] ?? row[b.column]) : '' })) }
      tables = tables.map((x) => (x.id === t.id ? replaced : x))
      // The German word stays visible where German is a further language.
      const labels = primary !== 'de' && additional.includes('de') ? { de: b.column } : {}
      s = { ...s, bindings: s.bindings.map((x) => (x.id === b.id ? { ...x, column, labels: { ...labels, ...x.labels } } : x)) }
    }
  }

  // ─── phases with a table of their own ───
  for (const r of s.relations.filter((r) => r.role === 'phase')) {
    const to = bindingById(s, r.to)
    const type = typeById(s, to?.typeId)
    if (!type || homeBinding(s, type.id)) continue
    const values = new Set()
    for (const b of s.bindings.filter((x) => x.typeId === type.id)) for (const row of tableOf(b.tableId)?.rows ?? []) if (row[b.column]) values.add(row[b.column])
    const id = freeId(`${type.prefix}__list`)
    addTable({ id, name: `${type.name} list`, source: { kind: 'derived', phases: type.id }, columns: [{ name: to.column, declared: null }], primaryKey: [to.column], uniques: [], foreignKeys: [], rows: [...values].map((v) => ({ [to.column]: v })) })
    s = { ...s, keys: { ...s.keys, [id]: to.column } }
    ;[s] = bindColumn(s, id, to.column, type.id)
  }

  // ─── phase order: an edge to a slim copy of the phases, with join keys ───
  for (const r of s.relations.filter((r) => r.role === 'phaseOrder')) {
    const from = bindingById(s, r.from), to = bindingById(s, r.to)
    const phases = tableOf(from?.tableId)
    const key = phases && s.keys[phases.id]
    if (!phases || !to || from.column !== key || to.tableId !== phases.id) { report.push(`phase order ${r.name}: needs a column of the phases' own table`); continue }
    let next = to.column
    if (r.reverse) {
      // The column names the phase before: for each phase, the one that names it is the next.
      next = freeName(`${to.column}__next`, new Set(phases.columns.map((c) => c.name)))
      const after = new Map()
      for (const row of phases.rows) if (row[to.column] && !after.has(row[to.column])) after.set(row[to.column], row[key])
      const replaced = { ...phases, columns: [...phases.columns, { name: next, declared: null }], rows: phases.rows.map((row) => ({ ...row, [next]: after.get(row[key]) ?? '' })) }
      tables = tables.map((x) => (x.id === phases.id ? replaced : x))
    }
    const id = freeId(`${phases.id}__order`)
    addTable({ id, name: `${phases.name}__order`, source: { kind: 'derived', order: phases.id }, columns: [{ name: key, declared: null }], primaryKey: [], uniques: [], foreignKeys: [], rows: phases.rows.filter((row) => row[key]).map((row) => ({ [key]: row[key] })) })
    let there
    ;[s, there] = bindColumn(s, id, key, from.typeId)
    s = {
      ...s,
      bindings: s.bindings.filter((b) => b.id !== to.id),
      relations: s.relations.map((x) => (x.id === r.id ? { ...x, to: there, join: { source: next, target: key }, reverse: false } : x)),
    }
  }
  return { catalog: { ...catalog, tables }, sketch: s, report }
}
