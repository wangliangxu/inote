import { reminderTimings } from '../todo/reminders'
import { useMemo, useState, useEffect, useRef, memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { Note, SaveState, NoteLinks } from '../../shared/types'
import { noteToMarkdown, parseMarkdownWithFrontmatter, setSetting, checkFileExists, saveNoteImage } from '../../shared/api'
import { openUrl } from '@tauri-apps/plugin-opener'
import { convertFileSrc } from '@tauri-apps/api/core'
import { toMarkdownImagePreviewSrc } from '../../shared/markdownImages'
import { normalizeMarkdownBody, preserveMarkdownTrailingWhitespace, EDITOR_TO_MARKDOWN_OPTIONS } from '../../shared/normalizeMarkdown'
import { orderedListStartPlugin } from './orderedListStartPlugin'
import { captureRichTextSelection, restoreRichTextSelection, type RichTextSelectionSnapshot } from './richTextSelection'
import { isDarkThemeDatasetValue } from '../../shared/theme'
import { TextCursorInput, RefreshCw, Save, Trash2, MoveRight, Info, Archive, Link2, ListTree, ListOrdered } from 'lucide-react'
import { $getNearestNodeFromDOMNode, $isElementNode } from 'lexical'
import { computeScrollTopForChild, extractMarkdownHeadings, findActiveHeadingFromLine as findActiveHeadingIndexFromLine, findRichTextHeadingElementIndex, isScrollableOverflowY, type EditorHeading } from './editorToc'
import {
  MDXEditor,
  type MDXEditorMethods,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  frontmatterPlugin,
  tablePlugin,
  linkPlugin,
  linkDialogPlugin,
  imagePlugin,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  CreateLink,
  InsertTable,
  ListsToggle,
  InsertThematicBreak,
  diffSourcePlugin,
  DiffSourceToggleWrapper,
  InsertImage,
  codeBlockPlugin,
  codeMirrorPlugin,
  InsertCodeBlock,
  viewMode$,
  markdown$,
  muteChange$,
  rootEditor$,
  activeEditor$,
  convertSelectionToNode$,
  realmPlugin
} from '@mdxeditor/editor'
import { withLatestFrom } from '@mdxeditor/gurx'
import '@mdxeditor/editor/style.css'
import { EditorView } from '@codemirror/view'
import { installTableCellBackspaceGuard } from './tableCellBackspacePlugin'
import { getCodeMirrorCspExtensions } from './codeMirrorCsp'
import { diffOnlyExtension } from './diffOnly'
import { installSearchHighlights } from './searchHighlights'
import { HighlightedText } from '../search/HighlightedText'

interface EditorProps {
  vaultRoot?: string
  note: Note
  searchQuery?: string
  onChange: (body: string) => void
  onSave?: () => void
  onCheckExternal?: () => void
  previewMode?: boolean
  onTogglePreview?: () => void
  onRename?: () => void
  onMove?: () => void
  onDelete?: () => void
  saveState?: SaveState
  noteLinks?: NoteLinks
  onUpdateTitle?: (title: string) => void
  onUpdateCreatedAt?: (date: string) => void
  onUpdateUpdatedAt?: (date: string) => void
  onUpdateDue?: (date: string) => void
  remindersEnabled?: boolean
  onUpdateReminder?: (timing: string) => void
  onUpdateStatus?: (status: string) => void
  onUpdatePriority?: (priority: string) => void
  onUpdateProject?: (project: string) => void
  onUpdateTags?: (tags: string) => void
  onArchiveInboxNote?: () => void
  onNavigateLink?: (path: string) => void
}

export const MDXEDITOR_SUPPRESS_HTML_PROCESSING = true

const TagsInput = memo(function TagsInput({ tags, onChange }: { tags: string[], onChange: (value: string) => void }) {
  const [value, setValue] = useState(tags.join(', '))

  useEffect(() => {
    const currentTags = value
      .split(',')
      .map(t => t.trim().replace(/^#/, ''))
      .filter(Boolean)
      .filter((tag, index, all) => all.indexOf(tag) === index)
      .join(',')
    
    const newTags = tags.join(',')
    
    if (currentTags !== newTags) {
      setValue(tags.join(', '))
    }
  }, [tags, value])

  return (
    <input 
      value={value} 
      onChange={(e) => {
        setValue(e.target.value)
        onChange(e.target.value)
      }} 
    />
  )
})

export function Editor({
  vaultRoot = '',
  note,
  searchQuery = '',
  onChange,
  onSave,
  onCheckExternal,
  previewMode = false,
  onRename,
  onMove,
  onDelete,
  saveState = 'demo',
  noteLinks,
  onUpdateTitle,
  onUpdateCreatedAt,
  onUpdateUpdatedAt,
  onUpdateDue,
  remindersEnabled = false,
  onUpdateReminder,
  onUpdateStatus,
  onUpdatePriority,
  onUpdateProject,
  onUpdateTags,
  onArchiveInboxNote,
  onNavigateLink,
}: EditorProps) {
  const { t } = useTranslation()
  const editorRef = useRef<MDXEditorMethods>(null)
  const editorWrapperRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!editorWrapperRef.current || !searchQuery.trim()) return
    return installSearchHighlights(editorWrapperRef.current, searchQuery)
  }, [searchQuery, note.path])

  const isInternalChangeRef = useRef(false)
  const pendingBlockTypeSelectionRef = useRef<RichTextSelectionSnapshot | null>(null)

  const getEditorContainer = useCallback(() => {
    return editorWrapperRef.current?.querySelector('.mdx-editor-main') ?? null
  }, [])

  const getRichTextArea = useCallback(() => {
    const editorContainer = getEditorContainer()
    if (!editorContainer) return null

    const candidates = Array.from(editorContainer.querySelectorAll<HTMLElement>('[contenteditable="true"]'))
    return candidates.find(el => !el.closest('.cm-editor') && el.closest('.mdxeditor-root-contenteditable')) ??
      candidates.find(el => !el.closest('.cm-editor')) ??
      null
  }, [getEditorContainer])

  const getRichTextScrollContainer = useCallback((richTextArea: HTMLElement) => {
    const editorContainer = getEditorContainer()
    let node = richTextArea.parentElement

    while (node && node !== editorContainer) {
      const { overflowY } = window.getComputedStyle(node)
      if (
        isScrollableOverflowY(overflowY) &&
        node.scrollHeight > node.clientHeight
      ) {
        return node
      }
      node = node.parentElement
    }

    const wrapper = editorContainer?.querySelector('.mdxeditor-diff-source-wrapper')
    return wrapper instanceof HTMLElement ? wrapper : null
  }, [getEditorContainer])

  // Prevent Backspace/Delete in empty table cells from freezing the editor
  useEffect(() => {
    const el = editorWrapperRef.current
    if (!el) return
    return installTableCellBackspaceGuard(el)
  }, [note.path]) // re-install when the note changes (editor re-mounts)

  // Intercept link clicks in rich-text mode:
  // - HTTP(S) links → open in the system browser
  // - .md file links → navigate to the note if the file exists in the vault
  useEffect(() => {
    const el = editorWrapperRef.current
    if (!el) return

    const handleLinkClick = async (e: MouseEvent) => {
      // Walk up from click target to find an <a> element
      let target = e.target as HTMLElement | null
      while (target && target !== el) {
        if (target.tagName === 'A') break
        target = target.parentElement
      }
      if (!target || target.tagName !== 'A') return

      const anchor = target as HTMLAnchorElement
      const href = anchor.getAttribute('href')
      if (!href) return

      // Only intercept in rich-text contenteditable, not in CodeMirror/source mode
      const richTextArea = getRichTextArea()
      if (!richTextArea || !richTextArea.contains(anchor)) return

      e.preventDefault()
      e.stopPropagation()

      // HTTP(S) links → open in system browser
      if (/^https?:\/\//i.test(href)) {
        try {
          await openUrl(href)
        } catch (err) {
          console.error('Failed to open URL in system browser:', err)
        }
        return
      }

      // .md file links → navigate within the app
      if (href.endsWith('.md')) {
        // Resolve relative path based on current note's directory
        const noteDir = note.path.includes('/')
          ? note.path.substring(0, note.path.lastIndexOf('/'))
          : ''
        const resolvedPath = href.startsWith('/')
          ? href.slice(1) // Absolute path from vault root — strip leading /
          : noteDir
            ? `${noteDir}/${href}`
            : href

        // Normalize: collapse '..' and '.' segments
        const parts = resolvedPath.split('/')
        const normalized: string[] = []
        for (const part of parts) {
          if (part === '.' || part === '') continue
          if (part === '..') { normalized.pop(); continue }
          normalized.push(part)
        }
        const finalPath = normalized.join('/')

        try {
          const exists = await checkFileExists(vaultRoot, finalPath)
          if (exists) {
            onNavigateLink?.(finalPath)
          } else {
            console.warn('Linked .md file not found in vault:', finalPath)
          }
        } catch (err) {
          console.error('Failed to check file existence:', err)
        }
        return
      }

      // Other links (mailto:, etc.) → try opening in system browser
      try {
        await openUrl(href)
      } catch (err) {
        console.error('Failed to open link:', err)
      }
    }

    el.addEventListener('click', handleLinkClick)
    return () => el.removeEventListener('click', handleLinkClick)
  }, [note.path, vaultRoot, onNavigateLink, getRichTextArea])

  // Pre-normalize the markdown body so it matches MDXEditor's canonical output.
  // This prevents spurious diffs (bullet chars, list spacing, table formatting)
  // that would otherwise appear when the editor round-trips the content.
  const normalizedMarkdown = useMemo(() => {
    const raw = noteToMarkdown(note)
    const match = raw.match(/^(---\n[\s\S]*?\n---\n\n)([\s\S]*)$/)
    if (!match) return raw
    const [, frontmatter, body] = match
    return frontmatter + normalizeMarkdownBody(body)
  }, [note])

  const lastEditorMarkdownRef = useRef({ path: note.path, markdown: normalizedMarkdown })
  const sourceEditRef = useRef<{ markdown: string } | null>(null)
  const restoreEditorWhitespaceRef = useRef<(() => void) | null>(null)
  if (lastEditorMarkdownRef.current.path !== note.path) {
    lastEditorMarkdownRef.current = { path: note.path, markdown: normalizedMarkdown }
    sourceEditRef.current = null
    isInternalChangeRef.current = false
  }

  const handleEditorChange = useCallback((body: string, initialMarkdownNormalize: boolean) => {
    const previous = lastEditorMarkdownRef.current.markdown
    const sourceEdit = sourceEditRef.current?.markdown === body
    if (sourceEdit) sourceEditRef.current = null
    // Source/diff editors also publish focus, selection and programmatic updates.
    // Only document edits may replace the original trailing whitespace.
    if (!initialMarkdownNormalize && currentViewModeRef.current !== 'rich-text' && !sourceEdit) return
    const markdown = sourceEdit ? body : preserveMarkdownTrailingWhitespace(body, previous)
    lastEditorMarkdownRef.current.markdown = markdown
    if (initialMarkdownNormalize || markdown === previous) return
    isInternalChangeRef.current = true
    onChange(markdown)
  }, [onChange])

  const [savedViewMode] = useState<'rich-text' | 'diff' | 'source'>(() => {
    if (typeof localStorage !== 'undefined') {
      return (localStorage.getItem('mdxeditor-view-mode') as any) || 'rich-text'
    }
    return 'rich-text'
  })

  const [diffBaseline, setDiffBaseline] = useState(() => normalizedMarkdown)
  const [metadataPanelOpen, setMetadataPanelOpen] = useState(() => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('mdxeditor-metadata-open') === 'true'
    }
    return false
  })
  const metadataPanelOpenRef = useRef(metadataPanelOpen)

  const [tocPanelOpen, setTocPanelOpen] = useState(() => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('mdxeditor-toc-open') === 'true'
    }
    return false
  })

  const [tocNumbering, setTocNumbering] = useState(() => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('mdxeditor-toc-numbering') === 'true'
    }
    return false
  })

  useEffect(() => {
    metadataPanelOpenRef.current = metadataPanelOpen
  }, [metadataPanelOpen])

  useEffect(() => {
    localStorage.setItem('mdxeditor-metadata-open', String(metadataPanelOpen))
    setSetting('mdxeditor-metadata-open', String(metadataPanelOpen)).catch(console.error)
  }, [metadataPanelOpen])

  useEffect(() => {
    localStorage.setItem('mdxeditor-toc-open', String(tocPanelOpen))
    setSetting('mdxeditor-toc-open', String(tocPanelOpen)).catch(console.error)
  }, [tocPanelOpen])

  useEffect(() => {
    localStorage.setItem('mdxeditor-toc-numbering', String(tocNumbering))
    setSetting('mdxeditor-toc-numbering', String(tocNumbering)).catch(console.error)
  }, [tocNumbering])

  const [activeHeadingIndex, setActiveHeadingIndex] = useState<number>(-1)
  const activeHeadingIndexRef = useRef(activeHeadingIndex)
  useEffect(() => { activeHeadingIndexRef.current = activeHeadingIndex }, [activeHeadingIndex])

  // Auto-scroll TOC when active heading changes
  useEffect(() => {
    if (activeHeadingIndex >= 0) {
      const activeEl = document.getElementById(`toc-heading-${activeHeadingIndex}`)
      const container = activeEl?.closest('.context-panel') as HTMLElement | null
      if (activeEl && container) {
        const containerRect = container.getBoundingClientRect()
        const elRect = activeEl.getBoundingClientRect()
        if (elRect.top < containerRect.top) {
          container.scrollBy({ top: elRect.top - containerRect.top - 8, behavior: 'smooth' })
        } else if (elRect.bottom > containerRect.bottom) {
          container.scrollBy({ top: elRect.bottom - containerRect.bottom + 8, behavior: 'smooth' })
        }
      } else if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }, [activeHeadingIndex])

  // Extract headings
  const headings = useMemo(() => {
    return extractMarkdownHeadings(normalizedMarkdown)
  }, [normalizedMarkdown])

  const headingsRef = useRef(headings)
  useEffect(() => { headingsRef.current = headings }, [headings])

  // Helper: find the active heading index from a 0-based line index
  const findActiveHeadingFromLine = useCallback((lineIndex: number) => {
    return findActiveHeadingIndexFromLine(headings, lineIndex)
  }, [headings])

  // Helper: get the CodeMirror EditorView for the source/diff editor (NOT code block editors)
  const getCmEditorView = useCallback(() => {
    const mode = currentViewModeRef.current
    if (mode !== 'source' && mode !== 'diff') return null

    // Source mode: .mdxeditor-source-editor .cm-editor
    // Diff mode: .mdxeditor-diff-editor .cm-editor (last one is the editable "b" side)
    const editorContainer = getEditorContainer()
    if (!editorContainer) return null
    const cmEditors = editorContainer.querySelectorAll('.cm-editor')
    if (cmEditors.length === 0) return null
    // Pick the last cm-editor (in diff mode, the "b" side is last)
    const cmEl = cmEditors[cmEditors.length - 1] as HTMLElement
    return EditorView.findFromDOM(cmEl)
  }, [getEditorContainer])

  // Read current line from CodeMirror and update active heading
  const updateCmActiveHeading = useCallback(() => {
    const view = getCmEditorView()
    if (!view) return
    const cursor = view.state.selection.main.head
    const line = view.state.doc.lineAt(cursor)
    setActiveHeadingIndex(findActiveHeadingFromLine(line.number - 1))
  }, [getCmEditorView, findActiveHeadingFromLine])

  const updateRichTextActiveHeading = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return

    const node = selection.anchorNode
    if (!node) return

    const richTextArea = getRichTextArea()
    if (!richTextArea || !richTextArea.contains(node)) return

    const headingElements = Array.from(richTextArea.querySelectorAll('h1, h2, h3, h4, h5, h6'))

    let activeIndex = -1
    for (let i = 0; i < headingElements.length; i++) {
      const heading = headingElements[i]
      if (heading === node || heading.contains(node)) {
        activeIndex = i
      } else {
        const position = heading.compareDocumentPosition(node)
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
          activeIndex = i
        } else {
          break
        }
      }
    }
    setActiveHeadingIndex(activeIndex)
  }, [getRichTextArea])

  useEffect(() => {
    // --- Rich text mode: use selectionchange ---
    const handleSelectionChange = () => {
      updateRichTextActiveHeading()
    }

    document.addEventListener('selectionchange', handleSelectionChange)

    // --- CodeMirror mode: use keyup/mouseup/focus on the cm-editor elements ---
    const handleCmCursorChange = () => {
      // Small delay to let CM update its state
      setTimeout(updateCmActiveHeading, 20)
    }

    const handleRichTextCursorChange = () => {
      setTimeout(updateRichTextActiveHeading, 20)
    }

    // We attach listeners to the entire editor wrapper to catch events from any CM instance
    const editorWrapper = getEditorContainer()
    if (editorWrapper) {
      editorWrapper.addEventListener('keyup', handleCmCursorChange)
      editorWrapper.addEventListener('mouseup', handleCmCursorChange)
      editorWrapper.addEventListener('focusin', handleCmCursorChange)
      editorWrapper.addEventListener('keyup', handleRichTextCursorChange)
      editorWrapper.addEventListener('mouseup', handleRichTextCursorChange)
      editorWrapper.addEventListener('focusin', handleRichTextCursorChange)
    }

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      if (editorWrapper) {
        editorWrapper.removeEventListener('keyup', handleCmCursorChange)
        editorWrapper.removeEventListener('mouseup', handleCmCursorChange)
        editorWrapper.removeEventListener('focusin', handleCmCursorChange)
        editorWrapper.removeEventListener('keyup', handleRichTextCursorChange)
        editorWrapper.removeEventListener('mouseup', handleRichTextCursorChange)
        editorWrapper.removeEventListener('focusin', handleRichTextCursorChange)
      }
    }
  }, [getEditorContainer, updateCmActiveHeading, updateRichTextActiveHeading])

  const scrollRichTextHeadingIntoView = useCallback((headingElement: Element, richTextArea: HTMLElement) => {
    const scrollContainer = getRichTextScrollContainer(richTextArea)
    if (!scrollContainer) {
      headingElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }

    const containerRect = scrollContainer.getBoundingClientRect()
    const headingRect = headingElement.getBoundingClientRect()
    scrollContainer.scrollTo({
      top: Math.max(0, computeScrollTopForChild({
        containerScrollTop: scrollContainer.scrollTop,
        containerTop: containerRect.top,
        childTop: headingRect.top,
      })),
      behavior: 'smooth',
    })
  }, [getRichTextScrollContainer])

  const selectRichTextHeading = useCallback((headingElement: Element) => {
    const rootEditor = realmRef.current?.getValue(rootEditor$)
    if (!rootEditor) return false

    let selected = false
    rootEditor.update(() => {
      const lexicalNode = $getNearestNodeFromDOMNode(headingElement)
      const targetNode = lexicalNode && ($isElementNode(lexicalNode) ? lexicalNode : lexicalNode.getTopLevelElement())
      if ($isElementNode(targetNode)) {
        targetNode.selectStart()
        selected = true
      }
    }, { discrete: true })
    return selected
  }, [])

  const captureActiveRichTextSelection = useCallback(() => {
    const editor = realmRef.current?.getValue(activeEditor$) ?? realmRef.current?.getValue(rootEditor$)
    if (!editor) return

    const snapshot = captureRichTextSelection(editor)
    if (snapshot) {
      pendingBlockTypeSelectionRef.current = snapshot
    }
  }, [])

  useEffect(() => {
    const wrapper = editorWrapperRef.current
    if (!wrapper) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return

      const richTextArea = getRichTextArea()
      if (richTextArea?.contains(target)) return

      captureActiveRichTextSelection()
    }

    wrapper.addEventListener('pointerdown', handlePointerDown, true)
    return () => wrapper.removeEventListener('pointerdown', handlePointerDown, true)
  }, [captureActiveRichTextSelection, getRichTextArea])

  const focusRichTextHeading = useCallback((headingElement: Element, richTextArea: HTMLElement) => {
    selectRichTextHeading(headingElement)
    richTextArea.focus({ preventScroll: true })

    const selection = window.getSelection()
    const range = document.createRange()
    const walker = document.createTreeWalker(headingElement, NodeFilter.SHOW_TEXT)
    const firstTextNode = walker.nextNode()

    if (firstTextNode) {
      range.setStart(firstTextNode, 0)
    } else {
      range.setStart(headingElement, 0)
    }
    range.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(range)

    scrollRichTextHeadingIntoView(headingElement, richTextArea)
    window.requestAnimationFrame(() => {
      scrollRichTextHeadingIntoView(headingElement, richTextArea)
    })
  }, [scrollRichTextHeadingIntoView, selectRichTextHeading])

  const handleHeadingClick = useCallback((heading: EditorHeading) => {
    const editorContainer = getEditorContainer()
    if (!editorContainer) return

    const mode = currentViewModeRef.current

    // Rich text mode: find the heading element in the contenteditable area and scroll to it
    if (mode === 'rich-text') {
      const richTextArea = getRichTextArea()
      if (richTextArea) {
        const elements = richTextArea.querySelectorAll(`h${heading.level}`)
        const elementIndex = findRichTextHeadingElementIndex(headings, heading)
        
        if (elementIndex >= 0 && elementIndex < elements.length) {
          focusRichTextHeading(elements[elementIndex], richTextArea)
          setActiveHeadingIndex(findActiveHeadingFromLine(heading.lineIndex))
          return
        }
        
        // Fallback: try text matching if indexing somehow failed
        const normalizedText = heading.text.replace(/\s+/g, ' ')
        for (let i = 0; i < elements.length; i++) {
          if (elements[i].textContent?.trim().replace(/\s+/g, ' ') === normalizedText) {
            focusRichTextHeading(elements[i], richTextArea)
            setActiveHeadingIndex(findActiveHeadingFromLine(heading.lineIndex))
            return
          }
        }
      }
      return
    }

    // Source/diff mode: use CodeMirror
    const view = getCmEditorView()
    if (view) {
      // lineIndex is 0-based, CM lines are 1-based
      const targetLine = Math.min(heading.lineIndex + 1, view.state.doc.lines)
      const line = view.state.doc.line(targetLine)
      view.dispatch({
        selection: { anchor: line.from },
        scrollIntoView: true
      })
      view.focus()
      setActiveHeadingIndex(findActiveHeadingFromLine(heading.lineIndex))
    }
  }, [focusRichTextHeading, getCmEditorView, getEditorContainer, getRichTextArea, headings, findActiveHeadingFromLine])

  const [metadataWidth, setMetadataWidth] = useState(300)
  const [tocWidth, setTocWidth] = useState(250)
  const metadataDragState = useRef({ isDragging: false, startX: 0, startWidth: 0 })
  const tocDragState = useRef({ isDragging: false, startX: 0, startWidth: 0 })
  const realmRef = useRef<any>(null)
  const previousModeRef = useRef<string>(savedViewMode)
  const currentViewModeRef = useRef<string>(savedViewMode)
  const contextToSync = useRef<{ text: string, offset: number } | null>(null)

  const realmTrackerPlugin = useMemo(() => realmPlugin({
    init: (realm) => {
      realmRef.current = realm
      const path = lastEditorMarkdownRef.current.path
      // The core exporter trims even when trim={false}. Restore its Markdown
      // cell as well as our onChange output, so source/diff panes retain EOF
      // whitespace. Defer until the export has finished and mute this repair.
      const restoreWhitespace = () => {
        const exported = realm.getValue(markdown$)
        queueMicrotask(() => {
          if (realmRef.current !== realm || !editorWrapperRef.current?.isConnected) return
          if (lastEditorMarkdownRef.current.path !== path) return
          if (realm.getValue(markdown$) !== exported) return
          const restored = preserveMarkdownTrailingWhitespace(exported, lastEditorMarkdownRef.current.markdown)
          if (restored === exported) return
          const muted = realm.getValue(muteChange$)
          realm.pub(muteChange$, true)
          try { realm.pub(markdown$, restored) }
          finally { realm.pub(muteChange$, muted) }
        })
      }
      restoreEditorWhitespaceRef.current = restoreWhitespace
      realm.sub(markdown$, restoreWhitespace)
      realm.sub(viewMode$, (mode: string) => {
        restoreWhitespace()
        const oldMode = currentViewModeRef.current
        
        // --- Save Cursor Context ---
        if (oldMode === 'rich-text') {
          const selection = window.getSelection()
          if (selection && selection.rangeCount > 0 && selection.anchorNode) {
            const text = selection.anchorNode.textContent || ''
            const offset = selection.anchorOffset || 0
            if (text.trim()) {
              contextToSync.current = { text: text.trim(), offset }
            } else {
              contextToSync.current = null
            }
          }
        } else if (oldMode === 'source' || oldMode === 'diff') {
          const view = getCmEditorView()
          if (view) {
            const cursor = view.state.selection.main.head
            const line = view.state.doc.lineAt(cursor)
            const snippet = line.text.replace(/[*_#`~\[\]()>=-]/g, '').trim()
            if (snippet.length > 2) {
              const textBeforeCursor = line.text.substring(0, cursor - line.from)
              const offset = textBeforeCursor.replace(/[*_#`~\[\]()>=-]/g, '').trimStart().length
              contextToSync.current = { text: snippet, offset }
            } else {
              contextToSync.current = null
            }
          }
        }

        currentViewModeRef.current = mode
        if (!metadataPanelOpenRef.current) {
          localStorage.setItem('mdxeditor-view-mode', mode)
          setSetting('mdxeditor-view-mode', mode).catch(console.error)
        } else if (mode !== 'source') {
          previousModeRef.current = mode
          localStorage.setItem('mdxeditor-view-mode', mode)
          setSetting('mdxeditor-view-mode', mode).catch(console.error)
        }

        // --- Restore Cursor Context ---
        const syncContext = contextToSync.current
        
        let attempts = 0
        const tryRestore = () => {
          attempts++
          if (mode === 'source' || mode === 'diff') {
            const view = getCmEditorView()
            if (view && syncContext) {
              const { text, offset } = syncContext
              const docText = view.state.doc.toString()
              let idx = docText.indexOf(text)
              if (idx === -1 && text.length > 10) {
                idx = docText.indexOf(text.substring(0, 10))
              }
              if (idx !== -1) {
                view.dispatch({
                  selection: { anchor: idx + Math.min(offset, text.length) },
                  scrollIntoView: true
                })
                view.focus()
              }
            } else if (attempts < 10) {
              setTimeout(tryRestore, 50)
            }
          } else if (mode === 'rich-text') {
            const richTextArea = getRichTextArea()
            // Wait until the editor has mounted and contains text
            if (richTextArea && richTextArea.textContent?.trim().length) {
              let foundBlock: Element | null = null
              
              if (syncContext) {
                const { text } = syncContext
                const blocks = Array.from(richTextArea.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, pre, blockquote'))
                for (const block of blocks) {
                  const blockText = block.textContent || ''
                  if (text && blockText.includes(text)) {
                    foundBlock = block
                    break
                  }
                  if (text.length > 5 && blockText.includes(text.substring(0, 10))) {
                    foundBlock = block
                    break
                  }
                }
              }

              if (foundBlock) {
                try {
                  foundBlock.scrollIntoView({ behavior: 'auto', block: 'center' })
                  const walker = document.createTreeWalker(foundBlock, NodeFilter.SHOW_TEXT, null)
                  let node: Node | null
                  let currentOffset = 0
                  const targetOffset = syncContext?.offset || 0
                  let targetNode: Node | null = null
                  let targetNodeOffset = 0
                  let lastNode: Node | null = null
                  
                  while ((node = walker.nextNode())) {
                    lastNode = node
                    const nodeLength = node.nodeValue?.length || 0
                    if (currentOffset + nodeLength >= targetOffset) {
                      targetNode = node
                      targetNodeOffset = targetOffset - currentOffset
                      break
                    }
                    currentOffset += nodeLength
                  }
                  
                  if (!targetNode && lastNode) {
                    targetNode = lastNode
                    targetNodeOffset = lastNode.nodeValue?.length || 0
                  }
                  
                  if (targetNode) {
                    const sel = window.getSelection()
                    const range = document.createRange()
                    range.setStart(targetNode, targetNodeOffset)
                    range.collapse(true)
                    sel?.removeAllRanges()
                    sel?.addRange(range)
                  }
                } catch (e) {
                  console.error('Failed to restore lexical cursor:', e)
                }
              } else {
                // Fallback to active heading if text match failed
                const headingIdx = activeHeadingIndexRef.current
                if (headingIdx >= 0 && headingsRef.current[headingIdx]) {
                  const h = headingsRef.current[headingIdx]
                  const hElements = richTextArea.querySelectorAll(`h${h.level}`)
                  const normalizedText = h.text.replace(/\s+/g, ' ')
                  for (let i = 0; i < hElements.length; i++) {
                    if (hElements[i].textContent?.trim().replace(/\s+/g, ' ') === normalizedText) {
                      hElements[i].scrollIntoView({ behavior: 'auto', block: 'start' })
                      break
                    }
                  }
                }
              }
            } else if (attempts < 15) {
              setTimeout(tryRestore, 50)
            }
          }
        }
        
        setTimeout(tryRestore, 50)
      })

      // Prevent scroll-to-bottom and preserve cursor position when changing block type
      // (e.g. paragraph → heading). The scroll happens because Lexical's DOM reconciliation
      // after $setBlocksType calls scrollIntoViewIfNeeded, and the subsequent editor.focus() does it again.
      // We save all ancestor scroll positions and lock them, and also re-apply the Lexical selection after focus.
      realm.sub(
        realm.pipe(convertSelectionToNode$, withLatestFrom(activeEditor$)),
        ([_factory, editor]: [any, any]) => {
          if (!editor) return
          const rootEl = editor.getRootElement()
          if (!rootEl) return
          const selectionSnapshot = pendingBlockTypeSelectionRef.current ?? captureRichTextSelection(editor)
          pendingBlockTypeSelectionRef.current = null

          // Collect all scrollable ancestors and save their scrollTop
          const savedScrolls: { el: Element, top: number }[] = []
          let el: Element | null = rootEl
          while (el) {
            if (el.scrollHeight > el.clientHeight) {
              savedScrolls.push({ el, top: el.scrollTop })
            }
            el = el.parentElement
          }

          // Also lock scroll via a scroll event listener on each scrollable ancestor
          const lockScroll = (e: Event) => {
            const target = e.target as Element
            const saved = savedScrolls.find(s => s.el === target)
            if (saved) target.scrollTop = saved.top
          }
          for (const { el } of savedScrolls) {
            el.addEventListener('scroll', lockScroll, { passive: false })
          }

          // After MDXEditor's core setTimeout(() => editor.focus(), 0) has run,
          // ensure rootEl is focused and force Lexical to synchronize DOM selection so the cursor isn't lost.
          setTimeout(() => {
            if (rootEl && document.contains(rootEl)) {
              rootEl.focus({ preventScroll: true })
              restoreRichTextSelection(editor, selectionSnapshot)
            }
          }, 25)

          // Release the lock after all focus and selection updates are settled
          setTimeout(() => {
            for (const { el, top } of savedScrolls) {
              el.removeEventListener('scroll', lockScroll)
              el.scrollTop = top
            }
          }, 120)
        }
      )
    }
  }), [getCmEditorView, getRichTextArea])

  useEffect(() => {
    if (metadataPanelOpen) {
      if (realmRef.current) {
        const currentMode = realmRef.current.getValue(viewMode$)
        if (currentMode !== 'source') {
          previousModeRef.current = currentMode
          realmRef.current.pub(viewMode$, 'source')
        }
      }
    } else {
      if (realmRef.current) {
        const currentMode = realmRef.current.getValue(viewMode$)
        if (currentMode === 'source') {
          realmRef.current.pub(viewMode$, previousModeRef.current)
        }
      }
    }
  }, [metadataPanelOpen])

  const handleTocMouseDown = useCallback((e: React.MouseEvent) => {
    tocDragState.current = { isDragging: true, startX: e.clientX, startWidth: tocWidth }
    document.body.style.cursor = 'col-resize'
    e.preventDefault()
  }, [tocWidth])

  const handleMetadataMouseDown = useCallback((e: React.MouseEvent) => {
    metadataDragState.current = { isDragging: true, startX: e.clientX, startWidth: metadataWidth }
    document.body.style.cursor = 'col-resize'
    e.preventDefault()
  }, [metadataWidth])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (tocDragState.current.isDragging) {
        const delta = tocDragState.current.startX - e.clientX
        setTocWidth(Math.max(150, Math.min(tocDragState.current.startWidth + delta, 600)))
      }
      if (metadataDragState.current.isDragging) {
        const delta = metadataDragState.current.startX - e.clientX
        setMetadataWidth(Math.max(200, Math.min(metadataDragState.current.startWidth + delta, 600)))
      }
    }
    
    const handleMouseUp = () => {
      if (tocDragState.current.isDragging || metadataDragState.current.isDragging) {
        tocDragState.current.isDragging = false
        metadataDragState.current.isDragging = false
        document.body.style.cursor = ''
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  useEffect(() => {
    if (saveState === 'saved' || saveState === 'demo') {
      setDiffBaseline(normalizedMarkdown)
    }
  }, [saveState, normalizedMarkdown])

  useEffect(() => {
    if (saveState === 'saving') return
    if (isInternalChangeRef.current) {
      isInternalChangeRef.current = false
      return
    }

    if (editorRef.current) {
      const currentMd = editorRef.current.getMarkdown()
      const { metadata: currentMeta, body: currentBody } = parseMarkdownWithFrontmatter(currentMd)
      const { metadata: newMeta, body: newBody } = parseMarkdownWithFrontmatter(normalizedMarkdown)
      
      const changed = 
        currentMeta.title !== newMeta.title ||
        currentMeta.createdAt !== newMeta.createdAt ||
        currentMeta.updatedAt !== newMeta.updatedAt ||
        currentMeta.category !== newMeta.category ||
        (currentMeta.tags || []).join(',') !== (newMeta.tags || []).join(',') ||
        currentMeta.summary !== newMeta.summary ||
        currentMeta.due !== newMeta.due ||
        currentMeta.status !== newMeta.status ||
        currentMeta.priority !== newMeta.priority ||
        currentMeta.project !== newMeta.project ||
        normalizeMarkdownBody(currentBody) !== normalizeMarkdownBody(newBody)

      if (changed) {
        lastEditorMarkdownRef.current.markdown = normalizedMarkdown
        editorRef.current.setMarkdown(normalizedMarkdown)
        restoreEditorWhitespaceRef.current?.()
      }
    }
  }, [note.title, note.category, note.tags, note.summary, note.due, note.status, note.priority, note.project, normalizedMarkdown, saveState])

  const saveLabel = {
    loading: 'Loading',
    demo: 'Demo only',
    dirty: 'Unsaved',
    saving: 'Saving',
    saved: 'Saved',
    error: 'Save failed',
  }[saveState]

  // Detect current theme from HTML dataset to pass to MDXEditor
  const [isDark, setIsDark] = useState(() => typeof document !== 'undefined' && isDarkThemeDatasetValue(document.documentElement.dataset.theme))

  useEffect(() => {
    if (typeof document === 'undefined') return
    
    const syncBodyClass = (dark: boolean) => {
      document.body.classList.toggle('dark-theme', dark)
      document.body.classList.toggle('dark-editor', dark)
    }

    const observer = new MutationObserver(() => {
      const dark = isDarkThemeDatasetValue(document.documentElement.dataset.theme)
      setIsDark(dark)
      syncBodyClass(dark)
    })
    
    // Initial sync
    const initialDark = isDarkThemeDatasetValue(document.documentElement.dataset.theme)
    syncBodyClass(initialDark)

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  const codeMirrorExtensions = useMemo(() => [
    ...getCodeMirrorCspExtensions(),
    diffOnlyExtension,
    EditorView.updateListener.of((update) => {
      if (!update.docChanged || update.state.readOnly) return
      if (!update.view.dom.closest('.mdxeditor-source-editor, .mdxeditor-diff-editor')) return
      const edit = { markdown: update.state.doc.toString() }
      sourceEditRef.current = edit
      queueMicrotask(() => {
        if (sourceEditRef.current === edit) sourceEditRef.current = null
      })
    }),
  ], [])

  const plugins = useMemo(() => [
    headingsPlugin(),
    listsPlugin(),
    orderedListStartPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    markdownShortcutPlugin(),
    frontmatterPlugin(),
    tablePlugin(),
    linkPlugin({ disableAutoLink: true }),
    linkDialogPlugin(),
    imagePlugin({
      imageUploadHandler: async (image: File) => {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(image)
        })
        if (!vaultRoot.trim()) return dataUrl

        return saveNoteImage({
          vaultRoot: vaultRoot.trim(),
          notePath: note.path,
          dataUrl,
        })
      },
      imagePreviewHandler: async (src: string) => {
        return toMarkdownImagePreviewSrc(vaultRoot, note.path, src, convertFileSrc)
      }
    }),
    codeBlockPlugin({ defaultCodeBlockLanguage: 'txt' }),
    codeMirrorPlugin({
      codeMirrorExtensions,
      codeBlockLanguages: { js: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript (React)', css: 'CSS', txt: 'Text', markdown: 'Markdown', json: 'JSON', html: 'HTML', python: 'Python', bash: 'Bash' } 
    }),
    diffSourcePlugin({ viewMode: savedViewMode as any, diffMarkdown: diffBaseline, codeMirrorExtensions }),
    toolbarPlugin({
      toolbarContents: () => (
        <DiffSourceToggleWrapper>
          <UndoRedo />
          <BoldItalicUnderlineToggles />
          <BlockTypeSelect />
          <ListsToggle />
          <CreateLink />
          <InsertImage />
          <InsertTable />
          <InsertThematicBreak />
          <InsertCodeBlock />
        </DiffSourceToggleWrapper>
      )
    }),
    realmTrackerPlugin()
  ], [note.path, vaultRoot, isDark, diffBaseline, realmTrackerPlugin, codeMirrorExtensions])

  return (
    <article className="editor">
      <header className="editor-header">
        <div className="editor-title-row">
          <div>
            <h2><HighlightedText text={note.title} query={searchQuery} /></h2>
          </div>
          <div className="editor-actions">
            <button className={`secondary-action icon-action ${tocPanelOpen ? 'active' : ''}`} type="button" onClick={() => setTocPanelOpen(!tocPanelOpen)} title={t('editor.toc') || 'Table of Contents'}>
              <ListTree size={16} />
            </button>
            <button className={`secondary-action icon-action ${metadataPanelOpen ? 'active' : ''}`} type="button" onClick={() => setMetadataPanelOpen(!metadataPanelOpen)} title={t('editor.metadata')}>
              <Info size={16} />
            </button>
            {onRename ? (
              <button className="secondary-action icon-action" type="button" onClick={onRename} title={t('editor.renameNote')}>
                <TextCursorInput size={16} />
              </button>
            ) : null}
            {onMove ? (
              <button className="secondary-action icon-action" type="button" onClick={onMove} title={t('editor.moveNote')}>
                <MoveRight size={16} />
              </button>
            ) : null}
            {onCheckExternal ? (
              <button className="secondary-action icon-action" type="button" onClick={onCheckExternal} title={t('editor.checkFile')}>
                <RefreshCw size={16} />
              </button>
            ) : null}
            {onSave ? (
              <button className="secondary-action icon-action" type="button" onClick={onSave} title={t('editor.save')}>
                <Save size={16} />
              </button>
            ) : null}
            {onDelete ? (
              <button className="secondary-action delete-action icon-action" type="button" onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onDelete()
              }} title={t('editor.delete')}>
                <Trash2 size={16} />
              </button>
            ) : null}
          </div>
        </div>
        <div className="metadata">
          <span className={`save-state ${saveState}`}>{saveLabel}</span>
          <span><HighlightedText text={note.category} query={searchQuery} /></span>
          <span>{note.createdAt}</span>
          <span>{note.wordCount} {t('editor.words')}</span>
          {note.tags.map((tag) => (
            <span key={tag}>#<HighlightedText text={tag} query={searchQuery} /></span>
          ))}
        </div>
      </header>
      <div className="editor-workspace" style={{
        gridTemplateColumns: `minmax(min(180px, 100%), 1fr)${tocPanelOpen ? ` 0 minmax(0, ${tocWidth}px)` : ''}${metadataPanelOpen ? ` 0 minmax(0, ${metadataWidth}px)` : ''}`,
      }}>
        <div ref={editorWrapperRef} className={`mdx-editor-wrapper ${isDark ? 'dark-theme dark-editor' : ''}`}>
          <MDXEditor
            ref={editorRef}
            key={note.path} // Force re-mount on note change so internal state resets
            className={`mdx-editor-main ${isDark ? 'dark-theme dark-editor' : ''}`}
            markdown={normalizedMarkdown}
            trim={false}
            onChange={handleEditorChange}
            readOnly={previewMode}
            contentEditableClassName="prose max-w-none"
            plugins={plugins}
            toMarkdownOptions={EDITOR_TO_MARKDOWN_OPTIONS}
            suppressHtmlProcessing={MDXEDITOR_SUPPRESS_HTML_PROCESSING}
          />
          <div className="diff-empty-message" role="status">{t('editor.noChanges')}</div>
        </div>
        {tocPanelOpen && (
          <>
            <div
              className="metadata-resizer"
              onMouseDown={handleTocMouseDown}
              style={{
                gridArea: '2 / 2',
                width: '5px',
                cursor: 'col-resize',
                backgroundColor: 'transparent',
                zIndex: 10,
                marginLeft: '-2px',
                marginRight: '-3px'
              }}
              onMouseEnter={(e) => {
                if (!tocDragState.current.isDragging) e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.1)'
              }}
              onMouseLeave={(e) => {
                if (!tocDragState.current.isDragging) e.currentTarget.style.backgroundColor = 'transparent'
              }}
            />
            <aside className="context-panel editor-toc-panel" style={{ gridArea: '2 / 3', borderLeft: '1px solid var(--border)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              <section className="context-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ opacity: 0.7, display: 'flex', alignItems: 'center' }}>
                    <ListTree size={14} />
                  </div>
                  <button 
                    className={`secondary-action icon-action ${tocNumbering ? 'active' : ''}`} 
                    type="button" 
                    onClick={() => setTocNumbering(!tocNumbering)} 
                    title={t('editor.toggleNumbering') || 'Toggle Numbering'}
                    style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-color)', opacity: tocNumbering ? 1 : 0.5 }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={e => e.currentTarget.style.opacity = tocNumbering ? '1' : '0.5'}
                  >
                    <ListOrdered size={14} />
                  </button>
                </div>
                <div className="toc-list" style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.9em' }}>
                  {headings.length === 0 ? (
                    <div style={{ opacity: 0.5 }}>No headings found</div>
                  ) : (
                    headings.map((h, i) => {
                      const isActive = i === activeHeadingIndex;
                      return (
                      <button 
                        id={`toc-heading-${i}`}
                        key={h.id} 
                        onClick={() => handleHeadingClick(h)}
                        style={{
                          textAlign: 'left',
                          padding: '2px 4px',
                          paddingLeft: `${(h.level - 1) * 12 + 4}px`,
                          border: 'none',
                          background: isActive ? 'var(--highlight-bg, rgba(124, 181, 144, 0.2))' : 'transparent',
                          cursor: 'pointer',
                          color: isActive ? 'var(--text-color)' : 'inherit',
                          borderRadius: '4px',
                          opacity: isActive ? 1 : 0.8,
                          transition: 'background 0.2s, opacity 0.2s',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          width: '100%'
                        }}
                        onMouseEnter={e => {
                          if (!isActive) e.currentTarget.style.opacity = '1'
                        }}
                        onMouseLeave={e => {
                          if (!isActive) e.currentTarget.style.opacity = '0.8'
                        }}
                      >
                        {tocNumbering ? <span style={{ opacity: 0.6, marginRight: '4px' }}>{h.numberPrefix}</span> : null}
                        {h.text}
                      </button>
                      )
                    })
                  )}
                </div>
              </section>
            </aside>
          </>
        )}
        {metadataPanelOpen && (
          <>
            <div
              className="metadata-resizer"
              onMouseDown={handleMetadataMouseDown}
              style={{
                gridArea: `2 / ${tocPanelOpen ? 4 : 2}`,
                width: '5px',
                cursor: 'col-resize',
                backgroundColor: 'transparent',
                zIndex: 10,
                marginLeft: '-2px',
                marginRight: '-3px'
              }}
              onMouseEnter={(e) => {
                if (!metadataDragState.current.isDragging) e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.1)'
              }}
              onMouseLeave={(e) => {
                if (!metadataDragState.current.isDragging) e.currentTarget.style.backgroundColor = 'transparent'
              }}
            />
            <aside className="context-panel editor-metadata-panel" style={{ gridArea: `2 / ${tocPanelOpen ? 5 : 3}`, borderLeft: '1px solid var(--border)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              <section className="context-section">
              <label className="metadata-editor">
                <span>{t('editor.title')}</span>
                <input value={note.title} onChange={(event) => onUpdateTitle?.(event.target.value)} />
              </label>
              <label className="metadata-editor">
                <span>{t('editor.created')}</span>
                <input type="date" value={note.createdAt.slice(0, 10)} onChange={(event) => onUpdateCreatedAt?.(event.target.value)} />
              </label>
              <label className="metadata-editor">
                <span>{t('editor.updated')}</span>
                <input type="date" value={note.updatedAt.slice(0, 10)} onChange={(event) => onUpdateUpdatedAt?.(event.target.value)} />
              </label>
              <label className="metadata-editor reminder-metadata">
                <span>{t('editor.due')}</span>
                <input type={note.due?.length === 10 ? 'date' : 'datetime-local'} value={note.due || ''} onChange={(event) => onUpdateDue?.(event.target.value)} />
                {note.due && <small><button type="button" className="underline" onClick={(event) => {
                  event.preventDefault()
                  onUpdateDue?.(note.due?.length === 10 ? `${note.due}T09:00` : note.due!.slice(0, 10))
                }}>{t(note.due.length === 10 ? 'reminders.addTime' : 'reminders.dateOnly')}</button></small>}
              </label>
              <label className="metadata-editor reminder-metadata">
                <span>{t('reminders.timing')}</span>
                <select value={typeof note.frontmatter?.reminder === 'string' ? note.frontmatter.reminder : 'at_due'} onChange={(event) => onUpdateReminder?.(event.target.value)}>
                  {reminderTimings.map((timing) => <option key={timing} value={timing}>{t(`reminders.${timing}`)}</option>)}
                </select>
                <small>{t(remindersEnabled ? 'reminders.saveHint' : 'reminders.enableHint')}</small>
              </label>
              <label className="metadata-editor">
                <span>{t('editor.status')}</span>
                <select value={note.status || 'todo'} onChange={(event) => onUpdateStatus?.(event.target.value)}>
                  <option value="todo">{t('editor.todo')}</option>
                  <option value="in_progress">{t('editor.inProgress')}</option>
                  <option value="done">{t('editor.done')}</option>
                  <option value="cancelled">{t('editor.cancelled')}</option>
                </select>
              </label>
              <label className="metadata-editor">
                <span>{t('editor.priority')}</span>
                <select value={note.priority || 'none'} onChange={(event) => onUpdatePriority?.(event.target.value)}>
                  <option value="none">{t('editor.none')}</option>
                  <option value="low">{t('editor.low')}</option>
                  <option value="medium">{t('editor.medium')}</option>
                  <option value="high">{t('editor.high')}</option>
                </select>
              </label>
              <label className="metadata-editor">
                <span>{t('editor.project')}</span>
                <input type="text" value={note.project || ''} onChange={(event) => onUpdateProject?.(event.target.value)} placeholder={t('editor.projectName')} />
              </label>
              <label className="metadata-editor">
                <span>{t('editor.tags')}</span>
                <TagsInput tags={note.tags} onChange={onUpdateTags!} />
              </label>
              <div className="context-actions">
                {note.path.startsWith('00-inbox/') && onArchiveInboxNote ? (
                  <button type="button" onClick={onArchiveInboxNote} title={t('editor.archiveInboxNote')}>
                    <Archive size={15} />
                  </button>
                ) : null}
              </div>
            </section>
            <section className="context-section">
              <p className="panel-title">
                <Link2 size={14} /> {t('editor.links')}
              </p>
              <div className="link-group">
                <h4>{t('editor.backlinks')}</h4>
                {noteLinks?.backlinks.length ? (
                  noteLinks.backlinks.map((link) => (
                    <button key={`${link.sourcePath}-${link.label}`} type="button" onClick={() => onNavigateLink?.(link.sourcePath)}>
                      <strong>{link.sourceTitle}</strong>
                      <span>{link.sourcePath}</span>
                    </button>
                  ))
                ) : (
                  <p>{t('editor.noBacklinks')}</p>
                )}
              </div>
              <div className="link-group">
                <h4>{t('editor.outgoing')}</h4>
                {noteLinks?.outgoing.length ? (
                  noteLinks.outgoing.map((link) => (
                    <button key={`${link.targetPath}-${link.label}`} type="button" onClick={() => onNavigateLink?.(link.targetPath)}>
                      <strong>{link.targetTitle}</strong>
                      <span>{link.targetPath}</span>
                    </button>
                  ))
                ) : (
                  <p>{t('editor.noOutgoingLinks')}</p>
                )}
              </div>
            </section>
          </aside>
          </>
        )}
      </div>
    </article>
  )
}
