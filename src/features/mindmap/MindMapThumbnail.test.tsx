// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Note } from '../../shared/types'
import { flattenNodes } from './mindmap'
import { MindMapThumbnail, thumbnailMap } from './MindMapThumbnail'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(cleanup)
const map = { version: 1, roots: [{ id: 'r', text: '课程', children: [
  { id: 'a', text: 'Python初步', color: '#ff8800', children: [] },
  { id: 'b', text: 'Pandas', color: '#33aaff', children: [] },
] }] }
const base: Note = { path: 'map.md', title: '课程', body: '', category: 'courses', tags: [], createdAt: '', updatedAt: '', wordCount: 0 }
describe('mind map card thumbnails', () => {
  it('renders actual labels and colored branches without interactive elements', () => {
    const preview = thumbnailMap({ ...base, frontmatter: { inote_mindmap: map } })!
    const { container } = render(<MindMapThumbnail map={preview} />)
    expect(screen.getByRole('img', { name: 'mindmap.thumbnail' })).toBeTruthy()
    expect(screen.getByText('Python初步')).toBeTruthy()
    expect(container.querySelector('path[stroke="#ff8800"]')).toBeTruthy()
    expect(container.querySelector('path[stroke="#33aaff"]')).toBeTruthy()
    expect(container.querySelector('button,input,textarea')).toBeNull()
  })
  it('uses cached previews before the body is loaded and prefers the full map after editing', () => {
    const note = { ...base, bodyLoaded: false, frontmatter: { inote_mindmap_preview: map } }
    expect(thumbnailMap(note)?.roots[0].text).toBe('课程')
    expect(thumbnailMap({ ...note, frontmatter: { ...note.frontmatter, inote_mindmap: {
      ...map, roots: [{ id: 'updated', text: 'Updated', children: [] }],
    } } })?.roots[0].text).toBe('Updated')
  })
  it('limits large maps and hides collapsed descendants without changing the original', () => {
    const large = { version: 1, roots: [{ id: 'r', text: 'Root', children: Array.from({ length: 80 }, (_, i) => ({
      id: `n${i}`, text: '学'.repeat(200), children: [],
    })) }] }
    const original = JSON.stringify(large)
    const preview = thumbnailMap({ ...base, frontmatter: { inote_mindmap: large } })!
    expect(flattenNodes(preview)).toHaveLength(32)
    expect(preview.roots[0].children[0].text).toHaveLength(48)
    expect(JSON.stringify(large)).toBe(original)
    expect(thumbnailMap({ ...base, frontmatter: { inote_mindmap: {
      ...map, roots: [{ ...map.roots[0], collapsed: true }],
    } } })?.roots[0].children).toEqual([])
  })
  it('falls back to text excerpts for ordinary or damaged notes', () => {
    expect(thumbnailMap(base)).toBeNull()
    expect(thumbnailMap({ ...base, frontmatter: { inote_mindmap: { version: 9 } } })).toBeNull()
  })
})
