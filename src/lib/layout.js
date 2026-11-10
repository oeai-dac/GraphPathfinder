/**
 * Where things go on the two canvases.
 *
 * Tables: connected tables are laid out together (dagre, along their references), the groups side
 * by side and wrapped into rows — 50 unconnected CSV tables would otherwise end up as one endless
 * column. Types: one dagre layout, top to bottom.
 *
 * In both, items with exactly the same neighbours (44 lists that all refer to the finds) form a
 * block laid out as a grid: dagre would put them all into one rank, a single column or row as
 * long as the 44 of them together.
 */
import dagre from 'dagre'

export const CARD_WIDTH = 300
export const TYPE_WIDTH = 160
export const cardHeight = (rows) => 46 + 26 * rows

const TWINS = 4

function components(ids, links) {
  const parent = new Map(ids.map((id) => [id, id]))
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)))
  for (const [a, b] of links) if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b))
  const groups = new Map()
  for (const id of ids) (groups.get(find(id)) ?? groups.set(find(id), []).get(find(id))).push(id)
  return [...groups.values()].sort((a, b) => b.length - a.length)
}

/**
 * dagre on `ids` with `links`, twins folded into grid blocks.
 * @returns {{ positions: { [id]: {x, y} } (top left), width, height }}
 */
function layoutGroup(ids, links, size, graph) {
  const inGroup = new Set(ids)
  const neighbours = new Map(ids.map((id) => [id, new Set()]))
  for (const [a, b] of links) if (inGroup.has(a) && inGroup.has(b) && a !== b) { neighbours.get(a).add(b); neighbours.get(b).add(a) }
  const bySignature = new Map()
  for (const id of ids) {
    const sig = [...neighbours.get(id)].sort().join('\u0000')
    if (sig) (bySignature.get(sig) ?? bySignature.set(sig, []).get(sig)).push(id)
  }
  const blockOf = new Map()
  const blocks = []
  for (const members of bySignature.values()) {
    // Not when the twins are everything (two hubs and nothing else) — then dagre is fine.
    if (members.length < TWINS || members.length === ids.length) continue
    const cell = { width: Math.max(...members.map((m) => size(m).width)), height: Math.max(...members.map((m) => size(m).height)) }
    // About square: fewer columns for tall cards, more for flat type boxes.
    const cols = Math.max(2, Math.ceil(Math.sqrt(members.length * cell.height / cell.width)))
    const block = { id: `block:${blocks.length}`, members, cols, cell, gap: 20 }
    block.width = cols * cell.width + (cols - 1) * block.gap
    block.height = Math.ceil(members.length / cols) * (cell.height + block.gap) - block.gap
    blocks.push(block)
    for (const m of members) blockOf.set(m, block.id)
  }
  const node = (id) => blockOf.get(id) ?? id

  const g = new dagre.graphlib.Graph()
  g.setGraph(graph)
  g.setDefaultEdgeLabel(() => ({}))
  for (const id of ids) if (!blockOf.has(id)) g.setNode(id, size(id))
  for (const b of blocks) g.setNode(b.id, { width: b.width, height: b.height })
  for (const [a, b] of links) {
    if (!inGroup.has(a) || !inGroup.has(b)) continue
    const x = node(a), y = node(b)
    if (x !== y && !g.hasEdge(x, y)) g.setEdge(x, y)
  }
  dagre.layout(g)
  const positions = {}
  for (const id of ids) {
    if (blockOf.has(id)) continue
    const n = g.node(id)
    positions[id] = { x: n.x - n.width / 2, y: n.y - n.height / 2 }
  }
  for (const b of blocks) {
    const n = g.node(b.id)
    const left = n.x - n.width / 2, top = n.y - n.height / 2
    b.members.forEach((m, i) => {
      positions[m] = { x: left + (i % b.cols) * (b.cell.width + b.gap), y: top + Math.floor(i / b.cols) * (b.cell.height + b.gap) }
    })
  }
  return { positions, width: g.graph().width ?? 0, height: g.graph().height ?? 0 }
}

/**
 * @param {Array<{ id, rows }>} tables  rows: how many rows the card shows
 * @param {Array<[from, to]>} links  table ids; references from → to
 * @returns {{ [tableId]: { x, y } }}
 */
export function layoutTables(tables, links, { maxWidth = 2600, gap = 80 } = {}) {
  const size = new Map(tables.map((t) => [t.id, { width: CARD_WIDTH, height: cardHeight(t.rows) }]))
  const out = {}
  let x = 0, y = 0, rowHeight = 0
  for (const group of components(tables.map((t) => t.id), links)) {
    const { positions, width, height } = layoutGroup(group, links, (id) => size.get(id), { rankdir: 'RL', nodesep: 40, ranksep: 120 })
    const w = Math.max(width, CARD_WIDTH)
    if (x > 0 && x + w > maxWidth) { x = 0; y += rowHeight + gap; rowHeight = 0 }
    for (const id of group) out[id] = { x: x + positions[id].x, y: y + positions[id].y }
    x += w + gap
    rowHeight = Math.max(rowHeight, height)
  }
  return out
}

/**
 * Top to bottom: the panel beside the canvas is taller than wide.
 * @param {Array<{ id, height }>} nodes  @param {Array<{ from, to }>} edges
 */
export function layoutSchema(nodes, edges) {
  const height = new Map(nodes.map((n) => [n.id, n.height]))
  const { positions } = layoutGroup(nodes.map((n) => n.id), edges.map((e) => [e.from, e.to]), (id) => ({ width: TYPE_WIDTH, height: height.get(id) }), { rankdir: 'TB', nodesep: 18, ranksep: 46 })
  return positions
}
