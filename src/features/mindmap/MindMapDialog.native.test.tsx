// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MindMapDialog } from './MindMapDialog'
import { pickMindMapFiles } from './mindmapFiles'
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}))
vi.mock('./mindmapFiles', () => ({
  pickMindMapFiles: vi.fn(),
  readBrowserMapFile: vi.fn(),
}))
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  vi.clearAllMocks()
})
afterEach(cleanup)
describe('native MindNode import workflow', () => {
  it('passes parsed native files through preview and creates editable map notes', async () => {
    const create = vi.fn(async () => undefined)
    vi.mocked(pickMindMapFiles).mockResolvedValue([
      {
        name: 'native.mindnode',
        mindnode: {
          formatVersion: 6,
          warnings: ['appearance'],
          roots: [
            {
              id: 'root',
              text: '<p>原生课程</p>',
              children: [{ id: 'child', text: '<p>节点</p>', children: [] }],
            },
          ],
        },
      },
    ])
    render(<MindMapDialog canCreate onCreate={create} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.chooseFiles' }))
    await screen.findByText('native.mindnode')
    expect(create).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.importAll' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toMatchObject({
      title: '原生课程',
      map: { roots: [{ text: '原生课程', children: [{ text: '节点' }] }] },
    })
  })
  it('uses the folder picker fallback and shows clear unsupported version errors', async () => {
    vi.mocked(pickMindMapFiles).mockResolvedValue([
      { name: 'future.mindnode', error: 'mindnodeVersion' },
    ])
    render(<MindMapDialog canCreate onCreate={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(
      screen.getByRole('button', { name: 'mindmap.choosePackage' }),
    )
    await screen.findByText('mindmap.errors.mindnodeVersion')
    expect(pickMindMapFiles).toHaveBeenCalledWith(true)
    expect(
      (
        screen.getByRole('button', {
          name: 'mindmap.importAll',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })
})
