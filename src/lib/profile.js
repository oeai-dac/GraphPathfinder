/**
 * Column statistics: what the heuristics decide from.
 *
 * Computed once per column when a table arrives, never while the sketch changes — with
 * 50 tables and several hundred thousand rows a pass over every cell costs a fraction of a
 * second, but not on every click.
 */

const NUMBER = /^[+-]?(\d+([.,]\d+)?|[.,]\d+)$/
const INTEGER = /^[+-]?\d+$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/
const DOTTED_DATE = /^\d{1,2}\.\d{1,2}\.\d{2,4}$/
const BOOLEAN = /^(true|false|yes|no|ja|nein|wahr|falsch)$/i
const WKT = /^\s*(SRID=\d+;\s*)?(MULTI)?(POINT|LINESTRING|POLYGON|GEOMETRYCOLLECTION|CIRCULARSTRING|COMPOUNDCURVE|CURVEPOLYGON)\b/i
// Identifiers: letters, then numbers in groups — SU1002, TSP-1001-01, F-3, SO1/2.
const CODE = /^[A-Za-zÄÖÜäöü]{1,8}[-_ ]?\d+([-_./]\d+)*[A-Za-z]?$/

/**
 * @returns {{ rows, filled, distinct, unique, numeric, integer, date, isoDate, boolean, wkt, digits, codeLike, maxLength, avgLength, samples }}
 *   numeric … codeLike are shares of the filled cells (0–1); isoDate: share of the dates written
 *   as ISO (2024-07-03, not 03.07.2024); digits: values with a digit anywhere ("10 × 10 m");
 *   codeLike: values shaped like identifiers (SU1002, TSP-1001-01);
 *   unique: every row filled, no value twice.
 */
export function profileColumn(rows, column) {
  const values = new Set()
  let filled = 0, numeric = 0, integer = 0, date = 0, iso = 0, boolean = 0, wkt = 0, digits = 0, codeLike = 0, maxLength = 0, totalLength = 0
  for (const row of rows) {
    const v = row[column]
    if (v === '' || v === undefined) continue
    filled++
    values.add(v)
    totalLength += v.length
    if (v.length > maxLength) maxLength = v.length
    if (v.length > 200) {
      // Long values are text or geometry; the number and date tests would only waste time.
      if (WKT.test(v)) wkt++
      continue
    }
    if (/\d/.test(v)) { digits++; if (CODE.test(v)) codeLike++ }
    if (NUMBER.test(v)) { numeric++; if (INTEGER.test(v)) integer++ }
    else if (ISO_DATE.test(v)) { date++; iso++ }
    else if (DOTTED_DATE.test(v)) date++
    else if (BOOLEAN.test(v)) boolean++
    else if (WKT.test(v)) wkt++
  }
  const share = (n) => (filled ? n / filled : 0)
  return {
    rows: rows.length,
    filled,
    distinct: values.size,
    unique: filled === rows.length && values.size === filled && filled > 0,
    numeric: share(numeric),
    integer: share(integer),
    date: share(date),
    isoDate: date ? iso / date : 0,
    boolean: share(boolean),
    wkt: share(wkt),
    digits: share(digits),
    codeLike: share(codeLike),
    maxLength,
    avgLength: filled ? totalLength / filled : 0,
    samples: [...values].slice(0, 5),
  }
}

/** Statistics for every column of a table: { [column]: stats } */
export function profileTable(table) {
  return Object.fromEntries(table.columns.map((c) => [c.name, profileColumn(table.rows, c.name)]))
}
