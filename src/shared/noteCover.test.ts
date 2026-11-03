import { describe, expect, it } from 'vitest'
import { firstMarkdownImage, noteCoverSource, safeCoverSource } from './noteCover'
import type { Note } from './types'
const base: Note = { path: 'notes/a.md', title: 'A', body: '![首图](images/a.png)', category: 'notes', tags: [], createdAt: '', updatedAt: '', wordCount: 0 }
describe('note card cover selection', () => {
  it('uses the first real image, supports spaces and parentheses, and ignores code and comments', () => {
    expect(firstMarkdownImage('```md\n![code](wrong.png)\n```\n`![inline](wrong.png)`\n<!-- ![hidden](wrong.png) -->\n![封面](<images/a b.png> "caption")')).toBe('images/a b.png')
    expect(firstMarkdownImage('![a](img/a(1).png)')).toBe('img/a(1).png')
    expect(firstMarkdownImage('![a](data:image/png;base64,abc)\n![b](next.jpg)')).toBe('next.jpg')
  })
  it('supports auto, custom and hidden covers including lazy summaries', () => {
    expect(noteCoverSource(base)).toBe('images/a.png')
    expect(noteCoverSource({ ...base, frontmatter: { cover: 'other.jpg' } })).toBe('other.jpg')
    expect(noteCoverSource({ ...base, frontmatter: { cover: false } })).toBeNull()
    expect(noteCoverSource({ ...base, frontmatter: { cover: null } })).toBe('images/a.png')
    expect(noteCoverSource({ ...base, body: '', bodyLoaded: false, frontmatter: { inote_card_cover: 'cached.png' } })).toBe('cached.png')
    expect(noteCoverSource({ ...base, body: 'plain text' })).toBeNull()
  })
  it('rejects active or oversized sources', () => {
    for (const source of ['javascript:alert(1)', 'data:image/png;base64,abc', 'blob:x', '//host/a.png', 'a'.repeat(2049)]) expect(safeCoverSource(source)).toBeNull()
    expect(safeCoverSource('https://example.com/a.png')).toBe('https://example.com/a.png')
  })
})
