/**
 * How far a sketch is from a reference: the columns read differently, each roughly one action
 * on the canvas (merge, toggle, pick a label, split). Names of types and relations do not count —
 * renaming is cheap; misreading a column is not.
 *
 * A column's reading: key of its table, label (and language), attribute (and kind of value),
 * reference to the records of another table, a type of its own (and which other columns share
 * it), part of an edge (from/to, and which column qualifies it), split, or unused.
 */
import { homeBinding } from '../src/lib/sketch'

const valueKind = (datatype) => (/wkt/i.test(datatype) ? 'geometry' : /integer|decimal|double|float/i.test(datatype) ? 'number' : /date/i.test(datatype) ? 'date' : /boolean/i.test(datatype) ? 'boolean' : 'text')

function readings(catalog, s) {
  const out = new Map()
  // A type is identified by where its records live (its home column), or, without a home,
  // by the set of columns bound to it.
  const typeIdentity = new Map()
  for (const t of s.types) {
    const home = homeBinding(s, t.id)
    const cols = s.bindings.filter((b) => b.typeId === t.id).map((b) => `${b.tableId}.${b.column}`).sort()
    typeIdentity.set(t.id, home ? `records of ${home.tableId}` : `values {${cols.join(', ')}}`)
  }
  for (const table of catalog.tables) {
    for (const c of table.columns) {
      const at = (b) => b.tableId === table.id && b.column === c.name
      const parts = []
      const binding = s.bindings.find(at)
      if (s.keys[table.id] === c.name && binding) parts.push('key')
      for (const b of s.bindings) for (const [lang, col] of Object.entries(b.labels ?? {})) if (b.tableId === table.id && col === c.name) parts.push(`label:${lang}`)
      const attribute = s.attributes.find((a) => a.tableId === table.id && a.column === c.name)
      if (attribute) parts.push(`attribute:${valueKind(attribute.datatype)}`)
      if (binding && s.keys[table.id] !== c.name) {
        const edge = s.relations.find((r) => r.from === binding.id || r.to === binding.id)
        const fromKey = edge && s.bindings.find((b) => b.id === edge.from)?.column === s.keys[table.id]
        if (edge && !fromKey) parts.push(`${edge.from === binding.id ? 'edge-from' : 'edge-to'}:${typeIdentity.get(binding.typeId)}${edge.kind ? ` kind ${edge.kind}` : ''}`)
        else parts.push(`type:${typeIdentity.get(binding.typeId)}`)
      }
      if (s.relations.some((r) => r.kind === c.name && s.bindings.some((b) => b.id === r.from && b.tableId === table.id))) parts.push('qualifies')
      const split = (s.splits ?? []).find((x) => x.tableId === table.id && x.column === c.name)
      if (split) parts.push(`split:${split.separator.trim()}`)
      out.set(`${table.id}.${c.name}`, parts.sort().join(' + ') || 'unused')
    }
  }
  return out
}

/** @returns {{ count, differences: Array<{ column, got, expected }> }} */
export function sketchDistance(catalog, sketch, reference) {
  const a = readings(catalog, sketch), b = readings(catalog, reference)
  const differences = []
  for (const [column, expected] of b) if (a.get(column) !== expected) differences.push({ column, got: a.get(column), expected })
  return { count: differences.length, differences }
}
