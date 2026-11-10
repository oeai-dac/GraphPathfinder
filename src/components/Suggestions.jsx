/** The open suggestions, grouped by kind, each to accept or dismiss — over the canvas. */
import { useMemo } from 'react'
import { describeSuggestion } from '../lib/suggestions'
import { openSuggestions, useStore } from '../store'

const KINDS = [
  ['matrix', 'Harris matrix'], ['matrixColumns', 'Harris matrix in columns'], ['role', 'Roles in the Harris matrix'], ['junction', 'Tables of edges'], ['same', 'Same records'], ['reference', 'References'], ['shared', 'Shared values'],
]

export function useOpenSuggestions() {
  const sketch = useStore((s) => s.sketch)
  const suggestions = useStore((s) => s.suggestions)
  const dismissed = useStore((s) => s.dismissed)
  return useMemo(() => openSuggestions({ sketch, suggestions, dismissed }), [sketch, suggestions, dismissed])
}

export default function Suggestions({ onClose }) {
  const open = useOpenSuggestions()
  const sketch = useStore((s) => s.sketch)
  const catalog = useStore((s) => s.catalog)
  const { accept, acceptAll, dismiss, setFocus } = useStore()
  const name = (id) => catalog.tables.find((t) => t.id === id)?.name ?? id
  const tablesOf = (x) => [x.tableId, x.refTable, x.from?.refTable, x.to?.refTable, ...(x.members ?? []).map((m) => m.tableId)].filter(Boolean)
  return (
    <aside className="suggestions-panel">
      <header>
        <h2>Suggestions <span className="muted">read from the values — applied only when accepted</span></h2>
        {open.length > 0 && <button onClick={() => acceptAll()}>Accept all ({open.length})</button>}
        <button className="icon" onClick={onClose} title="Close">✕</button>
      </header>
      {!open.length && <p className="muted pad">Nothing left to suggest.</p>}
      {KINDS.map(([kind, title]) => {
        const list = open.filter((x) => x.kind === kind)
        if (!list.length) return null
        return (
          <section key={kind}>
            <h3>{title} <span className="muted">{list.length}</span>{list.length > 1 && <button className="quiet small" onClick={() => acceptAll(kind)}>accept these</button>}</h3>
            <ul>
              {list.map((x) => (
                <li key={x.id}>
                  <span className="text" title="Show on the canvas" onClick={() => setFocus(tablesOf(x))}>{describeSuggestion(sketch, x, name)}</span>
                  <button className="small" onClick={() => accept(x.id)}>Accept</button>
                  <button className="quiet small" onClick={() => dismiss(x.id)}>Dismiss</button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </aside>
  )
}
