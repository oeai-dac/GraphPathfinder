/**
 * Primary keys, unique indexes and relationships of an Access database (Jet4 / ACE).
 *
 * mdb-reader reads tables and rows but skips the index section of a table definition, so the
 * keys are read here from the table definition pages, by the layout mdbtools documents
 * (HACKING.md, Jet4):
 *   header 63 bytes | real-index counts 12·nReal | columns 25·nCols | column names
 *   | real indexes 52·nReal | logical indexes 28·nIdx | logical index names
 * Relationships (foreign keys) are rows of the system table MSysRelationships.
 * Checked in step 0 (S1, S6) against databases written by Access itself (ACE OLEDB): every
 * primary key, also composite, the unique index and all 13 relationships of the example.
 *
 * Pages are decoded here and not through mdb-reader's internal modules (not part of its API):
 * Jet4 files may be "encoded" with RC4 per page; ACE files are either plain or password-protected,
 * and a protected file never gets this far.
 */

const PAGE = 4096
const HEADER_KEY = [0xc7, 0xda, 0x39, 0x6b]

function rc4(key, data) {
  const S = new Uint8Array(256)
  for (let i = 0; i < 256; i++) S[i] = i
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff
    ;[S[i], S[j]] = [S[j], S[i]]
  }
  const out = new Uint8Array(data)
  for (let k = 0, i = 0, j = 0; k < out.length; k++) {
    i = (i + 1) & 0xff
    j = (j + S[i]) & 0xff
    ;[S[i], S[j]] = [S[j], S[i]]
    out[k] ^= S[(S[i] + S[j]) & 0xff]
  }
  return out
}

// Page n of the file, decoded. Throws for files whose keys cannot be read.
function pageReader(file) {
  const version = file[0x14]
  if (version === 0x00) throw new Error('Access 97 (Jet 3) file')
  // Bytes 0x18… of page 0 are always RC4-obfuscated with a fixed key; the page key sits at 0x3e.
  const header = rc4(HEADER_KEY, file.subarray(0x18, 0x18 + 128))
  const pageKey = header.subarray(0x3e - 0x18, 0x3e - 0x18 + 4)
  const encoded = pageKey.some((b) => b !== 0)
  const msisam = String.fromCharCode(...file.subarray(4, 19)) === 'MSISAM Database'
  if (encoded && version >= 0x02) throw new Error('encrypted file')
  return (n) => {
    const page = file.subarray(n * PAGE, (n + 1) * PAGE)
    if (!encoded || msisam || n === 0) return page
    return rc4(pageKey.map((b, i) => b ^ ((n >>> (8 * i)) & 0xff)), page)
  }
}

const utf16 = new TextDecoder('utf-16le')
const latin1 = new TextDecoder('windows-1252')
const text = (b) => (b[0] === 0xff && b[1] === 0xfe ? latin1.decode(b.subarray(2)) : utf16.decode(b))

/**
 * Indexes per table: primary key, unique and other indexes, with their columns in order.
 * @param {Uint8Array} file  the whole database file
 * @param {object} reader    an MDBReader for the same file
 * @returns {Map<string, Array<{ name, primary, unique, columns }>>}
 */
export function readAccessIndexes(file, reader) {
  const page = pageReader(file)

  // A table definition may run over several pages (linked by the "next page" field).
  function tdef(start) {
    const parts = []
    for (let p = start, first = true; p; first = false) {
      const buf = page(p)
      if (buf[0] !== 0x02) throw new Error(`page ${p} is not a table definition`)
      parts.push(first ? buf : buf.subarray(8))
      p = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(4, true)
    }
    const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0))
    let at = 0
    for (const b of parts) { out.set(b, at); at += b.length }
    return out
  }

  function indexesOf(start) {
    const b = tdef(start)
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
    const nCols = v.getUint16(45, true), nIdx = v.getInt32(47, true), nReal = v.getInt32(51, true)
    let pos = 63 + nReal * 12
    const cols = []
    for (let i = 0; i < nCols; i++) cols.push({ num: v.getUint16(pos + 5 + i * 25, true) })
    pos += nCols * 25
    for (let i = 0; i < nCols; i++) {
      const len = v.getUint16(pos, true)
      pos += 2
      cols[i].name = text(b.subarray(pos, pos + len))
      pos += len
    }
    // Real index: 4 bytes, 10 × (column number, order), used pages, first page, 4 bytes, flags
    // (0x01 unique), 5 bytes. The flags sit at 46 in files written by Access 2016 (.accdb and
    // .mdb alike: 0x89 primary key, 0x81 unique index, 0x80 plain index), not at 42 as in mdbtools' notes.
    const real = []
    for (let i = 0; i < nReal; i++) {
      const nums = []
      for (let k = 0; k < 10; k++) {
        const n = v.getUint16(pos + 4 + k * 3, true)
        if (n !== 0xffff) nums.push(n)
      }
      real.push({ nums, unique: (b[pos + 46] & 0x01) !== 0 })
      pos += 52
    }
    // Logical index: points to a real index; type 1 is the primary key, 2 the far side of a relationship.
    const logical = []
    for (let i = 0; i < nIdx; i++) {
      logical.push({ realNum: v.getInt32(pos + 8, true), type: b[pos + 23] })
      pos += 28
    }
    for (let i = 0; i < nIdx; i++) {
      const len = v.getUint16(pos, true)
      pos += 2
      logical[i].name = text(b.subarray(pos, pos + len))
      pos += len
    }
    const byNum = new Map(cols.map((c) => [c.num, c.name]))
    return logical.filter((l) => l.type !== 2).map((l) => ({
      name: l.name,
      primary: l.type === 1,
      unique: l.type === 1 || !!real[l.realNum]?.unique,
      columns: (real[l.realNum]?.nums ?? []).map((n) => byNum.get(n) ?? `#${n}`),
    }))
  }

  const objects = reader.getTable('MSysObjects').getData({ columns: ['Id', 'Name', 'Type'] })
  const out = new Map()
  for (const name of reader.getTableNames()) {
    const o = objects.find((r) => r.Name === name && (r.Type & 0x7f) === 1)
    if (o) out.set(name, indexesOf(o.Id & 0x00ffffff))
  }
  return out
}

/**
 * Relationships from MSysRelationships: one row per column, grouped by name, in column order.
 * @returns {Array<{ name, table, columns, refTable, refColumns }>}
 */
export function readAccessForeignKeys(reader) {
  if (!reader.getTableNames({ normalTables: false, systemTables: true }).includes('MSysRelationships')) return []
  const byName = new Map()
  for (const r of reader.getTable('MSysRelationships').getData()) {
    if (!byName.has(r.szRelationship)) byName.set(r.szRelationship, { name: r.szRelationship, table: r.szObject, refTable: r.szReferencedObject, cols: [] })
    byName.get(r.szRelationship).cols.push({ i: r.icolumn, col: r.szColumn, ref: r.szReferencedColumn })
  }
  return [...byName.values()].map((fk) => {
    fk.cols.sort((a, b) => a.i - b.i)
    return { name: fk.name, table: fk.table, columns: fk.cols.map((c) => c.col), refTable: fk.refTable, refColumns: fk.cols.map((c) => c.ref) }
  })
}
