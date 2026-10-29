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
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}))
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
})
afterEach(cleanup)
function file(name: string, xml: string) {
  const result = new File([xml], name)
  Object.defineProperty(result, 'arrayBuffer', {
    value: async () => new TextEncoder().encode(xml).buffer,
  })
  return result
}
const mm = '<map><node TEXT="Root"><node TEXT="Child"/></node></map>'
describe('mind map creation and batch import', () => {
  it('creates a map with its title through the note creation callback', async () => {
    const create = vi.fn(async () => undefined),
      close = vi.fn()
    render(<MindMapDialog onCreate={create} onClose={close} canCreate />)
    fireEvent.change(screen.getByLabelText('mindmap.noteTitle'), {
      target: { value: 'My project' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.create' }))
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toMatchObject({
      title: 'My project',
      map: { roots: [{ text: 'My project' }] },
    })
  })
  it('previews valid and invalid files, retries failures and never duplicates successful imports', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined)
    render(<MindMapDialog onCreate={create} onClose={vi.fn()} canCreate />)
    const input = document.querySelector('input[type="file"]')!
    fireEvent.change(input, {
      target: {
        files: [
          file('a.mm', mm),
          file('b.mm', mm),
          file('bad.mm', '<bad>'),
          file('old.mindnode', ''),
        ],
      },
    })
    await screen.findByText('mindmap.errors.xml')
    expect(screen.getByText('mindmap.errors.mindnode')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.importAll' }))
    await screen.findByText('Error: disk full')
    expect(create).toHaveBeenCalledTimes(2)
    expect(screen.getAllByText(/mindmap.imported/)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.importAll' }))
    await waitFor(() =>
      expect(screen.getAllByText(/mindmap.imported/)).toHaveLength(2),
    )
    expect(create).toHaveBeenCalledTimes(3)
    expect(
      (
        screen.getByRole('button', {
          name: 'mindmap.importAll',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })
  it('requires a real vault before creating or importing notes', () => {
    render(
      <MindMapDialog onCreate={vi.fn()} onClose={vi.fn()} canCreate={false} />,
    )
    fireEvent.change(screen.getByLabelText('mindmap.noteTitle'), {
      target: { value: 'Map' },
    })
    expect(
      (
        screen.getByRole('button', {
          name: 'mindmap.create',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe('mindmap.openVault')
  })
})
