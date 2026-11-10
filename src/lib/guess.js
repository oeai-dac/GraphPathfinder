/**
 * Guesses across tables: foreign keys read from the values, vocabularies two tables share,
 * junction tables, stratigraphic relation tables, and tables describing the same records.
 *
 * What a database declares is taken as given (`declared: true`); everything read from values is
 * a guess, offered as a suggestion and never applied silently.
 */

import { oppositeDot1 } from '../core/keys'
import { nameStem, words } from './heuristics'
import { hmeMapping, hmeTypeOf, phaseOrderOfName, relationOfName, roleOfName } from './roles'
import { bindingAt, keyBinding } from './sketch'

const SAMPLE = 32
const COVERAGE = 0.95

/** The distinct values of a column — or of its parts, for a column listing several per cell. */
function distinctValues(rows, column, separator = null) {
  const out = new Set()
  for (const r of rows) {
    if (r[column] === '') continue
    if (!separator) { out.add(r[column]); continue }
    for (const part of r[column].split(separator)) if (part.trim()) out.add(part.trim())
  }
  return out
}

/** The key values of every table with a one-column key: Map tableId → { column, values, integer } */
export function keyIndex(catalog, keys) {
  const index = new Map()
  for (const t of catalog.tables) {
    const column = keys[t.id]
    if (!column || column === '#row') continue
    const values = distinctValues(t.rows, column)
    index.set(t.id, { column, values, integer: [...values].every((v) => /^[+-]?\d+$/.test(v)) })
  }
  return index
}

/**
 * How well a column's name points to a table: 2 when it names the table ("material_code" →
 * material), 1.5 when it repeats the key's name, 0.5 when one only contains the other
 * ("excavation_id" in "excavation_person"), else 0.
 */
function nameScore(column, refTable, refColumn) {
  const c = nameStem(column)
  if (!c) return 0
  const t = nameStem(refTable), k = nameStem(refColumn)
  if (c === t) return 2
  if (c === k) return 1.5
  if ((t.length >= 2 && c.includes(t)) || (k.length >= 2 && c.includes(k)) || (c.length >= 3 && (t.includes(c) || k.includes(c)))) return 0.5
  return 0
}

/**
 * Foreign keys: the ones the source declares, and the ones the values give away —
 * at least 95 % of a column's values are keys of another table (or of its own, for a parent).
 * @param {Set<string>} weakKeys  tables whose key is only unique, not named like one: read like any column
 * @param {Map<string, string>} splitOf  "<table>\0<column>" → separator: lists are compared part by part
 * @returns {Array<{ tableId, column, refTable, refColumn, coverage, nameMatch, declared }>}
 */
export function guessForeignKeys(catalog, keys, profiles, index = keyIndex(catalog, keys), weakKeys = new Set(), splitOf = new Map()) {
  const out = []
  const declaredAt = new Set()
  const nameOf = new Map(catalog.tables.map((t) => [t.id, t.name]))
  for (const t of catalog.tables) {
    for (const fk of t.foreignKeys) {
      if (fk.columns.length !== 1 || keys[fk.refTable] !== fk.refColumns[0]) continue
      out.push({ tableId: t.id, column: fk.columns[0], refTable: fk.refTable, refColumn: fk.refColumns[0], coverage: 1, nameMatch: true, declared: true })
      declaredAt.add(`${t.id}\u0000${fk.columns[0]}`)
    }
  }
  for (const t of catalog.tables) {
    for (const c of t.columns) {
      const p = profiles[t.id][c.name]
      // Key columns too: a junction table's key may be one of its references, and a table keyed
      // by another table's key describes that table's records.
      if (declaredAt.has(`${t.id}\u0000${c.name}`)) continue
      const separator = splitOf.get(`${t.id}\u0000${c.name}`) ?? null
      if (p.filled < 1 || p.wkt > 0 || (p.maxLength > 64 && !separator) || p.date > 0.5 || p.boolean > 0.5 || (p.numeric === 1 && p.integer < 1)) continue
      const values = distinctValues(t.rows, c.name, separator)
      const integer = separator ? [...values].every((v) => /^[+-]?\d+$/.test(v)) : p.integer === 1
      const smallIntegers = integer && [...values].every((v) => Math.abs(Number(v)) <= 10000)
      const isKey = c.name === keys[t.id] && !weakKeys.has(t.id)
      // "liegt über", "cut by" … name a relation to units of the same table, whatever the values look like.
      const relationWord = relationOfName(c.name) !== null
      let best = null
      for (const [refTable, key] of index) {
        if (refTable === t.id && key.column === c.name) continue
        if (values.size > key.values.size || integer !== key.integer) continue
        const names = relationWord && refTable === t.id ? 2 : nameScore(c.name, nameOf.get(refTable), key.column)
        // 1, 2, 3 … fit every numbered key; only the name makes them a reference.
        if (smallIntegers && names < 1.5) continue
        // A key pointing elsewhere has to name that table: person_id → person, not the other way.
        if (isKey && names < 2) continue
        if (values.size < 3 && names === 0) continue
        let seen = 0, hits = 0
        for (const v of values) {
          if (seen++ >= SAMPLE) break
          if (key.values.has(v)) hits++
        }
        if (hits / Math.min(SAMPLE, values.size) < 0.8) continue
        hits = 0
        for (const v of values) if (key.values.has(v)) hits++
        const coverage = hits / values.size
        if (coverage < COVERAGE) continue
        const score = coverage + names - (refTable === t.id ? 0.5 : 0)
        if (!best || score > best.score) best = { tableId: t.id, column: c.name, refTable, refColumn: key.column, coverage, nameMatch: names > 0, declared: false, score }
      }
      if (best) { delete best.score; out.push(best) }
    }
  }
  return out
}

