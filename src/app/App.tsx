import { useEffect, useMemo, useState } from 'react'
import {
  Bot,
  CalendarDays,
  FileMinus2,
  FilePlus2,
  FolderPlus,
  FolderTree,
  Inbox,
  MoveRight,
  PanelRight,
  Pencil,
  Search,
  Settings,
  Sparkles,
} from 'lucide-react'
import { CalendarView } from '../features/calendar/CalendarView'
import { Editor } from '../features/editor/Editor'
import { Explorer } from '../features/explorer/Explorer'
import { LlmAssistant } from '../features/llm/LlmAssistant'
import { SearchPanel } from '../features/search/SearchPanel'
import { SettingsPanel } from '../features/settings/SettingsPanel'
import { demoNotes } from '../shared/fixtures'
import type { Note, WorkspaceView } from '../shared/types'
import {
  createFolder,
  createInboxNote,
  createNote,
  createTodayNote,
  deleteNote,
  initializeVault,
  moveNote,
  noteToMarkdown,
  readNote,
  scanVault,
  writeNote,
} from '../shared/api'
import { filterNotesByCategory, getTodayNote, searchNotes, sortByUpdatedDesc } from '../shared/vault'

const LAST_VAULT_KEY = 'inote.lastVaultRoot'

export function App() {
  const [notes, setNotes] = useState<Note[]>(demoNotes)
  const [activeView, setActiveView] = useState<WorkspaceView>('today')
  const [activeCategory, setActiveCategory] = useState('journal')
  const [activePath, setActivePath] = useState(demoNotes[0]?.path ?? '')
  const [query, setQuery] = useState('')
  const [vaultRoot, setVaultRoot] = useState('')
  const [status, setStatus] = useState('Demo vault loaded. Enter a local path in Settings to open real notes.')
  const [saveState, setSaveState] = useState<'demo' | 'dirty' | 'saving' | 'saved' | 'error'>('demo')
  const [previewMode, setPreviewMode] = useState(false)

  const activeNote = notes.find((note) => note.path === activePath) ?? notes[0]
  const totalWords = useMemo(() => notes.reduce((sum, note) => sum + note.wordCount, 0), [notes])

  useEffect(() => {
    const remembered = window.localStorage.getItem(LAST_VAULT_KEY)
    if (remembered) {
      setVaultRoot(remembered)
      setStatus('Last vault path restored. Open it from Settings to refresh notes.')
    }
  }, [])

  const visibleNotes = useMemo(() => {
    if (activeView === 'search') return searchNotes(notes, query)
    if (activeView === 'today') return getTodayNote(notes) ? [getTodayNote(notes)!] : sortByUpdatedDesc(notes).slice(0, 5)
    if (activeView === 'category') return filterNotesByCategory(notes, activeCategory)
    return sortByUpdatedDesc(notes)
  }, [activeCategory, activeView, notes, query])

  function updateActiveNote(body: string) {
    if (!activeNote) return
    setSaveState(vaultRoot.trim() ? 'dirty' : 'demo')
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
      window.localStorage.setItem(LAST_VAULT_KEY, vaultRoot.trim())
      setSaveState('saved')
      setStatus(`Loaded ${loadedNotes.length} Markdown notes.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function initVault() {
    if (!vaultRoot.trim()) {
      setStatus('Enter a vault path first.')
      return
    }
    try {
      const loadedNotes = await initializeVault(vaultRoot.trim())
      setNotes(loadedNotes.length ? loadedNotes : [])
      setActivePath(loadedNotes[0]?.path ?? '')
      window.localStorage.setItem(LAST_VAULT_KEY, vaultRoot.trim())
      setSaveState('saved')
      setStatus('Starter vault folders are ready.')
    } catch (error) {
      setSaveState('error')
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function saveActiveNote() {
    if (!activeNote || !vaultRoot.trim()) {
      setStatus('Open a real vault before saving.')
      return
    }
    try {
      setSaveState('saving')
      const saved = await writeNote({
        vaultRoot: vaultRoot.trim(),
        path: activeNote.path,
        content: noteToMarkdown(activeNote),
      })
      setNotes((current) => current.map((note) => (note.path === saved.path ? saved : note)))
      setSaveState('saved')
      setStatus(`Saved ${saved.path}.`)
    } catch (error) {
      setSaveState('error')
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function checkExternalActiveNote() {
    if (!activeNote || !vaultRoot.trim()) {
      setStatus('Open a real vault before checking disk changes.')
      return
    }
    try {
      const diskNote = await readNote(vaultRoot.trim(), activeNote.path)
      const changedOnDisk =
        diskNote.body !== activeNote.body ||
        diskNote.title !== activeNote.title ||
        diskNote.updatedAt !== activeNote.updatedAt ||
        diskNote.tags.join('\n') !== activeNote.tags.join('\n')

      if (!changedOnDisk) {
        setStatus('Disk version matches the editor.')
        return
      }

      const reload = window.confirm(`${activeNote.path} changed on disk. Reload the disk version?`)
      if (!reload) {
        setStatus('Kept editor version. Save to overwrite disk when ready.')
        setSaveState('dirty')
        return
      }

      setNotes((current) => current.map((note) => (note.path === diskNote.path ? diskNote : note)))
      setSaveState('saved')
      setStatus(`Reloaded ${diskNote.path} from disk.`)
    } catch (error) {
      setSaveState('error')
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
      setSaveState('saved')
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
      setSaveState('saved')
      setStatus(`Created ${note.path}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function addCategoryNote() {
    if (!vaultRoot.trim()) {
      setStatus('Open a real vault before creating notes.')
      return
    }
    const title = window.prompt('Note title')
    if (!title) return
    const category = window.prompt('Category folder', activeCategory || 'knowledge')
    if (!category) return
    try {
      const note = await createNote({ vaultRoot: vaultRoot.trim(), title, category })
      setNotes((current) => [note, ...current])
      setActivePath(note.path)
      setActiveCategory(note.category)
      setActiveView('category')
      setSaveState('saved')
      setStatus(`Created ${note.path}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function addFolder() {
    if (!vaultRoot.trim()) {
      setStatus('Open a real vault before creating folders.')
      return
    }
    const path = window.prompt('Folder path', activeCategory || 'knowledge/new-topic')
    if (!path) return
    try {
      await createFolder({ vaultRoot: vaultRoot.trim(), path })
      const loadedNotes = await scanVault(vaultRoot.trim())
      setNotes(loadedNotes)
      setActiveCategory(path)
      setActiveView('category')
      setStatus(`Created folder ${path}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function renameActiveNote() {
    if (!activeNote || !vaultRoot.trim()) {
      setStatus('Open a real vault before renaming notes.')
      return
    }
    const currentName = activeNote.path.split('/').pop() ?? activeNote.path
    const nextName = window.prompt('New filename', currentName)
    if (!nextName || nextName === currentName) return
    const folder = activeNote.path.includes('/') ? activeNote.path.split('/').slice(0, -1).join('/') : ''
    const normalized = nextName.endsWith('.md') ? nextName : `${nextName}.md`
    const to = folder ? `${folder}/${normalized}` : normalized
    await moveActiveNote(to)
  }

  async function moveActiveNotePrompt() {
    if (!activeNote) return
    const nextPath = window.prompt('Move to path', activeNote.path)
    if (!nextPath || nextPath === activeNote.path) return
    await moveActiveNote(nextPath.endsWith('.md') ? nextPath : `${nextPath}.md`)
  }

  async function moveActiveNote(to: string) {
    if (!activeNote || !vaultRoot.trim()) {
      setStatus('Open a real vault before moving notes.')
      return
    }
    try {
      const moved = await moveNote({ vaultRoot: vaultRoot.trim(), from: activeNote.path, to })
      setNotes((current) => current.map((note) => (note.path === activeNote.path ? moved : note)))
      setActivePath(moved.path)
      setActiveCategory(moved.category)
      setSaveState('saved')
      setStatus(`Moved to ${moved.path}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function deleteActiveNote() {
    if (!activeNote || !vaultRoot.trim()) {
      setStatus('Open a real vault before deleting notes.')
      return
    }
    const confirmed = window.confirm(`Delete ${activeNote.path}?`)
    if (!confirmed) return
    try {
      await deleteNote(vaultRoot.trim(), activeNote.path)
      const remaining = notes.filter((note) => note.path !== activeNote.path)
      setNotes(remaining)
      setActivePath(remaining[0]?.path ?? '')
      setSaveState('saved')
      setStatus(`Deleted ${activeNote.path}.`)
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
          <button type="button" onClick={addCategoryNote} title="Create note">
            <Pencil size={17} />
          </button>
          <button type="button" onClick={addFolder} title="Create folder">
            <FolderPlus size={17} />
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
            onInitializeVault={initVault}
            onCreateToday={addTodayNote}
            onCreateInbox={addInboxNote}
            onCreateFolder={addFolder}
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
              <Editor
                note={activeNote}
                onChange={updateActiveNote}
                onSave={saveActiveNote}
                onCheckExternal={checkExternalActiveNote}
                previewMode={previewMode}
                onTogglePreview={() => setPreviewMode((current) => !current)}
                saveState={saveState}
              />
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
              <div className="context-actions">
                <button type="button" onClick={renameActiveNote} title="Rename note">
                  <Pencil size={15} />
                </button>
                <button type="button" onClick={moveActiveNotePrompt} title="Move note">
                  <MoveRight size={15} />
                </button>
                <button type="button" onClick={deleteActiveNote} title="Delete note">
                  <FileMinus2 size={15} />
                </button>
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
