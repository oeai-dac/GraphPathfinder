/**
 * The graph the sketch gives, at the level of types, live beside the canvas: types with their
 * number of records and attributes, relations between them; a type's relations to itself (units
 * above units, a phase before the next) as lines of its card. Clicking a type or an edge selects
 * it (inspector) and shows its columns on the canvas.
 */
import { memo, useEffect, useMemo } from 'react'
import ReactFlow, { Handle, MarkerType, Position, useReactFlow } from 'reactflow'
import { layoutSchema } from '../lib/layout'
import { resultSchema } from '../lib/resultSchema'
import { useStore } from '../store'

const SHOWN_ATTRIBUTES = 5
const heightOf = (n, loops = 0) => 52 + 16 * (Math.min(n.attributes.length, SHOWN_ATTRIBUTES + 1) + loops)
const labelOf = (e) => (e.kind ? `${e.name} · ${e.kind}` : e.kinds.length ? `${e.name} · ${e.kinds.join(', ')}` : e.name)

const TypeNode = memo(({ data }) => {
  const n = data.node
  return (
    <div className={`type-node${n.invisible ? ' invisible' : ''}${data.selected ? ' selected' : ''}`} title={n.invisible ? 'Takes part in no relation: will not appear in the graph' : n.tables.join(', ')}>
      <Handle type="target" position={Position.Top} className="type-handle" />
      <div className="type-head"><strong>{n.name}</strong><span className="muted">{n.approx ? '≈' : ''}{n.count}</span></div>
      {n.languages.length > 1 && <div className="type-langs">{n.languages.join(' · ')}</div>}
      <ul>
        {n.attributes.slice(0, SHOWN_ATTRIBUTES).map((a) => <li key={a}>{a}</li>)}
        {n.attributes.length > SHOWN_ATTRIBUTES && <li className="muted">+{n.attributes.length - SHOWN_ATTRIBUTES} more</li>}
      </ul>
      {data.loops.length > 0 && (
        <ul className="type-loops">
          {data.loops.map((e) => (
            <li key={e.id} className={`${e.kind || e.kinds.length ? 'dot-one' : ''}${data.selectedLoops.has(e.id) ? ' selected' : ''}`} title={`${labelOf(e)} — click for its settings`}
              onClick={(ev) => { ev.stopPropagation(); data.onLoop(e) }}>↻ {labelOf(e)}</li>
          ))}
        </ul>
      )}
      <Handle type="source" position={Position.Bottom} className="type-handle" />
    </div>
  )
})

const nodeTypes = { type: TypeNode }

export default function ResultSchema() {
  const catalog = useStore((s) => s.catalog)
  const sketch = useStore((s) => s.sketch)
  const profiles = useStore((s) => s.profiles)
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  const setFocus = useStore((s) => s.setFocus)
  const { fitView } = useReactFlow()

  const schema = useMemo(() => resultSchema(catalog, sketch, profiles), [catalog, sketch, profiles])
  // Re-arranged when the structure changes, not on every rename.
  const loopsOf = (id) => schema.edges.filter((e) => e.from === id && e.to === id)
  const between = schema.edges.filter((e) => e.from !== e.to)
  const shape = schema.nodes.map((n) => `${n.id}:${Math.min(n.attributes.length, SHOWN_ATTRIBUTES + 1)}:${loopsOf(n.id).length}`).join() + '|' + between.map((e) => `${e.from}>${e.to}`).join()
  const positions = useMemo(() => layoutSchema(schema.nodes.map((n) => ({ id: n.id, height: heightOf(n, loopsOf(n.id).length) })), between), [shape])
  useEffect(() => { setTimeout(() => fitView({ padding: 0.15, duration: 250 }), 30) }, [shape, fitView])

  const selectedType = selection?.kind === 'type' ? selection.typeId : null
  const selectedRelations = new Set(selection?.kind === 'relation' ? selection.ids : [])
  const onLoop = (e) => { select({ kind: 'relation', ids: e.relations }); setFocus([...e.tables]) }
  const selectedLoops = new Set(schema.edges.filter((e) => e.relations.some((r) => selectedRelations.has(r))).map((e) => e.id))
  const nodes = schema.nodes.map((n) => ({ id: n.id, type: 'type', position: positions[n.id] ?? { x: 0, y: 0 }, data: { node: n, selected: n.id === selectedType, loops: loopsOf(n.id), selectedLoops, onLoop }, draggable: false, targetPosition: Position.Top, sourcePosition: Position.Bottom }))
  const edges = between.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    label: labelOf(e),
    className: `schema-edge${e.kind || e.kinds.length ? ' dot-one' : ''}${e.role ? ' role' : ''}${e.relations.some((r) => selectedRelations.has(r)) ? ' selected' : ''}`,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    type: 'smoothstep',
    data: { relations: e.relations, tables: e.tables },
  }))

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => { select({ kind: 'type', typeId: n.id }); setFocus(n.data.node.tables) }}
      onEdgeClick={(_, e) => { select({ kind: 'relation', ids: e.data.relations }); setFocus(e.data.tables) }}
      onPaneClick={() => select(null)}
      nodesConnectable={false}
      nodesDraggable={false}
      minZoom={0.05}
      proOptions={{ hideAttribution: true }}
    />
  )
}
