/**
 * The settings of what is selected: a column (how it is read), a table (its key, rows as records
 * or edges), a type (its names), a relation (name, inverse, kind, its role in the Harris matrix)
 * — or, with nothing selected, the project (title, address, languages).
 */
import { useEffect, useState } from 'react'
import {
  makeKey, readingOf, removeRelation, renameType, rowsAsEdges, setReading, setRole, setSettings, setValueMap, unmerge, updateRelation,
} from '../lib/edit'
import { HME_TYPES, hmeMapping, ROLES } from '../lib/roles'
import { bindingById, homeBinding, keyBinding, setSplit, typeById } from '../lib/sketch'
import { STRATIGRAPHIC } from '../lib/suggestions'
import { useStore } from '../store'
import { DATATYPES, readingText } from './readings'

/** A text field that commits on Enter or when it loses focus — one undo step per change, not per key. */
function TextField({ value, onCommit, placeholder, className = '' }) {
  const [text, setText] = useState(value ?? '')
  useEffect(() => setText(value ?? ''), [value])
  const commit = () => { if (text !== (value ?? '')) onCommit(text) }
  return (
    <input className={`text ${className}`} value={text} placeholder={placeholder}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setText(value ?? ''); e.target.blur() } }} />
  )
}

const Field = ({ label, children }) => <label className="field"><span>{label}</span>{children}</label>

const KINDS = ['above', 'below', 'contemporary with', 'equals']

/** The values of a binding's column, parts of split cells one by one. */
function valuesOf(sketch, catalog, binding, limit = 60) {
  const table = catalog.tables.find((t) => t.id === binding.tableId)
  const separator = (sketch.splits ?? []).find((x) => x.tableId === binding.tableId && x.column === binding.column)?.separator
  const values = new Set()
  for (const row of table?.rows ?? []) {
    const v = row[binding.column]
    for (const part of separator ? v.split(separator.trim()) : [v]) if (part.trim()) values.add(part.trim())
    if (values.size > limit) break
  }
  return [...values]
}

