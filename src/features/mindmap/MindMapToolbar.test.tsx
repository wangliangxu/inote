// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MindMapToolbar } from './MindMapToolbar'
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
afterEach(cleanup)
function props() {
  return {
    view: 'map' as const,
    zoom: 1,
    readOnly: false,
    canUndo: true,
    canRedo: false,
    canFold: true,
    collapsed: false,
    inspectorOpen: true,
    onView: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onAddChild: vi.fn(),
    onAddSibling: vi.fn(),
    onFold: vi.fn(),
    onNotes: vi.fn(),
    onInspector: vi.fn(),
    onFit: vi.fn(),
    onZoom: vi.fn(),
    onExport: vi.fn(),
    onSave: vi.fn(),
  }
}
describe('mind map command toolbar', () => {
  it('routes node commands to the selected-node operations and disables writes in preview', () => {
    const handlers = props(),
      rendered = render(<MindMapToolbar {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.addChild' }))
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.addSibling' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'mindmap.foldSelected' }),
    )
    expect(handlers.onAddChild).toHaveBeenCalledTimes(1)
    expect(handlers.onAddSibling).toHaveBeenCalledTimes(1)
    expect(handlers.onFold).toHaveBeenCalledTimes(1)
    rendered.rerender(<MindMapToolbar {...handlers} readOnly />)
    for (const name of [
      'mindmap.addChild',
      'mindmap.addSibling',
      'mindmap.foldSelected',
      'mindmap.undo',
    ])
      expect(
        (screen.getByRole('button', { name }) as HTMLButtonElement).disabled,
      ).toBe(true)
  })
  it('exports only the chosen format and dismisses its menu', () => {
    const handlers = props()
    render(<MindMapToolbar {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.export' }))
    expect(screen.getAllByRole('menuitem')).toHaveLength(4)
    expect(handlers.onExport).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitem', { name: /FreeMind/ }))
    expect(handlers.onExport).toHaveBeenCalledWith('mm')
    expect(screen.queryByRole('menu')).toBeNull()
  })
  it('supports menu keyboard navigation, Escape and restoring trigger focus', () => {
    render(<MindMapToolbar {...props()} />)
    const trigger = screen.getByRole('button', { name: 'mindmap.export' })
    fireEvent.click(trigger)
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' })
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[3])
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
  it('preserves file actions in More and closes when clicking outside', () => {
    const rename = vi.fn(),
      remove = vi.fn()
    render(<MindMapToolbar {...props()} onRename={rename} onDelete={remove} />)
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.more' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'editor.renameNote' }))
    expect(rename).toHaveBeenCalledTimes(1)
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.more' }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
