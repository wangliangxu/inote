// @vitest-environment jsdom
import { useState } from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Note } from '../../shared/types'
import { parseMarkdownWithFrontmatter } from '../../shared/noteMarkdown'
import { createMindMap, getNoteMindMap, withMindMap } from './mindmap'
import { Editor } from './MindMapEditor'
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('../editor/Editor', () => ({
  Editor: () => <div>Markdown editor</div>,
}))
vi.mock('./mindmapFiles', () => ({
  saveMindMapFile: vi.fn(async () => undefined),
}))
const base: Note = {
  path: 'knowledge/map.md',
  title: 'Project',
  category: 'knowledge',
  body: '',
  tags: [],
  createdAt: '2026-10-29',
  updatedAt: '2026-10-29',
  wordCount: 0,
}
afterEach(cleanup)
function Harness({
  onSave = vi.fn(),
  previewMode = false,
}: {
  onSave?: (note: Note) => void
  previewMode?: boolean
}) {
  const [note, setNote] = useState(
    withMindMap(base, createMindMap('Central topic')),
  )
  return (
    <Editor
      note={note}
      previewMode={previewMode}
      onChange={(content) => {
        const { body, metadata } = parseMarkdownWithFrontmatter(content)
        setNote((current) => ({ ...current, ...metadata, body }))
      }}
      onUpdateTags={(value) =>
        setNote((current) => ({
          ...current,
          tags: value
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
        }))
      }
      onSave={() => onSave(note)}
      saveState="saved"
    />
  )
}
describe('mind map editor integration', () => {
  it('edits, saves and reopens the same node data', async () => {
    const save = vi.fn()
    const rendered = render(<Harness onSave={save} />)
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.addChild' }))
    fireEvent.change(screen.getByLabelText('mindmap.nodeText'), {
      target: { value: 'Imported knowledge' },
    })
    fireEvent.blur(screen.getByLabelText('mindmap.nodeText'))
    fireEvent.change(screen.getByLabelText('mindmap.nodeNote'), {
      target: { value: 'Keep this note' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'editor.save' }))
    expect(save).toHaveBeenCalledTimes(1)
    const saved = save.mock.calls[0][0] as Note
    expect(saved.body).toContain('Imported knowledge')
    expect(getNoteMindMap(saved)?.roots[0].children[0]).toMatchObject({
      text: 'Imported knowledge',
      note: 'Keep this note',
    })
    rendered.unmount()
    render(<Editor note={saved} onChange={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: /Imported knowledge/ }),
    ).toBeTruthy()
  })
  it('saves tag edits immediately without requiring the input to lose focus', () => {
    const save = vi.fn()
    render(<Harness onSave={save} />)
    const tags = screen.getByLabelText('mindmap.tags')
    fireEvent.change(tags, { target: { value: 'work,' } })
    expect((tags as HTMLInputElement).value).toBe('work,')
    fireEvent.change(tags, { target: { value: 'work, ideas' } })
    fireEvent.click(screen.getByRole('button', { name: 'editor.save' }))
    expect(save.mock.calls[0][0].tags).toEqual(['work', 'ideas'])
  })
  it('keeps changes across view switches, coalesces typing undo and restores deleted branches', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.addChild' }))
    fireEvent.change(screen.getByLabelText('mindmap.nodeText'), {
      target: { value: 'First' },
    })
    fireEvent.change(screen.getByLabelText('mindmap.nodeText'), {
      target: { value: 'First topic' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.outline' }))
    expect(screen.getByRole('button', { name: 'First topic' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.undo' }))
    expect(screen.getByRole('button', { name: 'mindmap.newNode' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.redo' }))
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.remove' }))
    expect(screen.queryByRole('button', { name: 'First topic' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.undo' }))
    expect(screen.getByRole('button', { name: 'First topic' })).toBeTruthy()
  })
  it('supports keyboard creation and collapse/expand without losing children', () => {
    render(<Harness />)
    fireEvent.keyDown(screen.getByLabelText('mindmap.canvas'), { key: 'Tab' })
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.collapse' }))
    expect(screen.queryByRole('button', { name: 'mindmap.newNode' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.expand' }))
    expect(screen.getByRole('button', { name: 'mindmap.newNode' })).toBeTruthy()
  })
  it('preserves normal keyboard navigation in toolbar and inspector', () => {
    render(<Harness />)
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'mindmap.addChild' }),
      { key: 'Enter' },
    )
    fireEvent.keyDown(screen.getByLabelText('mindmap.nodeText'), { key: 'Tab' })
    expect(screen.queryByRole('button', { name: 'mindmap.newNode' })).toBeNull()
  })
  it('disables editing in preview mode', () => {
    render(<Harness previewMode />)
    expect(
      (screen.getByLabelText('mindmap.nodeText') as HTMLTextAreaElement)
        .disabled,
    ).toBe(true)
    expect(
      (
        screen.getByRole('button', {
          name: 'mindmap.addChild',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    fireEvent.keyDown(screen.getByLabelText('mindmap.canvas'), { key: 'Enter' })
    expect(screen.queryByRole('button', { name: 'mindmap.newNode' })).toBeNull()
  })
  it('keeps ordinary notes in the Markdown editor and exposes recovery for invalid maps', () => {
    const rendered = render(<Editor note={base} onChange={vi.fn()} />)
    expect(screen.getByText('Markdown editor')).toBeTruthy()
    rendered.rerender(
      <Editor
        note={{ ...base, frontmatter: { inote_mindmap: { version: 9 } } }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert').textContent).toContain(
      'mindmap.errors.invalid',
    )
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.source' }))
    expect(screen.getByText('Markdown editor')).toBeTruthy()
  })
  it('clears stale undo history on external map changes', async () => {
    let replace: (note: Note) => void = () => undefined
    function ExternalHarness() {
      const [note, setNote] = useState(
        withMindMap(base, createMindMap('Original')),
      )
      replace = setNote
      return (
        <Editor
          note={note}
          onChange={(content) => {
            const { body, metadata } = parseMarkdownWithFrontmatter(content)
            setNote((current) => ({ ...current, ...metadata, body }))
          }}
        />
      )
    }
    render(<ExternalHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'mindmap.addChild' }))
    expect(
      (
        screen.getByRole('button', {
          name: 'mindmap.undo',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false)
    act(() => replace(withMindMap(base, createMindMap('External revision'))))
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'mindmap.undo',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true),
    )
    expect(
      screen.getByRole('button', { name: 'External revision' }),
    ).toBeTruthy()
  })
})
