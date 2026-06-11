export type ThemePreference = 'system' | 'light' | 'dark'
export type EffectiveTheme = 'light' | 'dark'

export const THEME_PREFERENCE_KEY = 'inote.themePreference'

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function getEffectiveTheme(preference: ThemePreference, systemPrefersDark: boolean): EffectiveTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light'
  return preference
}

export function readStoredThemePreference(localStorage: Pick<Storage, 'getItem'> | undefined): ThemePreference {
  const savedThemePreference = localStorage?.getItem(THEME_PREFERENCE_KEY) ?? null
  return isThemePreference(savedThemePreference) ? savedThemePreference : 'system'
}

interface ApplyInitialThemeInput {
  element: HTMLElement
  localStorage?: Pick<Storage, 'getItem'>
  systemPrefersDark: boolean
}

export function applyInitialTheme({ element, localStorage, systemPrefersDark }: ApplyInitialThemeInput): EffectiveTheme {
  const themePreference = readStoredThemePreference(localStorage)
  const effectiveTheme = getEffectiveTheme(themePreference, systemPrefersDark)
  element.dataset.theme = effectiveTheme
  element.dataset.themePreference = themePreference
  element.style.colorScheme = effectiveTheme
  return effectiveTheme
}
