// model.json → the same example as plain tables: one CSV per table (serpents_meadow_tables/)
// and one workbook with a sheet per table (serpents_meadow.xlsx). The way a project keeps its
// data when there is no database.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as XLSX from 'xlsx'

const here = new URL('./', import.meta.url)
const { tables } = JSON.parse(readFileSync(new URL('model.json', here), 'utf8'))

// RFC 4180: quote a value holding the separator, a quote or a line break; double the quotes.
const field = (v) => {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const dir = new URL('../serpents_meadow_tables/', here)
mkdirSync(dir, { recursive: true })
const wb = XLSX.utils.book_new()
for (const t of tables) {
  const names = t.columns.map((c) => c.name)
  const lines = [names.join(','), ...t.rows.map((r) => names.map((n) => field(r[n])).join(','))]
  writeFileSync(new URL(`${t.name}.csv`, dir), lines.join('\n') + '\n')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([names, ...t.rows.map((r) => names.map((n) => r[n] ?? ''))]), t.name)
}
writeFileSync(new URL('../serpents_meadow.xlsx', here), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
console.log(`${tables.length} CSV files in serpents_meadow_tables/, serpents_meadow.xlsx with ${tables.length} sheets`)
