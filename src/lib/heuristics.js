/**
 * Guesses about single tables: which column is the key, which columns are labels (and in which
 * language), which become attributes and which types, and which cells hold several values.
 *
 * They decide from the column statistics (profile.js) and the column names. Names matter: an
 * integer "weight_g" is a measurement, an integer "sondage_no" a code; a column "name_de" is the
 * German label next to "name". Every guess here can be overridden in the sketch.
 */

// ─── names ───

/** "parent_site_id" → "parent site id"; "SE-Nummer" → "se nummer" */
export const words = (name) => String(name).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.\s]+/g, ' ').trim().toLowerCase()

/** "stratigraphic_unit" → "Stratigraphic unit", "SE_Rel" → "SE rel" (abbreviations keep their capitals) */
export function humanize(name) {
  const parts = String(name).replace(/([a-z])([A-Z])/g, '$1 $2').split(/[_\-.\s]+/).filter(Boolean)
    .map((p) => (/^[A-ZÄÖÜ0-9]{2,5}$/.test(p) ? p : p.toLowerCase()))
  const w = parts.join(' ')
  return w ? w[0].toUpperCase() + w.slice(1) : String(name)
}

/** A relation's name from the column it reads: "material_code" → "material", "su_id" → "su". */
export function relationName(column) {
  const w = words(column).replace(/^(fk|id|ref) /, '').replace(/ (id|code|key|fk|ref|nr|no|nummer)$/, '').trim()
  return w || words(column)
}

/** For comparing names across tables: lower case, without id/code/nr affixes and plural endings. */
export function nameStem(name) {
  return words(name)
    .replace(/^(fk|id|ref|tbl|tab|lkp|lookup|vocab|v) /, '')
    .replace(/ (id|ids|code|key|fk|ref|nr|no|nummer|number|liste|list|table|tabelle)$/, '')
    .replace(/(ies)$/, 'y').replace(/(ses|xes)$/, (m) => m.slice(0, -2)).replace(/([^s])s$/, '$1')
    .replace(/ /g, '')
}

const KEY_NAME = /(^|\s)(id|uuid|guid|key|pk|nr|no|nummer|number|code|inv|inventar|inventory)$|^(id|nr|no)(\s|$)/
const CODE_NAME = /(^|\s)(id|key|code|nr|no|nummer|number|typ|type|kategorie|category|klasse|class)$/
const MEASURE_NAME = /(^|\s)(jahr|year|datum|date|von|bis|from|to|start|end|begin|ende|anzahl|count|menge|amount|hoehe|höhe|tiefe|breite|laenge|länge|gewicht|weight|height|depth|width|length|area|flaeche|fläche|volume|volumen|elevation|dm|cm|mm|m|m2|m3|kg|g|percent|prozent|age|alter|top|bottom|x|y|z|lat|lon|long)$/
const LABEL_NAME = /(^|\s)(name|label|title|titel|bezeichnung|benennung|designation|caption|term|begriff|fullname|full name)$/
// Free text, whatever its values look like: short descriptions ("Nail, iron, complete") would
// otherwise pass for lists or vocabularies.
const TEXT_NAME = /(^|\s)(description|beschreibung|desc|notes?|notiz(en)?|bemerkung(en)?|anmerkung(en)?|comments?|kommentar|remarks?|text|info|freitext|befund(beschreibung)?)$/
// Two-letter languages a column may be suffixed with. Not "id" (Indonesian) or "no" (Norwegian):
// those suffixes are far more often identifiers and numbers.
const LANGS = ['de', 'en', 'fr', 'it', 'es', 'la', 'nl', 'cs', 'hu', 'sl', 'hr', 'pl', 'el', 'sk', 'ro']
const LANG_SUFFIX = new RegExp(`^(.*?)(?:[\\s_\\-.]+|\\s*[(\\[])(${LANGS.join('|')})[)\\]]?$`, 'i')

/** "name_de" → { base: "name", lang: "de" }, "Bezeichnung (EN)" → { base: "Bezeichnung", lang: "en" } */
export function languageSuffix(column) {
  const m = LANG_SUFFIX.exec(column.trim())
  return m && m[1] ? { base: m[1].trim(), lang: m[2].toLowerCase() } : null
}

// ─── keys ───

