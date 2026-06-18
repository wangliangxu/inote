import { describe, expect, it } from 'vitest'
import {
  applyInitialTheme,
  getEffectiveTheme,
  getThemeDatasetValue,
  isThemePreference,
  readStoredThemePreference,
} from './theme'

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

  it('reads invalid stored theme preferences as system', () => {
    const storage = new Map<string, string>([['inote.themePreference', 'sepia']])
    const localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
    } as Storage

    expect(readStoredThemePreference(localStorage)).toBe('system')
  })

  it('applies the initial dark theme before React renders', () => {
    const element = {
      dataset: {},
      style: {},
    } as HTMLElement
    const storage = new Map<string, string>([['inote.themePreference', 'system']])
    const localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
    } as Storage

    applyInitialTheme({
      element,
      localStorage,
      systemPrefersDark: true,
    })

    expect(element.dataset.theme).toBe('dark')
    expect(element.dataset.themePreference).toBe('system')
    expect(element.style.colorScheme).toBe('dark')
  })

  it('maps color themes to light and dark dataset values', () => {
    expect(getThemeDatasetValue('light', 'default')).toBe('light')
    expect(getThemeDatasetValue('dark', 'default')).toBe('dark')
    expect(getThemeDatasetValue('light', 'nord')).toBe('nord')
    expect(getThemeDatasetValue('dark', 'nord')).toBe('nord-dark')
    expect(getThemeDatasetValue('light', 'sepia')).toBe('sepia')
    expect(getThemeDatasetValue('dark', 'sepia')).toBe('sepia-dark')
    expect(getThemeDatasetValue('light', 'ocean')).toBe('ocean')
    expect(getThemeDatasetValue('dark', 'ocean')).toBe('ocean-dark')
  })

})
