// @vitest-environment jsdom
import { createRef } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MDXEditor, diffSourcePlugin, type MDXEditorMethods } from '@mdxeditor/editor'
import { EditorView } from '@codemirror/view'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Saving must keep the CodeMirror instance alive: MDXEditor recreates it from
// the rich-text baseline when readOnly changes, losing source-only edits.
describe('saving source edits', () => {
  afterEach(cleanup)

  it('retains source content while a save is pending and after it completes', async () => {
    const ref = createRef<MDXEditorMethods>()
    const onChange = vi.fn()
    const plugins = [diffSourcePlugin({ viewMode: 'source' })]
    const editor = render(<MDXEditor ref={ref} markdown="Original content" onChange={onChange} plugins={plugins} />)
    const source = editor.container.querySelector('.cm-content')!
    const view = EditorView.findFromDOM(source)!
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'Edited content' } }))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('Edited content', false))

    // App rerenders on isSaving; readOnly must remain the user's preview choice.
    editor.rerender(<MDXEditor ref={ref} markdown="Edited content" onChange={onChange} plugins={plugins} readOnly={false} />)
    expect(ref.current?.getMarkdown()).toBe('Edited content')
    const pendingView = EditorView.findFromDOM(editor.container.querySelector('.cm-content')!)!
    expect(pendingView.state.doc.toString()).toBe('Edited content')
    expect(pendingView === view).toBe(true)
    editor.rerender(<MDXEditor ref={ref} markdown="Edited content" onChange={onChange} plugins={plugins} readOnly={false} />)
    expect(ref.current?.getMarkdown()).toBe('Edited content')
    expect(EditorView.findFromDOM(editor.container.querySelector('.cm-content')!)?.state.doc.toString()).toBe('Edited content')
  })

  it('keeps save progress separate from the editor preview mode in App', () => {
    const app = readFileSync(resolve(__dirname, '../../app/App.tsx'), 'utf8')
    expect(app).toContain('previewMode={previewMode}')
    expect(app).not.toContain('previewMode={previewMode || isSaving}')
  })
})
