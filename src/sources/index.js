/**
 * One entry for every source: a file's name and bytes in, catalog tables out.
 * Databases arrive as files too: Access (.accdb/.mdb) and PostgreSQL dumps in plain SQL;
 * SQLite/GeoPackage and a live connection later — each only adds a branch here.
 */
import { readAccess } from './access'
import { readDelimited } from './delimited'
import { readJson } from './json'
import { readPgDump } from './pgdump'
import { readWorkbook } from './workbook'

export const ACCEPTED = '.csv,.tsv,.tab,.txt,.xlsx,.xlsm,.xls,.ods,.json,.accdb,.mdb,.sql,.dump,.backup'

/** @returns {{ tables, warnings }} */
export function readSource(file, bytes) {
  const ext = file.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  if (ext === 'tsv' || ext === 'tab') return readDelimited(file, bytes, { delimiter: '\t' })
  if (ext === 'csv' || ext === 'txt') return readDelimited(file, bytes)
  if (['xlsx', 'xlsm', 'xls', 'ods'].includes(ext)) return readWorkbook(file, bytes)
  if (ext === 'json') return readJson(file, bytes)
  if (ext === 'accdb' || ext === 'mdb') return readAccess(file, bytes)
  // .dump and .backup are mostly pg_dump/pgAdmin archives; the reader says how to get plain SQL.
  if (['sql', 'dump', 'backup'].includes(ext)) return readPgDump(file, bytes)
  throw new Error(`${file}: not a file this tool reads (${ACCEPTED.replaceAll(',', ' ')})`)
}
