/**
 * Excel and OpenDocument workbooks: every sheet with content is a table.
 * One sheet is named after the file ("Funde.xlsx" with "Tabelle1" → Funde); several sheets
 * after themselves, as the tables of a database would be.
 */
import * as XLSX from 'xlsx'
import { tableFromGrid } from '../lib/catalog'
import { baseName } from './text'

export function readWorkbook(file, bytes) {
  // cellDates: dates arrive as Date, not as Excel's day numbers (45476 for 2024-07-03).
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true })
  const sheets = wb.SheetNames
    .map((name) => ({ name, grid: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false }) }))
    .filter((s) => s.grid.length > 0)
  const tables = sheets.map((s) => {
    const [header = [], ...body] = s.grid
    return tableFromGrid({
      name: sheets.length === 1 ? baseName(file) : s.name,
      source: { kind: 'xlsx', file, sheet: s.name },
      header,
      body,
    })
  })
  return { tables, warnings: [] }
}
