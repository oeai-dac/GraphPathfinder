/**
 * A table card: one row per column, with a handle on each side. Dragging from one row to another
 * merges (other table) or relates (same table) — see TableCanvas and lib/edit.js.
 */
import { memo, useMemo } from 'react'
import { Handle, Position } from 'reactflow'
import { readingOf } from '../lib/edit'
import { useStore } from '../store'
import { LINKING, READING, readingText } from './readings'

function TableNode({ id }) {
  const table = useStore((s) => s.catalog.tables.find((t) => t.id === id))
  const sketch = useStore((s) => s.sketch)
  const profile = useStore((s) => s.profiles[id])
  const collapsed = useStore((s) => s.collapsed.has(id))
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  const toggleCollapsed = useStore((s) => s.toggleCollapsed)

  const rows = useMemo(() => {
    if (!table) return []
    const key = sketch.keys[id]
    const list = table.columns.map((c) => ({ column: c.name, reading: readingOf(sketch, id, c.name) }))
    if (key === '#row' && sketch.bindings.some((b) => b.tableId === id && b.column === '#row')) list.unshift({ column: '#row', reading: readingOf(sketch, id, '#row'), synthetic: true })
    return list
  }, [table, sketch, id])
  if (!table) return null

  const shown = collapsed ? rows.filter((r) => LINKING.has(r.reading.kind)) : rows
  const isSelectedColumn = (c) => selection?.kind === 'column' && selection.tableId === id && selection.column === c
  const ofSelectedType = (r) => selection?.kind === 'type' && r.reading.type?.id === selection.typeId
  const tableSelected = selection?.kind === 'table' && selection.tableId === id
  const edges = sketch.keys[id] === '#row' && !sketch.bindings.some((b) => b.tableId === id && b.column === '#row')

  return (
    <div className={`table-card${tableSelected ? ' selected' : ''}`}>
      <div className="card-head" onClick={() => select({ kind: 'table', tableId: id })} title="Drag to move; click for the table's settings">
        <strong>{table.name}</strong>
        <span className="muted">{table.rows.length} rows{edges ? ' · rows are edges' : ''}</span>
        <button className="icon" title={collapsed ? 'Show all columns' : 'Show linked columns only'} onClick={(e) => { e.stopPropagation(); toggleCollapsed(id) }}>{collapsed ? '▸' : '▾'}</button>
      </div>
      {shown.map(({ column, reading, synthetic }) => (
        <div
          key={column}
          className={`col-row ${reading.kind}${isSelectedColumn(column) ? ' selected' : ''}${ofSelectedType({ reading }) ? ' highlight' : ''}`}
          onClick={(e) => { e.stopPropagation(); select({ kind: 'column', tableId: id, column }) }}
          title={profile?.[column] ? `${profile[column].distinct} distinct · ${profile[column].filled} filled · e.g. ${profile[column].samples.slice(0, 3).join(' | ')}` : column}
        >
          <Handle type="source" position={Position.Left} id={`l:${column}`} className="col-handle" />
          <span className="col-icon">{READING[reading.kind].icon}</span>
          <span className="col-name">{synthetic ? 'row number' : column}</span>
          <span className={`col-badge ${reading.kind}`}>{readingText(reading)}{reading.split ? ` · split “${reading.split.separator.trim()}”` : ''}{reading.relations.length && reading.kind !== 'edge' ? ` · +${reading.relations.length}` : ''}</span>
          <Handle type="source" position={Position.Right} id={`r:${column}`} className="col-handle" />
        </div>
      ))}
      {collapsed && rows.length > shown.length && (
        <div className="col-more" onClick={() => toggleCollapsed(id)}>{rows.length - shown.length} more columns …</div>
      )}
    </div>
  )
}

export default memo(TableNode)
