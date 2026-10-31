// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { $createParagraphNode, $createTextNode, $getRoot, getNearestEditorFromDOMNode } from 'lexical'
import { Editor } from './Editor'
import { demoNotes } from '../../shared/fixtures'
import { noteToMarkdown, parseMarkdownWithFrontmatter } from '../../shared/noteMarkdown'

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
    }
  })
})
