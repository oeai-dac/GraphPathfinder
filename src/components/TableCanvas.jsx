/**
 * The canvas of table cards. Drawn between cards are the merges only — a column that refers to
 * another table's records (violet) or shares its values with a column elsewhere (dashed blue);
 * relations within a table show in its rows. Dragging a column onto another column is the one
 * gesture: another table merges, the same table relates.
 */
import { useCallback, useEffect, useMemo } from 'react'
import ReactFlow, { Background, Controls, MarkerType, MiniMap, useReactFlow } from 'reactflow'
import { mergeColumns } from '../lib/edit'
import { homeBinding } from '../lib/sketch'
import { useStore } from '../store'
import TableNode from './TableNode'

const nodeTypes = { table: TableNode }
const columnOf = (handle) => handle.slice(handle.indexOf(':') + 1)

// A vocabulary shared by more columns than this draws its lines only while it is selected:
// 44 lists with the same "kategorie" would cover the canvas; their row badges say it anyway.
const SHARED_LINES = 6

function canvasEdges(sketch, layout, selectedType) {
  const edges = []
  const side = (a, b) => ((layout[a]?.x ?? 0) <= (layout[b]?.x ?? 0) ? ['r', 'l'] : ['l', 'r'])
  const count = new Map()
  for (const b of sketch.bindings) count.set(b.typeId, (count.get(b.typeId) ?? 0) + 1)
  for (const b of sketch.bindings) {
    const home = homeBinding(sketch, b.typeId)
    let target = null, kind = 'reference'
    if (home && home.id !== b.id) target = home
    else if (!home && (count.get(b.typeId) <= SHARED_LINES || b.typeId === selectedType)) {
      const first = sketch.bindings.find((x) => x.typeId === b.typeId)
      if (first.id !== b.id) { target = first; kind = 'shared' }
    }
    if (!target || target.tableId === b.tableId) continue
    const [s, t] = side(b.tableId, target.tableId)
    edges.push({
      id: `${b.id}>${target.id}`,
      source: b.tableId, sourceHandle: `${s}:${b.column}`,
      target: target.tableId, targetHandle: `${t}:${target.column}`,
      className: `merge ${kind}`,
      markerEnd: kind === 'reference' ? { type: MarkerType.ArrowClosed, width: 16, height: 16 } : undefined,
      data: { tableId: b.tableId, column: b.column },
    })
  }
  return edges
}

export default function TableCanvas() {
  const catalog = useStore((s) => s.catalog)
  const sketch = useStore((s) => s.sketch)
  const layout = useStore((s) => s.layout)
  const moveTable = useStore((s) => s.moveTable)
  const edit = useStore((s) => s.edit)
  const select = useStore((s) => s.select)
  const focus = useStore((s) => s.focus)
  const selection = useStore((s) => s.selection)
  const { fitView } = useReactFlow()

  // The type in view: the one selected, or the one of the selected column.
  const selectedType = selection?.kind === 'type' ? selection.typeId
    : selection?.kind === 'column' ? sketch.bindings.find((b) => b.tableId === selection.tableId && b.column === selection.column)?.typeId : null
  const nodes = useMemo(() => catalog.tables.map((t) => ({
    id: t.id, type: 'table', position: layout[t.id] ?? { x: 0, y: 0 }, data: {}, dragHandle: '.card-head',
  })), [catalog, layout])
  const edges = useMemo(() => canvasEdges(sketch, layout, selectedType), [sketch, layout, selectedType])

  const tableCount = catalog.tables.length
  useEffect(() => { if (tableCount) setTimeout(() => fitView({ padding: 0.1, duration: 300 }), 50) }, [tableCount, fitView])
  useEffect(() => { if (focus?.length) fitView({ nodes: focus.map((id) => ({ id })), padding: 0.4, duration: 400, maxZoom: 1.2 }) }, [focus, fitView])

  const onNodesChange = useCallback((changes) => {
    for (const c of changes) if (c.type === 'position' && c.position) moveTable(c.id, c.position)
  }, [moveTable])
  const onConnect = useCallback(({ source, sourceHandle, target, targetHandle }) => {
    if (!sourceHandle || !targetHandle) return
    const a = { tableId: source, column: columnOf(sourceHandle) }, b = { tableId: target, column: columnOf(targetHandle) }
    if (a.tableId === b.tableId && a.column === b.column) return
    edit((s) => mergeColumns(s, a, b))
    select({ kind: 'column', ...a })
  }, [edit, select])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onConnect={onConnect}
      onPaneClick={() => select(null)}
      onEdgeClick={(_, e) => select({ kind: 'column', ...e.data })}
      connectionMode="loose"
      onlyRenderVisibleElements
      minZoom={0.05}
      maxZoom={2}
      nodesConnectable
      selectNodesOnDrag={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeStrokeWidth={2} />
    </ReactFlow>
  )
}
