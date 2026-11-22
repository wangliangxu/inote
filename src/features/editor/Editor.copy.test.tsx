// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { $getRoot, $selectAll, getNearestEditorFromDOMNode } from 'lexical'
import { afterEach, expect, it, vi } from 'vitest'
import { demoNotes } from '../../shared/fixtures'
import { Editor } from './Editor'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

class TestClipboardEvent extends Event {
  clipboardData = new Map<string, string>()

  constructor() {
    super('copy', { bubbles: true, cancelable: true })
    Object.assign(this.clipboardData, { setData: this.clipboardData.set.bind(this.clipboardData) })
  }
}

afterEach(() => {
  cleanup()
  window.getSelection()?.removeAllRanges()
  delete document.documentElement.dataset.theme
  document.body.classList.remove('dark-theme', 'dark-editor')
  vi.unstubAllGlobals()
})

it.each(['dark', 'light'])('copies rich text with the expected foreground color in the %s theme', (theme) => {
  vi.stubGlobal('ClipboardEvent', TestClipboardEvent)
  document.documentElement.dataset.theme = theme
  const note = { ...demoNotes[0], body: '# Heading\n\n**Bold** and [a link](https://example.com)\n' }
  const { container } = render(<Editor note={note} onChange={vi.fn()} />)
  const root = container.querySelector<HTMLElement>('.mdxeditor-root-contenteditable [contenteditable="true"]')!
  const editor = getNearestEditorFromDOMNode(root)!
  act(() => {
    root.focus()
    editor.update(() => {
      const bold = $getRoot().getAllTextNodes().find((node) => node.getTextContent() === 'Bold')!
      bold.setStyle('color: white; background-color: yellow')
      $selectAll()
    }, { discrete: true })
  })

  const event = new TestClipboardEvent()
  fireEvent(root, event)
  const html = document.createElement('template')
  html.innerHTML = event.clipboardData.get('text/html') ?? ''
  expect(event.defaultPrevented).toBe(true)
  expect(html.content.querySelector('h1')?.textContent).toBe('Heading')
  expect(html.content.querySelector('b')?.textContent).toBe('Bold')
  expect(html.content.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
  const styled = html.content.querySelector<HTMLElement>('[style*="background-color"]')
  expect(styled?.style.backgroundColor).toBe('yellow')
  expect(styled?.style.color).toBe(theme === 'dark' ? '' : 'white')
  expect(event.clipboardData.get('text/plain')).toContain('Bold and a link')
  expect(event.clipboardData.get('application/x-lexical-editor')).toContain('color: white')
})
