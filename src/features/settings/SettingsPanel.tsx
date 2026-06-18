import { useState } from 'react'
import { Settings, Palette, Bot } from 'lucide-react'
import type { CategoryGroup, LlmProviderSettings } from '../../shared/types'
import type { EffectiveTheme, ThemePreference } from '../../shared/theme'
import { getSystemFonts } from '../../shared/api'
import { useTranslation } from 'react-i18next'
import { useEffect } from 'react'

interface SettingsPanelProps {
  vaultRoot: string
  status: string
  llmSettings: LlmProviderSettings
  themePreference: ThemePreference
  effectiveTheme: EffectiveTheme
  baseFontSize: number
  fontFamily: string
  defaultCategory: string
  categories: CategoryGroup[]
  showTodayNoteButton: boolean
  onShowTodayNoteButtonChange: (show: boolean) => void
  onVaultRootChange: (path: string) => void
  onLlmSettingsChange: (settings: LlmProviderSettings) => void
  onThemePreferenceChange: (preference: ThemePreference) => void
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
  baseFontSize,
  fontFamily,
  defaultCategory,
  categories,
  showTodayNoteButton,
  onShowTodayNoteButtonChange,
  onVaultRootChange,
  onLlmSettingsChange,
  onThemePreferenceChange,
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

  const tabButtonStyle = (isActive: boolean) => ({
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    background: isActive ? 'var(--accent, #0066cc)' : 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '8px 12px',
    borderRadius: '8px',
    color: isActive ? '#fff' : 'var(--text-secondary, #888)',
    opacity: isActive ? 1 : 0.8,
    minWidth: '64px'
  })

  return (
    <section className="settings-panel" style={{ display: 'flex', flexDirection: 'column', height: '560px', padding: 0 }}>
      <header className="settings-window-header" style={{ borderBottom: 'none', position: 'relative', paddingTop: '16px', paddingLeft: '16px', paddingRight: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '1.2em', fontWeight: 'bold', color: 'var(--text)', textAlign: 'center' }}>
          {t('settings.title')}
        </h2>
        <button className="settings-close-button" type="button" onClick={onClose} aria-label={t('settings.close')} style={{ position: 'absolute', right: '16px', top: '16px' }}>
          x
        </button>
      </header>

      <div className="settings-toolbar" style={{ display: 'flex', justifyContent: 'center', gap: '16px', padding: '12px 0 16px 0', borderBottom: '1px solid var(--border)' }}>
        <button onClick={() => setActiveTab('general')} style={tabButtonStyle(activeTab === 'general')}>
          <Settings size={22} />
          <span style={{ fontSize: '11px', marginTop: '6px' }}>{t('settings.general')}</span>
        </button>
        <button onClick={() => setActiveTab('appearance')} style={tabButtonStyle(activeTab === 'appearance')}>
          <Palette size={22} />
          <span style={{ fontSize: '11px', marginTop: '6px' }}>{t('settings.appearance')}</span>
        </button>
        <button onClick={() => setActiveTab('llm')} style={tabButtonStyle(activeTab === 'llm')}>
          <Bot size={22} />
          <span style={{ fontSize: '11px', marginTop: '6px' }}>{t('settings.llm')}</span>
        </button>
      </div>

      <div className="setting-box" style={{ padding: '24px 32px', flex: 1, overflowY: 'auto' }}>
        {activeTab === 'general' && (
          <div className="settings-tab-content">
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
            <label className="setting-checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px', marginTop: '12px' }}>
              <input
                type="checkbox"
                checked={showTodayNoteButton}
                onChange={(e) => onShowTodayNoteButtonChange(e.target.checked)}
              />
              {t('settings.showTodayNoteButton')}
            </label>
            <div className="action-row" style={{ marginTop: '16px' }}>
              <button className="secondary-action" type="button" onClick={onOpenVault}>
                {t('settings.openVault')}
              </button>
              <button className="secondary-action" type="button" onClick={onInitializeVault}>
                {t('settings.initialize')}
              </button>
              <button className="secondary-action" type="button" onClick={onCreateFolder}>
                {t('settings.newFolder')}
              </button>
              <button className="secondary-action" type="button" onClick={onRebuildIndex}>
                {t('settings.rebuildIndex')}
              </button>
            </div>
            <p className="settings-status" style={{ marginTop: '8px' }}>{status}</p>
          </div>
        )}

        {activeTab === 'appearance' && (
          <div className="settings-tab-content">
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
              {t('settings.fontFamily') || 'Font Family'}
              <select
                className="setting-input"
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
          <div className="settings-tab-content">
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
            <p className="settings-status" style={{ marginTop: '8px' }}>
              {t('settings.apiKeysNote')}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
