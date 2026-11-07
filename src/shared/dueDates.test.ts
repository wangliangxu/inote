import { describe, expect, it } from 'vitest'
import { dueTone, moveDueDate } from './dueDates'
import { countWords, readingMinutes } from './textStats'

describe('due dates', () => {
  it('classifies due dates relative to today', () => {
    expect(dueTone('2026-11-06', '2026-11-07')).toBe('overdue')
    expect(dueTone('2026-11-07T18:00', '2026-11-07')).toBe('today')
    expect(dueTone('2026-11-10', '2026-11-07')).toBe('soon')
    expect(dueTone('2026-11-11', '2026-11-07')).toBe('later')
    expect(dueTone('2027-01-01', '2026-12-30')).toBe('soon')
  })

  it('keeps the time of day when moving a due date', () => {
    expect(moveDueDate('2026-11-07T09:30', '2026-11-12')).toBe('2026-11-12T09:30')
    expect(moveDueDate('2026-11-07', '2026-11-12')).toBe('2026-11-12')
    expect(moveDueDate(undefined, '2026-11-12')).toBe('2026-11-12')
  })
})

describe('text stats', () => {
  it('counts CJK characters individually and Latin text by words', () => {
    expect(countWords('你好世界 hello world')).toBe(6)
    expect(countWords('# Title\n\n- item one\n\n```js\nconst ignored = 1\n```')).toBe(3)
  })

  it('estimates at least one minute of reading', () => {
    expect(readingMinutes('short')).toBe(1)
    expect(readingMinutes('字'.repeat(900))).toBe(3)
  })
})
