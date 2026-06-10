import { useMemo, useState } from 'react'
import { Bot, CalendarDays, FilePlus2, FolderTree, Inbox, PanelRight, Search, Settings, Sparkles } from 'lucide-react'
import { CalendarView } from '../features/calendar/CalendarView'
import { Editor } from '../features/editor/Editor'
import { Explorer } from '../features/explorer/Explorer'
import { LlmAssistant } from '../features/llm/LlmAssistant'
import { SearchPanel } from '../features/search/SearchPanel'
import { SettingsPanel } from '../features/settings/SettingsPanel'
import { demoNotes } from '../shared/fixtures'
import type { Note, WorkspaceView } from '../shared/types'
import { createInboxNote, createTodayNote, noteToMarkdown, scanVault, writeNote } from '../shared/api'
import { filterNotesByCategory, getTodayNote, searchNotes, sortByUpdatedDesc } from '../shared/vault'

export function App() {
  const [notes, setNotes] = useState<Note[]>(demoNotes)
  const [activeView, setActiveView] = useState<WorkspaceView>('today')
  const [activeCategory, setActiveCategory] = useState('journal')
  const [activePath, setActivePath] = useState(demoNotes[0]?.path ?? '')
  const [query, setQuery] = useState('')
  const [vaultRoot, setVaultRoot] = useState('')
  const [status, setStatus] = useState('Demo vault loaded. Enter a local path in Settings to open real notes.')

  const activeNote = notes.find((note) => note.path === activePath) ?? notes[0]
  const totalWords = useMemo(() => notes.reduce((sum, note) => sum + note.wordCount, 0), [notes])

  const visibleNotes = useMemo(() => {
    if (activeView === 'search') return searchNotes(notes, query)
    if (activeView === 'today') return getTodayNote(notes) ? [getTodayNote(notes)!] : sortByUpdatedDesc(notes).slice(0, 5)
    if (activeView === 'category') return filterNotesByCategory(notes, activeCategory)
    return sortByUpdatedDesc(notes)
  }, [activeCategory, activeView, notes, query])

  function updateActiveNote(body: string) {
    if (!activeNote) return
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
              ...note,
              body,
              updatedAt: new Date().toISOString().slice(0, 10),
              wordCount: body.trim() ? body.trim().split(/\s+/).length : 0,
            }
          : note,
      ),
    )
  }

  async function openVault() {
    if (!vaultRoot.trim()) {
      setStatus('Enter a vault path first.')
      return
    }
    try {
      const loadedNotes = await scanVault(vaultRoot.trim())
      setNotes(loadedNotes)
      setActivePath(loadedNotes[0]?.path ?? '')
      setStatus(`Loaded ${loadedNotes.length} Markdown notes.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function saveActiveNote() {
    if (!activeNote || !vaultRoot.trim()) {
      setStatus('Open a real vault before saving.')
      return
    }
    try {
      const saved = await writeNote({
        vaultRoot: vaultRoot.trim(),
        path: activeNote.path,
        content: noteToMarkdown(activeNote),
      })
      setNotes((current) => current.map((note) => (note.path === saved.path ? saved : note)))
      setStatus(`Saved ${saved.path}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function addTodayNote() {
    if (!vaultRoot.trim()) {
      setStatus('Open a real vault before creating today note.')
      return
    }
    try {
      const note = await createTodayNote(vaultRoot.trim())
      setNotes((current) => [note, ...current.filter((item) => item.path !== note.path)])
      setActivePath(note.path)
      setStatus(`Opened ${note.path}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function addInboxNote() {
    if (!vaultRoot.trim()) {
      setStatus('Open a real vault before creating inbox note.')
      return
    }
    try {
      const note = await createInboxNote(vaultRoot.trim(), 'Quick Thought')
      setNotes((current) => [note, ...current])
      setActivePath(note.path)
      setStatus(`Created ${note.path}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">i</span>
          <div>
            <h1>iNote</h1>
            <p>Local Markdown journal</p>
          </div>
        </div>

        <div className="vault-card">
          <div>
            <span className="eyebrow">Vault</span>
            <strong>{vaultRoot.trim() ? vaultRoot.split('/').filter(Boolean).pop() : 'Demo workspace'}</strong>
          </div>
          <span>{notes.length}</span>
        </div>

        <div className="quick-actions">
          <button type="button" onClick={addInboxNote} title="Create inbox note">
            <FilePlus2 size={17} />
          </button>
          <button type="button" onClick={addTodayNote} title="Open today note">
            <CalendarDays size={17} />
          </button>
          <button type="button" onClick={() => setActiveView('search')} title="Search">
            <Search size={17} />
          </button>
        </div>

        <nav className="nav-list" aria-label="Workspace views">
          <button className={activeView === 'today' ? 'active' : ''} onClick={() => setActiveView('today')}>
            <Inbox size={18} /> Today
          </button>
          <button className={activeView === 'category' ? 'active' : ''} onClick={() => setActiveView('category')}>
            <FolderTree size={18} /> Categories
          </button>
          <button className={activeView === 'calendar' ? 'active' : ''} onClick={() => setActiveView('calendar')}>
            <CalendarDays size={18} /> Calendar
          </button>
          <button className={activeView === 'search' ? 'active' : ''} onClick={() => setActiveView('search')}>
            <Search size={18} /> Search
          </button>
          <button className={activeView === 'settings' ? 'active' : ''} onClick={() => setActiveView('settings')}>
            <Settings size={18} /> Settings
          </button>
        </nav>

        <Explorer
          notes={notes}
          activeCategory={activeCategory}
          onSelectCategory={(category) => {
            setActiveCategory(category)
            setActiveView('category')
          }}
        />
      </aside>

      <section className="workspace">
        <header className="workspace-topbar">
          <div className="command-box">
            <Search size={17} />
            <input
              aria-label="Search notes"
              placeholder="Search notes"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActiveView('search')
              }}
            />
          </div>
          <div className="workspace-stats">
            <span>{notes.length} notes</span>
            <span>{totalWords} words</span>
          </div>
        </header>

        {activeView === 'calendar' ? (
          <CalendarView notes={notes} onSelectNote={setActivePath} />
        ) : activeView === 'search' ? (
          <SearchPanel query={query} notes={visibleNotes} onQueryChange={setQuery} onSelectNote={setActivePath} />
        ) : activeView === 'settings' ? (
          <SettingsPanel
            vaultRoot={vaultRoot}
            status={status}
            onVaultRootChange={setVaultRoot}
            onOpenVault={openVault}
            onCreateToday={addTodayNote}
            onCreateInbox={addInboxNote}
          />
        ) : (
          <>
            <div className="note-list">
              <div className="list-header">
                <span>{activeView === 'today' ? 'Today' : activeCategory}</span>
                <small>{visibleNotes.length}</small>
              </div>
              {visibleNotes.map((note) => (
                <button
                  key={note.path}
                  className={note.path === activeNote?.path ? 'note-row active' : 'note-row'}
                  onClick={() => setActivePath(note.path)}
                >
                  <span className="note-row-top">
                    <strong>{note.title}</strong>
                    <time>{note.updatedAt}</time>
                  </span>
                  <span>{note.path}</span>
                  <small>{note.summary ?? note.body.replace(/^# .*\n?/, '').trim().slice(0, 96)}</small>
                </button>
              ))}
            </div>
            {activeNote ? (
              <Editor note={activeNote} onChange={updateActiveNote} onSave={saveActiveNote} />
            ) : (
              <div className="empty">No note selected.</div>
            )}
          </>
        )}
      </section>

      <aside className="context-panel">
        {activeNote ? (
          <>
            <section className="context-section">
              <p className="panel-title">
                <PanelRight size={14} /> Context
              </p>
              <h3>{activeNote.title}</h3>
              <dl className="note-facts">
                <div>
                  <dt>Path</dt>
                  <dd>{activeNote.path}</dd>
                </div>
                <div>
                  <dt>Category</dt>
                  <dd>{activeNote.category}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{activeNote.createdAt}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{activeNote.updatedAt}</dd>
                </div>
              </dl>
              <div className="tag-strip">
                {activeNote.tags.map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </div>
            </section>
            <section className="context-section">
              <p className="panel-title">
                <Sparkles size={14} /> Summary
              </p>
              <p className="summary-text">{activeNote.summary ?? activeNote.body.replace(/^# .*\n?/, '').trim().slice(0, 180)}</p>
            </section>
            <section className="context-section">
              <p className="panel-title">
                <Bot size={14} /> Assistant
              </p>
              <LlmAssistant note={activeNote} />
            </section>
          </>
        ) : null}
      </aside>
    </main>
  )
}
