// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { coverThumbnail } from './coverThumbnailCache'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('small image cache', () => {
  it('deduplicates loads, resizes to card resolution, and invalidates when the revision changes', async () => {
    let loads = 0
    vi.stubGlobal('indexedDB', undefined)
    vi.stubGlobal('Image', class {
      naturalWidth = 1600; naturalHeight = 1000; crossOrigin = ''; referrerPolicy = ''
      onload?: () => void
      set src(value: string) { if (value) { loads++; queueMicrotask(() => this.onload?.()) } }
    })
    const draw = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage: draw } as unknown as CanvasRenderingContext2D)
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) {
      expect(this.width).toBe(320); expect(this.height).toBe(200)
      return 'data:image/jpeg;base64,thumb'
    })
    const first = coverThumbnail('asset://cache-test-a.png', '1')
    expect(coverThumbnail('asset://cache-test-a.png', '1')).toBe(first)
    expect(await first).toBe('data:image/jpeg;base64,thumb')
    expect(await coverThumbnail('asset://cache-test-a.png', '1')).toBe('data:image/jpeg;base64,thumb')
    expect(loads).toBe(1)
    await coverThumbnail('asset://cache-test-a.png', '2')
    expect(loads).toBe(2); expect(encode).toHaveBeenCalledTimes(2)
  })
  it('returns no image when a source cannot load', async () => {
    vi.stubGlobal('Image', class {
      onerror?: () => void
      set src(value: string) { if (value) queueMicrotask(() => this.onerror?.()) }
    })
    expect(await coverThumbnail('asset://missing.png', '1')).toBeNull()
  })
})
