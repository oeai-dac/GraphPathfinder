/**
 * PostgreSQL dumps in plain SQL (pg_dump's default format) → catalog tables with their keys.
 *
 * Reads what pg_dump writes: CREATE TABLE, ALTER TABLE … ADD CONSTRAINT (PRIMARY KEY, UNIQUE,
 * FOREIGN KEY), COPY … FROM stdin blocks and INSERT statements (--inserts, --column-inserts).
 * Everything else (functions, sequences, indexes, grants, views) is skipped. PostGIS geometries
 * arrive as hex EWKB and become WKT. Checked in step 0 against a real pg_dump 17.5 (S6): every
 * cell, key and foreign key of the example database.
 *
 * Why a dump and not a connection: the tool runs in the browser and research data never leaves
 * the computer; a live connection needs a local server (later). The archive formats (-Fc, -Ft,
 * pgAdmin's "Backup") are binary and are turned away with instructions.
 */
import { makeTable } from '../lib/catalog'
import { hexToBytes, wkbToWkt } from './wkb'
import { decodeText } from './text'

// ─── identifiers ───

function skipSpace(s, i) {
  while (s[i] === ' ' || s[i] === '\n' || s[i] === '\t' || s[i] === '\r') i++
  return i
}

function readIdent(s, i) {
  i = skipSpace(s, i)
  if (s[i] === '"') {
    let out = ''
    i++
    while (i < s.length) {
      if (s[i] === '"') { if (s[i + 1] === '"') { out += '"'; i += 2; continue } i++; break }
      out += s[i++]
    }
    return [out, i]
  }
  const m = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(s.slice(i, i + 200))
  return m ? [m[0], i + m[0].length] : [null, i]
}

// schema.name, each part optionally quoted. Without a schema, pg_dump means public.
function readQualified(s, i) {
  const [a, j] = readIdent(s, i)
  if (s[j] === '.') { const [b, k] = readIdent(s, j + 1); return { schema: a, name: b, end: k } }
  return { schema: 'public', name: a, end: j }
}

// "(a, "b c", d)" from position i on → [list, end]. Without a list: [[], i].
function readIdentList(s, i) {
  i = skipSpace(s, i)
  if (s[i] !== '(') return [[], i]
  i++
  const list = []
  while (i < s.length && s[i] !== ')') {
    const [id, j] = readIdent(s, i)
    if (id === null) { i++; continue }
    list.push(id)
    i = j
    while (s[i] === ' ' || s[i] === ',' || s[i] === '\n' || s[i] === '\r' || s[i] === '\t') i++
  }
  return [list, i + 1]
}

