// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { getCodeMirrorCspExtensions } from './codeMirrorCsp'

afterEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

describe('CodeMirror styles under the packaged app CSP', () => {
  it('authorizes generated styles with the startup style nonce and preserves YAML at line one', () => {
    const startupStyle = document.createElement('style')
    startupStyle.id = 'inote-startup-theme'
    startupStyle.nonce = 'packaged-style-nonce'
    document.head.append(startupStyle)
    const markdown = '---\ntitle: Test\n---\n\n# Note'
    const view = new EditorView({
      parent: document.body,
      doc: markdown,
      extensions: getCodeMirrorCspExtensions(),
    })
    try {
      const generatedStyle = [...document.querySelectorAll('style')].find(style => style !== startupStyle)
      expect(generatedStyle?.nonce).toBe(startupStyle.nonce)
      expect(generatedStyle?.textContent).toContain('.cm-scroller')
      expect(view.state.doc.toString()).toBe(markdown)
      expect(view.contentDOM.firstElementChild?.textContent).toBe('---')
    } finally {
      view.destroy()
    }
  })

  it('keeps the default style behavior in development without a nonce', () => {
    document.head.innerHTML = '<style id="inote-startup-theme">:root { color: black }</style>'
    const state = EditorState.create({ extensions: getCodeMirrorCspExtensions() })
    expect(state.facet(EditorView.cspNonce)).toBe('')
  })

  it('does not use unrelated script nonces for styles', () => {
    document.head.innerHTML = '<script nonce="script-only"></script>'
    const state = EditorState.create({ extensions: getCodeMirrorCspExtensions() })
    expect(state.facet(EditorView.cspNonce)).toBe('')
  })
})
