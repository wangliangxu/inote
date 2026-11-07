// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoNotes } from '../../shared/fixtures'
import { CommandPalette } from './CommandPalette'
import { ContextMenu } from './ContextMenu'
import { FolderPicker } from './FolderPicker'
import { ResizeHandle } from './ResizeHandle'
import { ToastProvider, useToast } from './Toast'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => options ? `${key}:${JSON.stringify(options)}` : key }) }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('toast', () => {
  function Trigger({ onUndo }: { onUndo: () => void }) {
    const toast = useToast()
    return <button type="button" onClick={() => toast.show({ message: 'Moved to trash', actionLabel: 'Undo', onAction: onUndo })}>trigger</button>
  }

  it('runs the action and dismisses, and hides itself after a delay', () => {
    vi.useFakeTimers()
    const onUndo = vi.fn()
    render(<ToastProvider><Trigger onUndo={onUndo} /></ToastProvider>)
    fireEvent.click(screen.getByText('trigger'))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Moved to trash')).toBeNull()

    fireEvent.click(screen.getByText('trigger'))
    expect(screen.getByText('Moved to trash')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(6100) })
    expect(screen.queryByText('Moved to trash')).toBeNull()
  })
})

describe('resize handle', () => {
  it('resizes with the keyboard, clamps, and resets on double-click', () => {
    const onResize = vi.fn()
    const onResizeEnd = vi.fn()
    render(<ResizeHandle side="left" width={300} min={220} max={320} defaultWidth={268} onResize={onResize} onResizeEnd={onResizeEnd} label="Resize" />)
    const handle = screen.getByRole('separator', { name: 'Resize' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onResize).toHaveBeenLastCalledWith(316)
    fireEvent.keyDown(handle, { key: 'End' })
    expect(onResize).toHaveBeenLastCalledWith(320)
    fireEvent.doubleClick(handle)
    expect(onResize).toHaveBeenLastCalledWith(268)
    expect(onResizeEnd).toHaveBeenLastCalledWith(268)
  })

  it('grows a right-side panel when dragging left', () => {
    const onResize = vi.fn()
    render(<ResizeHandle side="right" width={300} min={200} max={500} defaultWidth={300} onResize={onResize} label="Resize" />)
    const handle = screen.getByRole('separator', { name: 'Resize' })
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 460, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 460, pointerId: 1 })
    expect(onResize).toHaveBeenLastCalledWith(340)
  })
})

describe('folder picker', () => {
  it('filters folders and offers to create a new one', () => {
    const resolve = vi.fn()
    render(
      <FolderPicker
        request={{ title: 'Move', current: 'journal', resolve }}
        folders={[{ name: 'journal', count: 2 }, { name: 'knowledge', count: 3 }]}
        onDone={() => undefined}
      />,
    )
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'projects/new/' } })
    expect(screen.queryByText('knowledge')).toBeNull()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(resolve).toHaveBeenCalledWith('projects/new')
  })

  it('does not offer the current folder as a destination', () => {
    render(
      <FolderPicker
        request={{ title: 'Move', current: 'journal', resolve: vi.fn() }}
        folders={[{ name: 'journal', count: 2 }]}
        onDone={() => undefined}
      />,
    )
    expect((screen.getByText('journal').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('command palette', () => {
  it('filters commands and notes and runs the highlighted entry', () => {
    const run = vi.fn()
    const onOpenNote = vi.fn()
    const onClose = vi.fn()
    render(
      <CommandPalette
        open
        mode="all"
        commands={[{ id: 'new', group: 'Create', label: 'New note', run }, { id: 'off', group: 'Create', label: 'Hidden', disabled: true, run }]}
        notes={demoNotes}
        onOpenNote={onOpenNote}
        onClose={onClose}
      />,
    )
    const input = screen.getByRole('combobox')
    expect(screen.queryByText('Hidden')).toBeNull()
    fireEvent.change(input, { target: { value: 'new note' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(run).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()

    fireEvent.change(input, { target: { value: demoNotes[1].title } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onOpenNote).toHaveBeenCalledWith(demoNotes[1].path)
  })
})

describe('context menu', () => {
  it('runs an item, skips disabled ones, and closes on Escape', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(
      <ContextMenu
        x={10}
        y={10}
        label="Note actions"
        onClose={onClose}
        items={[
          { id: 'a', label: 'Rename', onSelect },
          'separator',
          { id: 'b', label: 'Delete', disabled: true, onSelect },
        ]}
      />,
    )
    expect((screen.getByRole('menuitem', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
