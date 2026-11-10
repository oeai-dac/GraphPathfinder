/**
 * Suggestions: guesses the sketch does not apply by itself.
 *
 *   reference  a column's values are keys of another table: { tableId, column, refTable, refColumn, coverage }
 *   shared     columns holding the same vocabulary: { members: [{ tableId, column }, …], shared }
 *   junction   a table only connects two records: { tableId, from: { column, refTable }, to: { … }, name }
 *   matrix     a table of stratigraphic relations: { tableId, from, to, kindColumn, refTable, name }
 *   same       a table describes the records of another: { tableId, refTable }
 *   matrixColumns  columns of a unit table listing units above, below …: { tableId, columns: [{ column, kind, separator }] }
 *   role       an edge's role for the Harris matrix: { tableId, column, role, from?, valueMap?, reverse? }
 *
 * Applying is idempotent and tolerates any order: a suggestion that no longer fits leaves the
 * sketch as it is. Declared structure (a database's foreign keys and junction tables) goes the
 * same way, only without asking.
 */

import { readingOf, relateColumns, rowsAsEdges, setReading, setRole, updateRelation } from './edit'
import { relationName, words } from './heuristics'
import { ROLES } from './roles'
import { addRelation, attributeAt, bindColumn, bindingAt, keyBinding, mergeTypes, removeAttribute, retypeBinding, setSplit, typeById } from './sketch'

export const STRATIGRAPHIC = 'stratigraphic relation'

function applyReference(s, { tableId, column, refTable }) {
  const target = keyBinding(s, refTable)
  if (!target) return s
  const existing = bindingAt(s, tableId, column)
  if (existing) return existing.typeId === target.typeId ? s : retypeBinding(s, existing.id, target.typeId)
  // An attribute or an unused column becomes a reference from the table's records.
  const attribute = attributeAt(s, tableId, column)
  if (attribute) s = removeAttribute(s, attribute.id)
  const home = keyBinding(s, tableId)
  let b
  ;[s, b] = bindColumn(s, tableId, column, target.typeId)
  if (home) [s] = addRelation(s, home.id, b, { name: relationName(column) })
  return s
}

function applyShared(s, { members }) {
  const [first, ...rest] = members.map((m) => bindingAt(s, m.tableId, m.column)).filter(Boolean)
  for (const b of rest) s = mergeTypes(s, first.typeId, bindingAt(s, b.tableId, b.column).typeId)
  return s
}

// A junction or relation table is read as edges only: its own records disappear.
const applyEdges = (s, tableId, from, to, name, kind = null) => rowsAsEdges(s, tableId, from, to, { name, kind })

function applySame(s, { tableId, refTable }) {
  const own = keyBinding(s, tableId), target = keyBinding(s, refTable)
  return own && target ? mergeTypes(s, target.typeId, own.typeId) : s
}

// Each listed column: a reference to the table's own units, split if it lists several, its edge
// named like every stratigraphic relation and qualified by what the column name says.
function applyMatrixColumns(s, { tableId, columns }) {
  if (!keyBinding(s, tableId)) return s
  for (const { column, kind, separator } of columns) {
    s = setReading(s, tableId, column, { kind: 'reference', refTable: tableId })
    if (separator && !(s.splits ?? []).some((x) => x.tableId === tableId && x.column === column && x.separator === separator)) s = setSplit(s, tableId, column, separator)
    const star = readingOf(s, tableId, column).star
    if (star && (star.kindValue !== kind || star.name !== STRATIGRAPHIC)) s = updateRelation(s, star.id, { kindValue: kind, name: STRATIGRAPHIC })
  }
  return s
}

function applyRole(s, { tableId, column, role, from = null, valueMap, reverse }) {
  if (!keyBinding(s, tableId)) return s
  if (role === 'phaseOrder') s = setReading(s, tableId, column, { kind: 'reference', refTable: tableId })
  else if (from) s = relateColumns(s, tableId, from, column)
  else if (!bindingAt(s, tableId, column)) s = setReading(s, tableId, column, { kind: 'type' })
  const source = from ? bindingAt(s, tableId, from) : keyBinding(s, tableId)
  const target = bindingAt(s, tableId, column)
  const r = source && target && s.relations.find((x) => x.from === source.id && x.to === target.id)
  return r ? setRole(s, r.id, role, { valueMap: role === 'unitType' ? valueMap ?? null : undefined, reverse: role === 'phaseOrder' ? !!reverse : undefined }) : s
}

export function applySuggestion(sketch, suggestion) {
  switch (suggestion.kind) {
    case 'reference': return applyReference(sketch, suggestion)
    case 'shared': return applyShared(sketch, suggestion)
    case 'junction': return applyEdges(sketch, suggestion.tableId, suggestion.from, suggestion.to, suggestion.name)
    case 'matrix': return applyEdges(sketch, suggestion.tableId, { column: suggestion.from, refTable: suggestion.refTable }, { column: suggestion.to, refTable: suggestion.refTable }, STRATIGRAPHIC, suggestion.kindColumn)
    case 'same': return applySame(sketch, suggestion)
    case 'matrixColumns': return applyMatrixColumns(sketch, suggestion)
    case 'role': return applyRole(sketch, suggestion)
    default: return sketch
  }
}

/** The suggestion in one sentence, for the interface. */
export function describeSuggestion(sketch, x, tableName = (id) => id) {
  const typeOf = (tableId) => typeById(sketch, keyBinding(sketch, tableId)?.typeId)?.name ?? tableName(tableId)
  const pct = (v) => `${Math.round(v * 100)} %`
  switch (x.kind) {
    case 'reference':
      return `${tableName(x.tableId)}.${x.column} refers to ${typeOf(x.refTable)} (${pct(x.coverage)} of its values are ${tableName(x.refTable)}.${x.refColumn})`
    case 'shared': {
      const cols = x.members.map((m) => `${tableName(m.tableId)}.${m.column}`)
      const list = cols.length > 4 ? `${cols.slice(0, 3).join(', ')} and ${cols.length - 3} more` : cols.join(', ')
      return `${list} hold the same values (${x.shared} in common) — one type`
    }
    case 'junction':
      return `${tableName(x.tableId)} only links ${typeOf(x.from.refTable)} and ${typeOf(x.to.refTable)} — read it as edges "${x.name}"`
    case 'matrix':
      return `${tableName(x.tableId)} holds stratigraphic relations (${x.from} → ${x.to}, kind in ${x.kindColumn}) — Harris matrix`
    case 'same':
      return `${tableName(x.tableId)} describes the same records as ${typeOf(x.refTable)} — merge the two`
    case 'matrixColumns':
      return `${tableName(x.tableId)}: ${x.columns.map((c) => `${c.column} (${c.kind})`).join(', ')} list other units — Harris matrix`
    case 'role': {
      const label = ROLES.find(([r]) => r === x.role)?.[1] ?? x.role
      const mapped = x.valueMap && Object.keys(x.valueMap).length ? `; ${Object.entries(x.valueMap).slice(0, 4).map(([v, t]) => `${v} → ${t}`).join(', ')}${Object.keys(x.valueMap).length > 4 ? ' …' : ''}` : ''
      const order = x.role === 'phaseOrder' ? (x.reverse ? ' (names the phase before)' : ' (names the phase after)') : ''
      return `${tableName(x.tableId)}.${x.column}${x.from ? ` of ${x.from}` : ''} as ${label}${order}${mapped}`
    }
    default:
      return words(x.kind)
  }
}