/** Unit types: each value of the column as one of the five the Harris Matrix Editor draws. */
function ValueMapFields({ type, values }) {
  const edit = useStore((s) => s.edit)
  const map = type.valueMap ?? {}
  const set = (value, to) => {
    const next = { ...map }
    if (to) next[value] = to
    else delete next[value]
    edit((s) => setValueMap(s, type.id, next))
  }
  return (
    <div className="value-map">
      <span className="muted">Each value as a unit type of the Harris Matrix Editor:</span>
      {values.map((v) => (
        <label key={v} className="value-row"><span>{v}</span>
          <select value={map[v] ?? ''} onChange={(e) => set(v, e.target.value)}>
            <option value="">{HME_TYPES.includes(v) ? v : '— as it is —'}</option>
            {HME_TYPES.filter((x) => x !== v).map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
      ))}
    </div>
  )
}

/** The relation's role in the Harris matrix: phase, phase order, object, group, unit type; or the kind every edge of a column has. */
function MatrixFields({ relation }) {
  const sketch = useStore((s) => s.sketch)
  const catalog = useStore((s) => s.catalog)
  const edit = useStore((s) => s.edit)
  const from = bindingById(sketch, relation.from)
  const to = bindingById(sketch, relation.to)
  if (!from || !to || relation.kind) return null
  const type = typeById(sketch, to.typeId)
  const role = relation.role ?? ''
  // Between records of one type (unit → unit): a stratigraphic column, every edge of one kind.
  if (from.typeId === to.typeId && !role) {
    return (
      <Field label="Every edge of this column is (Harris matrix)">
        <select value={relation.kindValue ?? ''} onChange={(e) => edit((s) => updateRelation(s, relation.id, e.target.value ? { kindValue: e.target.value, name: STRATIGRAPHIC } : { kindValue: null }))}>
          <option value="">— not stratigraphic —</option>
          {KINDS.map((k) => <option key={k}>{k}</option>)}
        </select>
      </Field>
    )
  }
  const chooseRole = (next) => edit((s) => setRole(s, relation.id, next || null,
    next === 'unitType' ? { valueMap: type?.valueMap ?? hmeMapping(valuesOf(s, catalog, to)) } : {}))
  return (
    <>
      <Field label="Role in the Harris matrix">
        <select value={role} onChange={(e) => chooseRole(e.target.value)}>
          <option value="">— none —</option>
          {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      {role === 'phaseOrder' && (
        <label className="check"><input type="checkbox" checked={!!relation.reverse} onChange={(e) => edit((s) => setRole(s, relation.id, 'phaseOrder', { reverse: e.target.checked }))} /> the column names the phase before, not the next</label>
      )}
      {role === 'unitType' && type && <ValueMapFields type={type} values={valuesOf(sketch, catalog, to)} />}
    </>
  )
}

function RelationFields({ relation, tableColumns }) {
  const edit = useStore((s) => s.edit)
  const up = (patch) => edit((s) => updateRelation(s, relation.id, patch))
  return (
    <div className="relation">
      <Field label="Edge name"><TextField value={relation.name} onCommit={(name) => up({ name })} /></Field>
      <Field label="Read backwards">
        <TextField value={relation.inverseName ?? ''} placeholder={relation.inverseName === '' ? '(no reverse edge)' : 'automatic: the source type'} onCommit={(v) => up({ inverseName: v || null })} />
      </Field>
      <label className="check"><input type="checkbox" checked={relation.inverseName === ''} onChange={(e) => up({ inverseName: e.target.checked ? '' : null })} /> no reverse edge</label>
      {tableColumns && (
        <Field label="Kind of each edge (Harris matrix)">
          <select value={relation.kind ?? ''} onChange={(e) => up({ kind: e.target.value || null })}>
            <option value="">— none —</option>
            {tableColumns.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      )}
      <MatrixFields relation={relation} />
    </div>
  )
}

function ColumnInspector({ tableId, column }) {
  const sketch = useStore((s) => s.sketch)
  const catalog = useStore((s) => s.catalog)
  const p = useStore((s) => s.profiles[tableId]?.[column])
  const edit = useStore((s) => s.edit)
  const select = useStore((s) => s.select)
  const table = catalog.tables.find((t) => t.id === tableId)
  if (!table) return null
  const r = readingOf(sketch, tableId, column)
  const { primary, additional } = sketch.settings.languages
  const langs = [primary, ...additional]
  const records = catalog.tables.filter((t) => keyBinding(sketch, t.id))
  const key = keyBinding(sketch, tableId)
  const star = key && r.binding && sketch.relations.find((x) => x.from === key.id && x.to === r.binding.id)
  const choose = (reading) => edit((s) => setReading(s, tableId, column, reading))
  const current = r.kind === 'shared' ? 'type' : r.kind
  const refTable = r.kind === 'reference' ? homeBinding(sketch, r.type.id)?.tableId : records.find((t) => t.id !== tableId)?.id

  if (column === '#row') {
    return <section className="inspector"><h3>{table.name} · row number</h3><p className="muted">The rows of this table have no identifier of their own; their number is their key.</p></section>
  }
  return (
    <section className="inspector">
      <h3>{table.name}.<span className="mono">{column}</span></h3>
      {p && <p className="muted">{p.distinct} distinct · {p.filled} of {p.rows} filled · e.g. {p.samples.slice(0, 4).join(' | ')}</p>}
      <p><span className={`col-badge ${r.kind}`}>{readingText(r)}</span></p>

      <fieldset>
        <legend>Read as</legend>
        <label className="radio"><input type="radio" checked={current === 'key'} onChange={() => edit((s) => makeKey(s, tableId, column))} /> key of the table — its records</label>
        <label className="radio"><input type="radio" checked={current === 'label'} disabled={!key} onChange={() => choose({ kind: 'label', lang: primary })} /> label
          {current === 'label' && (
            <select value={r.lang} onChange={(e) => choose({ kind: 'label', lang: e.target.value })}>{langs.map((l) => <option key={l}>{l}</option>)}</select>
          )}
        </label>
        <label className="radio"><input type="radio" checked={current === 'type'} disabled={!key} onChange={() => choose({ kind: 'type' })} /> a type of its own (its values become nodes)</label>
        <label className="radio"><input type="radio" checked={current === 'reference'} disabled={!key || !records.length} onChange={() => refTable && choose({ kind: 'reference', refTable })} /> refers to the records of
          {current === 'reference' && (
            <select value={refTable} onChange={(e) => choose({ kind: 'reference', refTable: e.target.value })}>
              {records.map((t) => <option key={t.id} value={t.id}>{typeById(sketch, keyBinding(sketch, t.id).typeId).name} ({t.name})</option>)}
            </select>
          )}
        </label>
        <label className="radio"><input type="radio" checked={current === 'attribute'} disabled={!key} onChange={() => choose({ kind: 'attribute', datatype: 'xsd:string' })} /> attribute
          {current === 'attribute' && (
            <select value={r.attribute.datatype} onChange={(e) => choose({ kind: 'attribute', datatype: e.target.value })}>{DATATYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          )}
        </label>
        <label className="radio"><input type="radio" checked={current === 'unused'} disabled={r.kind === 'key'} onChange={() => choose({ kind: 'unused' })} /> not used</label>
        {(r.kind === 'edge' || r.kind === 'kind') && <p className="muted">Part of the edges this table's rows stand for — see the table's settings.</p>}
      </fieldset>

      {r.type && ['key', 'type', 'shared', 'reference'].includes(r.kind) && (
        <Field label={r.kind === 'reference' ? 'Type it refers to' : 'Type name'}>
          <TextField value={r.type.name} onCommit={(name) => edit((s) => renameType(s, r.type.id, name))} />
        </Field>
      )}
      {r.kind === 'shared' && (
        <p className="muted">Same values as {r.others.map((o, i) => <a key={o.id} onClick={() => select({ kind: 'column', tableId: o.tableId, column: o.column })}>{i ? ', ' : ''}{o.tableId}.{o.column}</a>)}.</p>
      )}
      {(r.kind === 'reference' || r.kind === 'shared') && <button className="quiet" onClick={() => edit((s) => unmerge(s, tableId, column))}>Separate: a type of its own</button>}
      {star && <RelationFields relation={star} />}
      {r.relations.filter((x) => x.id !== star?.id).map((x) => (
        <div key={x.id} className="further">
          <p className="muted">Edge “{x.name}” {x.from === r.binding?.id ? 'to' : 'from'} {sketch.bindings.find((b) => b.id === (x.from === r.binding?.id ? x.to : x.from))?.column}</p>
          <RelationFields relation={x} tableColumns={table.columns.map((c) => c.name)} />
          <button className="quiet" onClick={() => edit((s) => removeRelation(s, x.id))}>Remove this edge</button>
        </div>
      ))}
      {['type', 'shared', 'reference', 'attribute'].includes(r.kind) && (
        <Field label="Several values per cell">
          <select value={r.split?.separator ?? ''} onChange={(e) => edit((s) => setSplit(s, tableId, column, e.target.value || null))}>
            <option value="">— one value —</option><option value="; ">split at ;</option><option value=" | ">split at |</option><option value=", ">split at ,</option>
          </select>
        </Field>
      )}
    </section>
  )
}

function TableInspector({ tableId }) {
  const sketch = useStore((s) => s.sketch)
  const table = useStore((s) => s.catalog.tables.find((t) => t.id === tableId))
  const edit = useStore((s) => s.edit)
  const removeTable = useStore((s) => s.removeTable)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [kind, setKind] = useState('')
  if (!table) return null
  const key = sketch.keys[tableId]
  const asEdges = key === '#row' && !keyBinding(sketch, tableId)
  // Columns that name records of a table: the ends an edge can have.
  const ends = table.columns.map((c) => c.name).filter((c) => {
    const r = readingOf(sketch, tableId, c)
    return (r.kind === 'reference' || r.kind === 'edge' || r.kind === 'key') && homeBinding(sketch, r.type.id)
  })
  const refOf = (c) => homeBinding(sketch, readingOf(sketch, tableId, c).type.id).tableId
  const edge = asEdges && sketch.relations.find((r) => sketch.bindings.find((b) => b.id === r.from)?.tableId === tableId)
  return (
    <section className="inspector">
      <h3>{table.name}</h3>
      <p className="muted">{table.rows.length} rows · {table.columns.length} columns · {table.source.file}{table.source.sheet ? ` › ${table.source.sheet}` : ''}</p>
      {!asEdges && (
        <Field label="Key: the column that identifies a record">
          <select value={key} onChange={(e) => edit((s) => makeKey(s, tableId, e.target.value))}>
            <option value="#row">— the row number —</option>
            {table.columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </Field>
      )}
      <fieldset>
        <legend>Its rows are</legend>
        {asEdges ? (
          <>
            <p>edges, not records{edge ? `: “${edge.name}”${edge.kind ? ` qualified by ${edge.kind}` : ''}` : ''}.</p>
            {edge && <RelationFields relation={edge} tableColumns={table.columns.map((c) => c.name)} />}
            <button className="quiet" onClick={() => edit((s) => makeKey(s, tableId, table.columns[0].name))}>Read the rows as records again</button>
          </>
        ) : (
          <>
            <p className="muted">records of “{typeById(sketch, keyBinding(sketch, tableId)?.typeId)?.name}”. A table that only links records (a junction, stratigraphic relations) can be read as edges instead — merge its two columns into their tables first.</p>
            {ends.length >= 2 && (
              <div className="edges-form">
                <Field label="edge from"><select value={from} onChange={(e) => setFrom(e.target.value)}><option value="">—</option>{ends.map((c) => <option key={c}>{c}</option>)}</select></Field>
                <Field label="to"><select value={to} onChange={(e) => setTo(e.target.value)}><option value="">—</option>{ends.map((c) => <option key={c}>{c}</option>)}</select></Field>
                <Field label="kind (optional)"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">—</option>{table.columns.map((c) => <option key={c.name}>{c.name}</option>)}</select></Field>
                <button disabled={!from || !to || from === to} onClick={() => edit((s) => rowsAsEdges(s, tableId, { column: from, refTable: refOf(from) }, { column: to, refTable: refOf(to) }, { name: table.name.replace(/[_-]+/g, ' '), kind: kind || null }))}>Read rows as edges</button>
              </div>
            )}
          </>
        )}
      </fieldset>
      <button className="danger" onClick={() => removeTable(tableId)}>Remove table</button>
    </section>
  )
}

function TypeInspector({ typeId }) {
  const sketch = useStore((s) => s.sketch)
  const edit = useStore((s) => s.edit)
  const select = useStore((s) => s.select)
  const type = typeById(sketch, typeId)
  if (!type) return null
  const { primary, additional } = sketch.settings.languages
  const bindings = sketch.bindings.filter((b) => b.typeId === typeId)
  const home = homeBinding(sketch, typeId)
  const related = sketch.relations.some((r) => [r.from, r.to].some((id) => bindings.some((b) => b.id === id)))
  return (
    <section className="inspector">
      <h3>Type</h3>
      <Field label={`Name (${primary})`}><TextField value={type.name} onCommit={(name) => edit((s) => renameType(s, typeId, name))} /></Field>
      {additional.map((l) => (
        <Field key={l} label={`Name (${l})`}><TextField value={type.nameI18n?.[l] ?? ''} placeholder="—" onCommit={(name) => edit((s) => renameType(s, typeId, name, l))} /></Field>
      ))}
      <p className="muted">{home ? `Records of ${home.tableId}, keyed by ${home.column === '#row' ? 'row number' : home.column}.` : 'A vocabulary: its values are the nodes.'}</p>
      {!related && <p className="warning">Takes part in no relation: it would not appear in the graph.</p>}
      <p>Columns:</p>
      <ul className="columns">
        {bindings.map((b) => <li key={b.id}><a onClick={() => select({ kind: 'column', tableId: b.tableId, column: b.column })}>{b.tableId}.{b.column}</a></li>)}
      </ul>
    </section>
  )
}

function RelationInspector({ ids }) {
  const sketch = useStore((s) => s.sketch)
  const catalog = useStore((s) => s.catalog)
  const edit = useStore((s) => s.edit)
  const relations = sketch.relations.filter((r) => ids.includes(r.id))
  if (!relations.length) return null
  return (
    <section className="inspector">
      <h3>Edge “{relations[0].name}”</h3>
      {relations.map((r) => {
        const from = sketch.bindings.find((b) => b.id === r.from), to = sketch.bindings.find((b) => b.id === r.to)
        const table = catalog.tables.find((t) => t.id === from.tableId)
        return (
          <div key={r.id} className="further">
            <p className="muted">{from.tableId}: {from.column === sketch.keys[from.tableId] ? 'record' : from.column} → {to.column} ({typeById(sketch, to.typeId)?.name})</p>
            <RelationFields relation={r} tableColumns={table?.columns.map((c) => c.name)} />
            <button className="quiet" onClick={() => edit((s) => removeRelation(s, r.id))}>Remove this edge</button>
          </div>
        )
      })}
    </section>
  )
}

function ProjectInspector() {
  const sketch = useStore((s) => s.sketch)
  const edit = useStore((s) => s.edit)
  const [lang, setLang] = useState('')
  const { title, base, languages } = sketch.settings
  const setLanguages = (l) => edit((s) => setSettings(s, { languages: l }))
  return (
    <section className="inspector">
      <h3>Project</h3>
      <Field label="Title"><TextField value={title} placeholder="Title of the graph" onCommit={(t) => edit((s) => setSettings(s, { title: t }))} /></Field>
      <Field label="Address of every class, property and node (base URI)"><TextField value={base} onCommit={(b) => edit((s) => setSettings(s, { base: b }))} /></Field>
      <Field label="Primary language">
        <select value={languages.primary} onChange={(e) => setLanguages({ primary: e.target.value, additional: [...new Set([languages.primary, ...languages.additional])].filter((l) => l !== e.target.value) })}>
          {[languages.primary, ...languages.additional].map((l) => <option key={l}>{l}</option>)}
        </select>
      </Field>
      <div className="chips">
        {languages.additional.map((l) => <span key={l} className="chip">{l} <button className="icon" onClick={() => setLanguages({ ...languages, additional: languages.additional.filter((x) => x !== l) })}>✕</button></span>)}
        <input className="text short" value={lang} placeholder="add: fr" maxLength={8}
          onChange={(e) => setLang(e.target.value.toLowerCase())}
          onKeyDown={(e) => { if (e.key === 'Enter' && lang && lang !== languages.primary && !languages.additional.includes(lang)) { setLanguages({ ...languages, additional: [...languages.additional, lang] }); setLang('') } }} />
      </div>
      <div className="help">
        <p><strong>Drag a column onto another:</strong> onto a column of another table — the two hold the same things (onto its key: a reference to its records); within a table — a relation.</p>
        <p><strong>Click</strong> a column, a table head, a type or an edge for its settings here.</p>
      </div>
    </section>
  )
}

export default function Inspector() {
  const selection = useStore((s) => s.selection)
  if (selection?.kind === 'column') return <ColumnInspector key={`${selection.tableId}.${selection.column}`} {...selection} />
  if (selection?.kind === 'table') return <TableInspector key={selection.tableId} tableId={selection.tableId} />
  if (selection?.kind === 'type') return <TypeInspector key={selection.typeId} typeId={selection.typeId} />
  if (selection?.kind === 'relation') return <RelationInspector ids={selection.ids} />
  return <ProjectInspector />
}