/**
 * Tables whose rows only connect two records: two foreign keys and at most two small
 * columns beside them (a role, an order). Declared when the source's primary key is exactly
 * the two foreign keys.
 */
export function detectJunctions(catalog, keys, profiles, fks) {
  const out = []
  for (const t of catalog.tables) {
    const own = fks.filter((f) => f.tableId === t.id)
    if (own.length !== 2) continue
    const fkColumns = new Set(own.map((f) => f.column))
    const others = t.columns.filter((c) => !fkColumns.has(c.name) && c.name !== keys[t.id] && profiles[t.id][c.name].filled > 0)
    if (others.length > 2 || others.some((c) => profiles[t.id][c.name].avgLength > 40)) continue
    const declared = t.primaryKey.length === 2 && t.primaryKey.every((c) => fkColumns.has(c)) && own.every((f) => f.declared)
    // A table with a key of its own (samples: sample_id, su_id, find_id, kind) has records of its
    // own. A junction's "key" is one of its references, the row number, or a bare counter.
    const keyIsReference = fkColumns.has(keys[t.id]) || keys[t.id] === '#row'
    if (!declared && !keyIsReference && others.length > 0) continue
    const [from, to] = t.columns.filter((c) => fkColumns.has(c.name)).map((c) => own.find((f) => f.column === c.name))
    out.push({ tableId: t.id, from: { column: from.column, refTable: from.refTable }, to: { column: to.column, refTable: to.refTable }, declared })
  }
  return out
}

/**
 * Stratigraphic relation tables: two references to the same table and a column whose values
 * are relation words the Harris matrix knows (above/below, über/unter, contemporary, equals).
 */
export function detectMatrixTables(catalog, keys, profiles, fks) {
  const out = []
  for (const t of catalog.tables) {
    const own = fks.filter((f) => f.tableId === t.id)
    const byTarget = new Map()
    for (const f of own) (byTarget.get(f.refTable) ?? byTarget.set(f.refTable, []).get(f.refTable)).push(f)
    const pair = [...byTarget.values()].find((list) => list.length >= 2)
    if (!pair) continue
    const fkColumns = new Set(own.map((f) => f.column))
    const kind = t.columns.find((c) => {
      if (fkColumns.has(c.name) || c.name === keys[t.id]) return false
      const values = distinctValues(t.rows, c.name)
      if (!values.size || values.size > 50) return false
      const known = [...values].filter((v) => oppositeDot1(v) !== null).length
      return known / values.size >= 0.8
    })
    if (!kind) continue
    const [from, to] = t.columns.filter((c) => pair.some((f) => f.column === c.name)).slice(0, 2)
    out.push({ tableId: t.id, from: from.name, to: to.name, kindColumn: kind.name, refTable: pair[0].refTable })
  }
  return out
}

/**
 * Value columns of different tables that hold the same vocabulary (material in finds and in
 * samples): the same name, or a large share of values in common. Columns that pair up are
 * grouped, so 44 lists with the same "kategorie" make one suggestion, not 946.
 * @param {Array<{ tableId, column }>} columns  the columns read as types of their own
 * @returns {Array<{ members: Array<{ tableId, column }>, shared }>}  shared: values the group has in common
 */
export function detectSharedValues(catalog, columns) {
  const sets = columns.map((c) => ({ ...c, stem: nameStem(c.column), values: distinctValues(catalog.tables.find((t) => t.id === c.tableId).rows, c.column) }))
    .filter((c) => c.values.size > 0 && c.values.size <= 1000)
  const parent = sets.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i], b = sets[j]
      if (a.tableId === b.tableId || find(i) === find(j)) continue
      const sameName = a.stem && a.stem === b.stem
      if (!sameName && (a.values.size > 200 || b.values.size > 200)) continue
      let shared = 0
      for (const v of a.values) if (b.values.has(v)) shared++
      const jaccard = shared / (a.values.size + b.values.size - shared)
      if ((sameName && shared >= 1) || (shared >= 2 && jaccard >= 0.3)) parent[find(j)] = find(i)
    }
  }
  const groups = new Map()
  sets.forEach((c, i) => (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))).push(c))
  return [...groups.values()].filter((g) => g.length > 1).map((g) => {
    const all = new Set(g.flatMap((c) => [...c.values]))
    const shared = [...all].filter((v) => g.filter((c) => c.values.has(v)).length > 1).length
    return { members: g.map((c) => ({ tableId: c.tableId, column: c.column })), shared }
  })
}

