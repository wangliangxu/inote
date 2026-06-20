import { describe, expect, it } from 'vitest'
import {
  applyInitialTheme,
  getEffectiveTheme,
  getThemeDatasetValue,
  isColorTheme,
  isDarkThemeDatasetValue,
  isThemePreference,
  readStoredColorTheme,
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
    expect(getThemeDatasetValue('light', 'corporate')).toBe('corporate')
    expect(getThemeDatasetValue('dark', 'corporate')).toBe('business')
    expect(getThemeDatasetValue('light', 'cupcake')).toBe('cupcake')
    expect(getThemeDatasetValue('dark', 'cupcake')).toBe('dracula')
    expect(getThemeDatasetValue('light', 'nord')).toBe('nord')
    expect(getThemeDatasetValue('dark', 'nord')).toBe('dim')
  })

  it('accepts the redesigned color themes and rejects removed themes', () => {
    expect(isColorTheme('default')).toBe(true)
    expect(isColorTheme('corporate')).toBe(true)
    expect(isColorTheme('cupcake')).toBe(true)
    expect(isColorTheme('nord')).toBe(true)
    expect(isColorTheme('forest')).toBe(false)
    expect(isColorTheme('graphite')).toBe(false)
    expect(isColorTheme('ember')).toBe(false)
    expect(isColorTheme('sepia')).toBe(false)
    expect(isColorTheme('ocean')).toBe(false)
  })

  it('reads removed stored color themes as default', () => {
    const storage = new Map<string, string>([['inote.colorTheme', 'forest']])
    const localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
    } as Storage

    expect(readStoredColorTheme(localStorage)).toBe('default')
  })

  it('detects default and custom dark dataset themes', () => {
    expect(isDarkThemeDatasetValue('dark')).toBe(true)
    expect(isDarkThemeDatasetValue('business')).toBe(true)
    expect(isDarkThemeDatasetValue('dracula')).toBe(true)
    expect(isDarkThemeDatasetValue('dim')).toBe(true)
    expect(isDarkThemeDatasetValue('light')).toBe(false)
    expect(isDarkThemeDatasetValue('corporate')).toBe(false)
    expect(isDarkThemeDatasetValue('cupcake')).toBe(false)
    expect(isDarkThemeDatasetValue('nord')).toBe(false)
  })

})
