// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { $createParagraphNode, $createTextNode, $getRoot, getNearestEditorFromDOMNode } from 'lexical'
import { Editor } from './Editor'
import { demoNotes } from '../../shared/fixtures'
import { noteToMarkdown, parseMarkdownWithFrontmatter } from '../../shared/noteMarkdown'
import { hasNoteChanges } from '../../shared/noteChanges'
import type { Note } from '../../shared/types'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../shared/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../shared/api')>(),
  setSetting: vi.fn(async () => undefined),
}))

beforeEach(() => {
  localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList)
  Range.prototype.getBoundingClientRect = vi.fn(() => new DOMRect())
})
afterEach(cleanup)

function Workspace({ original, onSave }: { original: Note, onSave: (markdown: string) => void }) {
  const [note, setNote] = useState(original)
  return <>
    <output data-testid="draft">{JSON.stringify(note)}</output>
    <Editor note={note} saveState={note.isDirty ? 'dirty' : 'saved'} onChange={(markdown) => {
      const content = parseMarkdownWithFrontmatter(markdown)
      if (hasNoteChanges(note, content)) {
        setNote({ ...note, ...content.metadata, body: content.body, updatedAt: '2026-11-01', isDirty: true })
      }
    }} onSave={() => {
      onSave(noteToMarkdown(note))
      setNote({ ...note, isDirty: false })
    }} />
  </>
}