// Split "a, b(c, d), 'x,y'" at top-level commas.
function splitTopLevel(body) {
  const parts = []
  let depth = 0, quote = null, cur = ''
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (quote) {
      cur += c
      if (c === quote) { if (body[i + 1] === quote) { cur += body[++i]; continue } quote = null }
      continue
    }
    if (c === "'" || c === '"') { quote = c; cur += c; continue }
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

const CONSTRAINT_START = /^(CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|EXCLUDE)\b/i
const COLUMN_STOP = /\s(NOT\s+NULL|NULL|DEFAULT|CONSTRAINT|PRIMARY\s+KEY|REFERENCES|UNIQUE|CHECK|COLLATE|GENERATED)\b/i

// ─── values ───

// COPY text format: \N is NULL; backslash escapes; octal and hex escapes are bytes (UTF-8).
const SIMPLE = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' }
const utf8 = new TextDecoder('utf-8')

/** One field of a COPY line → its value (null for \N). */
export function unescapeCopy(field) {
  if (field === '\\N') return null
  if (!field.includes('\\')) return field
  let out = '', bytes = []
  const flush = () => { if (bytes.length) { out += utf8.decode(new Uint8Array(bytes)); bytes = [] } }
  for (let i = 0; i < field.length; i++) {
    const c = field[i]
    if (c !== '\\') { flush(); out += c; continue }
    const n = field[i + 1]
    if (/[0-7]/.test(n)) {
      const m = /^[0-7]{1,3}/.exec(field.slice(i + 1, i + 4))[0]
      bytes.push(parseInt(m, 8) & 0xff)
      i += m.length
    } else if (n === 'x' && /[0-9a-fA-F]/.test(field[i + 2])) {
      const m = /^[0-9a-fA-F]{1,2}/.exec(field.slice(i + 2, i + 4))[0]
      bytes.push(parseInt(m, 16))
      i += 1 + m.length
    } else {
      flush()
      out += SIMPLE[n] ?? n
      i++
    }
  }
  flush()
  return out
}

// The literals of one INSERT tuple: 'text', E'text', number, NULL, TRUE/FALSE, optional ::cast.
function parseValueList(s) {
  const out = []
  let i = 0
  while (i < s.length) {
    while (s[i] === ' ' || s[i] === ',' || s[i] === '\n' || s[i] === '\r') i++
    if (i >= s.length) break
    let val
    const escaped = (s[i] === 'E' || s[i] === 'e') && s[i + 1] === "'"
    if (escaped) i++
    if (s[i] === "'") {
      val = ''
      i++
      while (i < s.length) {
        if (s[i] === "'") { if (s[i + 1] === "'") { val += "'"; i += 2; continue } i++; break }
        if (escaped && s[i] === '\\') { val += SIMPLE[s[i + 1]] ?? s[i + 1]; i += 2; continue }
        val += s[i++]
      }
    } else {
      const m = /^[^,\s)]+/.exec(s.slice(i))[0]
      i += m.length
      val = /^null$/i.test(m) ? null : /^true$/i.test(m) ? 't' : /^false$/i.test(m) ? 'f' : m
    }
    if (s.startsWith('::', i)) {
      const m = /^::[A-Za-z_. "[\]()0-9]+?(?=,|$|\))/.exec(s.slice(i))
      i += m ? m[0].length : 2
    }
    out.push(val)
  }
  return out
}

// ─── types ───

// geometry(Point,4326), public.geometry, postgis.geography(…): PostGIS may live in any schema.
const GEOM = /^(?:"?[A-Za-z_][\w$]*"?\.)?(geometry|geography)(?:\(\s*([A-Za-z]+)\s*(?:,\s*(\d+))?\s*\))?/i

function classifyType(t) {
  const g = GEOM.exec(t)
  if (g) return { kind: 'geometry', srid: g[3] ? Number(g[3]) : null }
  if (/\[\]$/.test(t)) return { kind: 'array' }
  if (/^(smallint|integer|bigint|int\d?|serial|bigserial|smallserial)\b/i.test(t)) return { kind: 'integer' }
  if (/^(numeric|decimal|real|double precision|float\d?|money)\b/i.test(t)) return { kind: 'decimal' }
  if (/^boolean\b/i.test(t)) return { kind: 'boolean' }
  if (/^date\b/i.test(t)) return { kind: 'date' }
  if (/^(timestamp|time)\b/i.test(t)) return { kind: 'datetime' }
  if (/^bytea\b/i.test(t)) return { kind: 'binary' }
  return { kind: 'text' }
}

// ─── lines ───

// Line by line without splitting the whole text into an array first (dumps of 100+ MB).
function* linesOf(text) {
  let start = 0
  while (start < text.length) {
    let end = text.indexOf('\n', start)
    if (end < 0) end = text.length
    yield text.slice(start, end)
    start = end + 1
  }
}

// ─── the dump ───

/**
 * The dump as the database describes it: tables with schema, columns, keys and rows.
 * @param {Iterable<string>} lines
 * @returns {{ tables: Array<{ schema, name, columns, primaryKey, uniques, foreignKeys, rows }>, warnings: string[], dataOnly: boolean }}
 */
export function parsePgDump(lines) {
  const tables = new Map()
  const partitions = new Map()
  const warnings = []
  const binaryDropped = new Set()
  const key = (schema, name) => `${schema}.${name}`
  const table = (schema, name) => {
    const k = key(schema, name)
    if (!tables.has(k)) tables.set(k, { schema, name, columns: [], primaryKey: [], uniques: [], foreignKeys: [], rows: [] })
    return tables.get(k)
  }

  function onStatement(st) {
    const s = st.trim()
    let m
    if ((m = /^CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i.exec(s))) {
      const q = readQualified(s, m[0].length)
      const t = table(q.schema, q.name)
      t.defined = true
      const parent = /^\s*PARTITION\s+OF\s+/i.exec(s.slice(q.end))
      if (parent) {
        const p = readQualified(s, q.end + parent[0].length)
        partitions.set(key(q.schema, q.name), key(p.schema, p.name))
        return
      }
      const open = s.indexOf('(', q.end)
      if (open < 0) return
      let depth = 0, close = open
      for (let i = open; i < s.length; i++) {
        if (s[i] === '(') depth++
        if (s[i] === ')' && --depth === 0) { close = i; break }
      }
      for (const item of splitTopLevel(s.slice(open + 1, close))) {
        if (CONSTRAINT_START.test(item)) {
          const named = /^CONSTRAINT\s+("(?:[^"]|"")+"|\S+)\s+/i.exec(item)
          onConstraint(t, named ? item.slice(named[0].length) : item)
          continue
        }
        if (/^LIKE\s/i.test(item)) continue
        const [name, j] = readIdent(item, 0)
        if (name === null) continue
        const rest = item.slice(j).trim()
        const stop = COLUMN_STOP.exec(' ' + rest)
        const type = (stop ? rest.slice(0, stop.index) : rest).trim()
        t.columns.push({ name, type, ...classifyType(type) })
        if (/\bPRIMARY\s+KEY\b/i.test(rest)) t.primaryKey = [name]
        if (/\bUNIQUE\b/i.test(rest)) t.uniques.push([name])
        const ref = /\bREFERENCES\s+/i.exec(rest)
        if (ref) {
          const rq = readQualified(rest, ref.index + ref[0].length)
          t.foreignKeys.push({ columns: [name], refSchema: rq.schema, refTable: rq.name, refColumns: readIdentList(rest, rq.end)[0] })
        }
      }
      return
    }
    if ((m = /^ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?/i.exec(s))) {
      const q = readQualified(s, m[0].length)
      const rest = s.slice(q.end).trim()
      const c = /^ADD\s+CONSTRAINT\s+("(?:[^"]|"")+"|\S+)\s+/i.exec(rest)
      if (c) { onConstraint(table(q.schema, q.name), rest.slice(c[0].length)); return }
      const a = /^ATTACH\s+PARTITION\s+/i.exec(rest)
      if (a) {
        const child = readQualified(rest, a[0].length)
        partitions.set(key(child.schema, child.name), key(q.schema, q.name))
      }
      return
    }
    if ((m = /^COPY\s+/i.exec(s))) {
      const q = readQualified(s, m[0].length)
      const from = s.search(/\bFROM\b/i)
      const paren = s.indexOf('(', q.end)
      const cols = paren >= 0 && paren < from ? readIdentList(s, q.end)[0] : null
      if (!/FROM\s+stdin/i.test(s)) { warnings.push(`COPY from a file outside the dump left out: ${q.name}`); return }
      const t = table(q.schema, q.name)
      // A data-only dump (pg_dump -a) has no CREATE TABLE; the COPY column list is all there is.
      if (!t.defined && !t.columns.length && cols) t.columns = cols.map((name) => ({ name, type: '', kind: 'text' }))
      return { copy: { table: t, cols } }
    }
    if ((m = /^INSERT\s+INTO\s+/i.exec(s))) {
      const q = readQualified(s, m[0].length)
      const t = table(q.schema, q.name)
      const valuesAt = s.search(/\bVALUES\b/i)
      if (valuesAt < 0) return
      const paren = s.indexOf('(', q.end)
      const cols = paren >= 0 && paren < valuesAt ? readIdentList(s, q.end)[0] : t.columns.map((c) => c.name)
      for (const tuple of splitTopLevel(s.slice(valuesAt + 6).replace(/;\s*$/, ''))) {
        addRow(t, cols, parseValueList(tuple.trim().replace(/^\(/, '').replace(/\)$/, '')))
      }
    }
  }

  function onConstraint(t, def) {
    let m
    if ((m = /^PRIMARY\s+KEY\s*/i.exec(def))) { t.primaryKey = readIdentList(def, m[0].length)[0]; return }
    if ((m = /^UNIQUE\s*(?:NULLS\s+(?:NOT\s+)?DISTINCT\s*)?/i.exec(def))) { t.uniques.push(readIdentList(def, m[0].length)[0]); return }
    if ((m = /^FOREIGN\s+KEY\s*/i.exec(def))) {
      const [columns, j] = readIdentList(def, m[0].length)
      const ref = /REFERENCES\s+/i.exec(def.slice(j))
      if (!ref) return
      const rq = readQualified(def, j + ref.index + ref[0].length)
      t.foreignKeys.push({ columns, refSchema: rq.schema, refTable: rq.name, refColumns: readIdentList(def, rq.end)[0] })
    }
  }

  function addRow(t, cols, values) {
    const row = {}
    cols.forEach((c, i) => {
      let v = values[i] ?? null
      const col = t.columns.find((x) => x.name === c)
      if (v !== null && col?.kind === 'geometry') {
        try {
          v = wkbToWkt(hexToBytes(v)).wkt
        } catch (e) {
          warnings.push(`${t.name}.${c}: geometry not read (${e.message})`)
          v = null
        }
      }
      // Bytes (photos, scans) are no use in a graph and can be large.
      if (v !== null && col?.kind === 'binary') { binaryDropped.add(`${t.name}.${c}`); v = null }
      if (v !== null && col?.kind === 'boolean') v = v === 't' || v === 'true'
      row[c] = v
    })
    t.rows.push(row)
  }

  // Statement scanner: tracks quotes and dollar quotes across lines, skips -- comments.
  let buf = '', quote = null, dollar = null, copy = null, first = true
  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (first) {
      first = false
      // pg_dump -Fc and pgAdmin's "Backup" write a binary archive; only the plain format is SQL text.
      if (line.startsWith('PGDMP')) throw new Error(ARCHIVE_MESSAGE)
    }
    if (copy) {
      if (line === '\\.') { copy = null; continue }
      addRow(copy.table, copy.cols ?? copy.table.columns.map((c) => c.name), line.split('\t').map(unescapeCopy))
      continue
    }
    // psql meta-commands (\connect, \restrict/\unrestrict from pg_dump 17.6/16.10 on) are not SQL.
    if (!quote && !dollar && !buf.trim() && (line.startsWith('\\') || line.startsWith('--'))) continue
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (dollar) {
        if (line.startsWith(dollar, i)) { buf += dollar; i += dollar.length - 1; dollar = null } else buf += c
        continue
      }
      if (quote) {
        buf += c
        if (c === quote) { if (line[i + 1] === quote) { buf += line[++i]; continue } quote = null }
        continue
      }
      if (c === '-' && line[i + 1] === '-') break
      if (c === "'" || c === '"') { quote = c; buf += c; continue }
      if (c === '$') {
        const m = /^\$[A-Za-z_]*\$/.exec(line.slice(i, i + 64))
        if (m) { dollar = m[0]; buf += dollar; i += dollar.length - 1; continue }
      }
      if (c === ';') {
        const r = onStatement(buf)
        buf = ''
        if (r?.copy) { copy = r.copy; break }
        continue
      }
      buf += c
    }
    if (!copy) buf += '\n'
  }

  // Partitions hold the rows of their parent table.
  for (const [child, parent] of partitions) {
    const c = tables.get(child), p = tables.get(parent)
    if (c && p) { p.rows.push(...c.rows); tables.delete(child) }
  }
  for (const col of binaryDropped) warnings.push(`${col}: binary data (bytea) left out`)

  // Only tables the dump creates: extension tables (PostGIS spatial_ref_sys) come as a COPY block
  // without CREATE TABLE. A dump without any CREATE TABLE is a data-only dump.
  const all = [...tables.values()]
  const defined = all.filter((t) => t.defined)
  const dataOnly = defined.length === 0
  const kept = dataOnly ? all.filter((t) => t.columns.length && t.name !== 'spatial_ref_sys') : defined
  return { tables: kept.map(({ defined: _, ...t }) => t), warnings, dataOnly }
}

