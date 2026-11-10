// How a column's reading is shown in a card row and in the inspector.
export const READING = {
  key: { icon: '🔑', label: 'key' },
  label: { icon: '🏷', label: 'label' },
  reference: { icon: '→', label: 'reference' },
  shared: { icon: '≡', label: 'shared values' },
  type: { icon: '◆', label: 'own type' },
  edge: { icon: '⇄', label: 'edge' },
  kind: { icon: '⋯', label: 'kind of edge' },
  attribute: { icon: '·', label: 'attribute' },
  unused: { icon: '', label: 'not used' },
}

const ROLE_TEXT = { phase: 'phase', phaseOrder: 'phase order', object: 'object', group: 'group', unitType: 'unit type' }
// What the edge from the record says: its role in the Harris matrix, or the kind of every edge.
const starText = (r) => (r.star?.role ? ` · ${ROLE_TEXT[r.star.role]}` : r.star?.kindValue ? ` · ${r.star.kindValue}` : '')

export function readingText(r) {
  switch (r.kind) {
    case 'key': return r.type.name
    case 'label': return `label ${r.lang}`
    case 'reference': return `→ ${r.type.name}${starText(r)}`
    case 'shared': return `≡ ${r.type.name}${starText(r)}`
    case 'type': return `${r.type.name}${starText(r)}`
    case 'edge': return `${r.relation.from === r.binding.id ? 'from' : 'to'} ${r.type.name}${r.relation.kind ? ` · ${r.relation.kind}` : ''}${r.relation.role ? ` · ${ROLE_TEXT[r.relation.role]}` : ''}`
    case 'kind': return `kind of “${r.relation.name}”`
    case 'attribute': return r.attribute.datatype.replace(/^(xsd|geo):/, '')
    default: return '—'
  }
}

// Collapsed cards keep what links the table to others.
export const LINKING = new Set(['key', 'reference', 'shared', 'edge', 'kind'])

export const DATATYPES = [
  ['xsd:string', 'text'], ['xsd:integer', 'integer'], ['xsd:decimal', 'decimal'], ['xsd:date', 'date'],
  ['xsd:dateTime', 'date and time'], ['xsd:gYear', 'year'], ['xsd:boolean', 'yes / no'], ['geo:wktLiteral', 'geometry (WKT)'],
]
