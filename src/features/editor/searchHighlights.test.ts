// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectSearchRanges, installSearchHighlights } from './searchHighlights'

afterEach(() => vi.unstubAllGlobals())

describe('editor search highlights', () => {
  it('matches across inline formatting without changing Markdown DOM or selection', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>中文<strong>搜索</strong>词 Rust</p><p>rust</p><button>Rust</button>'
    document.body.append(root)
    const selection = window.getSelection()!
    const caret = document.createRange()
    caret.setStart(root.querySelector('p')!.firstChild!, 1)
    caret.collapse(true)
    selection.removeAllRanges()
    selection.addRange(caret)
    const before = root.innerHTML
    const ranges = collectSearchRanges(root, '中文搜索词 rust')
    expect(ranges.map(range => range.toString())).toEqual(['中文搜索词', 'Rust', 'rust'])
    expect(root.innerHTML).toBe(before)
    expect(selection.anchorNode).toBe(caret.startContainer)
    expect(selection.anchorOffset).toBe(1)
    expect(collectSearchRanges(root, 'Rustrust')).toEqual([])
    root.remove()
  })

  it('updates after editing or switching to source mode and cleans up highlights', async () => {
    class TestHighlight extends Set<Range> {}
    const registry = new Map<string, TestHighlight>()
    vi.stubGlobal('CSS', { highlights: registry })
    vi.stubGlobal('Highlight', TestHighlight)
    const frames = new Map<number, FrameRequestCallback>()
    let frameId = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    const wrapper = document.createElement('div')
    wrapper.innerHTML = '<div class="mdxeditor-root-contenteditable"><p>Rust <strong>rust</strong></p></div>'
    const dispose = installSearchHighlights(wrapper, 'rust')
    const matches = () => Array.from(registry.get('inote-search')!, range => range.toString())
    expect(matches()).toEqual(['Rust', 'rust'])
    wrapper.innerHTML = '<div class="cm-content"><div class="cm-line">source RUST</div></div>'
    await Promise.resolve()
    expect(frames.size).toBe(1)
    for (const callback of frames.values()) callback(0)
    expect(matches()).toEqual(['RUST'])
    wrapper.querySelector('.cm-line')!.textContent = 'rust edited'
    await Promise.resolve()
    dispose()
    expect(registry.has('inote-search')).toBe(false)
    expect(frames.has(frameId)).toBe(false)
  })

  it('leaves editor content intact when the platform has no highlight API', () => {
    vi.stubGlobal('CSS', undefined)
    const wrapper = document.createElement('div')
    wrapper.textContent = 'Rust'
    expect(() => installSearchHighlights(wrapper, 'rust')()).not.toThrow()
    expect(wrapper.textContent).toBe('Rust')
  })
})
