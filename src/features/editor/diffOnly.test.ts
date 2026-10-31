// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { MergeView } from '@codemirror/merge'
import { EditorView } from '@codemirror/view'
import { diffOnlyExtension } from './diffOnly'

let merge: MergeView | undefined
afterEach(() => {
  merge?.destroy()
  merge = undefined
  document.body.replaceChildren()
})

function compare(before: string, after: string) {
  merge = new MergeView({
    parent: document.body,
    a: { doc: before, extensions: [diffOnlyExtension] },
    b: { doc: after, extensions: [diffOnlyExtension] },
  })
  return merge
}

describe('showing only note differences', () => {
  it.each(['', 'Unchanged', 'Unchanged\n\n'])('marks identical documents %j as blank without changing their text', (text) => {
    const view = compare(text, text)
    for (const editor of [view.a, view.b]) {
      expect(editor.dom.getAttribute('data-inote-diff-empty')).toBe('true')
      expect(editor.state.doc.toString()).toBe(text)
    }
  })

  it('shows each change with nearby context and hides distant unchanged text', () => {
    const before = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`).join('\n')
    const after = before.replace('Line 12\n', 'Edited 12\n').replace('Line 48\n', 'Edited 48\n')
    const view = compare(before, after)
    const lines = (editor: EditorView) => Array.from(editor.dom.querySelectorAll('.cm-line'), line => line.textContent)
    expect(lines(view.a)).toContain('Line 12')
    expect(lines(view.b)).toContain('Edited 12')
    expect(lines(view.b)).toContain('Edited 48')
    expect(lines(view.b)).toContain('Line 11')
    expect(lines(view.b)).not.toContain('Line 1')
    expect(lines(view.b)).not.toContain('Line 30')
    expect(lines(view.b)).not.toContain('Line 60')
    expect(view.b.state.doc.toString()).toBe(after)
  })

  it('updates when changes are made or reverted, including final blank lines', () => {
    const view = compare('Original\n\n', 'Original\n\n')
    view.b.dispatch({ changes: { from: view.b.state.doc.length - 1, to: view.b.state.doc.length } })
    expect(view.b.dom.getAttribute('data-inote-diff-empty')).toBe('false')
    expect(view.a.dom.getAttribute('data-inote-diff-empty')).toBe('false')
    view.b.dispatch({ changes: { from: view.b.state.doc.length, insert: '\n' } })
    expect(view.b.dom.getAttribute('data-inote-diff-empty')).toBe('true')
    expect(view.a.dom.getAttribute('data-inote-diff-empty')).toBe('true')
  })

  it.each([['', 'Added'], ['Deleted', ''], ['A\nB', 'A\nB\nAdded']])('handles adding or removing entire lines', (before, after) => {
    const view = compare(before, after)
    expect(view.b.dom.getAttribute('data-inote-diff-empty')).toBe('false')
    expect(view.a.state.doc.toString()).toBe(before)
    expect(view.b.state.doc.toString()).toBe(after)
  })

  it('leaves source editors fully visible', () => {
    const view = new EditorView({ doc: 'First\nSecond\nThird\n', parent: document.body, extensions: [diffOnlyExtension] })
    try {
      expect(view.dom.hasAttribute('data-inote-diff-empty')).toBe(false)
      expect(view.contentDOM.textContent).toContain('First')
      expect(view.contentDOM.textContent).toContain('Third')
    } finally { view.destroy() }
  })
})
