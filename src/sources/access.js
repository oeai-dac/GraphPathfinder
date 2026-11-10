/**
 * Microsoft Access databases (.accdb from Access 2007 on, .mdb from Access 2000–2003) → catalog
 * tables with their primary keys, unique indexes and relationships.
 *
 * Rows come from mdb-reader (pure JavaScript, in the browser, nothing leaves the computer); keys
 * and relationships from accessKeys.js. Columns that hold files (OLE objects, attachments,
 * binary) are left out: they are no use in a graph and can be large. Not read yet:
 * password-protected .accdb files; Access 97 files are read without their keys.
 */
import { Buffer } from './bufferGlobal'
import MDBReader from 'mdb-reader'
import { makeTable } from '../lib/catalog'
import { readAccessForeignKeys, readAccessIndexes } from './accessKeys'

// mdb-reader's column types → the kinds the catalog notes as `declared`.
const KIND = {
  boolean: 'boolean', byte: 'integer', integer: 'integer', long: 'integer', bigint: 'integer',
  currency: 'decimal', float: 'decimal', double: 'decimal', numeric: 'decimal',
  datetime: 'datetime', datetimextended: 'datetime', text: 'text', memo: 'text', repid: 'text',
}
const LEFT_OUT = { ole: 'OLE object', binary: 'binary data', complex: 'attachment or multi-value field' }

const pad = (n) => String(n).padStart(2, '0')

// Access keeps wall-clock time without a time zone; mdb-reader hands it over as if it were UTC.
// A date stays a date, a time of day (stored on 1899-12-30) stays a time.
function dateText(d) {
  if (Number.isNaN(d.getTime())) return ''
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  if (time === '00:00:00') return date
  return date === '1899-12-30' ? time : `${date} ${time}`
}

function valueText(v, type) {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return dateText(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  // Single precision: 0.1 is stored as 0.10000000149011612; Access shows 7 significant digits.
  if (type === 'float' && typeof v === 'number') return String(Number(v.toPrecision(7)))
  return String(v)
}

function open(file, bytes) {
  try {
    return new MDBReader(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  } catch (e) {
    if (/password|encrypt/i.test(e.message)) {
      throw new Error('The database is password-protected. Encrypted Access files cannot be read yet: '
        + 'in Access, remove the password (File → Info → Decrypt Database) and load a copy.')
    }
    throw new Error(`not readable as an Access database (${e.message})`)
  }
}

/** @returns {{ tables, warnings }} */
export function readAccess(file, bytes) {
  const reader = open(file, bytes)
  const warnings = []
  const names = reader.getTableNames()

  // A split database: the "front end" holds forms and links, the tables live in the "back end".
  const linked = reader.getTableNames({ normalTables: false, linkedTables: true })
  const linkedNote = linked.length
    ? `${linked.length} linked table${linked.length > 1 ? 's' : ''} (${linked.length <= 5 ? linked.join(', ') : `${linked.slice(0, 5).join(', ')} …`}) `
      + `live${linked.length > 1 ? '' : 's'} in another file. Load the database they link to (often the "back end" file).`
    : ''
  if (!names.length) throw new Error(linked.length ? `no tables of its own: ${linkedNote}` : 'no tables found')
  if (linked.length) warnings.push(`${file}: ${linkedNote}`)

  let indexes = new Map()
  try {
    indexes = readAccessIndexes(bytes, reader)
  } catch (e) {
    warnings.push(`${file}: primary keys not read (${e.message}); keys are guessed from the values`)
  }
  let relationships = []
  try {
    relationships = readAccessForeignKeys(reader)
  } catch (e) {
    warnings.push(`${file}: relationships not read (${e.message}); references are guessed from the values`)
  }

  const tables = []
  for (const name of names) {
    const t = reader.getTable(name)
    const all = t.getColumns()
    const kept = all.filter((c) => !LEFT_OUT[c.type])
    for (const c of all.filter((c) => LEFT_OUT[c.type])) warnings.push(`${file}: ${name}.${c.name}: ${LEFT_OUT[c.type]} left out`)
    const typeOf = new Map(kept.map((c) => [c.name, c.type]))
    const rows = t.getData({ columns: kept.map((c) => c.name) }).map((r) => {
      const row = {}
      for (const c of kept) row[c.name] = valueText(r[c.name], typeOf.get(c.name))
      return row
    })
    const keptNames = new Set(kept.map((c) => c.name))
    const idx = indexes.get(name) ?? []
    const covered = (cols) => cols.length > 0 && cols.every((c) => keptNames.has(c))
    const primaryKey = idx.find((i) => i.primary)?.columns ?? []
    const uniques = []
    for (const i of idx.filter((i) => i.unique && !i.primary && covered(i.columns))) {
      if (!uniques.some((u) => u.join('\u0000') === i.columns.join('\u0000'))) uniques.push(i.columns)
    }
    const foreignKeys = relationships
      .filter((r) => r.table === name && names.includes(r.refTable) && covered(r.columns))
      .map((r) => ({ columns: r.columns, refTable: r.refTable, refColumns: r.refColumns }))
    tables.push(makeTable({
      name,
      source: { kind: 'access', file, table: name },
      columns: kept.map((c) => ({ name: c.name, declared: KIND[c.type] ?? 'text' })),
      rows,
      primaryKey: covered(primaryKey) ? primaryKey : [],
      uniques,
      foreignKeys,
    }))
  }
  return { tables, warnings }
}
