/**
 * JSON records: a list of objects, one row each, as database and API exports write them.
 * The list may also sit in a property ({ "finds": [ … ] }); every such list is a table.
 * Nested objects become dotted columns (location.x), lists of plain values one cell ("a; b").
 */
import { makeTable } from '../lib/catalog'
import { baseName, decodeText } from './text'

function flatten(value, prefix, out) {
  for (const [k, v] of Object.entries(value)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out)
    else if (Array.isArray(v)) out[key] = v.every((x) => x === null || typeof x !== 'object') ? v.filter((x) => x !== null).join('; ') : JSON.stringify(v)
    else out[key] = v
  }
  return out
}

const isRecordList = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object' && !Array.isArray(x))

function toTable(name, file, records) {
  const rows = records.map((r) => flatten(r, '', {}))
  const columns = []
  const seen = new Set()
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); columns.push({ name: k, declared: null }) }
  return makeTable({ name, source: { kind: 'json', file }, columns, rows })
}

export function readJson(file, bytes) {
  const data = JSON.parse(decodeText(bytes).text)
  if (isRecordList(data)) return { tables: [toTable(baseName(file), file, data)], warnings: [] }
  if (data && typeof data === 'object') {
    const lists = Object.entries(data).filter(([, v]) => isRecordList(v))
    if (lists.length) return { tables: lists.map(([k, v]) => toTable(lists.length === 1 ? baseName(file) : k, file, v)), warnings: [] }
  }
  throw new Error(`${file}: no list of records found (expected [ {…}, {…} ] or { "name": [ {…} ] })`)
}
