import { useState } from 'react'
import { Settings, Palette, Bot, X } from 'lucide-react'
import type { CategoryGroup, LlmProviderSettings } from '../../shared/types'
import type { EffectiveTheme, ThemePreference, ColorTheme } from '../../shared/theme'
import { COLOR_THEME_OPTIONS } from '../../shared/theme'
import { getSystemFonts } from '../../shared/api'
import { useTranslation } from 'react-i18next'
import { useEffect } from 'react'

interface SettingsPanelProps {
  vaultRoot: string
  status: string
  llmSettings: LlmProviderSettings
  themePreference: ThemePreference
  effectiveTheme: EffectiveTheme
  colorTheme: ColorTheme
  baseFontSize: number
  fontFamily: string
  defaultCategory: string
  categories: CategoryGroup[]
  showTodayNoteButton: boolean
  onShowTodayNoteButtonChange: (show: boolean) => void
  lockUpdateTime: boolean
  onLockUpdateTimeChange: (lock: boolean) => void
  onVaultRootChange: (path: string) => void
  onLlmSettingsChange: (settings: LlmProviderSettings) => void
  onThemePreferenceChange: (preference: ThemePreference) => void
  onColorThemeChange: (theme: ColorTheme) => void
  onBaseFontSizeChange: (size: number) => void
  onFontFamilyChange: (family: string) => void
  onDefaultCategoryChange: (category: string) => void
  onOpenVault: () => void
  onInitializeVault: () => void
  onCreateToday: () => void

  onCreateFolder: () => void
  onRebuildIndex: () => void
  onClose: () => void
}

