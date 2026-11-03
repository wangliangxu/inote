// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteCoverPreview } from './NoteCoverPreview'
import { coverThumbnail } from '../../shared/coverThumbnailCache'
import type { Note } from '../../shared/types'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }))
vi.mock('../../shared/coverThumbnailCache', () => ({ coverThumbnail: vi.fn(async () => 'data:image/jpeg;base64,thumb') }))
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })
const note: Note = { path: 'notes/a.md', title: 'A', body: '![a](a.png)', category: 'notes', tags: [], createdAt: '', updatedAt: '', wordCount: 0 }
describe('note cover cards', () => {
  it('waits for visibility before loading and shows a cached small image', async () => {
    let intersect: IntersectionObserverCallback = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { intersect = callback }
      observe() {} disconnect = disconnect
    })
    render(<NoteCoverPreview note={note} vaultRoot="/vault" fallback={<small>摘要</small>} />)
    expect(coverThumbnail).not.toHaveBeenCalled()
    intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe('data:image/jpeg;base64,thumb'))
    expect(coverThumbnail).toHaveBeenCalledWith('asset:///vault/notes/a.png', '')
    expect(screen.queryByText('摘要')).toBeNull()
    expect(disconnect).toHaveBeenCalled()
  })
  it('keeps excerpts for missing or hidden images', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    vi.mocked(coverThumbnail).mockResolvedValueOnce(null)
    const rendered = render(<NoteCoverPreview note={note} vaultRoot="/vault" fallback={<small>摘要</small>} />)
    await waitFor(() => expect(coverThumbnail).toHaveBeenCalled())
    expect(screen.getByText('摘要')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    rendered.rerender(<NoteCoverPreview note={{ ...note, frontmatter: { cover: false } }} vaultRoot="/vault" fallback={<small>摘要</small>} />)
    expect(screen.queryByRole('img')).toBeNull()
  })
})
