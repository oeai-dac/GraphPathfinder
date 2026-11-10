/**
 * The one store the interface works through: the loaded tables and their statistics, the sketch
 * with its history (undo/redo), the suggestions, what is selected, and where the cards are.
 * Everything that decides anything lives in src/lib/; this file only keeps state and calls it.
 */
import { create } from 'zustand'
import { adoptTables } from './lib/adopt'
import { addTables, emptyCatalog } from './lib/catalog'
import { compile } from './lib/compile'
import { buildSketch } from './lib/defaultSketch'
import { explore } from './lib/explore'
import { layoutTables } from './lib/layout'
import { profileTable } from './lib/profile'
import { clearTable, isSketchFormat } from './lib/sketch'
import { bindSketch, readSketchFile, writeSketchFile } from './lib/sketchFile'
import { applySuggestion } from './lib/suggestions'
import { readSource } from './sources/index'

const AUTOSAVE_KEY = 'graphpathfinder:autosave:v1'
const HISTORY = 200

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const fileName = (title, suffix) => `${(title || 'graph').replace(/[\\/:*?"<>|]+/g, '_')}${suffix}`

// What a suggestion says, without its number or figures: the same guess after more tables arrive.
export const signature = (x) => JSON.stringify([x.kind, x.tableId, x.column, x.refTable, x.from, x.to, x.kindColumn, x.members, x.role, x.columns?.map((c) => c.column)])

/** Suggestions still worth showing: not dismissed, and applying them would change something. */
export const openSuggestions = (state) => state.suggestions.filter((x) => !state.dismissed.has(signature(x)) && applySuggestion(state.sketch, x) !== state.sketch)

// Browser storage is a convenience only: private windows and cleared site data lose it.
function readAutosave() {
  try { return JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? 'null') } catch { return null }
}
let autosaveTimer = null
function scheduleAutosave(get) {
  clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    const { sketch, catalog, layout, dismissed } = get()
    if (!catalog.tables.length) return
    try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(writeSketchFile(sketch, catalog, { layout, dismissed: [...dismissed] }))) } catch { /* full or blocked */ }
  }, 800)
}

const isSketchFile = (name, bytes) => {
  if (!/\.json$/i.test(name)) return null
  try {
    const json = JSON.parse(new TextDecoder().decode(bytes))
    return isSketchFormat(json?.format) ? json : null
  } catch { return null }
}

const linksOf = (sketch, suggestions) => [
  ...sketch.bindings.flatMap((b) => {
    const home = sketch.bindings.find((h) => h.typeId === b.typeId && sketch.keys[h.tableId] === h.column)
    return home && home.tableId !== b.tableId ? [[b.tableId, home.tableId]] : []
  }),
  ...suggestions.filter((x) => x.kind === 'reference').map((x) => [x.tableId, x.refTable]),
]

