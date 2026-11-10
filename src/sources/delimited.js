/**
 * CSV and TSV files. Quoted values may contain the separator, quotes and line breaks
 * ("Nail, iron, complete"); the separator is detected (, ; tab |) unless the file is .tsv.
 */
import Papa from 'papaparse'
import { tableFromGrid } from '../lib/catalog'
import { baseName, decodeText } from './text'

export function readDelimited(file, bytes, { delimiter } = {}) {
  const { text, encoding } = decodeText(bytes)
  const parsed = Papa.parse(text, { header: false, delimiter: delimiter ?? '', skipEmptyLines: 'greedy' })
  const warnings = []
  // A single column has no separator to detect; that is not an error.
  for (const e of parsed.errors.filter((e) => e.code !== 'UndetectableDelimiter').slice(0, 3)) {
    warnings.push(`${file}: row ${e.row + 1}: ${e.message}`)
  }
  const [header = [], ...body] = parsed.data
  const kind = delimiter === '\t' || parsed.meta.delimiter === '\t' ? 'tsv' : 'csv'
  const table = tableFromGrid({ name: baseName(file), source: { kind, file, encoding, delimiter: parsed.meta.delimiter }, header, body })
  return { tables: [table], warnings }
}
