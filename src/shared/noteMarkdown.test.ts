import { describe, expect, it } from 'vitest'
import { noteToMarkdown, parseMarkdownWithFrontmatter } from './noteMarkdown'
import { demoNotes } from './fixtures'
import { hasNoteChanges } from './noteChanges'

describe('Markdown frontmatter round trips', () => {
  it('does not mark an untouched editor dirty and detects comment-only changes', () => {
    const note = { ...demoNotes[0], frontmatterSource: '# Original comment\ncustom: {b: 2, a: 1}', frontmatter: { custom: { a: 1, b: 2 } } }
    const rendered = noteToMarkdown(note)
    expect(hasNoteChanges(note, parseMarkdownWithFrontmatter(rendered))).toBe(false)
    expect(hasNoteChanges(note, parseMarkdownWithFrontmatter(rendered.replace('Original comment', 'Edited comment')))).toBe(true)
  })
  it('preserves special characters, nested custom fields, multiline values and comments', () => {
    const original = '---\n# Keep this comment\ntitle: \'A "quote" and C:\\notes\'\ntags:\n  - "a,b"\n  - \'a"b\'\nsummary: |\n  第一行\n  第二行\ncustom:\n  owner: 张三\n  options: [one, two]\ncreated_at: 2026-06-10\n---\n\n正文\n'
    const first = parseMarkdownWithFrontmatter(original)
    const note = { ...demoNotes[0], ...first.metadata, body: first.body }
    const saved = noteToMarkdown(note)
    const second = parseMarkdownWithFrontmatter(saved)
    expect(second.metadata.title).toBe('A "quote" and C:\\notes')
    expect(second.metadata.tags).toEqual(['a,b', 'a"b'])
    expect(second.metadata.frontmatter).toEqual({ custom: { owner: '张三', options: ['one', 'two'] } })
    expect(second.metadata.summary).toBe('第一行\n第二行\n')
    expect(saved).toContain('# Keep this comment')
    expect(second.body).toBe('正文\n')
  })
  it('persists reminder timing with custom frontmatter and detects timing-only changes', () => {
    const parsed = parseMarkdownWithFrontmatter('---\ntitle: Task\nreminder: at_due\ncustom: keep\n---\nBody')
    const original = { ...demoNotes[0], ...parsed.metadata, body: parsed.body }
    const changed = { ...original, frontmatter: { ...original.frontmatter, reminder: '10_minutes' } }
    const roundTrip = parseMarkdownWithFrontmatter(noteToMarkdown(changed))
    expect(roundTrip.metadata.frontmatter).toEqual({ reminder: '10_minutes', custom: 'keep' })
    expect(hasNoteChanges(original, roundTrip)).toBe(true)
  })
  it('handles CRLF and an exact closing delimiter without consuming similar body text', () => {
    const parsed = parseMarkdownWithFrontmatter('---\r\ntitle: Test\r\n---\r\n\r\n---body\r\n')
    expect(parsed.metadata.title).toBe('Test')
    expect(parsed.body).toBe('---body\r\n')
  })
  it('rejects malformed mappings and duplicate keys', () => {
    expect(() => parseMarkdownWithFrontmatter('---\ntitle: [broken\n---\nBody')).toThrow('Invalid frontmatter')
    expect(() => parseMarkdownWithFrontmatter('---\ntitle: A\ntitle: B\n---\nBody')).toThrow()
    expect(() => parseMarkdownWithFrontmatter('---\n- list\n---\nBody')).toThrow('mapping')
  })
  it('does not serialize an unloaded summary and retains an invalid raw draft for editing', () => {
    expect(() => noteToMarkdown({ ...demoNotes[0], bodyLoaded: false })).toThrow('Load the note body')
    expect(noteToMarkdown({ ...demoNotes[0], rawMarkdown: '---\ntitle: [unfinished' })).toBe('---\ntitle: [unfinished')
  })
})
