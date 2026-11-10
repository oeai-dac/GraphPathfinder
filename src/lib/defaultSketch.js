/**
 * The sketch a set of tables starts with, and the suggestions that come with it.
 *
 * - Every table's records are a type, keyed by the declared primary key, else the column that
 *   best looks like an identifier, else the row number. Label columns (also per language) name
 *   the records.
 * - What the source declares is applied: foreign keys merge their column into the referenced
 *   type, junction tables become edges, tables keyed by another table's key describe its records.
 * - Every other column is read by itself: an attribute (numbers, dates, geometry, text) or a type
 *   of its own linked from the record ("star"); cells listing several values are split.
 * - Everything read from values is a suggestion: references between tables, shared vocabularies,
 *   junction and stratigraphic relation tables.
 */

import {
  detectJunctions, detectMatrixColumns, detectMatrixTables, detectRoles, detectSameEntities, detectSharedValues, guessForeignKeys, keyIndex,
} from './guess'
import { assignLanguages, classifyColumn, detectKey, detectLabels, detectSplit, humanize, relationName, words } from './heuristics'
import { profileTable } from './profile'
import { relationOfName } from './roles'
import { addAttribute, addRelation, addType, bindColumn, createSketch, keyBinding, setKey, setSplit } from './sketch'
import { applySuggestion } from './suggestions'

export function buildSketch(catalog, { profiles, settings = {} } = {}) {
  profiles ??= Object.fromEntries(catalog.tables.map((t) => [t.id, profileTable(t)]))
  const nameOf = (id) => catalog.tables.find((t) => t.id === id)?.name ?? id

  const detected = new Map(catalog.tables.map((t) => [t.id, detectKey(t, profiles[t.id])]))
  const keys = Object.fromEntries([...detected].map(([id, k]) => [id, k.column ?? '#row']))
  const weak = new Set([...detected].filter(([, k]) => k.weak).map(([id]) => id))
  // Lists first: "SE1002; SE1003" refers to units only part by part.
  const splitOf = new Map()
  for (const t of catalog.tables) {
    for (const c of t.columns) {
      if (c.name === keys[t.id] || !profiles[t.id][c.name].filled) continue
      const sep = detectSplit(t.rows, c.name, profiles[t.id][c.name], { lists: relationOfName(c.name) !== null })
      if (sep) splitOf.set(`${t.id}\u0000${c.name}`, sep)
    }
  }
  const fks = guessForeignKeys(catalog, keys, profiles, keyIndex(catalog, keys), weak, splitOf)
  const matrixColumns = detectMatrixColumns(catalog, keys, fks, splitOf)
  const inMatrixColumns = new Set(matrixColumns.flatMap((m) => m.columns.map((c) => `${m.tableId}\u0000${c.column}`)))
  const matrices = detectMatrixTables(catalog, keys, profiles, fks)
  const junctions = detectJunctions(catalog, keys, profiles, fks).filter((j) => !matrices.some((m) => m.tableId === j.tableId))
  const structural = new Set([...junctions, ...matrices].map((x) => x.tableId))
  const folded = new Set(junctions.filter((j) => j.declared).map((j) => j.tableId))
  const references = (tableId) => new Set(fks.filter((f) => f.tableId === tableId).map((f) => f.column))

  const labelsOf = new Map(catalog.tables.map((t) => [t.id, folded.has(t.id) || keys[t.id] === '#row' ? [] : detectLabels(t, keys[t.id], profiles[t.id], references(t.id))
    .map((l) => ({ ...l, tableId: t.id, filled: profiles[t.id][l.column].filled, rows: t.rows.length }))]))
  const languages = assignLanguages([...labelsOf.values()].flat(), settings.languages?.primary ?? 'de')

  let s = createSketch({ ...settings, languages })
  for (const t of catalog.tables) {
    s = setKey(s, t.id, keys[t.id])
    if (folded.has(t.id)) continue
    const labels = {}
    for (const l of labelsOf.get(t.id)) labels[l.lang] ??= l.column
    let typeId
    ;[s, typeId] = addType(s, humanize(t.name))
    ;[s] = bindColumn(s, t.id, keys[t.id], typeId, labels)
  }
  for (const j of junctions.filter((j) => folded.has(j.tableId))) s = applySuggestion(s, { kind: 'junction', ...j, name: words(nameOf(j.tableId)) })

  const declared = new Map(fks.filter((f) => f.declared).map((f) => [`${f.tableId}\u0000${f.column}`, f]))
  const valueColumns = []
  for (const t of catalog.tables) {
    if (folded.has(t.id)) continue
    const home = keyBinding(s, t.id)
    const labelColumns = new Set(labelsOf.get(t.id).map((l) => l.column))
    for (const c of t.columns) {
      const p = profiles[t.id][c.name]
      if (c.name === keys[t.id] || labelColumns.has(c.name) || !p.filled) continue
      const fk = declared.get(`${t.id}\u0000${c.name}`)
      const split = splitOf.get(`${t.id}\u0000${c.name}`)
      if (split) s = setSplit(s, t.id, c.name, split)
      if (fk) { s = applySuggestion(s, { kind: 'reference', ...fk }); continue }
      const reading = split ? { type: true } : classifyColumn(c, p)
      if (reading.attribute) {
        ;[s] = addAttribute(s, t.id, c.name, home.id, { name: humanize(c.name), datatype: reading.attribute })
        continue
      }
      let typeId, b
      ;[s, typeId] = addType(s, humanize(c.name))
      ;[s, b] = bindColumn(s, t.id, c.name, typeId)
      ;[s] = addRelation(s, home.id, b, { name: relationName(c.name) })
      valueColumns.push({ tableId: t.id, column: c.name })
    }
  }

  const suggestions = []
  for (const e of detectSameEntities(catalog, keys, fks, structural)) {
    if (e.declared) s = applySuggestion(s, { kind: 'same', ...e })
    else suggestions.push({ kind: 'same', ...e })
  }
  for (const m of matrices) suggestions.push({ kind: 'matrix', ...m, name: 'stratigraphic relation' })
  for (const m of matrixColumns) suggestions.push({ kind: 'matrixColumns', ...m })
  for (const j of junctions.filter((j) => !folded.has(j.tableId))) suggestions.push({ kind: 'junction', ...j, name: words(nameOf(j.tableId)) })
  const referenced = new Set()
  for (const f of fks) {
    if (f.declared || structural.has(f.tableId) || f.column === keys[f.tableId] || inMatrixColumns.has(`${f.tableId}\u0000${f.column}`)) continue
    suggestions.push({ kind: 'reference', ...f })
    referenced.add(`${f.tableId}\u0000${f.column}`)
  }
  const free = valueColumns.filter((c) => !referenced.has(`${c.tableId}\u0000${c.column}`) && !structural.has(c.tableId) && !inMatrixColumns.has(`${c.tableId}\u0000${c.column}`))
  for (const v of detectSharedValues(catalog, free)) suggestions.push({ kind: 'shared', ...v })
  // Roles where there are units of a Harris matrix: the targets of relation tables, the tables with relation columns.
  const unitTables = new Set([...matrices.map((m) => m.refTable), ...matrixColumns.map((m) => m.tableId)])
  for (const r of detectRoles(catalog, s, unitTables, fks)) suggestions.push(r)
  suggestions.forEach((x, i) => { x.id = `s${i + 1}` })
  return { sketch: s, suggestions }
}

/** The sketch alone, without its suggestions. */
export const defaultSketch = (catalog, options) => buildSketch(catalog, options).sketch
