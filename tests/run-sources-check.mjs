// Sources: CSV/TSV (quoting, separators, encodings), workbooks (sheets, dates), JSON records.
import * as XLSX from 'xlsx'
import { readSource } from '../src/sources/index'
import { decodeText } from '../src/sources/text'
import { addTables, emptyCatalog } from '../src/lib/catalog'
import { bytesOf, done, eq, ok, section } from './check.mjs'

const table = (file, text) => readSource(file, typeof text === 'string' ? bytesOf(text) : text).tables[0]

section('CSV: quoting, separators, headers')
{
  const t = table('Finds.csv', 'id,description,weight\nF-1,"Nail, iron, complete",10.4\nF-2,"says ""hi""\nover two lines",\n\n,,\nF-3\n')
  eq(t.name, 'Finds', 'table named after the file')
  eq(t.columns.map((c) => c.name), ['id', 'description', 'weight'], 'header row')
  eq(t.rows.length, 3, 'empty rows dropped, short rows kept')
  eq(t.rows[0].description, 'Nail, iron, complete', 'separator inside quotes')
  eq(t.rows[1].description, 'says "hi"\nover two lines', 'doubled quotes and a line break inside quotes')
  eq(t.rows[2], { id: 'F-3', description: '', weight: '' }, 'a short row is filled with empty cells')
  eq(t.source.kind, 'csv', 'kind')

  const semi = table('Funde.csv', 'Nr;Gewicht;Material\n1;12,5;Bronze\n2;3,0;Eisen\n')
  eq(semi.columns.map((c) => c.name), ['Nr', 'Gewicht', 'Material'], 'semicolon detected')
  eq(semi.rows[0].Gewicht, '12,5', 'decimal comma kept as written')

  const tsv = table('SE.tsv', 'se\tnote\nSU1\ta, b; c\n')
  eq(tsv.rows[0].note, 'a, b; c', 'TSV: commas and semicolons are text')
  eq(tsv.source.kind, 'tsv', 'TSV kind')

  const dup = table('x.csv', ' id ,,id\n1,2,3\n')
  eq(dup.columns.map((c) => c.name), ['id', 'column_2', 'id (2)'], 'headers trimmed, empty and repeated headers named')
}

section('CSV: encodings')
{
  const latin1 = new Uint8Array([...bytesOf('se;bezeichnung\nSU1;Grubenverf'), 0xfc, ...bytesOf('llung\n')])
  eq(decodeText(latin1).encoding, 'windows-1252', 'invalid UTF-8 read as Windows-1252')
  eq(table('a.csv', latin1).rows[0].bezeichnung, 'Grubenverfüllung', 'umlaut from Windows-1252')
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytesOf('id,name\n1,Grubenverfüllung\n')])
  eq(table('b.csv', bom).columns[0].name, 'id', 'UTF-8 BOM not part of the first header')
  eq(table('b.csv', bom).rows[0].name, 'Grubenverfüllung', 'UTF-8 with BOM')
  eq(table('c.csv', 'id,name\n1,Grubenverfüllung\n').rows[0].name, 'Grubenverfüllung', 'UTF-8 without BOM')
}

section('Workbooks')
{
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['find_id', 'weight', 'found_on', 'complete'], ['F-1', 12.5, new Date(Date.UTC(2024, 6, 3)), true], ['F-2', 3, '', false]]), 'Finds')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['su_id'], ['SU1001']]), 'SU')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Empty')
  const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
  const { tables } = readSource('Grabung.xlsx', bytes)
  eq(tables.map((t) => t.name), ['Finds', 'SU'], 'one table per sheet with content, named after the sheet')
  eq(tables[0].rows[0], { find_id: 'F-1', weight: '12.5', found_on: '2024-07-03', complete: 'true' }, 'number, date and boolean as text')
  eq(tables[0].rows[1].found_on, '', 'empty cell')

  const one = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(one, XLSX.utils.aoa_to_sheet([['a'], ['1']]), 'Tabelle1')
  eq(readSource('Funde.xlsx', new Uint8Array(XLSX.write(one, { type: 'array', bookType: 'xlsx' }))).tables[0].name, 'Funde', 'a single sheet is named after the file')
}

section('JSON records')
{
  const t = table('finds.json', JSON.stringify([{ id: 'F-1', loc: { x: 1, y: 2 }, tags: ['a', 'b'], n: null }, { id: 'F-2', extra: true }]))
  eq(t.columns.map((c) => c.name), ['id', 'loc.x', 'loc.y', 'tags', 'n', 'extra'], 'nested objects flattened, columns of all records')
  eq(t.rows[0], { id: 'F-1', 'loc.x': '1', 'loc.y': '2', tags: 'a; b', n: '', extra: '' }, 'values as text, lists joined')
  const multi = readSource('dump.json', bytesOf(JSON.stringify({ finds: [{ id: 1 }], units: [{ id: 'SU1' }], meta: { v: 1 } }))).tables
  eq(multi.map((x) => x.name), ['finds', 'units'], 'every list of records in an object is a table')
  let threw = false
  try { readSource('x.json', bytesOf('{"a": 1}')) } catch { threw = true }
  ok(threw, 'JSON without records is rejected')
}

section('Catalog')
{
  let threw = false
  try { readSource('plan.pdf', new Uint8Array()) } catch { threw = true }
  ok(threw, 'unknown file type rejected')
  const a = table('Finds.csv', 'id\n1\n'), b = table('Finds.tsv', 'id\n2\n')
  const cat = addTables(addTables(emptyCatalog(), [a]), [b])
  eq(cat.tables.map((t) => t.id), ['Finds', 'Finds (2)'], 'table ids stay unique')
}

done('sources')
