export type ThemePreference = 'system' | 'light' | 'dark'
export type EffectiveTheme = 'light' | 'dark'

export type ColorTheme = 'default' | 'corporate' | 'cupcake' | 'nord'

export const COLOR_THEME_OPTIONS: readonly { value: ColorTheme; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'corporate', label: 'Corporate / Business' },
  { value: 'cupcake', label: 'Cupcake / Dracula' },
  { value: 'nord', label: 'Nord / Dim' },
]

export const THEME_PREFERENCE_KEY = 'inote.themePreference'
export const COLOR_THEME_KEY = 'inote.colorTheme'

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function isColorTheme(value: string | null): value is ColorTheme {
  return COLOR_THEME_OPTIONS.some((theme) => theme.value === value)
}

export function getEffectiveTheme(preference: ThemePreference, systemPrefersDark: boolean): EffectiveTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light'
  return preference
}

export function getThemeDatasetValue(effectiveTheme: EffectiveTheme, colorTheme: ColorTheme): string {
  if (colorTheme === 'default') return effectiveTheme === 'dark' ? 'dark' : 'light'
  if (colorTheme === 'corporate') return effectiveTheme === 'dark' ? 'business' : 'corporate'
  if (colorTheme === 'cupcake') return effectiveTheme === 'dark' ? 'dracula' : 'cupcake'
  if (colorTheme === 'nord') return effectiveTheme === 'dark' ? 'dim' : 'nord'
  return effectiveTheme === 'dark' ? 'dark' : 'light'
}

export function isDarkThemeDatasetValue(theme: string | undefined): boolean {
  return ['dark', 'business', 'dracula', 'dim'].includes(theme || '')
}

export function readStoredThemePreference(localStorage: Pick<Storage, 'getItem'> | undefined): ThemePreference {
  const savedThemePreference = localStorage?.getItem(THEME_PREFERENCE_KEY) ?? null
  return isThemePreference(savedThemePreference) ? savedThemePreference : 'system'
}

export function readStoredColorTheme(localStorage: Pick<Storage, 'getItem'> | undefined): ColorTheme {
  const saved = localStorage?.getItem(COLOR_THEME_KEY) ?? null
  return isColorTheme(saved) ? saved : 'default'
}

interface ApplyInitialThemeInput {
  element: HTMLElement
  localStorage?: Pick<Storage, 'getItem'>
  systemPrefersDark: boolean
}

export function applyInitialTheme({ element, localStorage, systemPrefersDark }: ApplyInitialThemeInput): EffectiveTheme {
  const themePreference = readStoredThemePreference(localStorage)
  const colorTheme = readStoredColorTheme(localStorage)
  const effectiveTheme = getEffectiveTheme(themePreference, systemPrefersDark)
  
  element.dataset.theme = getThemeDatasetValue(effectiveTheme, colorTheme)
  element.dataset.themePreference = themePreference
  element.style.colorScheme = effectiveTheme
  return effectiveTheme
}
