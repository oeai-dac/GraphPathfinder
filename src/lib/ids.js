/**
 * Identifiers: every type gets its own namespace.
 *
 * In the Studio and the OntoGraphNavigator a node *is* its URI: the same value in two tables
 * becomes one node, whatever its type. That is what merging columns relies on — and what
 * would also fuse "Holz" the material with "Holz" the sample kind, or find 1 with sample 1.
 * So each type gets a prefix of its own (se:SU1001, material:Holz), and only columns merged
 * into the same type share one.
 */

import { slugify } from '../core/keys'

// Prefixes the project file needs for itself.
const RESERVED = new Set(['xsd', 'geo', 'crm', 'rdf', 'rdfs', 'owl', 'skos', 'data', 'class', 'prop'])

/** A prefix for a new type: from its name, valid as a prefixed-name prefix, not yet taken. */
export function typePrefix(name, taken) {
  let base = slugify(name)
  if (!/^[a-z]/.test(base)) base = `t_${base}`
  let prefix = base
  for (let n = 2; RESERVED.has(prefix) || taken.has(prefix); n++) prefix = `${base}_${n}`
  return prefix
}

// What an IRI may not contain unescaped, plus "/" "#" "?" which would cut the local name.
// Letters beyond ASCII stay as they are (IRIs allow them): Grubenverfüllung, not Grubenverf%C3%BCllung.
const UNSAFE = /[\s<>"{}|\\^`%/#?[\]\u0000-\u001f\u007f]/gu

/** A cell value as the local part of an IRI. */
export function iriLocal(value) {
  return String(value).trim().replace(UNSAFE, (c) =>
    [...new TextEncoder().encode(c)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join(''))
}
