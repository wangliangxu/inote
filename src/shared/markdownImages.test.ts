import { describe, expect, it } from 'vitest'
import { resolveMarkdownImagePath, toMarkdownImagePreviewSrc } from './markdownImages'

describe('resolveMarkdownImagePath', () => {
  it('resolves relative image paths from the note folder inside the vault', () => {
    expect(resolveMarkdownImagePath('/Users/me/vault', 'notes/高考报名.md', 'images/准考证.png')).toBe(
      '/Users/me/vault/notes/images/准考证.png',
    )
  })

  it('leaves remote and data image sources unchanged', () => {
    expect(resolveMarkdownImagePath('/Users/me/vault', 'notes/高考报名.md', 'https://example.com/a.png')).toBe(
      'https://example.com/a.png',
    )
    expect(resolveMarkdownImagePath('/Users/me/vault', 'notes/高考报名.md', 'data:image/png;base64,abc')).toBe(
      'data:image/png;base64,abc',
    )
  })

  it('normalizes sibling and parent directory image references', () => {
    expect(resolveMarkdownImagePath('/Users/me/vault', 'notes/apply/高考报名.md', './a.png')).toBe(
      '/Users/me/vault/notes/apply/a.png',
    )
    expect(resolveMarkdownImagePath('/Users/me/vault', 'notes/apply/高考报名.md', '../assets/b.jpg')).toBe(
      '/Users/me/vault/notes/assets/b.jpg',
    )
  })

  it('converts local images to asset URLs without inlining base64 data', () => {
    const src = toMarkdownImagePreviewSrc(
      '/Users/me/vault',
      'notes/高考报名.md',
      '_assets/高考报名/a.png',
      (path) => `asset://${path}`,
    )

    expect(src).toBe('asset:///Users/me/vault/notes/_assets/高考报名/a.png')
    expect(src).not.toContain('base64')
  })

  it('does not convert remote or inline image sources to asset URLs', () => {
    const convert = (path: string) => `asset://${path}`

    expect(toMarkdownImagePreviewSrc('/Users/me/vault', 'notes/a.md', 'https://example.com/a.png', convert)).toBe(
      'https://example.com/a.png',
    )
    expect(toMarkdownImagePreviewSrc('/Users/me/vault', 'notes/a.md', 'data:image/png;base64,abc', convert)).toBe(
      'data:image/png;base64,abc',
    )
  })
})
