import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('note deletion controls', () => {
  it('uses real delete buttons instead of nested role buttons', () => {
    const source = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')

    expect(source).not.toContain('role="button"')
    expect(source.match(/<button[\s\S]*?className="note-delete-action"/g)).toHaveLength(2)
  })
})
