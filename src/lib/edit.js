/**
 * The edits made on the canvas and in the inspector: one function per gesture or choice, each
 * returning a new sketch (or the same one when nothing changes).
 *
 * They keep the sketch's rules: a relation stays within one table, a table's records keep their
 * key binding, a type without columns disappears. Dragging a column onto another means
 * - in another table: the two hold the same things (merge) —
 *     onto that table's key: a reference to its records; key onto key: the same records;
 *     two value columns: one vocabulary;
 * - in the same table: a relation from one to the other (onto the table's own key: a parent).
 */

import { humanize, relationName } from './heuristics'
import { isUnitTypeName, UNIT_TYPE_NAME } from './roles'
import {
  addAttribute, addRelation, addType, attributeAt, bindColumn, bindingAt, bindingById, bindingsOfType, homeBinding,
  keyBinding, mergeTypes, pruneTypes, removeAttribute, setKey, setLabel, setSplit, typeById,
} from './sketch'

const isKey = (s, tableId, column) => s.keys[tableId] === column

/**
 * How a column is read now.
 *   key | label (lang) | reference (to a type with records elsewhere) | shared (one vocabulary with
 *   other columns) | type (a vocabulary of its own) | edge (only part of an edge: junction, matrix) |
 *   kind (qualifies an edge) | attribute | unused
 * `relations`: the edges the column takes part in besides the one from its table's key.
 */
export function readingOf(s, tableId, column) {
  const binding = bindingAt(s, tableId, column)
  const key = keyBinding(s, tableId)
  const fromKey = (r) => key && r.from === key.id
  const relations = binding ? s.relations.filter((r) => (r.from === binding.id || r.to === binding.id) && !(fromKey(r) && r.to === binding.id)) : []
  const split = (s.splits ?? []).find((x) => x.tableId === tableId && x.column === column) ?? null
  // The edge from the table's records to this column, if any (its name, role, fixed kind).
  const star = binding && key ? s.relations.find((r) => r.from === key.id && r.to === binding.id) ?? null : null
  const base = { relations, split, star }
  if (binding && isKey(s, tableId, column)) return { ...base, kind: 'key', binding, type: typeById(s, binding.typeId) }
  const lang = key && Object.entries(key.labels ?? {}).find(([, c]) => c === column)?.[0]
  if (lang) return { ...base, kind: 'label', lang }
  if (binding) {
    const type = typeById(s, binding.typeId)
    const starred = s.relations.some((r) => fromKey(r) && r.to === binding.id)
    if (!starred && relations.length) return { ...base, kind: 'edge', binding, type, relation: relations[0] }
    const home = homeBinding(s, type.id)
    if (home && home.id !== binding.id) return { ...base, kind: 'reference', binding, type, home }
    const others = bindingsOfType(s, type.id).filter((b) => b.id !== binding.id)
    return { ...base, kind: others.length ? 'shared' : 'type', binding, type, others }
  }
  const qualified = s.relations.find((r) => r.kind === column && bindingById(s, r.from)?.tableId === tableId)
  if (qualified) return { ...base, kind: 'kind', relation: qualified }
  const attribute = attributeAt(s, tableId, column)
  if (attribute) return { ...base, kind: 'attribute', attribute }
  return { ...base, kind: 'unused' }
}

/** Everything that uses a column, except the table's key binding: binding, attribute, label, kind, split. */
function clearColumn(s, tableId, column) {
  const binding = bindingAt(s, tableId, column)
  if (binding && !isKey(s, tableId, column)) {
    s = {
      ...s,
      bindings: s.bindings.filter((b) => b.id !== binding.id),
      relations: s.relations.filter((r) => r.from !== binding.id && r.to !== binding.id),
      attributes: s.attributes.filter((a) => a.owner !== binding.id),
    }
  }
  const attribute = attributeAt(s, tableId, column)
  if (attribute) s = removeAttribute(s, attribute.id)
  s = {
    ...s,
    bindings: s.bindings.map((b) => {
      if (b.tableId !== tableId || !Object.values(b.labels ?? {}).includes(column)) return b
      return { ...b, labels: Object.fromEntries(Object.entries(b.labels).filter(([, c]) => c !== column)) }
    }),
    relations: s.relations.map((r) => (r.kind === column && bindingById(s, r.from)?.tableId === tableId ? { ...r, kind: null } : r)),
  }
  return pruneTypes(setSplit(s, tableId, column, null))
}

function requireKey(s, tableId) {
  const key = keyBinding(s, tableId)
  if (!key) throw new Error(`${tableId} has no records of its own (its rows are edges); choose a key column first`)
  return key
}

/**
 * Read a column another way.
 * @param {{ kind: 'unused'|'attribute'|'type'|'label'|'reference'|'key', datatype?, name?, lang?, refTable? }} reading
 */
