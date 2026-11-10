/**
 * The sketch: this tool's own model of the graph to be built.
 *
 *   types       what the graph's nodes are: { id, name, nameI18n, prefix, color, role }
 *   keys        per table, the column whose values are the table's records: { [tableId]: column }
 *   bindings    a column read as a type: { id, typeId, tableId, column, labels: { [lang]: column } }
 *               Binding two columns to one type merges them: equal values are one node.
 *   attributes  a column read as plain values of a binding: { id, tableId, column, owner, name, datatype }
 *   relations   an edge between two bindings of the same table: { id, from, to, name, inverseName, role, kind, kindValue, reverse }
 *               kind: a column of that table that qualifies each edge (Dot-One, e.g. above/below);
 *               kindValue: one qualifier for every edge, from the column's meaning ("liegt über" → above);
 *               role: phase, phaseOrder, object, group, unitType (see roles.js); reverse: a phase order
 *               column naming the phase before, not after
 *   splits      cells holding several values: { tableId, column, separator }
 *
 * A table's key may be '#row': nothing identifies its rows but their number.
 *
 * There are no edges between tables. Two tables meet only where a column of one is merged into
 * a type of the other (Finds.su_id into "SU") — the compiler turns that into the Studio's join
 * keys. One rule instead of join keys, guessed joins and Cartesian products.
 *
 * Every operation returns a new sketch; nothing is changed in place.
 */

import { typePrefix } from './ids'

export const SKETCH_FORMAT = 'graphpathfinder-sketch'
export const SKETCH_VERSION = 1

// Sketches saved under the working title "NoName", before the first release, open as well.
const EARLIER_FORMATS = ['noname-sketch']

/** Whether a file's `format` is a sketch of this tool. */
export const isSketchFormat = (format) => format === SKETCH_FORMAT || EARLIER_FORMATS.includes(format)

export function createSketch(settings = {}) {
  return {
    format: SKETCH_FORMAT,
    version: SKETCH_VERSION,
    settings: {
      title: settings.title ?? '',
      // Every class, property and node URI lives under this address.
      base: settings.base ?? 'https://example.org/graph/',
      languages: settings.languages ?? { primary: 'de', additional: [] },
    },
    types: [],
    keys: {},
    bindings: [],
    attributes: [],
    relations: [],
    splits: [],
  }
}

// Short, stable ids: t1, b1, a1, r1 … never reused within a sketch.
function nextId(list, letter) {
  let max = 0
  for (const x of list) {
    const n = Number(String(x.id).slice(1))
    if (x.id?.[0] === letter && n > max) max = n
  }
  return `${letter}${max + 1}`
}

/** valueMap: values read as other values, for unit types the HME's five ({ Verfüllung: 'fill' }). */
export function addType(sketch, name, extra = {}) {
  const taken = new Set(sketch.types.map((t) => t.prefix))
  const type = { id: nextId(sketch.types, 't'), name, nameI18n: {}, prefix: typePrefix(name, taken), color: '', role: null, valueMap: null, ...extra }
  return [{ ...sketch, types: [...sketch.types, type] }, type.id]
}

export function setKey(sketch, tableId, column) {
  return { ...sketch, keys: { ...sketch.keys, [tableId]: column } }
}

export function bindColumn(sketch, tableId, column, typeId, labels = {}) {
  const binding = { id: nextId(sketch.bindings, 'b'), typeId, tableId, column, labels }
  return [{ ...sketch, bindings: [...sketch.bindings, binding] }, binding.id]
}

export function addAttribute(sketch, tableId, column, owner, { name = column, datatype = 'xsd:string' } = {}) {
  const attribute = { id: nextId(sketch.attributes, 'a'), tableId, column, owner, name, datatype }
  return [{ ...sketch, attributes: [...sketch.attributes, attribute] }, attribute.id]
}