describe('viewing notes without editing', () => {
  it.each(['rich-text', 'source', 'diff'])('does not report initial normalization as an edit in %s mode', async (mode) => {
    localStorage.setItem('mdxeditor-view-mode', mode)
    const note = { ...demoNotes[0], body: '# Search result\n\n* Original item\n\n\n' }
    const original = noteToMarkdown(note)
    const onChange = vi.fn()
    const editor = render(<Editor note={note} searchQuery="Original" onChange={onChange} saveState="saved" />)
    await waitFor(() => expect(editor.container.querySelector('.mdxeditor-root-contenteditable, .cm-content')).toBeTruthy())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(onChange).not.toHaveBeenCalled()

    editor.rerender(<Editor note={note} searchQuery="item" onChange={onChange} saveState="saved" />)
    fireEvent.click(editor.container.querySelector('.mdxeditor-root-contenteditable, .cm-content')!)
    const source = editor.container.querySelector('.cm-content')
    if (source) {
      const view = EditorView.findFromDOM(source)!
      act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }))
    }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(onChange).not.toHaveBeenCalled()
    expect(noteToMarkdown(note)).toBe(original)

    const next = { ...note, path: 'knowledge/next.md', title: 'Next note', body: 'Another result\n\n' }
    editor.rerender(<Editor note={next} searchQuery="result" onChange={onChange} saveState="saved" />)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('preserves the original note on selection changes and reports actual source edits, including whitespace edits', async () => {
    localStorage.setItem('mdxeditor-view-mode', 'source')
    const note = { ...demoNotes[0], body: 'Original content\n\n\n' }
    const onChange = vi.fn()
    const editor = render(<Editor note={note} searchQuery="Original" onChange={onChange} />)
    await waitFor(() => expect(editor.container.querySelector('.cm-content')).toBeTruthy())
    const view = EditorView.findFromDOM(editor.container.querySelector('.cm-content')!)!
    const initialBody = parseMarkdownWithFrontmatter(view.state.doc.toString()).body
    expect(initialBody).toBe(note.body)
    act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }))
    expect(onChange).not.toHaveBeenCalled()
    expect(note.body).toBe('Original content\n\n\n')
    expect(note.updatedAt).toBe('2026-06-10')

    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: '\n' } }))
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(parseMarkdownWithFrontmatter(onChange.mock.calls[0][0]).body).toBe(initialBody + '\n')

    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: 'Edited content' } }))
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2))
    expect(onChange.mock.lastCall![0]).toContain('Edited content')
  })

  it('ignores initial formatting of a raw draft and still reports rich text edits', async () => {
    const onChange = vi.fn()
    const note = { ...demoNotes[0], rawMarkdown: '* Original item\n\n\n' }
    const editor = render(<Editor note={note} searchQuery="Original" onChange={onChange} />)
    await waitFor(() => expect(editor.container.querySelector('li')?.textContent).toBe('Original item'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(onChange).not.toHaveBeenCalled()

    const root = editor.container.querySelector('.mdxeditor-root-contenteditable [contenteditable="true"]')!
    const lexical = getNearestEditorFromDOMNode(root)!
    act(() => lexical.update(() => {
      $getRoot().append($createParagraphNode().append($createTextNode('Actual edit')))
    }, { discrete: true }))
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(onChange.mock.lastCall![0]).toContain('Actual edit')
    expect(onChange.mock.lastCall![0]).toMatch(/\n\n\n$/)
  })

  it('does not report switching editor modes as an edit', async () => {
    const onChange = vi.fn()
    const note = { ...demoNotes[0], body: 'Original content\n\n\n' }
    const editor = render(<Editor note={note} searchQuery="Original" onChange={onChange} />)
    await waitFor(() => expect(editor.container.querySelector('.mdxeditor-root-contenteditable')).toBeTruthy())
    for (const mode of ['Source mode', 'Diff mode', 'Rich text', 'Source mode']) {
      fireEvent.click(editor.getByRole('radio', { name: mode }))
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
      expect(onChange).not.toHaveBeenCalled()
      const sources = editor.container.querySelectorAll('.cm-content')
      if (sources.length) {
        const view = EditorView.findFromDOM(sources[sources.length - 1])!
        expect(parseMarkdownWithFrontmatter(view.state.doc.toString()).body).toBe(note.body)
      }
    }
  })

  it.each(['', '\n', '\n\n', '\n\n\n'])('retains the exact trailing newlines %j in both diff panes after loading', async (ending) => {
    localStorage.setItem('mdxeditor-view-mode', 'diff')
    const note = { ...demoNotes[0], body: `Original content${ending}` }
    const onChange = vi.fn()
    const editor = render(<Editor note={note} onChange={onChange} saveState="saved" />)
    await waitFor(() => expect(editor.container.querySelectorAll('.cm-content')).toHaveLength(2))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    for (const source of editor.container.querySelectorAll('.cm-content')) {
      const view = EditorView.findFromDOM(source)!
      expect(parseMarkdownWithFrontmatter(view.state.doc.toString()).body).toBe(note.body)
      act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }))
    }
    expect(onChange).not.toHaveBeenCalled()
  })

  it('stays saved with one final blank line through mode switches and saving', async () => {
    const note = { ...demoNotes[0], body: 'Original content\n\n', isDirty: false }
    const save = vi.fn()
    const editor = render(<Workspace original={note} onSave={save} />)
    for (const mode of ['Source mode', 'Rich text', 'Diff mode', 'Source mode']) {
      await waitFor(() => expect(editor.queryByRole('radio', { name: mode })).toBeTruthy())
      fireEvent.click(editor.getByRole('radio', { name: mode }))
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
      const draft = JSON.parse(editor.getByTestId('draft').textContent!)
      expect(draft).toEqual(note)
      expect(editor.container.querySelector('.save-state')?.textContent).toBe('Saved')
    }
    fireEvent.click(editor.getByRole('button', { name: 'editor.save' }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(save).toHaveBeenCalledWith(noteToMarkdown(note))
    expect(editor.container.querySelector('.save-state')?.textContent).toBe('Saved')
  })

  it.each(['source', 'diff'])('keeps deliberate removal of all trailing newlines across %s, rich text, and save', async (mode) => {
    localStorage.setItem('mdxeditor-view-mode', mode)
    const save = vi.fn()
    const editor = render(<Workspace original={{ ...demoNotes[0], body: 'Original content\n\n', isDirty: false }} onSave={save} />)
    await waitFor(() => expect(editor.container.querySelector('.cm-content')).toBeTruthy())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    const sources = editor.container.querySelectorAll('.cm-content')
    const view = EditorView.findFromDOM(sources[sources.length - 1])!
    expect(view.state.doc.toString()).toMatch(/\n\n$/)
    act(() => view.dispatch({ changes: { from: view.state.doc.length - 2, to: view.state.doc.length } }))
    await waitFor(() => expect(editor.container.querySelector('.save-state')?.textContent).toBe('Unsaved'))
    expect(JSON.parse(editor.getByTestId('draft').textContent!).body).toBe('Original content')
    fireEvent.click(editor.getByRole('radio', { name: 'Rich text' }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    fireEvent.click(editor.getByRole('radio', { name: 'Source mode' }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(EditorView.findFromDOM(editor.container.querySelector('.cm-content')!)!.state.doc.toString()).toMatch(/Original content$/)
    fireEvent.click(editor.getByRole('button', { name: 'editor.save' }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(parseMarkdownWithFrontmatter(save.mock.lastCall![0]).body).toBe('Original content')
    expect(editor.container.querySelector('.save-state')?.textContent).toBe('Saved')
  })

  it('synchronizes an externally changed final blank line without marking it as a local edit', async () => {
    localStorage.setItem('mdxeditor-view-mode', 'source')
    const onChange = vi.fn()
    const note = { ...demoNotes[0], body: 'Original content\n\n' }
    const editor = render(<Editor note={note} onChange={onChange} saveState="saved" />)
    await waitFor(() => expect(editor.container.querySelector('.cm-content')).toBeTruthy())
    const changed = { ...note, body: 'Original content\n' }
    editor.rerender(<Editor note={changed} onChange={onChange} saveState="saved" />)
    await waitFor(() => {
      const view = EditorView.findFromDOM(editor.container.querySelector('.cm-content')!)!
      expect(parseMarkdownWithFrontmatter(view.state.doc.toString()).body).toBe(changed.body)
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows an empty diff when unchanged, shows edits, and becomes empty again after saving', async () => {
    localStorage.setItem('mdxeditor-view-mode', 'diff')
    const save = vi.fn()
    const editor = render(<Workspace original={{ ...demoNotes[0], body: 'Original content\n\n', isDirty: false }} onSave={save} />)
    const diffIsEmpty = () => editor.container.querySelectorAll('.mdxeditor-diff-editor [data-inote-diff-empty="true"]').length === 2
    await waitFor(() => expect(diffIsEmpty()).toBe(true))
    expect(editor.container.querySelector('.mdxeditor-diff-editor')?.matches(':has([data-inote-diff-empty="true"])')).toBe(true)
    expect(editor.container.querySelector('.save-state')?.textContent).toBe('Saved')

    const sources = editor.container.querySelectorAll('.cm-content')
    const view = EditorView.findFromDOM(sources[sources.length - 1])!
    const from = view.state.doc.toString().indexOf('Original content')
    act(() => view.dispatch({ changes: { from, to: from + 'Original content'.length, insert: 'Edited content' } }))
    await waitFor(() => expect(diffIsEmpty()).toBe(false))
    expect(editor.container.querySelector('.save-state')?.textContent).toBe('Unsaved')
    expect(editor.container.querySelector('.cm-merge-b')?.textContent).toContain('Edited content')

    fireEvent.click(editor.getByRole('button', { name: 'editor.save' }))
    await waitFor(() => expect(diffIsEmpty()).toBe(true))
    expect(parseMarkdownWithFrontmatter(save.mock.lastCall![0]).body).toBe('Edited content\n\n')
    expect(editor.container.querySelector('.save-state')?.textContent).toBe('Saved')
    fireEvent.click(editor.getByRole('radio', { name: 'Source mode' }))
    await waitFor(() => expect(editor.container.querySelector('.mdxeditor-source-editor .cm-content')).toBeTruthy())
    expect(editor.container.querySelector('.mdxeditor-source-editor .cm-content')?.textContent).toContain('Edited content')
  })
})

describe('note cover metadata', () => {
  it('persists custom, hidden and automatic cover choices with the ordinary note', async () => {
    localStorage.setItem('mdxeditor-view-mode', 'source')
    localStorage.setItem('mdxeditor-metadata-open', 'true')
    const save = vi.fn()
    const original = { ...demoNotes[0], body: '# Note\n\n![图](images/a.png)', frontmatter: { custom: 'keep' } }
    const editor = render(<Workspace original={original} onSave={save} />)
    fireEvent.change(editor.getByLabelText('editor.cover'), { target: { value: 'custom' } })
    fireEvent.change(editor.getByPlaceholderText('editor.coverPath'), { target: { value: '../assets/cover.png' } })
    fireEvent.click(editor.getByRole('button', { name: 'editor.save' }))
    expect(parseMarkdownWithFrontmatter(save.mock.calls.at(-1)![0]).metadata.frontmatter).toMatchObject({ cover: '../assets/cover.png', custom: 'keep' })
    fireEvent.change(editor.getByLabelText('editor.cover'), { target: { value: 'hidden' } })
    fireEvent.click(editor.getByRole('button', { name: 'editor.save' }))
    expect(parseMarkdownWithFrontmatter(save.mock.calls.at(-1)![0]).metadata.frontmatter?.cover).toBe(false)
    fireEvent.change(editor.getByLabelText('editor.cover'), { target: { value: 'auto' } })
    fireEvent.click(editor.getByRole('button', { name: 'editor.save' }))
    expect(parseMarkdownWithFrontmatter(save.mock.calls.at(-1)![0]).metadata.frontmatter?.cover).toBeNull()
  })
})
