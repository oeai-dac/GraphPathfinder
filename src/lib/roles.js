/**
 * The words of the Harris matrix: which columns name a phase, an object, a group or a unit type,
 * which column names say how two units lie ("liegt über", "cut by"), and how unit types map to
 * the five the Harris Matrix Editor draws (layer, deposit, fill, structure, interface).
 *
 * Roles are what the GraphExplorer and the OntoGraphNavigator recognise by CIDOC CRM property:
 *   phase       unit –P10 falls within→ phase        phase bands
 *   phaseOrder  phase –P120 occurs before→ phase      their order (else: by name)
 *   object      unit –P46i forms part of→ object     object frames
 *   group       object –P46i forms part of→ group    group frames
 *   unitType    unit –P2 has type→ unit type         the HME's symbols; named "Unit type" for OGN
 */
import { words } from './heuristics'

export const ROLES = [
  ['phase', 'phase (P10 falls within)'],
  ['phaseOrder', 'phase order (P120 occurs before)'],
  ['object', 'object (P46i forms part of)'],
  ['group', 'object group (P46i forms part of)'],
  ['unitType', 'unit type (P2 has type)'],
]

const PHASE = /(^|\s)(phase|phasen|periode|period|zeitstufe|epoche|horizont|bauphase|siedlungsphase)$/
const OBJECT = /(^|\s)(objekt|object|feature|struktur|structure|komplex|complex|bauwerk|anlage)$/
const GROUP = /(^|\s)(gruppe|group|objektgruppe|object group|objekt gruppe)$/
const UNIT_TYPE = /(unit ?type|einheitstyp|einheitentyp|se ?typ|su ?type|se ?art|art der (se|einheit)|schichttyp|stratigraphic type)/
// "next phase" — this phase occurs before that one; "previous phase" — that one occurs before this.
const NEXT = /(^|\s)(next|naechste|nächste|nachfolger|danach|later|juenger|jünger|before|vor|occurs before|folgephase)(\s|$)/
const PREVIOUS = /(^|\s)(previous|vorige|vorherige|vorgaenger|vorgänger|davor|earlier|aelter|älter|after|nach|occurs after|folgt auf)(\s|$)/

export const roleOfName = (column) => {
  const w = words(column)
  if (UNIT_TYPE.test(w)) return 'unitType'
  if (GROUP.test(w)) return 'group'
  if (PHASE.test(w)) return 'phase'
  if (OBJECT.test(w)) return 'object'
  return null
}

/** For a column of a phase table pointing at another phase: 'next', 'previous' or null. */
export function phaseOrderOfName(column) {
  const w = words(column)
  if (NEXT.test(w)) return 'next'
  if (PREVIOUS.test(w)) return 'previous'
  return null
}

// ─── how two units lie, from a column's name ───
// A column of a unit table listing other units: what that says about this row's unit.
// Longer phrases first: "überlagert von" before "überlagert", "gleichzeitig" before "gleich".
const RELATION_WORDS = [
  ['below', ['liegt unter', 'unter', 'unterhalb', 'ueberlagert von', 'überlagert von', 'ueberdeckt von', 'überdeckt von', 'geschnitten von', 'wird geschnitten von', 'verfuellt von', 'verfüllt von', 'below', 'under', 'underlies', 'covered by', 'cut by', 'filled by', 'abutted by']],
  ['above', ['liegt ueber', 'liegt über', 'ueber', 'über', 'oberhalb', 'ueberlagert', 'überlagert', 'ueberdeckt', 'überdeckt', 'schneidet', 'verfuellt', 'verfüllt', 'stoesst an', 'stößt an', 'above', 'over', 'overlies', 'covers', 'cuts', 'fills', 'abuts']],
  ['contemporary with', ['zeitgleich', 'zeitgleich mit', 'gleichzeitig', 'gleichzeitig mit', 'bindet ein', 'contemporary', 'contemporary with', 'bonded with']],
  ['equals', ['gleich', 'gleich mit', 'entspricht', 'identisch', 'identisch mit', 'equals', 'same as', 'equal to']],
]
const ALL_PHRASES = RELATION_WORDS.flatMap(([kind, list]) => list.map((p) => [p, kind])).sort((a, b) => b[0].length - a[0].length)

/** The Harris matrix relation a column name states ("liegt_über" → above), or null. */
export function relationOfName(column) {
  const w = words(column).replace(/\b(se|su|us|einheit|einheiten|unit|units|nr|no)\b/g, ' ').replace(/\s+/g, ' ').trim()
  for (const [phrase, kind] of ALL_PHRASES) if (w === phrase) return kind
  return null
}

// ─── unit types ───
export const HME_TYPES = ['layer', 'deposit', 'fill', 'structure', 'interface']
const HME_WORDS = {
  layer: ['layer', 'schicht', 'lage', 'stratum', 'horizont', 'planierung', 'planierschicht', 'nutzungsschicht', 'kulturschicht', 'humus'],
  deposit: ['deposit', 'ablagerung', 'deponierung', 'sediment', 'aufschüttung', 'aufschuettung', 'schuttschicht', 'versturz', 'brandschicht'],
  fill: ['fill', 'verfüllung', 'verfuellung', 'füllung', 'fuellung', 'grubenverfüllung', 'grubenverfuellung', 'auffüllung', 'auffuellung'],
  structure: ['structure', 'struktur', 'mauer', 'wall', 'fundament', 'estrich', 'pflaster', 'mauerwerk', 'konstruktion', 'bauteil', 'pfosten'],
  interface: ['interface', 'grenzfläche', 'grenzflaeche', 'schnitt', 'cut', 'grube', 'pit', 'eingriff', 'grabung', 'pfostengrube', 'negativ', 'interface/cut'],
}

/** The HME type a value stands for ("Verfüllung" → fill), or null. */
export function hmeTypeOf(value) {
  const v = String(value ?? '').trim().toLowerCase()
  if (!v) return null
  for (const [type, list] of Object.entries(HME_WORDS)) if (list.includes(v)) return type
  for (const [type, list] of Object.entries(HME_WORDS)) if (list.some((w) => w.length > 4 && v.includes(w))) return type
  return null
}

/** A mapping of the values to HME types, for the values that have one: { value: type }. */
export function hmeMapping(values) {
  const map = {}
  for (const v of values) {
    const t = hmeTypeOf(v)
    // "Interface" too: the GraphExplorer reads it either way, the OntoGraphNavigator lists both spellings.
    if (t && t !== String(v).trim()) map[v] = t
  }
  return map
}

export const UNIT_TYPE_NAME = 'Unit type'
export const isUnitTypeName = (name) => /unit.?type|einheitstyp/i.test(name)