export function addRelation(sketch, from, to, { name, inverseName = null, role = null, kind = null, kindValue = null, reverse = false } = {}) {
  const a = bindingById(sketch, from), b = bindingById(sketch, to)
  if (!a || !b) throw new Error('relation between unknown bindings')
  if (a.tableId !== b.tableId) throw new Error(`a relation connects columns of one table (${a.tableId} ≠ ${b.tableId}); merge a column instead`)
  const relation = { id: nextId(sketch.relations, 'r'), from, to, name: name ?? b.column, inverseName, role, kind, kindValue, reverse }
  return [{ ...sketch, relations: [...sketch.relations, relation] }, relation.id]
}

/**
 * Merge type `dropId` into type `keepId`: its columns now count as the kept type, equal values
 * become one node. The dropped type disappears.
 */
export function mergeTypes(sketch, keepId, dropId) {
  if (keepId === dropId || !keepId || !dropId) return sketch
  return {
    ...sketch,
    types: sketch.types.filter((t) => t.id !== dropId),
    bindings: sketch.bindings.map((b) => (b.typeId === dropId ? { ...b, typeId: keepId } : b)),
  }
}

/** Read a bound column as another type (a code column becomes a reference to that table's records). */
export function retypeBinding(sketch, bindingId, typeId) {
  return pruneTypes({ ...sketch, bindings: sketch.bindings.map((b) => (b.id === bindingId ? { ...b, typeId } : b)) })
}

export function removeAttribute(sketch, attributeId) {
  return { ...sketch, attributes: sketch.attributes.filter((a) => a.id !== attributeId) }
}

/** Forget how a table is read: its bindings, attributes, relations and the types left without columns. */
export function clearTable(sketch, tableId) {
  const gone = new Set(sketch.bindings.filter((b) => b.tableId === tableId).map((b) => b.id))
  return pruneTypes({
    ...sketch,
    bindings: sketch.bindings.filter((b) => !gone.has(b.id)),
    attributes: sketch.attributes.filter((a) => a.tableId !== tableId && !gone.has(a.owner)),
    relations: sketch.relations.filter((r) => !gone.has(r.from) && !gone.has(r.to)),
    splits: sketch.splits.filter((x) => x.tableId !== tableId),
  })
}

export function setSplit(sketch, tableId, column, separator) {
  const splits = sketch.splits.filter((x) => !(x.tableId === tableId && x.column === column))
  if (separator) splits.push({ tableId, column, separator })
  return { ...sketch, splits }
}

/** Types without any column are dropped. */
export function pruneTypes(sketch) {
  const used = new Set(sketch.bindings.map((b) => b.typeId))
  return { ...sketch, types: sketch.types.filter((t) => used.has(t.id)) }
}

export function setLabel(sketch, bindingId, lang, column) {
  return {
    ...sketch,
    bindings: sketch.bindings.map((b) => {
      if (b.id !== bindingId) return b
      const labels = { ...b.labels }
      if (column) labels[lang] = column
      else delete labels[lang]
      return { ...b, labels }
    }),
  }
}

// ─── reading ───

export const typeById = (sketch, id) => sketch.types.find((t) => t.id === id)
export const bindingById = (sketch, id) => sketch.bindings.find((b) => b.id === id)
export const bindingsOfType = (sketch, typeId) => sketch.bindings.filter((b) => b.typeId === typeId)
export const bindingAt = (sketch, tableId, column) => sketch.bindings.find((b) => b.tableId === tableId && b.column === column)
export const attributeAt = (sketch, tableId, column) => sketch.attributes.find((a) => a.tableId === tableId && a.column === column)

/** The binding on a table's key column: the type whose records the table holds. */
export const keyBinding = (sketch, tableId) => bindingAt(sketch, tableId, sketch.keys[tableId])

/** The binding on its table's key column, if the type has one: where the type's records live. */
export function homeBinding(sketch, typeId) {
  return bindingsOfType(sketch, typeId).find((b) => sketch.keys[b.tableId] === b.column) ?? null
}