export function setReading(s, tableId, column, reading) {
  if (reading.kind === 'key') return makeKey(s, tableId, column)
  if (isKey(s, tableId, column) && keyBinding(s, tableId)) throw new Error(`${column} is the key of ${tableId}; choose another key first`)
  switch (reading.kind) {
    case 'unused':
      return clearColumn(s, tableId, column)
    case 'attribute': {
      const key = requireKey(s, tableId)
      ;[s] = addAttribute(clearColumn(s, tableId, column), tableId, column, key.id, { name: humanize(column), datatype: reading.datatype ?? 'xsd:string' })
      return s
    }
    case 'type': {
      const key = requireKey(s, tableId)
      let typeId, b
      ;[s, typeId] = addType(clearColumn(s, tableId, column), reading.name ?? humanize(column))
      ;[s, b] = bindColumn(s, tableId, column, typeId)
      ;[s] = addRelation(s, key.id, b, { name: relationName(column) })
      return s
    }
    case 'label': {
      const key = requireKey(s, tableId)
      return setLabel(clearColumn(s, tableId, column), key.id, reading.lang ?? s.settings.languages.primary, column)
    }
    case 'reference': {
      const key = requireKey(s, tableId)
      const target = keyBinding(s, reading.refTable)
      if (!target) throw new Error(`${reading.refTable} has no records to refer to`)
      const current = bindingAt(s, tableId, column)
      if (current && current.typeId === target.typeId) return s
      let b
      ;[s, b] = bindColumn(clearColumn(s, tableId, column), tableId, column, target.typeId)
      ;[s] = addRelation(s, key.id, b, { name: relationName(column) })
      return s
    }
    default:
      throw new Error(`unknown reading ${reading.kind}`)
  }
}

/** Make a column the key of its table ('#row': the row number). The records keep their type. */
export function makeKey(s, tableId, column) {
  if (isKey(s, tableId, column) && keyBinding(s, tableId)) return s
  const key = keyBinding(s, tableId)
  if (column !== '#row') s = clearColumn(s, tableId, column)
  if (!key) {
    let typeId
    ;[s, typeId] = addType(setKey(s, tableId, column), humanize(tableId))
    ;[s] = bindColumn(s, tableId, column, typeId)
    return s
  }
  s = setKey(s, tableId, column)
  return { ...s, bindings: s.bindings.map((b) => (b.id === key.id ? { ...b, column } : b)) }
}

// A column as a binding, so it can be merged or related: an attribute or unused column becomes a type.
function ensureBinding(s, tableId, column) {
  if (bindingAt(s, tableId, column)) return s
  if (!keyBinding(s, tableId)) {
    let typeId
    ;[s, typeId] = addType(clearColumn(s, tableId, column), humanize(column))
    ;[s] = bindColumn(s, tableId, column, typeId)
    return s
  }
  return setReading(s, tableId, column, { kind: 'type' })
}

/** The drag gesture between two tables: `a` dropped onto `b`. */
export function mergeColumns(s, a, b) {
  if (a.tableId === b.tableId) return relateColumns(s, a.tableId, a.column, b.column)
  const aKey = isKey(s, a.tableId, a.column) && keyBinding(s, a.tableId)
  const bKey = isKey(s, b.tableId, b.column) && keyBinding(s, b.tableId)
  if (aKey && bKey) return mergeTypes(s, bKey.typeId, aKey.typeId) // the same records
  if (bKey) return setReading(s, a.tableId, a.column, { kind: 'reference', refTable: b.tableId })
  if (aKey) return setReading(s, b.tableId, b.column, { kind: 'reference', refTable: a.tableId })
  s = ensureBinding(ensureBinding(s, a.tableId, a.column), b.tableId, b.column)
  const ta = bindingAt(s, a.tableId, a.column).typeId, tb = bindingAt(s, b.tableId, b.column).typeId
  // Join the type that already has records elsewhere; otherwise the one dropped onto.
  return homeBinding(s, ta) && !homeBinding(s, tb) ? mergeTypes(s, ta, tb) : mergeTypes(s, tb, ta)
}

/**
 * The drag gesture within a table: a relation `from` → `to`. Onto the table's own key it is a
 * reference to the table's records (site.parent_site_id → site). A relation from a column other
 * than the key replaces the key's own edge to `to` (material → material group, not key → group).
 */
export function relateColumns(s, tableId, from, to) {
  if (from === to) return s
  if (isKey(s, tableId, to) && keyBinding(s, tableId)) return setReading(s, tableId, from, { kind: 'reference', refTable: tableId })
  s = ensureBinding(ensureBinding(s, tableId, from), tableId, to)
  const a = bindingAt(s, tableId, from), b = bindingAt(s, tableId, to)
  if (s.relations.some((r) => r.from === a.id && r.to === b.id)) return s
  const key = keyBinding(s, tableId)
  if (key && a.id !== key.id) s = { ...s, relations: s.relations.filter((r) => !(r.from === key.id && r.to === b.id)) }
  ;[s] = addRelation(s, a.id, b.id, { name: relationName(to) })
  return s
}

