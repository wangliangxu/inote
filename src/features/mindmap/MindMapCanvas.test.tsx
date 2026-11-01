// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MindMapCanvas } from './MindMapCanvas'
import type { MindMap } from './mindmap'
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
describe('measured mind map connectors', () => {
  it('recomputes from actual label boxes without shifting curves when zoom changes', () => {
    let scale = 1
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        const id = this.getAttribute('data-mindmap-node')
        const box =
          id === 'root'
            ? { left: 40, top: 120, width: 200, height: 60 }
            : id === 'child'
              ? { left: 350, top: 30, width: 220, height: 50 }
              : { left: 0, top: 0, width: 1000, height: 600 }
        return {
          x: box.left * scale,
          y: box.top * scale,
          left: box.left * scale,
          top: box.top * scale,
          right: (box.left + box.width) * scale,
          bottom: (box.top + box.height) * scale,
          width: box.width * scale,
          height: box.height * scale,
          toJSON: () => ({}),
        }
      },
    )
    const map: MindMap = {
      version: 1,
      roots: [
        {
          id: 'root',
          text: 'Root',
          children: [{ id: 'child', text: 'Multiline\nlabel', children: [] }],
        },
      ],
    }
    const props = {
      map,
      view: 'map' as const,
      zoom: 1,
      selectedId: 'root',
      searchQuery: '',
      readOnly: false,
      onZoomChange: vi.fn(),
      onSelect: vi.fn(),
      onTextChange: vi.fn(),
      onTextEditStart: vi.fn(),
      onTextEditEnd: vi.fn(),
      onToggle: vi.fn(),
    }
    const rendered = render(<MindMapCanvas {...props} />)
    const initial = rendered.container.querySelector('path')!.getAttribute('d')
    expect(initial).toMatch(/^M 238 78.5 C .*, 350 78.5$/)
    scale = 0.5
    rendered.rerender(<MindMapCanvas {...props} zoom={0.5} />)
    expect(rendered.container.querySelector('path')!.getAttribute('d')).toBe(
      initial,
    )
    rendered.rerender(<MindMapCanvas {...props} zoom={0.5} view="outline" />)
    expect(rendered.container.querySelector('svg')).toBeNull()
  })
})