export const useStore = create((set, get) => ({
  catalog: emptyCatalog(),
  profiles: {},
  sketch: buildSketch(emptyCatalog()).sketch,
  past: [],
  future: [],
  suggestions: [],
  dismissed: new Set(),
  selection: null, // { kind: 'column', tableId, column } | { kind: 'type', typeId } | { kind: 'relation', ids } | { kind: 'table', tableId }
  layout: {},
  collapsed: new Set(),
  messages: [], // { level: 'info'|'warning'|'error', text }
  busy: false,
  pending: null, // a sketch file waiting for its tables
  restore: null, // an autosaved sketch that fits the loaded tables

  note(level, text) { set({ messages: [{ level, text }] }) },

  // ─── the sketch, with history ───
  commit(next) {
    const { sketch, past } = get()
    if (next === sketch) return
    set({ sketch: next, past: [...past, sketch].slice(-HISTORY), future: [] })
    scheduleAutosave(get)
  },
  edit(fn) {
    try { get().commit(fn(get().sketch)) } catch (e) { get().note('error', e.message) }
  },
  undo() {
    const { past, sketch, future } = get()
    if (!past.length) return
    set({ sketch: past.at(-1), past: past.slice(0, -1), future: [sketch, ...future] })
    scheduleAutosave(get)
  },
  redo() {
    const { past, sketch, future } = get()
    if (!future.length) return
    set({ sketch: future[0], past: [...past, sketch], future: future.slice(1) })
    scheduleAutosave(get)
  },

  // ─── tables ───
  async addFiles(files) {
    set({ busy: true })
    const messages = []
    const read = []
    let { catalog, profiles, pending } = get()
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const sketchFile = isSketchFile(file.name, bytes)
        if (sketchFile) { pending = sketchFile; continue }
        const { tables, warnings } = readSource(file.name, bytes)
        const before = catalog.tables.length
        catalog = addTables(catalog, tables)
        for (const t of catalog.tables.slice(before)) { profiles = { ...profiles, [t.id]: profileTable(t) }; read.push(t) }
        messages.push(...warnings.map((text) => ({ level: 'warning', text })))
      } catch (e) {
        messages.push({ level: 'error', text: `${file.name}: ${e.message}` })
      }
    }
    if (read.length) {
      const rows = read.reduce((n, t) => n + t.rows.length, 0)
      const list = read.length <= 3 ? `: ${read.map((t) => `${t.name} (${t.rows.length} rows)`).join(', ')}` : ''
      messages.unshift({ level: 'info', text: `Read ${read.length} table${read.length > 1 ? 's' : ''} with ${rows} rows${list}.` })
    }
    const fresh = read.map((t) => t.id)
    const hadTables = get().catalog.tables.length > 0
    const title = get().sketch.settings.title || (files.length === 1 && read.length ? files[0].name.replace(/\.[^.]+$/, '') : '')
    const built = buildSketch(catalog, { profiles, settings: { title, base: get().sketch.settings.base } })
    // The first tables start the sketch; later ones join the sketch as it is now.
    const sketch = hadTables ? adoptTables(get().sketch, built.sketch, fresh) : built.sketch
    const layout = { ...get().layout }
    const placed = layoutTables(catalog.tables.map((t) => ({ id: t.id, rows: t.columns.length })), linksOf(sketch, built.suggestions))
    if (!hadTables) Object.assign(layout, placed)
    else {
      // New cards below the existing ones.
      const bottom = Math.max(0, ...Object.values(layout).map((p) => p.y)) + 400
      const top = Math.min(...fresh.map((id) => placed[id]?.y ?? 0))
      for (const id of fresh) layout[id] = { x: placed[id].x, y: placed[id].y - top + bottom }
    }
    set({ catalog, profiles, messages, busy: false, suggestions: built.suggestions, layout, pending: null })
    if (sketch !== get().sketch) {
      if (hadTables) get().commit(sketch)
      else set({ sketch, past: [], future: [] })
    }
    if (pending) get().applySketchFile(pending)
    else if (!hadTables) {
      const saved = readAutosave()
      if (saved) {
        const bound = bindSketch(readSketchFile(saved), catalog)
        if (!bound.missing.length) set({ restore: { file: saved, savedAt: saved.savedAt } })
      }
    }
    scheduleAutosave(get)
  },

  removeTable(id) {
    const catalog = { ...get().catalog, tables: get().catalog.tables.filter((t) => t.id !== id) }
    const { [id]: _, ...profiles } = get().profiles
    const { [id]: __, ...layout } = get().layout
    const s = clearTable(get().sketch, id)
    const { [id]: ___, ...keys } = s.keys
    set({ catalog, profiles, layout, selection: null })
    get().commit({ ...s, keys })
  },

  reset() {
    set({
      catalog: emptyCatalog(), profiles: {}, messages: [], suggestions: [], dismissed: new Set(), selection: null,
      layout: {}, collapsed: new Set(), past: [], future: [], pending: null, restore: null, sketch: buildSketch(emptyCatalog()).sketch,
    })
  },

  // ─── canvas ───
  focus: null, // table ids to bring into view (search, a type clicked in the schema)
  setFocus(ids) { set({ focus: ids && ids.length ? [...ids] : null }) },
  select(selection) { set({ selection }) },
  moveTable(id, position) { set({ layout: { ...get().layout, [id]: position } }) },
  toggleCollapsed(id) {
    const collapsed = new Set(get().collapsed)
    if (collapsed.has(id)) collapsed.delete(id)
    else collapsed.add(id)
    set({ collapsed })
  },
  collapseAll(on) { set({ collapsed: on ? new Set(get().catalog.tables.map((t) => t.id)) : new Set() }) },
  arrange() {
    const { catalog, sketch, suggestions } = get()
    set({ layout: layoutTables(catalog.tables.map((t) => ({ id: t.id, rows: get().collapsed.has(t.id) ? 6 : t.columns.length })), linksOf(sketch, suggestions)) })
  },

  // ─── suggestions ───
  accept(id) {
    const x = get().suggestions.find((s) => s.id === id)
    if (x) get().commit(applySuggestion(get().sketch, x))
  },
  acceptAll(kind = null) {
    const list = openSuggestions(get()).filter((x) => !kind || x.kind === kind)
    get().commit(list.reduce(applySuggestion, get().sketch))
  },
  dismiss(id) {
    const x = get().suggestions.find((s) => s.id === id)
    if (x) { set({ dismissed: new Set([...get().dismissed, signature(x)]) }); scheduleAutosave(get) }
  },

  // ─── sketch file ───
  saveSketch() {
    const { sketch, catalog, layout, dismissed } = get()
    download(fileName(sketch.settings.title, '.sketch.json'), JSON.stringify(writeSketchFile(sketch, catalog, { layout, dismissed: [...dismissed] }), null, 1))
    get().note('info', 'Sketch saved. Open it again together with its tables.')
  },
  applySketchFile(json) {
    try {
      const file = readSketchFile(json)
      if (!get().catalog.tables.length) {
        set({ pending: json })
        get().note('info', `Sketch opened. Now load its tables: ${file.tables.map((t) => t.file || t.name).join(', ')}`)
        return
      }
      const bound = bindSketch(file, get().catalog)
      const layout = { ...get().layout }
      for (const [from, to] of bound.mapping) if (file.ui.layout?.[from]) layout[to] = file.ui.layout[from]
      set({ layout, dismissed: new Set(file.ui.dismissed ?? []), pending: null, restore: null })
      get().commit(bound.sketch)
      const notes = [...bound.missing.map((m) => ({ level: 'warning', text: `Table of the sketch not loaded: ${m}` })), ...bound.warnings.map((w) => ({ level: 'warning', text: w }))]
      set({ messages: [{ level: 'info', text: `Sketch applied to ${bound.mapping.size} table${bound.mapping.size === 1 ? '' : 's'}.` }, ...notes] })
    } catch (e) {
      get().note('error', e.message)
    }
  },
  restoreAutosave() {
    const r = get().restore
    if (r) get().applySketchFile(r.file)
  },
  discardAutosave() { set({ restore: null }) },

  // ─── exports ───
  exportGraphJson() {
    const { catalog, sketch } = get()
    try {
      const { json, diagnostics, report } = explore(catalog, sketch)
      download(fileName(sketch.settings.title, '-graph.json'), json)
      set({ messages: summary('Graph JSON', diagnostics, report) })
    } catch (e) {
      get().note('error', e.message)
    }
  },
  // For the OntoGraphNavigator and the Studio: rows on every node, as the Studio writes them.
  exportProject() {
    const { catalog, sketch } = get()
    try {
      const { project, report } = compile(catalog, sketch)
      download(fileName(sketch.settings.title, '-project.json'), JSON.stringify(project))
      set({ messages: summary('Project file', null, report) })
    } catch (e) {
      get().note('error', e.message)
    }
  },
}))

function summary(what, diagnostics, report) {
  const out = [{ level: 'info', text: `${what} written.` }]
  if (report.invisibleTypes.length) out.push({ level: 'warning', text: `Not in the graph, as they take part in no relation: ${report.invisibleTypes.join(', ')}` })
  for (const w of report.warnings) out.push({ level: 'warning', text: w })
  if (diagnostics?.typeCollisions.length) out.push({ level: 'warning', text: `${diagnostics.typeCollisions.length} values belong to two types at once` })
  if (diagnostics?.unpairable.length) out.push({ level: 'warning', text: `Edges without a way to pair rows: ${diagnostics.unpairable.join(', ')}` })
  return out
}