export function SettingsPanel({
  vaultRoot,
  status,
  llmSettings,
  themePreference,
  effectiveTheme,
  colorTheme,
  baseFontSize,
  fontFamily,
  defaultCategory,
  categories,
  showTodayNoteButton,
  onShowTodayNoteButtonChange,
  lockUpdateTime,
  onLockUpdateTimeChange,
  onVaultRootChange,
  onLlmSettingsChange,
  onThemePreferenceChange,
  onColorThemeChange,
  onBaseFontSizeChange,
  onFontFamilyChange,
  onDefaultCategoryChange,
  onOpenVault,
  onInitializeVault,
  onCreateToday,

  onCreateFolder,
  onRebuildIndex,
  onClose,
}: SettingsPanelProps) {
  const { t, i18n } = useTranslation()
  const [activeTab, setActiveTab] = useState<'general' | 'appearance' | 'llm'>('general')
  const [systemFonts, setSystemFonts] = useState<string[]>([])

  useEffect(() => {
    if (activeTab === 'appearance' && systemFonts.length === 0) {
      getSystemFonts().then(fonts => {
        setSystemFonts(fonts)
      }).catch(err => console.error("Failed to load fonts:", err))
    }
  }, [activeTab, systemFonts.length])

  function updateLlmSettings(patch: Partial<LlmProviderSettings>) {
    onLlmSettingsChange({ ...llmSettings, ...patch })
  }

  return (
    <section className="settings-panel flex h-full flex-col bg-base-100 text-base-content">
      <header className="settings-window-header flex items-center justify-between px-5 py-4">
        <h2 className="m-0 text-lg font-bold">
          {t('settings.title')}
        </h2>
        <button className="settings-close-button btn btn-ghost btn-sm btn-circle" type="button" onClick={onClose} aria-label={t('settings.close')}>
          <X size={18} />
        </button>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden px-5 pb-5">
        {/* Tab buttons */}
        <div role="tablist" className="tabs tabs-lift">
          <button
            role="tab"
            className={`tab gap-2 [--tab-border-color:var(--color-base-300)] ${activeTab === 'general' ? 'tab-active' : ''}`}
            type="button"
            onClick={() => setActiveTab('general')}
          >
            <Settings size={16} />
            <span>{t('settings.general')}</span>
          </button>
          <button
            role="tab"
            className={`tab gap-2 [--tab-border-color:var(--color-base-300)] ${activeTab === 'appearance' ? 'tab-active' : ''}`}
            type="button"
            onClick={() => setActiveTab('appearance')}
          >
            <Palette size={16} />
            <span>{t('settings.appearance')}</span>
          </button>
          <button
            role="tab"
            className={`tab gap-2 [--tab-border-color:var(--color-base-300)] ${activeTab === 'llm' ? 'tab-active' : ''}`}
            type="button"
            onClick={() => setActiveTab('llm')}
          >
            <Bot size={16} />
            <span>{t('settings.llm')}</span>
          </button>
        </div>

        {/* Tab content panel */}
        <div
          role="tabpanel"
          className="flex-1 overflow-y-auto rounded-b-box border border-base-300 bg-base-100 p-5"
        >
          {activeTab === 'general' && (
            <div className="settings-tab-content grid gap-4">
              <label className="setting-label form-control grid gap-2">
                <span className="label-text font-semibold">{t('settings.vaultPath')}</span>
                <input
                  className="setting-input input input-bordered w-full"
                  placeholder="/Users/you/Notes"
                  value={vaultRoot}
                  onChange={(event) => onVaultRootChange(event.target.value)}
                />
              </label>
              <label className="setting-label form-control grid gap-2">
                <span className="label-text font-semibold">{t('settings.defaultCategory')}</span>
                <select
                  className="setting-input select select-bordered w-full"
                  value={defaultCategory || (categories.length > 0 ? categories[0].name : '')}
                  onChange={(event) => onDefaultCategoryChange(event.target.value)}
                >
                  {defaultCategory && !categories.some(c => c.name === defaultCategory) && (
                    <option value={defaultCategory}>{defaultCategory}</option>
                  )}
                  {categories.map((cat) => (
                    <option key={cat.name} value={cat.name}>{cat.name}</option>
                  ))}
                </select>
              </label>
              <label className="setting-checkbox-label label cursor-pointer justify-start gap-3 rounded-lg bg-base-200/60 px-3 py-2">
                <input
                  className="checkbox checkbox-primary checkbox-sm"
                  type="checkbox"
                  checked={showTodayNoteButton}
                  onChange={(e) => onShowTodayNoteButtonChange(e.target.checked)}
                />
                <span className="label-text">{t('settings.showTodayNoteButton')}</span>
              </label>
              <label className="setting-checkbox-label label cursor-pointer justify-start gap-3 rounded-lg bg-base-200/60 px-3 py-2">
                <input
                  className="checkbox checkbox-primary checkbox-sm"
                  type="checkbox"
                  checked={lockUpdateTime}
                  onChange={(e) => onLockUpdateTimeChange(e.target.checked)}
                />
                <span className="label-text">{t('settings.lockUpdateTime')}</span>
              </label>
              <div className="action-row flex flex-wrap gap-2">
                <button className="secondary-action btn btn-outline btn-sm" type="button" onClick={onOpenVault}>
                  {t('settings.openVault')}
                </button>
                <button className="secondary-action btn btn-outline btn-sm" type="button" onClick={onInitializeVault}>
                  {t('settings.initialize')}
                </button>
                <button className="secondary-action btn btn-outline btn-sm" type="button" onClick={onCreateFolder}>
                  {t('settings.newFolder')}
                </button>
                <button className="secondary-action btn btn-outline btn-sm" type="button" onClick={onRebuildIndex}>
                  {t('settings.rebuildIndex')}
                </button>
              </div>
              <p className="settings-status alert alert-info alert-soft py-2 text-sm">{status}</p>
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="settings-tab-content grid gap-4">
              <label className="setting-label form-control grid gap-2">
                <span className="label-text font-semibold">{t('settings.language')}</span>
                <select
                  className="setting-input select select-bordered w-full"
                  value={i18n.resolvedLanguage || 'en'}
                  onChange={(event) => i18n.changeLanguage(event.target.value)}
                >
                  <option value="en">English</option>
                  <option value="zh">简体中文</option>
                </select>
              </label>
              <label className="setting-label form-control grid gap-2">
                <span className="label-text font-semibold">{t('settings.theme')} Mode</span>
                <select
                  className="setting-input select select-bordered w-full"
                  value={themePreference}
                  onChange={(event) => onThemePreferenceChange(event.target.value as ThemePreference)}
                >
                  <option value="system">{t('settings.themeFollowSystem')} ({effectiveTheme})</option>
                  <option value="light">{t('settings.themeLight')}</option>
                  <option value="dark">{t('settings.themeDark')}</option>
                </select>
              </label>
              <label className="setting-label form-control grid gap-2">
                <span className="label-text font-semibold">Color Theme</span>
                <select
                  className="setting-input select select-bordered w-full"
                  value={colorTheme}
                  onChange={(event) => onColorThemeChange(event.target.value as ColorTheme)}
                >
                  {COLOR_THEME_OPTIONS.map((theme) => (
                    <option key={theme.value} value={theme.value}>{theme.label}</option>
                  ))}
                </select>
              </label>
              <label className="setting-label form-control grid gap-2">
                <span className="label-text font-semibold">{t('settings.fontSize')}</span>
                <select
                  className="setting-input select select-bordered w-full"
                  value={baseFontSize}
                  onChange={(event) => onBaseFontSizeChange(Number(event.target.value))}
                >
                  <option value={14}>{t('settings.fontSizeSmall')}</option>
                  <option value={16}>{t('settings.fontSizeMedium')}</option>
                  <option value={18}>{t('settings.fontSizeLarge')}</option>
                  <option value={20}>{t('settings.fontSizeXLarge')}</option>
                </select>
              </label>
              <label className="setting-label form-control grid gap-2">
                <span className="label-text font-semibold">{t('settings.fontFamily') || 'Font Family'}</span>
                <select
                  className="setting-input select select-bordered w-full"
                  value={fontFamily}
                  onChange={(event) => onFontFamilyChange(event.target.value)}
                >
                  <option value="">{t('settings.fontFamilyDefault') || 'System Default'}</option>
                  {systemFonts.map((font) => (
                    <option key={font} value={font}>{font}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {activeTab === 'llm' && (
            <div className="settings-tab-content grid gap-4">
              <label className="setting-label form-control grid gap-2">
                <span className="label-text font-semibold">{t('settings.providerName')}</span>
                <input
                  className="setting-input input input-bordered w-full"
                  value={llmSettings.providerName}
                  onChange={(event) => updateLlmSettings({ providerName: event.target.value })}
                />
              </label>
              <label className="setting-label form-control grid gap-2">
                <span className="label-text font-semibold">{t('settings.apiBaseUrl')}</span>
                <input
                  className="setting-input input input-bordered w-full"
                  placeholder="https://api.openai.com/v1"
                  value={llmSettings.apiBaseUrl}
                  onChange={(event) => updateLlmSettings({ apiBaseUrl: event.target.value })}
                />
              </label>
              <label className="setting-label form-control grid gap-2">
                <span className="label-text font-semibold">{t('settings.apiKey')}</span>
                <input
                  className="setting-input input input-bordered w-full"
                  placeholder="Stored locally in this app"
                  type="password"
                  value={llmSettings.apiKey}
                  onChange={(event) => updateLlmSettings({ apiKey: event.target.value })}
                />
              </label>
              <label className="setting-label form-control grid gap-2">
                <span className="label-text font-semibold">{t('settings.model')}</span>
                <input
                  className="setting-input input input-bordered w-full"
                  placeholder="gpt-4.1-mini"
                  value={llmSettings.model}
                  onChange={(event) => updateLlmSettings({ model: event.target.value })}
                />
              </label>
              <p className="settings-status alert alert-warning alert-soft py-2 text-sm">
                {t('settings.apiKeysNote')}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
