import { describe, expect, it } from 'vitest'
import { parsePreferenceCommand } from './useNoteAgent'

describe('explicit agent preferences', () => {
  it('only accepts explicit remember and clear commands', () => {
    expect(parsePreferenceCommand('记住：保持学术写作风格')).toEqual({ action: 'save', content: '保持学术写作风格' })
    expect(parsePreferenceCommand('remember: use concise headings')).toEqual({ action: 'save', content: 'use concise headings' })
    expect(parsePreferenceCommand('清除此笔记的 Agent 偏好')).toEqual({ action: 'clear' })
    expect(parsePreferenceCommand('我比较喜欢简洁风格')).toBeNull()
  })
})
