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
    expect(getThemeDatasetValue('light', 'forest')).toBe('forest')
    expect(getThemeDatasetValue('dark', 'forest')).toBe('forest-dark')
    expect(getThemeDatasetValue('light', 'graphite')).toBe('graphite')
    expect(getThemeDatasetValue('dark', 'graphite')).toBe('graphite-dark')
    expect(getThemeDatasetValue('light', 'ember')).toBe('ember')
    expect(getThemeDatasetValue('dark', 'ember')).toBe('ember-dark')
  })

  it('accepts the redesigned color themes and rejects removed themes', () => {
    expect(isColorTheme('default')).toBe(true)
    expect(isColorTheme('forest')).toBe(true)
    expect(isColorTheme('graphite')).toBe(true)
    expect(isColorTheme('ember')).toBe(true)
    expect(isColorTheme('nord')).toBe(false)
    expect(isColorTheme('sepia')).toBe(false)
    expect(isColorTheme('ocean')).toBe(false)
  })

  it('reads removed stored color themes as default', () => {
    const storage = new Map<string, string>([['inote.colorTheme', 'nord']])
    const localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
    } as Storage

    expect(readStoredColorTheme(localStorage)).toBe('default')
  })

  it('detects default and custom dark dataset themes', () => {
    expect(isDarkThemeDatasetValue('dark')).toBe(true)
    expect(isDarkThemeDatasetValue('forest-dark')).toBe(true)
    expect(isDarkThemeDatasetValue('graphite-dark')).toBe(true)
    expect(isDarkThemeDatasetValue('ember-dark')).toBe(true)
    expect(isDarkThemeDatasetValue('light')).toBe(false)
    expect(isDarkThemeDatasetValue('forest')).toBe(false)
  })

})