const ARCHIVE_MESSAGE = 'This is a pg_dump archive (custom format, -Fc, or a pgAdmin backup), not SQL text. '
  + 'Export the database as plain SQL instead: pg_dump --no-owner --no-privileges -f dump.sql <database>, '
  + 'or turn the archive into SQL: pg_restore -f dump.sql <archive>.'

/**
 * A plain-SQL pg_dump file → catalog tables with primary keys, unique keys and foreign keys.
 * Tables are named without their schema unless two schemas hold a table of the same name.
 * @returns {{ tables, warnings }}
 */
export function readPgDump(file, bytes) {
  if (String.fromCharCode(...bytes.subarray(0, 5)) === 'PGDMP') throw new Error(ARCHIVE_MESSAGE)
  const { text } = decodeText(bytes)
  if (/^\s*CREATE TABLE\s+(IF NOT EXISTS\s+)?`/im.test(text.slice(0, 1_000_000))) {
    throw new Error('This looks like a MySQL/MariaDB dump (`quoted` names). Only PostgreSQL dumps are read so far.')
  }
  const parsed = parsePgDump(linesOf(text))
  if (!parsed.tables.length) throw new Error('No tables found. This reads plain-SQL dumps from PostgreSQL (pg_dump).')
  const warnings = parsed.warnings.map((w) => `${file}: ${w}`)
  if (parsed.dataOnly) warnings.push(`${file}: a data-only dump (no CREATE TABLE): keys and references are guessed from the values`)

  // Plain names, qualified only where two schemas share one.
  const count = new Map()
  for (const t of parsed.tables) count.set(t.name, (count.get(t.name) ?? 0) + 1)
  const nameOf = new Map(parsed.tables.map((t) => [`${t.schema}.${t.name}`, count.get(t.name) > 1 && t.schema !== 'public' ? `${t.schema}.${t.name}` : t.name]))

  const tables = parsed.tables.map((t) => {
    const foreignKeys = []
    for (const fk of t.foreignKeys) {
      const refKey = `${fk.refSchema}.${fk.refTable}`
      const ref = parsed.tables.find((x) => `${x.schema}.${x.name}` === refKey)
      if (!ref) { warnings.push(`${file}: ${t.name}(${fk.columns.join(', ')}) refers to ${fk.refTable}, which is not in the dump`); continue }
      // REFERENCES without columns means the referenced table's primary key.
      foreignKeys.push({ columns: fk.columns, refTable: nameOf.get(refKey), refColumns: fk.refColumns.length ? fk.refColumns : ref.primaryKey })
    }
    return makeTable({
      name: nameOf.get(`${t.schema}.${t.name}`),
      source: { kind: 'pgdump', file, schema: t.schema, table: t.name },
      columns: t.columns.map((c) => (c.kind === 'geometry' && c.srid ? { name: c.name, declared: c.kind, srid: c.srid } : { name: c.name, declared: c.kind })),
      rows: t.rows,
      primaryKey: t.primaryKey,
      uniques: t.uniques,
      foreignKeys,
    })
  })
  return { tables, warnings }
}
