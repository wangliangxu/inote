import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { confirm as tauriConfirm } from '@tauri-apps/plugin-dialog'
import {
  Archive,
  Bot,
  CalendarDays,
  Check,
  Clock,
  FileMinus2,
  FilePlus2,
  Flag,
  FolderPlus,
  FolderTree,
  Eye,
  LayoutGrid,
  Link2,
  List,
  ListTodo,
  MoveRight,
  PanelLeft,
  PanelRight,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Tags,
  Trash2,
} from 'lucide-react'
const CalendarView = lazy(() => import('../features/calendar/CalendarView').then(m => ({ default: m.CalendarView })))
import { Editor } from '../features/editor/Editor'
const LlmAssistant = lazy(() => import('../features/llm/LlmAssistant').then(m => ({ default: m.LlmAssistant })))
const SettingsPanel = lazy(() => import('../features/settings/SettingsPanel').then(m => ({ default: m.SettingsPanel })))
const TagsPanel = lazy(() => import('../features/tags/TagsPanel').then(m => ({ default: m.TagsPanel })))
const TodoDashboard = lazy(() => import('../features/todo/TodoDashboard').then(m => ({ default: m.TodoDashboard })))
import { demoNotes } from '../shared/fixtures'
import { getEffectiveTheme, readStoredThemePreference, THEME_PREFERENCE_KEY, type ThemePreference } from '../shared/theme'
import type { LlmProviderSettings, Note, NoteLinks, SaveState, SearchResult, WorkspaceView } from '../shared/types'
import {
  archiveNote,
  createFolder,
  createInboxNote,
  createMonthlyReview,
  createNote,
  createTodayNote,
  createWeeklyReview,
  deleteNote,
  emptyTrash,
  executeLlmChat,
  getNoteLinks,
  initializeVault,
  moveNote,
  noteToMarkdown,
  readNote,
  rebuildSearchIndex,
  loadUserSettings,
  saveUserSettings,
  scanVault,
  scanVaultAndRebuildIndex,
  searchIndex,
  writeNote,
  startVaultWatcher,
  stopVaultWatcher,
  parseMarkdownWithFrontmatter,
} from '../shared/api'
import { filterNotesByCategory, getTodayNote, groupByCategory, searchNotes, sortByUpdatedDesc } from '../shared/vault'
import { createInitialWorkspaceState, LAST_ACTIVE_PATH_KEY, LAST_VAULT_KEY } from './startup'

async function safeConfirm(message: string): Promise<boolean> {
  if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI_IPC__' in window)) {
    try {
      return await tauriConfirm(message)
    } catch {
      // Fallback if plugin fails
    }
  }
  return window.confirm(message)
}

const LLM_SETTINGS_KEY = 'inote.llmSettings'
const BASE_FONT_SIZE_KEY = 'inote.baseFontSize'
const OPEN_SETTINGS_EVENT = 'inote://open-settings'

const defaultLlmSettings: LlmProviderSettings = {
  providerName: 'OpenAI compatible',
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4.1-mini',
}

const excerptCache = new WeakMap<Note | SearchResult, string>()

function noteExcerpt(note: Note | SearchResult): string {
  const cached = excerptCache.get(note)
  if (cached !== undefined) return cached
  const excerpt = 'excerpt' in note ? note.excerpt : (note.summary ?? note.body.replace(/^# .*\n?/, '').trim().slice(0, 96))
  const result = stripMarkdownForSummary(excerpt)
  excerptCache.set(note, result)
  return result
}

const NOTES_PAGE_SIZE = 60

interface NoteItemProps {
  note: Note | SearchResult
  isActive: boolean
  onSelect: (path: string) => void
}

const NoteCardItem = memo(function NoteCardItem({ note, isActive, onSelect }: NoteItemProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [isActive])

  return (
    <div ref={ref} className={isActive ? 'note-card active' : 'note-card'}>
      <button className="note-card-select" type="button" onClick={() => onSelect(note.path)}>
        <strong className="note-title-line">
          {note.title}
          {('priority' in note && note.priority && note.priority !== 'none') && (
            <Flag size={12} className={`priority-icon ${note.priority}`} />
          )}
        </strong>
        <small>{noteExcerpt(note)}</small>
        <div className="note-card-footer">
          <time>{note.updatedAt}</time>
          {('due' in note && note.due) && (
            <span className="due-badge" title={`Due: ${note.due}`}>
              <Clock size={12} />
              {note.due.split('T')[0]}
            </span>
          )}
        </div>
      </button>
    </div>
  )
})

const NoteRowItem = memo(function NoteRowItem({ note, isActive, onSelect }: NoteItemProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [isActive])

  return (
    <div ref={ref} className={isActive ? 'note-row active' : 'note-row'}>
      <button className="note-row-select" type="button" onClick={() => onSelect(note.path)}>
        <strong className="note-title-line">
          {note.title}
          {('priority' in note && note.priority && note.priority !== 'none') && (
            <Flag size={12} className={`priority-icon ${note.priority}`} />
          )}
        </strong>
        <small>{noteExcerpt(note)}</small>
        <div className="note-row-footer">
          <time>{note.updatedAt}</time>
          {('due' in note && note.due) && (
            <span className="due-badge" title={`Due: ${note.due}`}>
              <Clock size={12} />
              {note.due.split('T')[0]}
            </span>
          )}
        </div>
      </button>
    </div>
  )
})

function stripMarkdownForSummary(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function localDateString(date = new Date()): string {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 10)
}

