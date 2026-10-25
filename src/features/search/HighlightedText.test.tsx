// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { HighlightedText } from './HighlightedText'
import { excerptAroundMatch, findSearchMatches } from './searchHighlight'

afterEach(cleanup)

describe('search highlighting', () => {
  it('marks all Chinese and case-insensitive text matches, excluding search operators', () => {
    const { container } = render(<HighlightedText text="Rust 和中文 rust OR" query="RUST OR 中文" />)
    expect(Array.from(container.querySelectorAll('mark'), mark => mark.textContent)).toEqual(['Rust', '中文', 'rust'])
    expect(container.textContent).toBe('Rust 和中文 rust OR')
  })

  it('highlights tag terms and treats special characters and HTML as literal text', () => {
    const text = '<img src=x> C++ [note] desktop RUST'
    const { container, rerender } = render(<HighlightedText text={text} query="#desk tag:rust C++ [note] <img" />)
    expect(Array.from(container.querySelectorAll('mark'), mark => mark.textContent)).toEqual(['<img', 'C++', '[note]', 'desk', 'RUST'])
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe(text)
    rerender(<HighlightedText text={text} query="  " />)
    expect(container.querySelector('mark')).toBeNull()
    expect(container.textContent).toBe(text)
  })

  it('does not duplicate overlapping matches or shift Unicode offsets', () => {
    expect(findSearchMatches('İ Rust 中文搜索', 'rust 中文 中文搜索')).toEqual([
      { start: 2, end: 6 }, { start: 7, end: 11 },
    ])
  })

  it('shows context around deep matches without truncating a long search term', () => {
    const text = '开头'.repeat(100) + '中文搜索词' + '结尾'.repeat(100)
    const excerpt = excerptAroundMatch(text, '中文搜索词')!
    expect(excerpt.startsWith('…')).toBe(true)
    expect(excerpt.endsWith('…')).toBe(true)
    expect(excerpt).toContain('中文搜索词')
    expect(excerpt.length).toBeLessThan(text.length)
    expect(excerptAroundMatch('prefix ' + 'x'.repeat(200), 'x'.repeat(200))).toContain('x'.repeat(200))
    expect(excerptAroundMatch(text, 'missing')).toBeNull()
  })
})
