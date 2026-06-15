import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('note agent integration', () => {
  it('renders NoteAgent in the right sidebar instead of LlmAssistant', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')

    expect(app).toContain('NoteAgent')
    expect(app).not.toContain('const LlmAssistant')
    expect(app).not.toContain('<LlmAssistant')
  })

  it('has dedicated Note Agent styles', () => {
    const styles = readFileSync(resolve(__dirname, './styles.css'), 'utf8')

    expect(styles).toContain('.note-agent')
    expect(styles).toContain('.agent-change-list')
    expect(styles).toContain('.agent-footer')
  })
})
