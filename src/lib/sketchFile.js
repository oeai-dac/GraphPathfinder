/**
 * The sketch file: the sketch and what it was drawn on, without the data.
 *
 *   { format, version, savedAt, app, sketch, tables: [{ id, name, file, columns }], ui: { layout, dismissed } }
 *
 * The tables are loaded again from their files (or a newer state of them); opening matches each
 * table of the file to a loaded one — the same id with every column the sketch uses, else the
 * same name, else the only table holding those columns — and leaves out, with a warning, what
 * refers to a table or column that is not there.
 */

import { APP_NAME, APP_VERSION } from './app'
import { isSketchFormat, pruneTypes, SKETCH_FORMAT, SKETCH_VERSION } from './sketch'

export function writeSketchFile(sketch, catalog, ui = {}) {
  return {
    format: SKETCH_FORMAT,
    version: SKETCH_VERSION,
    savedAt: new Date().toISOString(),
    app: { name: APP_NAME, version: APP_VERSION },
    sketch,
    tables: catalog.tables.map((t) => ({ id: t.id, name: t.name, file: t.source?.file ?? '', columns: t.columns.map((c) => c.name) })),
    ui,
  }
}

export function readSketchFile(json) {
  if (!json || !isSketchFormat(json.format)) throw new Error(`not a sketch file of ${APP_NAME}`)
  if (json.version > SKETCH_VERSION) throw new Error(`sketch file version ${json.version} is newer than this ${APP_NAME} (${SKETCH_VERSION}); please update`)
  return { sketch: json.sketch, tables: json.tables ?? [], ui: json.ui ?? {}, savedAt: json.savedAt }
}

/** The columns of a table the sketch reads. */
export function usedColumns(sketch, tableId) {
  const out = new Set()
  if (sketch.keys[tableId] && sketch.keys[tableId] !== '#row') out.add(sketch.keys[tableId])
  for (const b of sketch.bindings.filter((b) => b.tableId === tableId)) {
    if (b.column !== '#row') out.add(b.column)
    for (const c of Object.values(b.labels ?? {})) out.add(c)
  }
  for (const a of sketch.attributes.filter((a) => a.tableId === tableId)) out.add(a.column)
  for (const r of sketch.relations) if (r.kind && sketch.bindings.find((b) => b.id === r.from)?.tableId === tableId) out.add(r.kind)
  for (const x of sketch.splits ?? []) if (x.tableId === tableId) out.add(x.column)
  return out
}

/**
 * The sketch on the loaded tables.
 * @returns {{ sketch, mapping: Map<fileTableId, catalogTableId>, missing: string[], warnings: string[] }}
 */
export function bindSketch(file, catalog) {
  const { sketch, tables } = file
  const mapping = new Map()
  const taken = new Set()
  const has = (t, cols) => [...cols].every((c) => t.columns.some((x) => x.name === c))
  const overlap = (t, ft) => ft.columns.filter((c) => t.columns.some((x) => x.name === c)).length >= ft.columns.length / 2
  const free = () => catalog.tables.filter((t) => !taken.has(t.id))
  for (const ft of tables) {
    const used = usedColumns(sketch, ft.id)
    // By id or name a table may have lost a column (reported below); by its columns alone it
    // has to hold every column the sketch uses, and be the only one that does.
    let match = free().find((t) => t.id === ft.id && overlap(t, ft))
      ?? free().find((t) => t.name === ft.name && overlap(t, ft))
    if (!match) {
      const candidates = free().filter((t) => has(t, used) && overlap(t, ft))
      if (candidates.length === 1) match = candidates[0]
    }
    if (match) { mapping.set(ft.id, match.id); taken.add(match.id) }
  }
  const missing = tables.filter((ft) => !mapping.has(ft.id)).map((ft) => ft.name)
  const warnings = []
  const table = (id) => catalog.tables.find((t) => t.id === mapping.get(id))
  const present = (id, column) => column === '#row' || table(id)?.columns.some((c) => c.name === column)
  const where = (id) => mapping.get(id)

  const bindings = []
  for (const b of sketch.bindings) {
    if (!mapping.has(b.tableId)) continue
    if (!present(b.tableId, b.column)) { warnings.push(`${b.tableId}.${b.column} is gone`); continue }
    const labels = Object.fromEntries(Object.entries(b.labels ?? {}).filter(([, c]) => {
      if (present(b.tableId, c)) return true
      warnings.push(`label ${b.tableId}.${c} is gone`)
      return false
    }))
    bindings.push({ ...b, tableId: where(b.tableId), labels })
  }
  const kept = new Set(bindings.map((b) => b.id))
  const attributes = []
  for (const a of sketch.attributes) {
    if (!mapping.has(a.tableId) || !kept.has(a.owner)) continue
    if (!present(a.tableId, a.column)) { warnings.push(`${a.tableId}.${a.column} is gone`); continue }
    attributes.push({ ...a, tableId: where(a.tableId) })
  }
  const relations = sketch.relations
    .filter((r) => kept.has(r.from) && kept.has(r.to))
    .map((r) => {
      const from = sketch.bindings.find((b) => b.id === r.from)
      if (r.kind && !present(from.tableId, r.kind)) { warnings.push(`kind column ${from.tableId}.${r.kind} is gone`); return { ...r, kind: null } }
      return r
    })
  const keys = {}
  for (const [id, column] of Object.entries(sketch.keys)) if (mapping.has(id) && present(id, column)) keys[where(id)] = column
  const splits = (sketch.splits ?? []).filter((x) => mapping.has(x.tableId) && present(x.tableId, x.column)).map((x) => ({ ...x, tableId: where(x.tableId) }))
  return { sketch: pruneTypes({ ...sketch, keys, bindings, attributes, relations, splits }), mapping, missing, warnings }
}
