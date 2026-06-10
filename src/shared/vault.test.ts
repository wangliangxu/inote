import { describe, expect, it } from 'vitest'
import { demoNotes } from './fixtures'
import { filterNotesByCategory, groupByCategory, groupByMonth, searchNotes, titleFromPath } from './vault'

describe('vault helpers', () => {
  it('groups notes by top-level and nested categories', () => {
    expect(groupByCategory(demoNotes)).toEqual([
      { name: '00-inbox', count: 1 },
      { name: 'journal', count: 1 },
      { name: 'knowledge/rust', count: 1 },
    ])
  })

  it('filters notes by selected category prefix', () => {
    expect(filterNotesByCategory(demoNotes, 'knowledge')).toHaveLength(1)
    expect(filterNotesByCategory(demoNotes, 'knowledge')[0].title).toBe('Tauri Architecture Notes')
  })

  it('groups notes by creation month newest first', () => {
    expect(groupByMonth(demoNotes)[0].month).toBe('2026-06')
    expect(groupByMonth(demoNotes)[0].notes).toHaveLength(3)
  })

  it('searches title, body, tags, category, and summary', () => {
    expect(searchNotes(demoNotes, 'desktop')[0].title).toBe('Tauri Architecture Notes')
    expect(searchNotes(demoNotes, 'review')[0].title).toBe('Daily Note')
  })

  it('derives a readable title from a file path', () => {
    expect(titleFromPath('knowledge/rust/tauri-architecture.md')).toBe('Tauri Architecture')
  })
})
