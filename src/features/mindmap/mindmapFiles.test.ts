import { describe, expect, it, vi } from 'vitest'
import { readBrowserMapFile } from './mindmapFiles'
import { MAX_FILE_BYTES } from './mindmap'
function file(bytes: Uint8Array, size = bytes.length): File {
  return {
    name: 'map.mm',
    size,
    arrayBuffer: vi.fn(async () => bytes.buffer),
  } as unknown as File
}
describe('browser mind map file reading', () => {
  it('reads UTF-8 including Chinese text without modifying it', async () => {
    const source = '<map><node TEXT="中文导图"/></map>'
    expect(
      (await readBrowserMapFile(file(new TextEncoder().encode(source))))
        .content,
    ).toBe(source)
  })
  it('rejects invalid UTF-8 rather than silently corrupting old content', async () => {
    await expect(
      readBrowserMapFile(file(new Uint8Array([0xff, 0xfe, 0x80]))),
    ).rejects.toThrow()
  })
  it('checks file size before loading contents', async () => {
    const large = file(new Uint8Array(), MAX_FILE_BYTES + 1)
    expect((await readBrowserMapFile(large)).error).toBe('limit')
    expect(large.arrayBuffer).not.toHaveBeenCalled()
  })
})