/**
 * A table whose rows are edges, not records (a junction table, a table of stratigraphic relations):
 * each row links the record named in `from` to the one named in `to`, optionally qualified by the
 * column `kind`. `from`/`to` are { column, refTable }; the table's own records disappear.
 */
export function rowsAsEdges(s, tableId, from, to, { name, kind = null } = {}) {
  const A = keyBinding(s, from.refTable), B = keyBinding(s, to.refTable)
  if (!A || !B) return s
  const a0 = bindingAt(s, tableId, from.column), b0 = bindingAt(s, tableId, to.column)
  const done = a0?.typeId === A.typeId && b0?.typeId === B.typeId && s.relations.some((r) => r.from === a0.id && r.to === b0.id && r.kind === kind)
  if (done) return s
  // Forget how the table was read, then read its rows as edges with no identity of their own.
  const gone = new Set(s.bindings.filter((b) => b.tableId === tableId).map((b) => b.id))
  s = pruneTypes(setKey({
    ...s,
    bindings: s.bindings.filter((b) => !gone.has(b.id)),
    attributes: s.attributes.filter((x) => x.tableId !== tableId && !gone.has(x.owner)),
    relations: s.relations.filter((r) => !gone.has(r.from) && !gone.has(r.to)),
    splits: (s.splits ?? []).filter((x) => x.tableId !== tableId),
  }, tableId, '#row'))
  let a, b
  ;[s, a] = bindColumn(s, tableId, from.column, A.typeId)
  ;[s, b] = bindColumn(s, tableId, to.column, B.typeId)
  ;[s] = addRelation(s, a, b, { name: name ?? relationName(to.column), kind })
  return s
}

/** A merged column on its own again: a vocabulary of its own. */
export const unmerge = (s, tableId, column) => setReading(s, tableId, column, { kind: 'type' })

/** Rename a type; with `lang`, its name in that language. */
export function renameType(s, typeId, name, lang = null) {
  return {
    ...s,
    types: s.types.map((t) => {
      if (t.id !== typeId) return t
      if (!lang || lang === s.settings.languages.primary) return { ...t, name }
      const nameI18n = { ...t.nameI18n }
      if (name) nameI18n[lang] = name
      else delete nameI18n[lang]
      return { ...t, nameI18n }
    }),
  }
}

export function updateRelation(s, relationId, patch) {
  return { ...s, relations: s.relations.map((r) => (r.id === relationId ? { ...r, ...patch } : r)) }
}

/**
 * Give an edge a role (or none). A unit type is named "Unit type" if its name says nothing
 * of the kind — the OntoGraphNavigator finds the unit type by that name. `valueMap` maps its
 * values to the HME's five types.
 */
export function setRole(s, relationId, role, { valueMap, reverse } = {}) {
  const r = s.relations.find((x) => x.id === relationId)
  if (!r) return s
  const patch = { role: role || null }
  if (reverse !== undefined) patch.reverse = !!reverse
  const type = typeById(s, bindingById(s, r.to)?.typeId)
  const sameMap = valueMap === undefined || JSON.stringify(type?.valueMap ?? null) === JSON.stringify(valueMap && Object.keys(valueMap).length ? valueMap : null)
  const named = role !== 'unitType' || isUnitTypeName(type?.name ?? '')
  if (r.role === patch.role && (reverse === undefined || !!r.reverse === patch.reverse) && sameMap && named) return s
  s = updateRelation(s, relationId, patch)
  if (role === 'unitType') {
    const typeId = bindingById(s, r.to)?.typeId
    const type = typeById(s, typeId)
    if (type && !isUnitTypeName(type.name)) s = renameType(s, typeId, UNIT_TYPE_NAME)
    if (valueMap !== undefined) s = setValueMap(s, typeId, valueMap)
  }
  return s
}

export function setValueMap(s, typeId, valueMap) {
  const map = valueMap && Object.keys(valueMap).length ? { ...valueMap } : null
  return { ...s, types: s.types.map((t) => (t.id === typeId ? { ...t, valueMap: map } : t)) }
}

export function removeRelation(s, relationId) {
  return { ...s, relations: s.relations.filter((r) => r.id !== relationId) }
}

export function updateAttribute(s, attributeId, patch) {
  return { ...s, attributes: s.attributes.map((a) => (a.id === attributeId ? { ...a, ...patch } : a)) }
}

export function setSettings(s, patch) {
  return { ...s, settings: { ...s.settings, ...patch } }
}
