/**
 * WKB, EWKB (PostGIS) and GeoPackage geometry blobs → WKT.
 *
 * The GraphExplorer's map and 3D view read WKT only, so every binary geometry from a database
 * is turned into text before it reaches the catalog. Checked against GDAL in step 0 (S2, S3):
 * all 246 geometries of the GraphExplorer example structurally identical.
 */

const BASE = { 1: 'POINT', 2: 'LINESTRING', 3: 'POLYGON', 4: 'MULTIPOINT', 5: 'MULTILINESTRING', 6: 'MULTIPOLYGON', 7: 'GEOMETRYCOLLECTION' }
const EWKB_Z = 0x80000000, EWKB_M = 0x40000000, EWKB_SRID = 0x20000000

/** Bytes from a hex string (PostGIS dumps write EWKB as hex). */
export function hexToBytes(hex) {
  const out = new Uint8Array(hex.length >> 1)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16)
  return out
}

/** @returns {{ wkt: string, srid: number|null }} */
export function wkbToWkt(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 0
  let srid = null

  const fmt = (n) => (Number.isNaN(n) ? 'NaN' : String(n))

  function readGeometry() {
    const le = view.getUint8(pos) === 1
    pos += 1
    let code = view.getUint32(pos, le)
    pos += 4
    let hasZ = false, hasM = false
    // EWKB keeps Z/M/SRID in the high bits, ISO WKB adds 1000/2000/3000 to the type.
    if (code & EWKB_Z) hasZ = true
    if (code & EWKB_M) hasM = true
    if (code & EWKB_SRID) { srid = view.getInt32(pos, le); pos += 4 }
    code &= 0x0fffffff
    if (code >= 3000) { hasZ = hasM = true; code -= 3000 } else if (code >= 2000) { hasM = true; code -= 2000 } else if (code >= 1000) { hasZ = true; code -= 1000 }
    const type = BASE[code]
    if (!type) throw new Error(`unsupported WKB geometry type ${code}`)
    const dims = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0)
    const tag = type + (hasZ && hasM ? ' ZM' : hasZ ? ' Z' : hasM ? ' M' : '')

    const point = () => {
      const c = []
      for (let d = 0; d < dims; d++) { c.push(view.getFloat64(pos, le)); pos += 8 }
      return c
    }
    const count = () => {
      const n = view.getUint32(pos, le)
      pos += 4
      return n
    }
    const list = (read) => {
      const n = count()
      const out = []
      for (let i = 0; i < n; i++) out.push(read())
      return out
    }
    const coords = (pts) => pts.map((p) => p.map(fmt).join(' ')).join(', ')

    switch (type) {
      case 'POINT': {
        const p = point()
        return p.every(Number.isNaN) ? `${tag} EMPTY` : `${tag} (${p.map(fmt).join(' ')})`
      }
      case 'LINESTRING': {
        const pts = list(point)
        return pts.length ? `${tag} (${coords(pts)})` : `${tag} EMPTY`
      }
      case 'POLYGON': {
        const rings = list(() => list(point))
        return rings.length ? `${tag} (${rings.map((r) => `(${coords(r)})`).join(', ')})` : `${tag} EMPTY`
      }
      default: {
        // Multi* and collections nest full geometries (each with its own byte order and type).
        const subs = list(readGeometry)
        if (!subs.length) return `${tag} EMPTY`
        if (type === 'GEOMETRYCOLLECTION') return `${tag} (${subs.join(', ')})`
        // Strip the member's own type word: MULTIPOLYGON ((…)), not MULTIPOLYGON (POLYGON (…)).
        return `${tag} (${subs.map((s) => s.replace(/^[A-Z]+( ZM| Z| M)? /, '')).join(', ')})`
      }
    }
  }

  const wkt = readGeometry()
  return { wkt, srid }
}

/**
 * GeoPackage binary: "GP", version, flags, srs_id, optional envelope, then standard WKB.
 * http://www.geopackage.org/spec/#gpb_format — for the SQLite/GeoPackage source that follows.
 */
export function gpkgToWkt(bytes) {
  if (bytes[0] !== 0x47 || bytes[1] !== 0x50) throw new Error('not a GeoPackage geometry blob')
  const flags = bytes[3]
  const le = (flags & 0x01) === 1
  const envelope = [0, 32, 48, 48, 64][(flags >> 1) & 0x07]
  if (envelope === undefined) throw new Error('invalid GeoPackage envelope indicator')
  const srid = new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getInt32(0, le)
  const { wkt } = wkbToWkt(bytes.subarray(8 + envelope))
  return { wkt, srid }
}