function getFilenameForTitle(title: string) {
  const trimmed = title.trim()
  if (/[^\x00-\x7F]/.test(trimmed)) {
    let sanitized = trimmed.replace(/[\\/:\*\?"<>\|]/g, '-')
    sanitized = sanitized.replace(/^[ -]+|[ -]+$/g, '')
    return sanitized || 'note'
  } else {
    let slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    slug = slug.replace(/^-|-$/g, '')
    return slug || 'note'
  }
}



export function App() {
  const initialWorkspace = useMemo(
    () => createInitialWorkspaceState(typeof window === 'undefined' ? undefined : window.localStorage),
    [],
  )
  const [notes, setNotes] = useState<Note[]>(initialWorkspace.notes)
  const [activeView, setActiveView] = useState<WorkspaceView>('today')
  const [activeCategory, setActiveCategory] = useState('journal')
  const [activeTag, setActiveTag] = useState('')
  const [activePath, setActivePath] = useState(initialWorkspace.activePath)
  const [query, setQuery] = useState('')
  const [selectedSearchCategories, setSelectedSearchCategories] = useState<string[]>([])
  const [categoryFilterOpen, setCategoryFilterOpen] = useState(false)
  const [noteListMode, setNoteListMode] = useState<'cards' | 'summary'>('cards')
  const [leftSidebarVisible, setLeftSidebarVisible] = useState(true)
  const [rightSidebarVisible, setRightSidebarVisible] = useState(true)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(268)
  const [rightSidebarWidth, setRightSidebarWidth] = useState(336)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tagsPopoverOpen, setTagsPopoverOpen] = useState(false)
  const [vaultRoot, setVaultRoot] = useState(initialWorkspace.vaultRoot)
  const [status, setStatus] = useState(initialWorkspace.status)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [previewMode, setPreviewMode] = useState(false)
  const [indexedResults, setIndexedResults] = useState<SearchResult[]>([])
  const [noteLinks, setNoteLinks] = useState<NoteLinks>({ outgoing: [], backlinks: [] })
  const [linkVersion, setLinkVersion] = useState(0)
  const [llmSettings, setLlmSettings] = useState<LlmProviderSettings>(defaultLlmSettings)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    if (typeof window === 'undefined') return 'system'
    return readStoredThemePreference(window.localStorage)
  })
  const [defaultCategory, setDefaultCategory] = useState('knowledge')
  const [baseFontSize, setBaseFontSize] = useState<number>(() => {
    if (typeof window === 'undefined') return 16
    const stored = window.localStorage.getItem(BASE_FONT_SIZE_KEY)
    return stored ? parseInt(stored, 10) : 16
  })
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const [promptConfig, setPromptConfig] = useState<{ message: string, defaultValue: string, resolve: (val: string | null) => void } | null>(null)
  
  const safePrompt = useCallback((message: string, defaultValue = '') => {
    return new Promise<string | null>((resolve) => {
      setPromptConfig({ message, defaultValue, resolve })
    })
  }, [])
  const categoryFilterRef = useRef<HTMLDetailsElement>(null)
  const categoryFilterPointerInsideRef = useRef(false)
  const skipNextSettingsSaveRef = useRef(true)
  const skipNextVaultChangeUntilRef = useRef(0)
  const previousViewRef = useRef<{ view: WorkspaceView, category: string, path: string }>({ view: 'today', category: 'journal', path: '' })

  const toggleSpecialView = useCallback((view: 'archive' | 'trash' | 'calendar') => {
    if (activeView === view) {
      setActiveView(previousViewRef.current.view)
      setActiveCategory(previousViewRef.current.category)
      if (previousViewRef.current.path) {
        setActivePath(previousViewRef.current.path)
      }
    } else {
      if (activeView !== 'archive' && activeView !== 'trash' && activeView !== 'calendar') {
        previousViewRef.current = { view: activeView, category: activeCategory, path: activePath }
      }
      setActiveView(view)
    }
  }, [activeView, activeCategory, activePath])
  const activeNote = activePath ? notes.find((note) => note.path === activePath) : undefined
  
  const saveState: SaveState = !vaultRoot.trim() ? 'demo' :
    saveError ? 'error' :
    isSaving ? 'saving' :
    (activeNote?.isDirty ? 'dirty' : 'saved')
    
  useEffect(() => {
    setSaveError(false)
  }, [activePath])
    
  const effectiveTheme = useMemo(() => getEffectiveTheme(themePreference, systemPrefersDark), [systemPrefersDark, themePreference])
  const categoryOptions = useMemo(() => groupByCategory(notes), [notes])
  const searchCategorySet = useMemo(() => new Set(selectedSearchCategories), [selectedSearchCategories])
  const searchScopeLabel =
    selectedSearchCategories.length === 0
      ? 'All categories'
      : selectedSearchCategories.length === 1
        ? selectedSearchCategories[0]
        : `${selectedSearchCategories.length} categories`
  const totalWords = useMemo(() => notes.reduce((sum, note) => sum + note.wordCount, 0), [notes])
  const saveLabel = {
    loading: 'Loading',
    demo: 'Demo only',
    dirty: 'Unsaved changes',
    saving: 'Saving',
    saved: 'Saved',
    error: 'Save failed',
  }[saveState]

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemTheme = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches)
    }

    setSystemPrefersDark(query.matches)
    query.addEventListener('change', updateSystemTheme)
    return () => {
      query.removeEventListener('change', updateSystemTheme)
    }
  }, [])

  useLayoutEffect(() => {
    window.localStorage.setItem(THEME_PREFERENCE_KEY, themePreference)
    window.localStorage.setItem(BASE_FONT_SIZE_KEY, baseFontSize.toString())
    document.documentElement.dataset.theme = effectiveTheme
    document.documentElement.dataset.themePreference = themePreference
    document.documentElement.style.colorScheme = effectiveTheme
    document.documentElement.style.setProperty('--font-size-base', `${baseFontSize}px`)
  }, [effectiveTheme, themePreference, baseFontSize])

  const loadVaultFromDisk = useCallback(
    async (root: string, reason = 'Vault refreshed from disk.', preferredPath = '') => {
      const trimmedRoot = root.trim()
      if (!trimmedRoot) return
      const loadedNotes = await scanVaultAndRebuildIndex(trimmedRoot)
      setNotes(loadedNotes)
      setLinkVersion((current) => current + 1)
      setActivePath((current) => {
        if (preferredPath && loadedNotes.some((note) => note.path === preferredPath)) return preferredPath
        if (loadedNotes.some((note) => note.path === current)) return current
        return loadedNotes[0]?.path ?? ''
      })
      setSaveError(false)
      setStatus(reason)
    },
    [],
  )

  const loadDemoWorkspace = useCallback(() => {
    setNotes(demoNotes)
    setActivePath(demoNotes[0]?.path ?? '')
    setVaultRoot('')
    setSaveError(false)
    setStatus('Demo vault loaded. Enter a local path in Settings to open real notes.')
  }, [])

  const refreshVaultFromDisk = useCallback(
    async (reason = 'Vault refreshed from disk.') => {
      await loadVaultFromDisk(vaultRoot, reason)
    },
    [loadVaultFromDisk, vaultRoot],
  )

  useEffect(() => {
    let cancelled = false

    loadUserSettings()
      .then(async (savedSettings) => {
        if (cancelled) return
        const legacyVaultRoot = window.localStorage.getItem(LAST_VAULT_KEY) ?? ''
        const legacyActivePath = window.localStorage.getItem(LAST_ACTIVE_PATH_KEY) ?? ''
        const vaultRootFromSettings = savedSettings.vaultRoot || legacyVaultRoot
        if (vaultRootFromSettings) {
          setVaultRoot(vaultRootFromSettings)
        }

        let llmSettingsFromStorage = savedSettings.llmSettings
        if (savedSettings.defaultCategory) {
          setDefaultCategory(savedSettings.defaultCategory)
        }
        if (savedSettings.activeView) {
          setActiveView(savedSettings.activeView)
        }
        if (savedSettings.activeCategory) {
          setActiveCategory(savedSettings.activeCategory)
        }
        if (savedSettings.selectedSearchCategories) {
          setSelectedSearchCategories(savedSettings.selectedSearchCategories)
        }
        if (savedSettings.leftSidebarVisible !== undefined) setLeftSidebarVisible(savedSettings.leftSidebarVisible)
        if (savedSettings.rightSidebarVisible !== undefined) setRightSidebarVisible(savedSettings.rightSidebarVisible)
        if (savedSettings.leftSidebarWidth !== undefined) setLeftSidebarWidth(savedSettings.leftSidebarWidth)
        if (savedSettings.rightSidebarWidth !== undefined) setRightSidebarWidth(savedSettings.rightSidebarWidth)
        const savedLlmSettings = window.localStorage.getItem(LLM_SETTINGS_KEY)
        const hasStoredLlmSettings =
          savedSettings.llmSettings.providerName !== defaultLlmSettings.providerName ||
          savedSettings.llmSettings.apiBaseUrl !== defaultLlmSettings.apiBaseUrl ||
          savedSettings.llmSettings.apiKey !== defaultLlmSettings.apiKey ||
          savedSettings.llmSettings.model !== defaultLlmSettings.model
        if (!hasStoredLlmSettings && savedLlmSettings) {
          try {
            llmSettingsFromStorage = { ...defaultLlmSettings, ...JSON.parse(savedLlmSettings) }
          } catch {
            setStatus('LLM settings could not be loaded. Defaults restored.')
          }
        }
        setLlmSettings({ ...defaultLlmSettings, ...llmSettingsFromStorage })
        if (vaultRootFromSettings) {
          try {
            await loadVaultFromDisk(
              vaultRootFromSettings,
              savedSettings.vaultRoot
                ? 'Last vault restored from SQLite.'
                : 'Last vault migrated from browser fallback.',
              savedSettings.activePath || legacyActivePath,
            )
          } catch (error) {
            setSaveError(true)
            setStatus(error instanceof Error ? error.message : String(error))
          }
        } else {
          loadDemoWorkspace()
        }
      })
      .catch(async () => {
        if (cancelled) return
        const remembered = window.localStorage.getItem(LAST_VAULT_KEY)
        if (remembered) {
          setVaultRoot(remembered)
          try {
            await loadVaultFromDisk(
              remembered,
              'Last vault restored from browser fallback.',
              window.localStorage.getItem(LAST_ACTIVE_PATH_KEY) ?? '',
            )
          } catch (error) {
            setSaveError(true)
            setStatus(error instanceof Error ? error.message : String(error))
          }
        } else {
          loadDemoWorkspace()
        }
        const savedLlmSettings = window.localStorage.getItem(LLM_SETTINGS_KEY)
        if (savedLlmSettings) {
          try {
            setLlmSettings({ ...defaultLlmSettings, ...JSON.parse(savedLlmSettings) })
          } catch {
            setStatus('LLM settings could not be loaded. Defaults restored.')
          }
        }
      })
      .finally(() => {
        if (!cancelled) setSettingsLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [loadDemoWorkspace, loadVaultFromDisk])

  useEffect(() => {
    if (!settingsLoaded) return
    if (skipNextSettingsSaveRef.current) {
      skipNextSettingsSaveRef.current = false
      return
    }
    const timeout = window.setTimeout(() => {
      const activePathForStorage = vaultRoot.trim() ? activePath : ''
      saveUserSettings({ 
        vaultRoot: vaultRoot.trim(), activePath: activePathForStorage, activeView, activeCategory, selectedSearchCategories, llmSettings, defaultCategory,
        leftSidebarVisible, rightSidebarVisible, leftSidebarWidth, rightSidebarWidth
      })
        .then(() => {
          window.localStorage.setItem(LAST_VAULT_KEY, vaultRoot.trim())
          window.localStorage.setItem(LAST_ACTIVE_PATH_KEY, activePathForStorage)
          window.localStorage.removeItem(LLM_SETTINGS_KEY)
        })
        .catch((e) => {
          setStatus('Settings Save Error: ' + String(e))
          window.localStorage.setItem(LAST_VAULT_KEY, vaultRoot.trim())
          window.localStorage.setItem(LAST_ACTIVE_PATH_KEY, activePathForStorage)
          window.localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify({ ...llmSettings, apiKey: '' }))
        })
    }, 300)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [activePath, activeView, activeCategory, selectedSearchCategories, llmSettings, settingsLoaded, vaultRoot, defaultCategory, leftSidebarVisible, rightSidebarVisible, leftSidebarWidth, rightSidebarWidth])

  useEffect(() => {
    if (!vaultRoot.trim()) return
    let disposed = false

    startVaultWatcher(vaultRoot.trim()).catch(() => {
      // Browser-only dev mode has no Tauri backend; keep the UI usable.
    })

    const unlistenPromise = listen('vault://changed', () => {
      if (!disposed) {
        if (Date.now() < skipNextVaultChangeUntilRef.current) {
          skipNextVaultChangeUntilRef.current = 0
          return
        }
        refreshVaultFromDisk('Markdown files changed on disk. Vault refreshed.')
      }
    })

    return () => {
      disposed = true
      unlistenPromise.then((dispose) => dispose()).catch(() => {})
      stopVaultWatcher().catch(() => {
        // Ignore when not running inside Tauri.
      })
    }
  }, [refreshVaultFromDisk, vaultRoot])

  useEffect(() => {
    if (!categoryFilterOpen) return

    function closeCategoryFilter(event: PointerEvent) {
      if (!categoryFilterRef.current?.contains(event.target as Node)) {
        setCategoryFilterOpen(false)
      }
    }

    window.addEventListener('pointerdown', closeCategoryFilter)
    return () => {
      window.removeEventListener('pointerdown', closeCategoryFilter)
    }
  }, [categoryFilterOpen])

  useEffect(() => {
    if (!settingsOpen) return

    function closeSettings(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSettingsOpen(false)
      }
    }

    window.addEventListener('keydown', closeSettings)
    return () => {
      window.removeEventListener('keydown', closeSettings)
    }
  }, [settingsOpen])

  useEffect(() => {
    if (!tagsPopoverOpen) return

    function closeTags(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setTagsPopoverOpen(false)
      }
    }

    window.addEventListener('keydown', closeTags)
    return () => {
      window.removeEventListener('keydown', closeTags)
    }
  }, [tagsPopoverOpen])

  useEffect(() => {
    const unlistenPromise = listen('inote://empty-trash', async () => {
      if (!vaultRoot.trim()) return
      
      // Yield to event loop to allow menu interaction to finish
      await new Promise((resolve) => setTimeout(resolve, 50))
      
      const confirmed = await safeConfirm('Are you sure you want to permanently empty the trash? This action cannot be undone.')
      if (!confirmed) return
      
      // Yield to event loop to allow macOS NSAlert dialog to close completely
      await new Promise((resolve) => setTimeout(resolve, 50))
      
      try {
        await emptyTrash(vaultRoot.trim())
        setNotes((current) => current.filter((n) => !n.path.startsWith('.trash/')))
        setIndexedResults((current) => current.filter((n) => !n.path.startsWith('.trash/')))
        setStatus('Trash emptied.')
        setActivePath((current) => current.startsWith('.trash/') ? '' : current)
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error))
      }
    })
    
    return () => {
      unlistenPromise.then((dispose) => dispose()).catch(() => {})
    }
  }, [vaultRoot, safeConfirm])

  useEffect(() => {
    const unlistenPromise = listen(OPEN_SETTINGS_EVENT, () => {
      setSettingsOpen(true)
    })

    return () => {
      unlistenPromise.then((dispose) => dispose()).catch(() => {})
    }
  }, [])

  const visibleNotes = useMemo(() => {
    const isSpecialCategory = (note: Pick<Note, 'category' | 'path'>) =>
      note.category === 'archive' || note.category.startsWith('archive/') ||
      note.path.startsWith('.trash/')

    if (activeView === 'archive') {
      return sortByUpdatedDesc(notes.filter(note => note.category === 'archive' || note.category.startsWith('archive/')))
    }
    if (activeView === 'trash') {
      return sortByUpdatedDesc(notes.filter(note => note.path.startsWith('.trash/')))
    }

    if (activeView === 'search') {
      const matchesSearchScope = (note: Pick<Note, 'category' | 'path'>) => {
        if (searchCategorySet.size === 0) {
          return !isSpecialCategory(note)
        }
        return searchCategorySet.has(note.category) ||
               Array.from(searchCategorySet).some((category) => note.category.startsWith(`${category}/`))
      }
      const searchResults = vaultRoot.trim() && query.trim() ? indexedResults : searchNotes(notes, query)
      return searchResults.filter(matchesSearchScope)
    }
    if (activeView === 'today') return getTodayNote(notes) ? [getTodayNote(notes)!] : sortByUpdatedDesc(notes.filter(n => !isSpecialCategory(n))).slice(0, 5)
    if (activeView === 'category') return filterNotesByCategory(notes, activeCategory)
    if (activeView === 'todo') {
      const priorityWeights: Record<string, number> = { high: 3, medium: 2, low: 1, none: 0 }
      const todoNotes = notes.filter(n => !isSpecialCategory(n) && (n.status === 'todo' || n.status === 'in_progress' || n.status === 'done' || (n.due && n.status !== 'cancelled')))
      return todoNotes.sort((a, b) => {
        // Sort by due date
        if (a.due && b.due) {
          const aDue = a.due.localeCompare(b.due)
          if (aDue !== 0) return aDue
        } else if (a.due) {
          return -1
        } else if (b.due) {
          return 1
        }
        
        // Sort by priority
        const aPri = priorityWeights[a.priority ?? 'none'] ?? 0
        const bPri = priorityWeights[b.priority ?? 'none'] ?? 0
        if (aPri !== bPri) return bPri - aPri // high to low

        // Sort by update date
        return b.updatedAt.localeCompare(a.updatedAt)
      })
    }

    return sortByUpdatedDesc(notes.filter(n => !isSpecialCategory(n)))
  }, [activeCategory, activeView, indexedResults, notes, query, searchCategorySet, vaultRoot])

  const [renderedCount, setRenderedCount] = useState(NOTES_PAGE_SIZE)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const initialScrollDoneRef = useRef(false)

  // Initial scroll to active note
  useEffect(() => {
    if (settingsLoaded && visibleNotes.length > 0 && !initialScrollDoneRef.current) {
      const activeIndex = visibleNotes.findIndex((n) => n.path === activePath)
      if (activeIndex !== -1) {
        initialScrollDoneRef.current = true
        if (activeIndex >= renderedCount) {
          setRenderedCount(activeIndex + 20)
        }
        window.setTimeout(() => {
          const activeElement = document.querySelector('.note-card.active, .note-row.active')
          if (activeElement) {
            activeElement.scrollIntoView({ block: 'center', behavior: 'smooth' })
          }
        }, 150)
      } else if (notes.length > 0) {
        initialScrollDoneRef.current = true
      }
    }
  }, [settingsLoaded, visibleNotes, activePath, renderedCount, notes.length])

  // Reset rendered count when the view/category/search switch
  useEffect(() => {
    setRenderedCount(NOTES_PAGE_SIZE)
  }, [activeView, activeCategory, query, selectedSearchCategories, vaultRoot])

  // IntersectionObserver to load more notes when sentinel enters viewport
  useEffect(() => {
    const sentinel = loadMoreRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setRenderedCount((current) => Math.min(current + NOTES_PAGE_SIZE, visibleNotes.length))
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [visibleNotes.length])

  const visibleNoteGroups = useMemo(() => {
    const sliced = visibleNotes.slice(0, renderedCount)
    if (activeView === 'todo') {
      const today = localDateString()
      const groups = {
        'Overdue': [] as Array<Note | SearchResult>,
        'Due Today': [] as Array<Note | SearchResult>,
        'Upcoming': [] as Array<Note | SearchResult>,
        'No Due Date': [] as Array<Note | SearchResult>,
        'Recently Completed': [] as Array<Note | SearchResult>
      }

      for (const note of sliced) {
        if ('status' in note && note.status === 'done') {
          groups['Recently Completed'].push(note)
        } else if ('due' in note && note.due) {
          const dueDate = note.due.slice(0, 10)
          if (dueDate < today) {
            groups['Overdue'].push(note)
          } else if (dueDate === today) {
            groups['Due Today'].push(note)
          } else {
            groups['Upcoming'].push(note)
          }
        } else {
          groups['No Due Date'].push(note)
        }
      }

      return [
        { month: 'Overdue', notes: groups['Overdue'], isCollapsed: false },
        { month: 'Due Today', notes: groups['Due Today'], isCollapsed: false },
        { month: 'Upcoming', notes: groups['Upcoming'], isCollapsed: false },
        { month: 'No Due Date', notes: groups['No Due Date'], isCollapsed: false },
        { month: 'Recently Completed', notes: groups['Recently Completed'], isCollapsed: true },
      ].filter(g => g.notes.length > 0)
    }

    const groups = new Map<string, Array<Note | SearchResult>>()
    for (const note of sliced) {
      const month = note.createdAt.slice(0, 7)
      groups.set(month, [...(groups.get(month) ?? []), note])
    }
    return Array.from(groups.entries())
      .map(([month, groupedNotes]) => ({ month, notes: groupedNotes, isCollapsed: false }))
      .sort((a, b) => b.month.localeCompare(a.month))
  }, [visibleNotes, renderedCount, activeView])

  useEffect(() => {
    if (!vaultRoot.trim() || !query.trim()) {
      setIndexedResults([])
      return
    }
    let cancelled = false
    searchIndex({ vaultRoot: vaultRoot.trim(), query })
      .then((results) => {
        if (!cancelled) setIndexedResults(results)
      })
      .catch((error) => {
        if (!cancelled) {
          setIndexedResults([])
          setStatus(error instanceof Error ? error.message : String(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [query, vaultRoot])

  useEffect(() => {
    if (!activeNote || !vaultRoot.trim()) {
      setNoteLinks({ outgoing: [], backlinks: [] })
      return
    }
    let cancelled = false
    getNoteLinks({ vaultRoot: vaultRoot.trim(), path: activeNote.path })
      .then((links) => {
        if (!cancelled) setNoteLinks(links)
      })
      .catch(() => {
        if (!cancelled) setNoteLinks({ outgoing: [], backlinks: [] })
      })
    return () => {
      cancelled = true
    }
  }, [activeNote, linkVersion, vaultRoot])

  function updateActiveNote(fullContent: string) {
    if (!activeNote) return
    
    const { body, metadata } = parseMarkdownWithFrontmatter(fullContent)
    
    // MDXEditor normalizes markdown (e.g. table spacing, list bullet characters, loose lists).
    // We normalize both bodies for comparison to avoid marking the note dirty just from opening it.
    const normalizeFormatting = (md: string) => {
      // Remove carriage returns and collapse multiple newlines to a single newline to ignore blank line differences
      let normalized = md.replace(/\r/g, '').replace(/\n{2,}/g, '\n');
      
      // Normalize list item spaces (e.g., "-  item" to "- item")
      normalized = normalized.replace(/^([ \t]*[-*+])[ \t]+/gm, '$1 ');
      normalized = normalized.replace(/^([ \t]*\d+\.)[ \t]+/gm, '$1 ');
      // Normalize bullet characters so `-` and `*` are treated the same
      normalized = normalized.replace(/^([ \t]*)\*[ \t]+/gm, '$1- ');

      return normalized.split('\n').map(line => {
        let row = line.replace(/[ \t]+$/, ''); // Remove trailing spaces from all lines
        const trimmed = row.trim();
        if (trimmed.includes('|')) {
          let tableRow = trimmed.replace(/(^\||\|$)/g, '');
          tableRow = tableRow.replace(/\s*\|\s*/g, '|').trim();
          // Normalize multiple spaces/tabs to a single space to ignore internal text spacing changes
          tableRow = tableRow.replace(/\s+/g, ' ');
          // Handle delimiter rows, including those with colons for alignment
          if (/^[:\-\| ]+$/.test(tableRow)) {
            tableRow = tableRow.split('|').map(cell => {
              const c = cell.trim();
              const left = c.startsWith(':');
              const right = c.endsWith(':');
              if (left && right) return ':C:';
              if (left) return ':L';
              if (right) return 'R:';
              return '-';
            }).join('|');
          }
          return tableRow;
        }
        return row;
      }).join('\n').trim();
    }

    const hasChanges =
      normalizeFormatting(body) !== normalizeFormatting(activeNote.body) ||
      (metadata.title !== undefined && metadata.title !== activeNote.title) ||
      (metadata.category !== undefined && metadata.category !== activeNote.category) ||
      (metadata.tags !== undefined && metadata.tags.join(',') !== activeNote.tags.join(',')) ||
      (metadata.summary !== undefined && metadata.summary !== activeNote.summary) ||
      (metadata.due !== undefined && metadata.due !== activeNote.due) ||
      (metadata.status !== undefined && metadata.status !== activeNote.status) ||
      (metadata.priority !== undefined && metadata.priority !== activeNote.priority) ||
      (metadata.project !== undefined && metadata.project !== activeNote.project)

    if (!hasChanges) {
      return
    }

    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            ...metadata,
            body,
            updatedAt: localDateString(),
            wordCount: body.trim() ? body.trim().split(/\s+/).length : 0,
            isDirty: true,
          }
          : note,
      ),
    )
  }

  function updateActiveNoteTitle(title: string) {
    if (!activeNote) return
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            title,
            updatedAt: localDateString(),
            isDirty: true,
          }
          : note,
      ),
    )
  }

  function updateActiveNoteCreatedAt(createdAt: string) {
    if (!activeNote) return
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            createdAt,
            updatedAt: localDateString(),
            isDirty: true,
          }
          : note,
      ),
    )
  }

  function updateActiveNoteUpdatedAt(updatedAt: string) {
    if (!activeNote) return
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            updatedAt,
            isDirty: true,
          }
          : note,
      ),
    )
  }

  function updateActiveNoteDue(due: string) {
    if (!activeNote) return
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            due,
            updatedAt: localDateString(),
            isDirty: true,
          }
          : note,
      ),
    )
  }

  function updateActiveNoteStatus(status: string) {
    if (!activeNote) return
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            status,
            updatedAt: localDateString(),
            isDirty: true,
          }
          : note,
      ),
    )
  }

  async function updateNoteStatus(path: string, status: string) {
    if (!vaultRoot.trim()) return
    const noteToUpdate = notes.find((n) => n.path === path)
    if (!noteToUpdate) return

    if (activeNote && activeNote.path === path) {
      updateActiveNoteStatus(status)
      return
    }

    try {
      const updatedNote = { ...noteToUpdate, status, updatedAt: localDateString() }
      const saved = await writeNote({
        vaultRoot: vaultRoot.trim(),
        path: updatedNote.path,
        content: noteToMarkdown(updatedNote),
      })
      setNotes((current) => current.map((note) => (note.path === path ? saved : note)))
      setStatus(`Updated status for ${saved.title}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  function updateActiveNotePriority(priority: string) {
    if (!activeNote) return
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            priority,
            updatedAt: localDateString(),
            isDirty: true,
          }
          : note,
      ),
    )
  }

  function updateActiveNoteProject(project: string) {
    if (!activeNote) return
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            project,
            updatedAt: localDateString(),
            isDirty: true,
          }
          : note,
      ),
    )
  }

  function updateActiveNoteTags(value: string) {
    if (!activeNote) return
    const tags = value
      .split(',')
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter(Boolean)
      .filter((tag, index, all) => all.indexOf(tag) === index)
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            tags,
            updatedAt: localDateString(),
            isDirty: true,
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
      await refreshVaultFromDisk('Vault opened. Markdown notes indexed.')
      window.localStorage.setItem(LAST_VAULT_KEY, vaultRoot.trim())
      setSaveError(false)
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
      await rebuildSearchIndex(vaultRoot.trim(), true)
      setNotes(loadedNotes.length ? loadedNotes : [])
      setActivePath(loadedNotes[0]?.path ?? '')
      window.localStorage.setItem(LAST_VAULT_KEY, vaultRoot.trim())
      setSaveError(false)
      setStatus('Starter vault folders are ready.')
    } catch (error) {
      setSaveError(true)
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function saveActiveNote() {
    if (!activeNote || !vaultRoot.trim()) {
      setStatus('Open a real vault before saving.')
      return
    }
    try {
      setIsSaving(true)
      
      let noteToSave = { ...activeNote }
      
      if (noteToSave.title === '无标题' || noteToSave.title === 'Untitled') {
        const firstH1Match = noteToSave.body.match(/^#\s+(.+)$/m)
        if (firstH1Match && firstH1Match[1].trim()) {
          noteToSave.title = firstH1Match[1].trim()
        } else {
          const now = new Date()
          const timestamp = now.getFullYear().toString() + 
            String(now.getMonth() + 1).padStart(2, '0') + 
            String(now.getDate()).padStart(2, '0') + 
            String(now.getHours()).padStart(2, '0') + 
            String(now.getMinutes()).padStart(2, '0') + 
            String(now.getSeconds()).padStart(2, '0')
          const randomDigits = Math.floor(1000 + Math.random() * 9000)
          noteToSave.title = `${timestamp}-${randomDigits}`
        }
      }

      const expectedFilename = `${getFilenameForTitle(noteToSave.title)}.md`
      let expectedPath = noteToSave.category ? `${noteToSave.category}/${expectedFilename}` : expectedFilename
      expectedPath = expectedPath.replace(/\/+/g, '/')
      
      let finalPath = noteToSave.path
      
      if (noteToSave.path !== expectedPath) {
        try {
          const moved = await moveNote({ vaultRoot: vaultRoot.trim(), from: noteToSave.path, to: expectedPath })
          finalPath = moved.path
        } catch (error) {
          const newExpectedPath = expectedPath.replace(/\.md$/, `-${Math.floor(1000 + Math.random() * 9000)}.md`)
          const moved = await moveNote({ vaultRoot: vaultRoot.trim(), from: noteToSave.path, to: newExpectedPath })
          finalPath = moved.path
        }
        noteToSave.path = finalPath
      }

      const saved = await writeNote({
        vaultRoot: vaultRoot.trim(),
        path: finalPath,
        content: noteToMarkdown(noteToSave),
      })
      setLinkVersion((current) => current + 1)
      setNotes((current) => current.map((note) => (note.path === activeNote.path ? saved : note)))
      
      if (activeNote.path !== saved.path) {
        setActivePath(saved.path)
      }
      setActiveCategory(saved.category)
      setSaveError(false)
      setStatus(`Saved ${saved.path}.`)
    } catch (error) {
      setSaveError(true)
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSaving(false)
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
        diskNote.tags.join('\n') !== activeNote.tags.join('\n') ||
        diskNote.category !== activeNote.category ||
        diskNote.summary !== activeNote.summary ||
        diskNote.due !== activeNote.due ||
        diskNote.status !== activeNote.status ||
        diskNote.project !== activeNote.project

      if (!changedOnDisk) {
        setStatus('Disk version matches the editor.')
        return
      }

      const reload = await safeConfirm(`${activeNote.path} changed on disk. Reload the disk version?`)
      if (!reload) {
        setStatus('Kept editor version. Save to overwrite disk when ready.')
        setNotes((current) => current.map((note) => (note.path === diskNote.path ? { ...note, isDirty: true } : note)))
        return
      }

      setNotes((current) => current.map((note) => (note.path === diskNote.path ? diskNote : note)))
      setSaveError(false)
      setStatus(`Reloaded ${diskNote.path} from disk.`)
    } catch (error) {
      setSaveError(true)
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function archiveActiveInboxNote() {
    if (!activeNote || !vaultRoot.trim()) {
      setStatus('Open a real vault before archiving inbox notes.')
      return
    }
    if (!activeNote.path.startsWith('00-inbox/')) {
      setStatus('Only inbox notes can use the archive flow.')
      return
    }
    const title = await safePrompt('Archive title', activeNote.title)
    if (!title) return
    const category = await safePrompt('Archive category', activeCategory && activeCategory !== '00-inbox' ? activeCategory : 'knowledge')
    if (!category) return
    try {
      const archived = await archiveNote({
        vaultRoot: vaultRoot.trim(),
        from: activeNote.path,
        title,
        category,
        tags: activeNote.tags.filter((tag) => tag !== 'inbox'),
        createdAt: activeNote.createdAt,
        body: activeNote.body,
      })
      setLinkVersion((current) => current + 1)
      setNotes((current) => [archived, ...current.filter((note) => note.path !== activeNote.path)])
      setActivePath(archived.path)
      setActiveCategory(archived.category)
      setActiveView('category')
      setSaveError(false)
      setStatus(`Archived to ${archived.path}.`)
    } catch (error) {
      setSaveError(true)
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
      setLinkVersion((current) => current + 1)
      setNotes((current) => [note, ...current.filter((item) => item.path !== note.path)])
      setActivePath(note.path)
      setSaveError(false)
      setStatus(`Opened ${note.path}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function addWeeklyReview() {
    if (!vaultRoot.trim()) {
      setStatus('Open a real vault before creating weekly review.')
      return
    }
    try {
      const today = localDateString()
      const note = await createWeeklyReview({ vaultRoot: vaultRoot.trim(), date: today })
      setLinkVersion((current) => current + 1)
      setNotes((current) => [note, ...current.filter((item) => item.path !== note.path)])
      setActivePath(note.path)
      setActiveCategory(note.category)
      setActiveView('category')
      setSaveError(false)
      setStatus(`Created ${note.path}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function addMonthlyReview() {
    if (!vaultRoot.trim()) {
      setStatus('Open a real vault before creating monthly review.')
      return
    }
    try {
      const today = localDateString()
      const note = await createMonthlyReview({ vaultRoot: vaultRoot.trim(), date: today })
      setLinkVersion((current) => current + 1)
      setNotes((current) => [note, ...current.filter((item) => item.path !== note.path)])
      setActivePath(note.path)
      setActiveCategory(note.category)
      setActiveView('category')
      setSaveError(false)
      setStatus(`Created ${note.path}.`)
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
      setLinkVersion((current) => current + 1)
      setNotes((current) => [note, ...current])
      setActivePath(note.path)
      setSaveError(false)
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
    const title = '无标题'
    const fallbackCategory = categoryOptions.length > 0 ? categoryOptions[0].name : 'knowledge'
    const category = defaultCategory || fallbackCategory
    try {
      const note = await createNote({ vaultRoot: vaultRoot.trim(), title, category })
      setLinkVersion((current) => current + 1)
      setNotes((current) => [note, ...current])
      setActivePath(note.path)
      setActiveCategory(note.category)
      setActiveView('category')
      setSaveError(false)
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
    const path = await safePrompt('Folder path', activeCategory || 'knowledge/new-topic')
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
    const nextName = await safePrompt('New filename', currentName)
    if (!nextName || nextName === currentName) return
    const folder = activeNote.path.includes('/') ? activeNote.path.split('/').slice(0, -1).join('/') : ''
    const normalized = nextName.endsWith('.md') ? nextName : `${nextName}.md`
    const to = folder ? `${folder}/${normalized}` : normalized
    await moveActiveNote(to)
  }

  async function moveActiveNotePrompt() {
    if (!activeNote) return
    const nextPath = await safePrompt('Move to path', activeNote.path)
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
      setSaveError(false)
      setStatus(`Moved to ${moved.path}.`)

      setLinkVersion((current) => current + 1)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function deleteNoteByPath(path: string) {
    if (!vaultRoot.trim()) {
      setStatus('Open a real vault before deleting notes.')
      return
    }
    const isTrash = path.startsWith('.trash/')
    const confirmed = await safeConfirm(isTrash ? `Permanently delete ${path}?` : `Move ${path} to trash?`)
    if (!confirmed) return
    try {
      skipNextVaultChangeUntilRef.current = Date.now() + 1500
      await deleteNote(vaultRoot.trim(), path)
      const remaining = notes.filter((note) => note.path !== path)
      setNotes(remaining)
      setIndexedResults((current) => current.filter((note) => note.path !== path))
      setLinkVersion((current) => current + 1)
      setActivePath((current) => (current === path ? (remaining[0]?.path ?? '') : current))
      setSaveError(false)
      setStatus(isTrash ? `Permanently deleted ${path}.` : `Moved ${path} to trash.`)
    } catch (error) {
      skipNextVaultChangeUntilRef.current = 0
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  function deleteActiveNote() {
    if (!activeNote) return
    void deleteNoteByPath(activeNote.path)
  }

  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!leftSidebarVisible || event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = leftSidebarWidth

    function resize(moveEvent: PointerEvent) {
      const nextWidth = Math.min(560, Math.max(220, Math.round(startWidth + moveEvent.clientX - startX)))
      setLeftSidebarWidth(nextWidth)
    }

    function stopResize() {
      document.body.style.cursor = ''
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', stopResize)
    }

    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', stopResize)
  }

  function startRightSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!rightSidebarVisible || event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = rightSidebarWidth

    function resize(moveEvent: PointerEvent) {
      // Moving left increases width, moving right decreases width
      const nextWidth = Math.min(560, Math.max(220, Math.round(startWidth - (moveEvent.clientX - startX))))
      setRightSidebarWidth(nextWidth)
    }

    function stopResize() {
      document.body.style.cursor = ''
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', stopResize)
    }

    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', stopResize)
  }

  async function rebuildIndex() {
    if (!vaultRoot.trim()) {
      setStatus('Open a real vault before rebuilding the index.')
      return
    }
    try {
      await rebuildSearchIndex(vaultRoot.trim())
      setLinkVersion((current) => current + 1)
      if (query.trim()) {
        setIndexedResults(await searchIndex({ vaultRoot: vaultRoot.trim(), query }))
      }
      setStatus('Search index rebuilt.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <main className="app-frame" data-theme={effectiveTheme}>
      <header
        className="window-topbar"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button, input, a, [data-no-drag]')) return
          if (e.button !== 0) return
          e.preventDefault()
          getCurrentWindow().startDragging().catch(() => { })
        }}
      >
        <button
          className={leftSidebarVisible ? 'topbar-icon-button active' : 'topbar-icon-button'}
          type="button"
          onClick={() => setLeftSidebarVisible((current) => !current)}
          title={leftSidebarVisible ? 'Hide left sidebar' : 'Show left sidebar'}
          aria-label={leftSidebarVisible ? 'Hide left sidebar' : 'Show left sidebar'}
        >
          <PanelLeft size={17} />
        </button>
        <div className="window-brand" aria-label="iNote window">
          <strong>iNote</strong>
          <span>{vaultRoot.trim() ? vaultRoot.split('/').filter(Boolean).pop() : 'Demo workspace'}</span>
        </div>
        <div className="command-box window-command">

          <Search size={17} />
          <input
            aria-label="Search notes or #tags"
            placeholder="Search notes or #tags"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveView('search')
            }}
          />
        </div>
        <div className="window-actions" aria-label="Window actions">
          <button className="icon-action" type="button" onClick={addCategoryNote} title="Create note" aria-label="Create note">
            <Pencil size={16} />
          </button>
          <button className="icon-action" type="button" onClick={addFolder} title="Create folder" aria-label="Create folder">
            <FolderPlus size={16} />
          </button>
          <button
            className={tagsPopoverOpen ? 'icon-action active' : 'icon-action'}
            type="button"
            onClick={() => setTagsPopoverOpen(true)}
            title="Tags"
            aria-label="Open tags"
          >
            <Tags size={17} />
          </button>
          <button
            className={activeView === 'calendar' ? 'icon-action active' : 'icon-action'}
            type="button"
            onClick={() => toggleSpecialView('calendar')}
            title="Calendar"
            aria-label="Open calendar"
          >
            <CalendarDays size={17} />
          </button>
          <button
            className={activeView === 'archive' ? 'icon-action active' : 'icon-action'}
            type="button"
            onClick={() => toggleSpecialView('archive')}
            title="Archive"
            aria-label="Open archive"
          >
            <Archive size={17} />
          </button>
          <button
            className={activeView === 'trash' ? 'icon-action active' : 'icon-action'}
            type="button"
            onClick={() => toggleSpecialView('trash')}
            title="Trash"
            aria-label="Open trash"
          >
            <Trash2 size={17} />
          </button>
          <button
            className={settingsOpen ? 'icon-action active' : 'icon-action'}
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Open settings"
          >
            <Settings size={17} />
          </button>
          <button
            className={rightSidebarVisible ? 'icon-action active' : 'icon-action'}
            type="button"
            onClick={() => setRightSidebarVisible((current) => !current)}
            title={rightSidebarVisible ? 'Hide right sidebar' : 'Show right sidebar'}
            aria-label={rightSidebarVisible ? 'Hide right sidebar' : 'Show right sidebar'}
          >
            <PanelRight size={17} />
          </button>
        </div>
      </header>

      <div
        className="app-shell"
        style={{
          gridTemplateColumns: `${leftSidebarVisible ? `${leftSidebarWidth}px 5px` : '0 0'} minmax(0, 1fr) ${rightSidebarVisible ? `5px ${rightSidebarWidth}px` : '0 0'
            }`,
        }}
      >
        <aside className={leftSidebarVisible ? 'sidebar' : 'sidebar hidden'}>
          <div className="list-header">
            <details
              ref={categoryFilterRef}
              className="category-filter"
              data-no-drag
              open={categoryFilterOpen}
              onBlur={(event) => {
                if (categoryFilterPointerInsideRef.current) return
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setCategoryFilterOpen(false)
                }
              }}
              onPointerDownCapture={() => {
                categoryFilterPointerInsideRef.current = true
                window.setTimeout(() => {
                  categoryFilterPointerInsideRef.current = false
                }, 0)
              }}
              onToggle={(event) => setCategoryFilterOpen(event.currentTarget.open)}
            >
              <summary title={searchScopeLabel}>
                {activeView === 'today'
                  ? 'Today'
                  : activeView === 'search'
                    ? searchScopeLabel
                    : activeView === 'category'
                      ? activeCategory
                      : activeView === 'archive'
                        ? 'Archive'
                        : activeView === 'trash'
                          ? 'Trash'
                          : 'All notes'}
              </summary>
              <div className="category-filter-menu">
                <label>
                  <input
                    checked={selectedSearchCategories.length === 0}
                    type="checkbox"
                    onChange={() => {
                      setSelectedSearchCategories([])
                      setActiveView('search')
                    }}
                  />
                  <Check className="category-check" size={14} />
                  <span>All categories</span>
                </label>
                {categoryOptions.map((category) => (
                  <label key={category.name}>
                    <input
                      checked={searchCategorySet.has(category.name)}
                      type="checkbox"
                      onChange={(event) => {
                        setActiveView('search')
                        setSelectedSearchCategories((current) => {
                          if (event.target.checked) return [...current, category.name].sort((a, b) => a.localeCompare(b))
                          return current.filter((name) => name !== category.name)
                        })
                      }}
                    />
                    <Check className="category-check" size={14} />
                    <span>{category.name}</span>
                    <small>{category.count}</small>
                  </label>
                ))}
              </div>
            </details>
            <button
              className={activeView === 'todo' ? 'todo-toggle-btn active' : 'todo-toggle-btn'}
              onClick={() => {
                if (activeView === 'todo') {
                  setActiveView(previousViewRef.current.view)
                  setActiveCategory(previousViewRef.current.category)
                  if (previousViewRef.current.path) {
                    setActivePath(previousViewRef.current.path)
                  }
                } else {
                  if (activeView !== 'archive' && activeView !== 'trash' && activeView !== 'calendar' && activeView !== 'todo') {
                    previousViewRef.current = { view: activeView, category: activeCategory, path: activePath }
                  }
                  setActiveView('todo')
                  setActivePath('')
                }
              }}
              title="Todo List"
              aria-label="Toggle Todo List"
            >
              <ListTodo size={15} />
            </button>
            <div className="note-list-tools" aria-label="Note list display mode">
              <small>{visibleNotes.length}</small>
              <button
                className={noteListMode === 'cards' ? 'active' : ''}
                type="button"
                onClick={() => setNoteListMode('cards')}
                title="Card view"
                aria-label="Card view"
              >
                <LayoutGrid size={14} />
              </button>
              <button
                className={noteListMode === 'summary' ? 'active' : ''}
                type="button"
                onClick={() => setNoteListMode('summary')}
                title="Summary view"
                aria-label="Summary view"
              >
                <List size={14} />
              </button>
            </div>
          </div>
          <div className={`note-list ${noteListMode}`}>
            {visibleNoteGroups.map((group) => {
              const header = (
                <>
                  <h3>{group.month}</h3>
                  <small>{group.notes.length}</small>
                </>
              );
              const content = (
                <div className={noteListMode === 'cards' ? 'note-card-grid' : 'note-summary-stack'}>
                  {group.notes.map((note) =>
                    noteListMode === 'cards' ? (
                      <NoteCardItem
                        key={note.path}
                        note={note}
                        isActive={note.path === activePath}
                        onSelect={setActivePath}
                      />
                    ) : (
                      <NoteRowItem
                        key={note.path}
                        note={note}
                        isActive={note.path === activePath}
                        onSelect={setActivePath}
                      />
                    )
                  )}
                </div>
              );

              return (
                <section className="note-month-group" key={group.month}>
                  {group.isCollapsed ? (
                    <details className="note-group-details" data-no-drag>
                      <summary className="note-month-header">
                        {header}
                      </summary>
                      {content}
                    </details>
                  ) : (
                    <>
                      <div className="note-month-header">
                        {header}
                      </div>
                      {content}
                    </>
                  )}
                </section>
              );
            })}
            {renderedCount < visibleNotes.length && (
              <div ref={loadMoreRef} className="load-more-sentinel" aria-hidden="true" />
            )}
          </div>
        </aside>
        <div
          className={leftSidebarVisible ? 'sidebar-resizer' : 'sidebar-resizer hidden'}
          onPointerDown={startSidebarResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize left sidebar"
        />

        <section className="workspace">

          {activeView === 'calendar' ? (
            <Suspense fallback={<div className="empty">Loading calendar…</div>}>
              <CalendarView notes={notes} onSelectNote={setActivePath} onClose={() => toggleSpecialView('calendar')} />
            </Suspense>
          ) : activeView === 'todo' && !activeNote ? (
            <Suspense fallback={<div className="empty">Loading todo dashboard…</div>}>
              <TodoDashboard notes={visibleNotes} onSelectNote={setActivePath} onUpdateNoteStatus={updateNoteStatus} />
            </Suspense>
          ) : activeNote ? (
              <Editor
                key={activeNote.path}
                vaultRoot={vaultRoot.trim()}
                note={activeNote}
                onChange={updateActiveNote}
                onSave={saveActiveNote}
                onRename={renameActiveNote}
                onMove={moveActiveNotePrompt}
                onCheckExternal={checkExternalActiveNote}
                onDelete={deleteActiveNote}
                previewMode={previewMode}
                onTogglePreview={() => setPreviewMode((current) => !current)}
                saveState={saveState}
                noteLinks={noteLinks}
                onUpdateTitle={updateActiveNoteTitle}
                onUpdateCreatedAt={updateActiveNoteCreatedAt}
                onUpdateUpdatedAt={updateActiveNoteUpdatedAt}
                onUpdateDue={updateActiveNoteDue}
                onUpdateStatus={updateActiveNoteStatus}
                onUpdatePriority={updateActiveNotePriority}
                onUpdateProject={updateActiveNoteProject}
                onUpdateTags={updateActiveNoteTags}
                onArchiveInboxNote={archiveActiveInboxNote}
                onNavigateLink={setActivePath}
              />
            ) : (
              <div className="empty">
                {activeView === 'search' && query.startsWith('#')
                  ? '请在左侧边栏查看具体的搜索结果 (Please view the specific search results in the left sidebar)'
                  : 'No note selected.'}
              </div>
            )
          }
        </section>

        <div
          className={rightSidebarVisible ? 'sidebar-resizer right' : 'sidebar-resizer hidden'}
          onPointerDown={startRightSidebarResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize right sidebar"
        />

        <aside className={rightSidebarVisible ? 'context-panel' : 'context-panel hidden'}>
          {activeNote ? (
            <>

              <section className="context-section">
                <p className="panel-title">
                  <Bot size={14} /> Assistant
                </p>
                <Suspense fallback={<div className="empty">Loading assistant…</div>}>
                  <LlmAssistant note={activeNote} notes={notes} settings={llmSettings} />
                </Suspense>
              </section>
            </>
          ) : null}
        </aside>
      </div>

      {settingsOpen ? (
        <div className="settings-window-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <div
            className="settings-window"
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Suspense fallback={<div className="empty">Loading settings…</div>}>
              <SettingsPanel
                vaultRoot={vaultRoot}
                status={status}
                llmSettings={llmSettings}
                themePreference={themePreference}
                effectiveTheme={effectiveTheme}
                baseFontSize={baseFontSize}
                defaultCategory={defaultCategory}
                categories={categoryOptions}
                onVaultRootChange={setVaultRoot}
                onLlmSettingsChange={setLlmSettings}
                onThemePreferenceChange={setThemePreference}
                onBaseFontSizeChange={setBaseFontSize}
                onDefaultCategoryChange={setDefaultCategory}
                onOpenVault={openVault}
                onInitializeVault={initVault}
                onCreateToday={addTodayNote}
                onCreateInbox={addInboxNote}
                onCreateWeeklyReview={addWeeklyReview}
                onCreateMonthlyReview={addMonthlyReview}
                onCreateFolder={addFolder}
                onRebuildIndex={rebuildIndex}
                onClose={() => setSettingsOpen(false)}
              />
            </Suspense>
          </div>
        </div>
      ) : null}

      {tagsPopoverOpen ? (
        <div className="tags-popover-backdrop" role="presentation" onMouseDown={() => setTagsPopoverOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Tags" onMouseDown={(event) => event.stopPropagation()}>
            <Suspense fallback={<div className="empty">Loading tags…</div>}>
              <TagsPanel
                notes={notes}
                onSelectNote={(path) => {
                  setActivePath(path)
                }}
                onClose={() => setTagsPopoverOpen(false)}
              />
            </Suspense>
          </div>
        </div>
      ) : null}

      {promptConfig ? (
        <div className="settings-window-backdrop" role="presentation" style={{ zIndex: 1000 }} onMouseDown={() => { promptConfig.resolve(null); setPromptConfig(null) }}>
          <div
            className="settings-window"
            role="dialog"
            aria-modal="true"
            aria-label={promptConfig.message}
            style={{ width: '400px', height: 'auto', minHeight: 'auto', padding: '24px' }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <form onSubmit={(e) => {
              e.preventDefault()
              const val = new FormData(e.currentTarget).get('val') as string
              promptConfig.resolve(val)
              setPromptConfig(null)
            }}>
              <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: 'var(--font-size-lg)', fontWeight: '600' }}>{promptConfig.message}</h3>
              <input
                name="val"
                defaultValue={promptConfig.defaultValue}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    promptConfig.resolve(null)
                    setPromptConfig(null)
                  }
                }}
                style={{ 
                  width: '100%', 
                  padding: '8px 12px', 
                  marginBottom: '24px', 
                  backgroundColor: 'var(--surface-sunken)', 
                  color: 'var(--text-primary)', 
                  border: '1px solid var(--border)', 
                  borderRadius: '4px',
                  outline: 'none',
                  fontSize: 'var(--font-size-base)'
                }}
              />
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button type="button" className="btn" onClick={() => { promptConfig.resolve(null); setPromptConfig(null) }}>Cancel</button>
                <button type="submit" className="btn primary">OK</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <footer className="status-bar">
        <span className={`status-pill ${saveState}`}>{saveLabel}</span>
        <span>Vault: {vaultRoot.trim() ? vaultRoot.split('/').filter(Boolean).pop() : 'Demo workspace'}</span>
        <span>{notes.length} notes</span>
        <span>{status}</span>
        <span>{activeNote ? activeNote.path : 'No note'}</span>
        <span>{activeNote ? `${activeNote.wordCount} words` : `${totalWords} words total`}</span>
      </footer>
    </main>
  )
}