/**
 * Columns of a unit table that list other units of the same table and say by their name how
 * they lie: "liegt über", "unter", "schneidet", "zeitgleich" … One suggestion per table.
 * @returns {Array<{ tableId, columns: Array<{ column, kind, separator }> }>}
 */
export function detectMatrixColumns(catalog, keys, fks, splitOf = new Map()) {
  const byTable = new Map()
  for (const f of fks) {
    if (f.tableId !== f.refTable || f.column === keys[f.tableId]) continue
    const kind = relationOfName(f.column)
    if (!kind) continue
    if (!byTable.has(f.tableId)) byTable.set(f.tableId, [])
    byTable.get(f.tableId).push({ column: f.column, kind, separator: splitOf.get(`${f.tableId}\u0000${f.column}`) ?? null })
  }
  const order = (t) => catalog.tables.find((x) => x.id === t)?.columns.map((c) => c.name) ?? []
  return [...byTable].map(([tableId, columns]) => ({ tableId, columns: columns.sort((a, b) => order(tableId).indexOf(a.column) - order(tableId).indexOf(b.column)) }))
}

/**
 * Roles for the Harris matrix, read from the units' tables: phase, object, group and unit type
 * by column name (a unit type also by its values), the phase order by a phase table's column
 * that points at another phase ("next phase", "folgt auf").
 * @param {Set<string>} unitTables  tables whose records are the matrix's units
 * @param {Array} fks  references, declared and guessed
 * @returns suggestions { kind: 'role', tableId, column, role, from?, valueMap?, reverse? }
 */
export function detectRoles(catalog, sketch, unitTables, fks) {
  const out = []
  const tableOf = (id) => catalog.tables.find((t) => t.id === id)
  for (const tableId of unitTables) {
    const t = tableOf(tableId)
    if (!t || !keyBinding(sketch, tableId)) continue
    let objectColumn = null
    const groups = []
    for (const c of t.columns) {
      if (c.name === sketch.keys[tableId] || relationOfName(c.name)) continue
      const values = distinctValues(t.rows, c.name)
      let role = roleOfName(c.name)
      // A unit type also by its values (most of them words for layer, fill, cut …) — but not a
      // reference to another table: an interpretation code "flood_deposit" is no unit type.
      // Only for a column read as a vocabulary of its own: labels and free text say other things.
      const refersElsewhere = fks.some((f) => f.tableId === tableId && f.column === c.name && f.refTable !== tableId)
      const vocabulary = bindingAt(sketch, tableId, c.name) && !Object.values(keyBinding(sketch, tableId).labels ?? {}).includes(c.name)
      if (!role && vocabulary && !refersElsewhere && values.size > 0 && values.size <= 40 && [...values].filter((v) => hmeTypeOf(v)).length / values.size >= 0.6) role = 'unitType'
      if (!role) continue
      if (role === 'object') objectColumn = c.name
      if (role === 'group') { groups.push(c.name); continue }
      const x = { kind: 'role', tableId, column: c.name, role }
      if (role === 'unitType') x.valueMap = hmeMapping(values)
      out.push(x)
      if (role === 'phase') {
        // The phases' own table, where the column refers to one: its column naming the next phase.
        const ref = fks.find((f) => f.tableId === tableId && f.column === c.name && f.refTable !== tableId)
        const phases = ref && tableOf(ref.refTable)
        for (const pc of phases?.columns ?? []) {
          const direction = phaseOrderOfName(pc.name)
          if (direction && fks.some((f) => f.tableId === phases.id && f.column === pc.name && f.refTable === phases.id)) {
            out.push({ kind: 'role', tableId: phases.id, column: pc.name, role: 'phaseOrder', reverse: direction === 'previous' })
          }
        }
      }
    }
    for (const g of groups) if (objectColumn) out.push({ kind: 'role', tableId, column: g, role: 'group', from: objectColumn })
  }
  // Only suggestions for columns the sketch reads (or can read) at all.
  return out.filter((x) => x.column && tableOf(x.tableId)?.columns.some((c) => c.name === x.column) && (x.role !== 'phaseOrder' || bindingAt(sketch, x.tableId, sketch.keys[x.tableId])))
}

/** Tables keyed by a reference to another table's key: their rows describe the same records. */
export function detectSameEntities(catalog, keys, fks, exclude) {
  return fks
    .filter((f) => f.column === keys[f.tableId] && f.refTable !== f.tableId && !exclude.has(f.tableId))
    .map((f) => ({ tableId: f.tableId, refTable: f.refTable, declared: f.declared }))
}

export const describeTable = (catalog, id) => words(catalog.tables.find((t) => t.id === id)?.name ?? id)
