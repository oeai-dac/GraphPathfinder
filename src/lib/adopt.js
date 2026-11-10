/**
 * Tables added to a sketch somebody has already worked on.
 *
 * Reading everything again would throw away the work; reading the new tables alone would miss
 * what links them to the old ones. So the sketch for all tables is built (buildSketch), and only
 * its part about the new tables is taken over — with fresh ids, and with declared references to
 * old tables pointing at the types the old tables have now. Guesses between old and new come as
 * suggestions, as always.
 */

import { addAttribute, addRelation, addType, bindColumn, keyBinding, setKey, typeById } from './sketch'

export function adoptTables(current, built, tableIds) {
  const fresh = new Set(tableIds)
  let s = current
  const typeMap = new Map(), bindingMap = new Map()
  for (const id of tableIds) if (built.keys[id]) s = setKey(s, id, built.keys[id])

  const typeFor = (builtTypeId) => {
    if (typeMap.has(builtTypeId)) return typeMap.get(builtTypeId)
    // A type whose records live in an old table: the type that table has in the current sketch.
    const home = built.bindings.find((b) => b.typeId === builtTypeId && built.keys[b.tableId] === b.column)
    if (home && !fresh.has(home.tableId)) {
      const existing = keyBinding(s, home.tableId)?.typeId
      if (existing) { typeMap.set(builtTypeId, existing); return existing }
    }
    const t = typeById(built, builtTypeId)
    let id
    ;[s, id] = addType(s, t.name, { nameI18n: { ...t.nameI18n }, color: t.color, role: t.role })
    typeMap.set(builtTypeId, id)
    return id
  }

  for (const b of built.bindings.filter((b) => fresh.has(b.tableId))) {
    let id
    ;[s, id] = bindColumn(s, b.tableId, b.column, typeFor(b.typeId), { ...b.labels })
    bindingMap.set(b.id, id)
  }
  for (const a of built.attributes.filter((a) => fresh.has(a.tableId) && bindingMap.has(a.owner))) {
    ;[s] = addAttribute(s, a.tableId, a.column, bindingMap.get(a.owner), { name: a.name, datatype: a.datatype })
  }
  for (const r of built.relations.filter((r) => bindingMap.has(r.from) && bindingMap.has(r.to))) {
    ;[s] = addRelation(s, bindingMap.get(r.from), bindingMap.get(r.to), { name: r.name, inverseName: r.inverseName, role: r.role, kind: r.kind })
  }
  const splits = (built.splits ?? []).filter((x) => fresh.has(x.tableId))
  const languages = {
    primary: s.settings.languages.primary,
    additional: [...new Set([...s.settings.languages.additional, ...[built.settings.languages.primary, ...built.settings.languages.additional].filter((l) => l !== s.settings.languages.primary)])],
  }
  // Only tables that brought labels in a new language add it to the project.
  const usedLangs = new Set(s.bindings.flatMap((b) => Object.keys(b.labels ?? {})))
  languages.additional = languages.additional.filter((l) => current.settings.languages.additional.includes(l) || usedLangs.has(l))
  return { ...s, splits: [...(s.splits ?? []), ...splits], settings: { ...s.settings, languages } }
}