/** A column that could identify the records of its table. */
function keyCandidate(p) {
  return p.unique && p.wkt === 0 && p.maxLength <= 64 && p.avgLength <= 40 && !(p.numeric === 1 && p.integer < 1) && p.date < 0.5
}

/**
 * The key of a table: { column } for one column, { composite: [a, b] } for a pair, or
 * { column: '#row' } when nothing identifies a row (then the row number does).
 * weak: unique, but not named like an identifier — in a small table "von" can be unique by chance.
 */
export function detectKey(table, profile) {
  if (table.primaryKey.length === 1) return { column: table.primaryKey[0], declared: true }
  if (table.primaryKey.length > 1) return { composite: [...table.primaryKey], declared: true, column: '#row' }
  const stem = nameStem(table.name)
  let best = null
  table.columns.forEach((c, i) => {
    const p = profile[c.name]
    if (!keyCandidate(p)) return
    const w = words(c.name)
    let score = 0
    if (KEY_NAME.test(w)) score += 3
    if (stem && nameStem(c.name) === stem) score += 2
    if (LABEL_NAME.test(w)) score -= 2 // a unique name is a label, not an identifier
    score -= i * 0.1 // leftmost first
    if (!best || score > best.score) best = { column: c.name, score }
  })
  if (best) return { column: best.column, weak: best.score < 1.5 }
  // A pair that is unique together, e.g. the two columns of a junction table.
  const usable = table.columns.filter((c) => profile[c.name].filled === table.rows.length && profile[c.name].maxLength <= 64).slice(0, 8)
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const seen = new Set()
      let unique = true
      for (const r of table.rows) {
        const k = `${r[usable[i].name]}\u0000${r[usable[j].name]}`
        if (seen.has(k)) { unique = false; break }
        seen.add(k)
      }
      if (unique && table.rows.length > 1) return { composite: [usable[i].name, usable[j].name], column: '#row' }
    }
  }
  return { column: '#row' }
}

// ─── labels and languages ───

/**
 * The label columns of a table besides its key: by name ("name", "bezeichnung_de", "title"),
 * else a second unique short column (an inventory number next to an internal id) — only in a
 * table large enough for uniqueness to mean something, and never a reference or free text.
 * @param {Set<string>} references  columns that point to other tables
 * @returns {Array<{ column, lang: string|null }>}  lang null: no language suffix
 */
export function detectLabels(table, key, profile, references = new Set()) {
  const out = []
  for (const c of table.columns) {
    if (c.name === key || references.has(c.name)) continue
    const p = profile[c.name]
    if (!p.filled || p.wkt > 0 || p.avgLength > 80) continue
    const suffix = languageSuffix(c.name)
    const base = words(suffix ? suffix.base : c.name)
    if (LABEL_NAME.test(base)) out.push({ column: c.name, lang: suffix?.lang ?? null })
  }
  if (out.length || table.rows.length < 10) return out
  const alt = table.columns.find((c) => c.name !== key && !references.has(c.name) && !TEXT_NAME.test(words(c.name))
    && keyCandidate(profile[c.name]) && profile[c.name].numeric < 1)
  return alt ? [{ column: alt.name, lang: null }] : []
}

/**
 * Which language each label column is in, and the project's languages.
 * A column without suffix next to suffixed siblings is in the other one of German and English
 * ("name" beside "name_de" is English). The primary language is the best-filled one, German on a tie.
 * @param {Array<{ tableId, column, lang, filled, rows }>} labels  all label columns of all tables
 */
export function assignLanguages(labels, fallback = 'de') {
  const byTable = new Map()
  for (const l of labels) (byTable.get(l.tableId) ?? byTable.set(l.tableId, []).get(l.tableId)).push(l)
  for (const group of byTable.values()) {
    const suffixed = new Set(group.filter((l) => l.lang).map((l) => l.lang))
    for (const l of group.filter((l) => !l.lang)) {
      if (suffixed.size === 1 && suffixed.has('de')) l.lang = 'en'
      else if (suffixed.size === 1 && suffixed.has('en')) l.lang = 'de'
      else l.lang = null // decided below: the primary language
    }
  }
  const fill = new Map()
  for (const l of labels.filter((l) => l.lang)) fill.set(l.lang, (fill.get(l.lang) ?? 0) + l.filled / Math.max(1, l.rows))
  const ranked = [...fill.entries()].sort((a, b) => b[1] - a[1] || (a[0] === fallback ? -1 : b[0] === fallback ? 1 : 0))
  const primary = ranked[0]?.[0] ?? fallback
  for (const l of labels) l.lang ??= primary
  const additional = [...new Set(labels.map((l) => l.lang))].filter((x) => x !== primary).sort()
  return { primary, additional }
}

