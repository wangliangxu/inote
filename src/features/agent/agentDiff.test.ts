import { describe, expect, it } from 'vitest'
import { buildLineDiff } from './agentDiff'

describe('buildLineDiff', () => {
  it('marks retained, removed, and added Markdown lines', () => {
    const diff = buildLineDiff('# Title\nOld\nShared', '# Title\nNew\nShared')
    expect(diff).toContainEqual({ kind: 'same', text: '# Title' })
    expect(diff).toContainEqual({ kind: 'remove', text: 'Old' })
    expect(diff).toContainEqual({ kind: 'add', text: 'New' })
    expect(diff).toContainEqual({ kind: 'same', text: 'Shared' })
  })
})
