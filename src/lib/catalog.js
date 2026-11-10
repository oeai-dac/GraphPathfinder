/**
 * The catalog: the one shape every source delivers.
 *
 * A CSV file, an Excel workbook, an Access database, a SQLite file or a PostgreSQL dump all
 * end up as the same list of tables. Everything after the sources — statistics, heuristics,
 * the sketch, the compiler — only ever sees this shape, so a new source (a live database
 * later) is an addition and never a change.
 *
 *   Table {
 *     id           unique across the catalog (two files may both hold a sheet "Finds")
 *     name         as the source calls it
 *     source       { kind: 'csv'|'tsv'|'xlsx'|'json'|…, file }
 *     columns      [{ name, declared }]  declared: the database's type, or null (CSV)
 *     primaryKey   [column, …]  [] when the source declares none
 *     uniques      [[column, …], …]
 *     foreignKeys  [{ columns, refTable, refColumns }]  refTable is a table *id*
 *     rows         [{ column: value }]  every column present, every value a string
 *   }
 *
 * Values are strings because the Studio project file and the OntoGraphNavigator keep them as
 * strings; '' stands for an empty cell.
 */

/** A value as the project file will hold it. */
export function cellText(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return isoDate(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

// A date without a time of day stays a plain date: "2024-07-03", not "2024-07-03T00:00:00.000Z".
function isoDate(d) {
  if (Number.isNaN(d.getTime())) return ''
  const iso = d.toISOString()
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso
}

// Header cells become column names: trimmed, never empty, never twice the same.
function columnNames(headers) {
  const seen = new Map()
  return headers.map((h, i) => {
    let name = cellText(h).trim() || `column_${i + 1}`
    if (seen.has(name)) {
      let n = seen.get(name) + 1
      while (seen.has(`${name} (${n})`)) n++
      seen.set(name, n)
      name = `${name} (${n})`
    }
    seen.set(name, 1)
    return name
  })
}

/**
 * A table from a header row and value rows (arrays), as delimited files and sheets give them.
 * Rows that are empty in every cell are dropped; short rows are filled with ''.
 */
export function tableFromGrid({ name, source, header, body }) {
  const columns = columnNames(header)
  const rows = []
  for (const cells of body) {
    if (!cells.some((c) => cellText(c).trim() !== '')) continue
    const row = {}
    columns.forEach((c, i) => { row[c] = cellText(cells[i]) })
    rows.push(row)
  }
  return makeTable({ name, source, columns: columns.map((c) => ({ name: c, declared: null })), rows })
}

/** A table from row objects (databases, JSON); fills in every column on every row. */
export function makeTable({ name, source, columns, rows, primaryKey = [], uniques = [], foreignKeys = [] }) {
  const names = columns.map((c) => c.name)
  const normalized = rows.map((r) => {
    const row = {}
    for (const c of names) row[c] = cellText(r[c])
    return row
  })
  return { id: name, name, source, columns, primaryKey, uniques, foreignKeys, rows: normalized }
}

/**
 * Adds tables to a catalog. Table ids stay unique: a second "Finds" becomes "Finds (2)", and
 * foreign keys among the added tables follow the renaming.
 */
export function addTables(catalog, tables) {
  const taken = new Set(catalog.tables.map((t) => t.id))
  const renamed = new Map()
  const added = tables.map((t) => {
    let id = t.id
    for (let n = 2; taken.has(id); n++) id = `${t.id} (${n})`
    taken.add(id)
    renamed.set(t.id, id)
    return { ...t, id }
  })
  for (const t of added) {
    t.foreignKeys = t.foreignKeys.map((fk) => ({ ...fk, refTable: renamed.get(fk.refTable) ?? fk.refTable }))
  }
  return { ...catalog, tables: [...catalog.tables, ...added] }
}

export const emptyCatalog = () => ({ tables: [] })

export const tableById = (catalog, id) => catalog.tables.find((t) => t.id === id)
