import type { CategoryGroup, LlmProviderSettings } from '../../shared/types'
import type { EffectiveTheme, ThemePreference } from '../../shared/theme'
import { useTranslation } from 'react-i18next'

interface SettingsPanelProps {
  vaultRoot: string
  status: string
  llmSettings: LlmProviderSettings
  themePreference: ThemePreference
  effectiveTheme: EffectiveTheme
  baseFontSize: number
  defaultCategory: string
  categories: CategoryGroup[]
  onVaultRootChange: (path: string) => void
  onLlmSettingsChange: (settings: LlmProviderSettings) => void
  onThemePreferenceChange: (preference: ThemePreference) => void
  onBaseFontSizeChange: (size: number) => void
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
  baseFontSize,
  defaultCategory,
  categories,
  onVaultRootChange,
  onLlmSettingsChange,
  onThemePreferenceChange,
  onBaseFontSizeChange,
  onDefaultCategoryChange,
  onOpenVault,
  onInitializeVault,
  onCreateToday,

  onCreateFolder,
  onRebuildIndex,
  onClose,
}: SettingsPanelProps) {
  const { t, i18n } = useTranslation()
  function updateLlmSettings(patch: Partial<LlmProviderSettings>) {
    onLlmSettingsChange({ ...llmSettings, ...patch })
  }

  return (
    <section className="settings-panel">
      <header className="settings-window-header">
        <h2>{t('settings.title')}</h2>
        <button className="settings-close-button" type="button" onClick={onClose} aria-label={t('settings.close')}>
          x
        </button>
      </header>
      <div className="setting-box">
        <label>
          {t('settings.language')}
          <select
            className="setting-input"
            value={i18n.resolvedLanguage || 'en'}
            onChange={(event) => i18n.changeLanguage(event.target.value)}
          >
            <option value="en">English</option>
            <option value="zh">简体中文</option>
          </select>
        </label>
        <label>
          {t('settings.theme')}
          <select
            className="setting-input"
            value={themePreference}
            onChange={(event) => onThemePreferenceChange(event.target.value as ThemePreference)}
          >
            <option value="system">{t('settings.themeFollowSystem')} ({effectiveTheme})</option>
            <option value="light">{t('settings.themeLight')}</option>
            <option value="dark">{t('settings.themeDark')}</option>
          </select>
        </label>
        <label>
          {t('settings.fontSize')}
          <select
            className="setting-input"
            value={baseFontSize}
            onChange={(event) => onBaseFontSizeChange(Number(event.target.value))}
          >
            <option value={14}>{t('settings.fontSizeSmall')}</option>
            <option value={16}>{t('settings.fontSizeMedium')}</option>
            <option value={18}>{t('settings.fontSizeLarge')}</option>
            <option value={20}>{t('settings.fontSizeXLarge')}</option>
          </select>
        </label>
        <label>
          {t('settings.vaultPath')}
          <input
            className="setting-input"
            placeholder="/Users/you/Notes"
            value={vaultRoot}
            onChange={(event) => onVaultRootChange(event.target.value)}
          />
        </label>
        <label>
          {t('settings.defaultCategory')}
          <select
            className="setting-input"
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
        <div className="action-row">
          <button className="secondary-action" type="button" onClick={onOpenVault}>
            {t('settings.openVault')}
          </button>
          <button className="secondary-action" type="button" onClick={onInitializeVault}>
            {t('settings.initialize')}
          </button>
          <button className="secondary-action" type="button" onClick={onCreateToday}>
            {t('settings.todayNote')}
          </button>

          <button className="secondary-action" type="button" onClick={onCreateFolder}>
            {t('settings.newFolder')}
          </button>
          <button className="secondary-action" type="button" onClick={onRebuildIndex}>
            {t('settings.rebuildIndex')}
          </button>
        </div>
        <p className="settings-status">{status}</p>
        <label>
          {t('settings.providerName')}
          <input
            className="setting-input"
            value={llmSettings.providerName}
            onChange={(event) => updateLlmSettings({ providerName: event.target.value })}
          />
        </label>
        <label>
          {t('settings.apiBaseUrl')}
          <input
            className="setting-input"
            placeholder="https://api.openai.com/v1"
            value={llmSettings.apiBaseUrl}
            onChange={(event) => updateLlmSettings({ apiBaseUrl: event.target.value })}
          />
        </label>
        <label>
          {t('settings.apiKey')}
          <input
            className="setting-input"
            placeholder="Stored locally in this app"
            type="password"
            value={llmSettings.apiKey}
            onChange={(event) => updateLlmSettings({ apiKey: event.target.value })}
          />
        </label>
        <label>
          {t('settings.model')}
          <input
            className="setting-input"
            placeholder="gpt-4.1-mini"
            value={llmSettings.model}
            onChange={(event) => updateLlmSettings({ model: event.target.value })}
          />
        </label>
        <p className="settings-status">
          {t('settings.apiKeysNote')}
        </p>
      </div>
    </section>
  )
}
