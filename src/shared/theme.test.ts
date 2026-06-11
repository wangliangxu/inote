import { describe, expect, it } from 'vitest'
import { getEffectiveTheme, isThemePreference } from './theme'

describe('theme helpers', () => {
  it('defaults system preference to the current OS theme', () => {
    expect(getEffectiveTheme('system', true)).toBe('dark')
    expect(getEffectiveTheme('system', false)).toBe('light')
  })

  it('keeps explicit light and dark preferences independent from the OS theme', () => {
    expect(getEffectiveTheme('light', true)).toBe('light')
    expect(getEffectiveTheme('dark', false)).toBe('dark')
  })

  it('recognizes persisted theme preferences', () => {
    expect(isThemePreference('system')).toBe(true)
    expect(isThemePreference('light')).toBe(true)
    expect(isThemePreference('dark')).toBe(true)
    expect(isThemePreference('sepia')).toBe(false)
  })
})
