/**
 * The workspace: toolbar, the canvas of table cards on the left, the resulting graph and the
 * inspector on the right. Before any table is loaded, one large drop zone.
 */
import { useEffect, useRef, useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import 'reactflow/dist/style.css'
import Inspector from './components/Inspector'
import ResultSchema from './components/ResultSchema'
import Suggestions, { useOpenSuggestions } from './components/Suggestions'
import TableCanvas from './components/TableCanvas'
import { APP_NAME, APP_VERSION } from './lib/app'
import { ACCEPTED } from './sources/index'
import { useStore } from './store'

const ACCEPT_ALL = `${ACCEPTED},.sketch.json`

function useShortcuts() {
  const { undo, redo, saveSketch, catalog } = useStore()
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
      else if (mod && e.key.toLowerCase() === 's' && catalog.tables.length) { e.preventDefault(); saveSketch() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, saveSketch, catalog])
}

function Toolbar({ onOpen, showSuggestions, setShowSuggestions }) {
  const { catalog, past, future, undo, redo, saveSketch, exportGraphJson, exportProject, reset, collapseAll, arrange, setFocus, sketch } = useStore()
  const open = useOpenSuggestions()
  const [query, setQuery] = useState('')
  const search = (q) => {
    setQuery(q)
    const n = q.trim().toLowerCase()
    if (n.length < 2) return
    const hits = catalog.tables.filter((t) => t.name.toLowerCase().includes(n) || t.columns.some((c) => c.name.toLowerCase().includes(n))).map((t) => t.id)
    setFocus(hits)
  }
  return (
    <header className="toolbar">
      <h1>{APP_NAME} <span className="muted">{sketch.settings.title ? `${sketch.settings.title} · ` : ''}{APP_VERSION}</span></h1>
      <button onClick={onOpen} title="Tables (CSV, Excel, JSON), a database (Access, PostgreSQL dump) or a saved sketch">Load …</button>
      <button onClick={saveSketch} title="Save the sketch (Ctrl+S) — without the data">Save sketch</button>
      <span className="sep" />
      <button className="quiet" onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)">↶</button>
      <button className="quiet" onClick={redo} disabled={!future.length} title="Redo (Ctrl+Y)">↷</button>
      <span className="sep" />
      <button className={showSuggestions ? '' : 'quiet'} onClick={() => setShowSuggestions(!showSuggestions)}>Suggestions{open.length ? ` (${open.length})` : ''}</button>
      <input className="text search" value={query} placeholder="Find table or column" onChange={(e) => search(e.target.value)} />
      <button className="quiet" onClick={() => collapseAll(true)} title="Show only the columns that link tables">Collapse</button>
      <button className="quiet" onClick={() => collapseAll(false)}>Expand</button>
      <button className="quiet" onClick={arrange} title="Arrange the cards again">Arrange</button>
      <span className="grow" />
      <button onClick={exportGraphJson} title="Graph JSON for the GraphExplorer">Explore</button>
      <button onClick={exportProject} title="Studio project file, for the OntoGraphNavigator and OntoCartographer Studio">Project file</button>
      <button className="quiet" onClick={() => { if (confirm('Start over? Tables and sketch are removed (a saved sketch stays where it is).')) reset() }}>Start over</button>
    </header>
  )
}

function Messages() {
  const { messages, restore, restoreAutosave, discardAutosave } = useStore()
  const [hidden, setHidden] = useState(false)
  useEffect(() => setHidden(false), [messages])
  return (
    <div className="messages">
      {restore && (
        <div className="message info">Your last sketch on these tables ({new Date(restore.savedAt).toLocaleString()}) can be restored.
          <button className="small" onClick={restoreAutosave}>Restore</button><button className="quiet small" onClick={discardAutosave}>No</button></div>
      )}
      {!hidden && messages.map((m, i) => <div key={i} className={`message ${m.level}`}>{m.text}</div>)}
      {!hidden && messages.length > 0 && <button className="icon close" onClick={() => setHidden(true)}>✕</button>}
    </div>
  )
}

export default function App() {
  const { catalog, addFiles, busy } = useStore()
  const input = useRef(null)
  const [over, setOver] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(true)
  const openCount = useOpenSuggestions().length
  useShortcuts()
  const open = () => input.current.click()
  const drop = {
    onDragOver: (e) => { e.preventDefault(); setOver(true) },
    onDragLeave: (e) => { if (e.currentTarget === e.target) setOver(false) },
    onDrop: (e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]) },
  }
  const fileInput = <input ref={input} type="file" multiple accept={ACCEPT_ALL} hidden onChange={(e) => { addFiles([...e.target.files]); e.target.value = '' }} />

  if (!catalog.tables.length) {
    return (
      <div className="app empty">
        <header className="toolbar"><h1>{APP_NAME} <span className="muted">{APP_VERSION}</span></h1></header>
        <div className={`drop big${over ? ' over' : ''}`} {...drop} onClick={open}>
          {fileInput}
          {busy ? 'Reading …' : (<>
            <strong>Drop tables or a database here</strong>
            <span>CSV, TSV, Excel (every sheet), JSON, Access (.accdb, .mdb), PostgreSQL dump (plain SQL from pg_dump) — several at once — and a saved sketch with them</span>
          </>)}
        </div>
        <Messages />
      </div>
    )
  }
  return (
    <div className={`app workspace${over ? ' over' : ''}`} {...drop}>
      {fileInput}
      <Toolbar onOpen={open} showSuggestions={showSuggestions} setShowSuggestions={setShowSuggestions} />
      <main>
        <div className="canvas">
          <ReactFlowProvider><TableCanvas /></ReactFlowProvider>
          {showSuggestions && openCount > 0 && <Suggestions onClose={() => setShowSuggestions(false)} />}
          <Messages />
        </div>
        <aside className="side">
          <div className="schema"><div className="pane-title">Resulting graph</div><ReactFlowProvider><ResultSchema /></ReactFlowProvider></div>
          <div className="inspector-pane"><Inspector /></div>
        </aside>
      </main>
    </div>
  )
}
