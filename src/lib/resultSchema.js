/**
 * The graph the sketch will give, at the level of types — what the panel beside the canvas
 * shows live. Built from the sketch and the column statistics only, never from the data
 * itself: instant with 50 tables, where materialising takes seconds.
 *
 *   nodes  { id (type id), name, count, approx, tables, attributes, languages, invisible }
 *   edges  { id, from, to, name, kind, kinds, role, relations: [relation ids], tables }
 *          kind: the column of a relation table; kinds: the kinds of columns read as one each
 */

import { bindingById, homeBinding, keyBinding } from './sketch'

export function resultSchema(catalog, sketch, profiles) {
  const rowsOf = new Map(catalog.tables.map((t) => [t.id, t.rows.length]))
  const related = new Set()
  const groups = new Map()
  for (const r of sketch.relations) {
    const from = bindingById(sketch, r.from), to = bindingById(sketch, r.to)
    if (!from || !to) continue
    related.add(from.typeId).add(to.typeId)
    const key = [from.typeId, to.typeId, r.name, r.kind ?? '', r.role ?? '', r.kindValue ? 'kinds' : ''].join('\u0000')
    if (!groups.has(key)) groups.set(key, { id: `e${groups.size + 1}`, from: from.typeId, to: to.typeId, name: r.name, kind: r.kind, kinds: [], role: r.role, relations: [], tables: new Set() })
    if (r.kindValue && !groups.get(key).kinds.includes(r.kindValue)) groups.get(key).kinds.push(r.kindValue)
    groups.get(key).relations.push(r.id)
    groups.get(key).tables.add(from.tableId)
  }

  const nodes = sketch.types.map((t) => {
    const bindings = sketch.bindings.filter((b) => b.typeId === t.id)
    const home = homeBinding(sketch, t.id)
    // Records: the distinct keys of the home table (its rows, when keyed by number); a vocabulary
    // without a table of its own: at least the largest column's distinct values.
    let count = 0, approx = false
    if (home) count = home.column === '#row' ? rowsOf.get(home.tableId) ?? 0 : profiles[home.tableId]?.[home.column]?.distinct ?? 0
    else {
      count = Math.max(0, ...bindings.map((b) => profiles[b.tableId]?.[b.column]?.distinct ?? 0))
      approx = bindings.length > 1
    }
    const ids = new Set(bindings.map((b) => b.id))
    const attributes = [...new Set(sketch.attributes.filter((a) => ids.has(a.owner)).map((a) => a.name))]
    const key = home ?? bindings[0]
    const languages = Object.keys((home && keyBinding(sketch, home.tableId)?.labels) ?? {})
    return {
      id: t.id, name: t.name, role: t.role, count, approx,
      tables: [...new Set(bindings.map((b) => b.tableId))],
      home: home ? { tableId: home.tableId, column: home.column } : null,
      attributes, languages, invisible: !related.has(t.id), column: key?.column,
    }
  })
  const edges = [...groups.values()].map((g) => ({ ...g, tables: [...g.tables] }))
  return { nodes, edges }
}
