// An invented excavation database of any size, for timing and for the heuristics at scale
// (the generator of spike S5): sites, sondages, units with geometry, finds, samples, a
// stratigraphic relation table and 44 lists that reference finds. Seeded: the same every run.
import { addTables, emptyCatalog, makeTable } from '../../src/lib/catalog'

export function syntheticCatalog(scale = 1) {
  let seed = 42
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  const pick = (a) => a[Math.floor(rnd() * a.length)]
  const WORDS = 'Lehm braun dunkel locker Holzkohle Ziegel Kiesel humos verdichtet Mörtel Asche Knochen Scherben Grube Pfosten Mauer Estrich Brandschicht Planierung Verfüllung'.split(' ')
  const text = (n) => Array.from({ length: n }, () => pick(WORDS)).join(' ')
  const MATERIALS = Array.from({ length: 30 }, (_, i) => ['Bronze', 'Eisen', 'Keramik', 'Glas', 'Knochen', 'Holz'][i % 6] + (i >= 6 ? ` ${i}` : ''))
  const PHASES = Array.from({ length: 20 }, (_, i) => `Phase ${String.fromCharCode(65 + i)}`)
  const pad = (n, w) => String(n).padStart(w, '0')
  const S = Math.round(20000 * scale), F = Math.round(60000 * scale), P = Math.round(10000 * scale), R = Math.round(30000 * scale)
  const T = {}
  T.Sites = Array.from({ length: 50 }, (_, i) => ({ site_id: `ST${pad(i, 3)}`, site_name: `Site ${i}`, notes: text(12) }))
  T.Sondages = Array.from({ length: 500 }, (_, i) => ({ sondage_id: `SO${pad(i, 4)}`, site_id: `ST${pad(i % 50, 3)}`, opened: `20${10 + (i % 15)}-0${1 + (i % 9)}-1${i % 9}` }))
  T.SE = Array.from({ length: S }, (_, i) => {
    const x = 600000 + (i % 500) * 3, y = 5300000 + Math.floor(i / 500) * 3
    return { se_id: `SE${pad(i, 6)}`, sondage_id: `SO${pad(i % 500, 4)}`, bezeichnung: `${pick(WORDS)} ${pick(WORDS)}`, beschreibung: text(18), phase: pick(PHASES), hoehe: (150 + rnd() * 10).toFixed(2), geom: `POLYGON ((${x} ${y}, ${x + 2} ${y}, ${x + 2} ${y + 2}, ${x} ${y + 2}, ${x} ${y}))` }
  })
  T.Funde = Array.from({ length: F }, (_, i) => ({ find_id: `F${pad(i, 7)}`, se_id: `SE${pad(Math.floor(rnd() * S), 6)}`, material: pick(MATERIALS), gewicht: (rnd() * 500).toFixed(1), datierung: String(-800 + Math.floor(rnd() * 2500)), beschreibung: text(8) }))
  T.Proben = Array.from({ length: P }, (_, i) => ({ probe_id: `P${pad(i, 6)}`, se_id: `SE${pad(Math.floor(rnd() * S), 6)}`, material: pick(MATERIALS), art: pick(['C14', 'Boden', 'Holz', 'Botanik']) }))
  T.SE_Rel = Array.from({ length: R }, () => { const a = Math.floor(rnd() * S); return { von: `SE${pad(a, 6)}`, nach: `SE${pad((a + 1 + Math.floor(rnd() * 5)) % S, 6)}`, art: pick(['über', 'über', 'unter', 'zeitgleich']) } })
  for (let k = 0; k < 44; k++) {
    T[`Liste_${pad(k, 2)}`] = Array.from({ length: Math.round(500 * scale) }, (_, i) => ({ id: `L${k}_${i}`, ref_find: `F${pad(Math.floor(rnd() * F), 7)}`, kategorie: `Kat ${i % 12}`, wert: (rnd() * 100).toFixed(3), notiz: text(5) }))
  }
  const tables = Object.entries(T).map(([name, rows]) => makeTable({ name, source: { kind: 'csv', file: `${name}.csv` }, columns: Object.keys(rows[0]).map((c) => ({ name: c, declared: null })), rows }))
  return addTables(emptyCatalog(), tables)
}