// ─── several values in one cell ───

const SEPARATORS = ['; ', ';', ' | ', '|', ', ']

/**
 * The separator of a column whose cells list several values ("Bronze; Eisen"), or null.
 * The parts have to be short and repeat across rows — a description with commas is not a list.
 * A comma only counts when nearly every listing cell uses it the same way (decimal commas and
 * prose make it unreliable), see the stricter thresholds.
 */
export function detectSplit(rows, column, p, { lists = false } = {}) {
  if (!p.filled || p.numeric > 0.5 || p.wkt > 0 || p.avgLength > 60 || TEXT_NAME.test(words(column))) return null
  // A column whose name says it lists units ("liegt über"): one list suffices, and unit numbers
  // need not repeat the way vocabulary values do.
  if (lists) {
    for (const sep of SEPARATORS) {
      let listing = 0, partLength = 0, partCount = 0
      for (const r of rows) {
        const ps = (r[column] ?? '').split(sep).map((x) => x.trim()).filter(Boolean)
        if (ps.length > 1) listing++
        for (const x of ps) { partLength += x.length; partCount++ }
      }
      if (listing >= 1 && partCount && partLength / partCount <= 30) return sep
    }
    return null
  }
  for (const sep of SEPARATORS) {
    let listing = 0
    const parts = new Map()
    let partLength = 0, partCount = 0
    for (const r of rows) {
      const v = r[column]
      if (!v) continue
      const ps = v.split(sep).map((x) => x.trim()).filter(Boolean)
      if (ps.length > 1) listing++
      for (const x of ps) { parts.set(x, (parts.get(x) ?? 0) + 1); partLength += x.length; partCount++ }
    }
    const share = listing / p.filled
    const repeat = partCount / Math.max(1, parts.size)
    const comma = sep === ', '
    if (listing >= 2 && share >= (comma ? 0.3 : 0.1) && partLength / partCount <= 30 && repeat >= (comma ? 3 : 1.5) && parts.size <= p.distinct) return sep
  }
  return null
}

// ─── attribute or type ───

/**
 * How a column reads by itself: { attribute: datatype } or { type: true }.
 * Columns that are keys, labels, foreign keys or empty are decided elsewhere.
 */
export function classifyColumn(column, p) {
  const d = column.declared
  const w = words(column.name)
  if (d === 'geometry' || p.wkt > 0.9) return { attribute: 'geo:wktLiteral' }
  if (TEXT_NAME.test(w) && p.numeric < 0.5) return { attribute: 'xsd:string' }
  if (d === 'boolean' || p.boolean > 0.95) return { attribute: 'xsd:boolean' }
  if (d === 'date' || p.date > 0.95) return { attribute: p.isoDate ? 'xsd:date' : 'xsd:string' }
  if (d === 'datetime') return { attribute: 'xsd:dateTime' }
  if (d === 'decimal' || (p.numeric > 0.95 && p.integer < 0.95)) return { attribute: 'xsd:decimal' }
  if (d === 'integer' || p.integer > 0.95) {
    if (MEASURE_NAME.test(w)) return { attribute: 'xsd:integer' }
    if (CODE_NAME.test(w)) return { type: true }
    // Few values, each many times: a category (phase 1–5), not a measurement.
    return p.distinct <= 20 && p.filled >= 3 * p.distinct ? { type: true } : { attribute: 'xsd:integer' }
  }
  if (p.maxLength > 120 || p.avgLength > 40) return { attribute: 'xsd:string' }
  if (p.filled > 20 && p.distinct / p.filled > 0.5) return { attribute: 'xsd:string' }
  // Measurements written as text ("10 × 10 m", "ca. 2 m"), when they do not repeat like a category
  // and are not identifiers (SU1002, TSP-1001-01), which contain digits too.
  if (p.digits > 0.8 && p.codeLike < 0.5 && p.distinct / p.filled > 0.3 && !CODE_NAME.test(w)) return { attribute: 'xsd:string' }
  return { type: true }
}
