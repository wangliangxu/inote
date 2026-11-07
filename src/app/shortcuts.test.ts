// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { formatShortcut, matchShortcut } from './shortcuts'

function key(init: KeyboardEventInit & { code: string }, target?: HTMLElement) {
  const event = new KeyboardEvent('keydown', { bubbles: true, ...init })
  if (target) Object.defineProperty(event, 'target', { value: target })
  return event
}

describe('global shortcuts', () => {
  it('matches the platform modifier only', () => {
    expect(matchShortcut(key({ code: 'KeyN', metaKey: true }), true)).toBe('newNote')
    expect(matchShortcut(key({ code: 'KeyN', ctrlKey: true }), true)).toBeNull()
    expect(matchShortcut(key({ code: 'KeyN', ctrlKey: true }), false)).toBe('newNote')
  })

  it('distinguishes shifted and alt variants', () => {
    expect(matchShortcut(key({ code: 'KeyF', metaKey: true, shiftKey: true }), true)).toBe('focusSearch')
    expect(matchShortcut(key({ code: 'KeyF', metaKey: true }), true)).toBeNull()
    expect(matchShortcut(key({ code: 'Backslash', metaKey: true }), true)).toBe('toggleLeftSidebar')
    expect(matchShortcut(key({ code: 'Backslash', metaKey: true, altKey: true }), true)).toBe('toggleRightSidebar')
    expect(matchShortcut(key({ code: 'Enter', metaKey: true, shiftKey: true }), true)).toBe('focusMode')
  })

  it('leaves delete and bracket shortcuts to text and code editors', () => {
    const input = document.createElement('input')
    expect(matchShortcut(key({ code: 'Backspace', metaKey: true }, input), true)).toBeNull()
    expect(matchShortcut(key({ code: 'Backspace', metaKey: true }, document.body), true)).toBe('deleteNote')
    const code = document.createElement('div')
    code.className = 'cm-editor'
    const line = document.createElement('div')
    code.append(line)
    expect(matchShortcut(key({ code: 'BracketLeft', metaKey: true }, line), true)).toBeNull()
    expect(matchShortcut(key({ code: 'BracketLeft', metaKey: true }, document.body), true)).toBe('historyBack')
  })

  it('formats shortcuts for each platform', () => {
    expect(formatShortcut('focusSearch', true)).toBe('⌘⇧F')
    expect(formatShortcut('focusSearch', false)).toBe('Ctrl+Shift+F')
    expect(formatShortcut('deleteNote', false)).toBe('Ctrl+Backspace')
  })
})
