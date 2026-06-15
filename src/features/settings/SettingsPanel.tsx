import type { CategoryGroup, LlmProviderSettings } from '../../shared/types'
import type { EffectiveTheme, ThemePreference } from '../../shared/theme'

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
  function updateLlmSettings(patch: Partial<LlmProviderSettings>) {
    onLlmSettingsChange({ ...llmSettings, ...patch })
  }

  return (
    <section className="settings-panel">
      <header className="settings-window-header">
        <h2>Settings</h2>
        <button className="settings-close-button" type="button" onClick={onClose} aria-label="Close settings">
          x
        </button>
      </header>
      <div className="setting-box">
        <label>
          Theme
          <select
            className="setting-input"
            value={themePreference}
            onChange={(event) => onThemePreferenceChange(event.target.value as ThemePreference)}
          >
            <option value="system">Follow system ({effectiveTheme})</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label>
          Font size
          <select
            className="setting-input"
            value={baseFontSize}
            onChange={(event) => onBaseFontSizeChange(Number(event.target.value))}
          >
            <option value={14}>Small</option>
            <option value={16}>Medium</option>
            <option value={18}>Large</option>
            <option value={20}>Extra Large</option>
          </select>
        </label>
        <label>
          Vault path
          <input
            className="setting-input"
            placeholder="/Users/you/Notes"
            value={vaultRoot}
            onChange={(event) => onVaultRootChange(event.target.value)}
          />
        </label>
        <label>
          Default Category
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
            Open vault
          </button>
          <button className="secondary-action" type="button" onClick={onInitializeVault}>
            Initialize
          </button>
          <button className="secondary-action" type="button" onClick={onCreateToday}>
            Today note
          </button>

          <button className="secondary-action" type="button" onClick={onCreateFolder}>
            New folder
          </button>
          <button className="secondary-action" type="button" onClick={onRebuildIndex}>
            Rebuild index
          </button>
        </div>
        <p className="settings-status">{status}</p>
        <label>
          Provider
          <input
            className="setting-input"
            value={llmSettings.providerName}
            onChange={(event) => updateLlmSettings({ providerName: event.target.value })}
          />
        </label>
        <label>
          LLM API base URL
          <input
            className="setting-input"
            placeholder="https://api.openai.com/v1"
            value={llmSettings.apiBaseUrl}
            onChange={(event) => updateLlmSettings({ apiBaseUrl: event.target.value })}
          />
        </label>
        <label>
          API key
          <input
            className="setting-input"
            placeholder="Stored locally in this app"
            type="password"
            value={llmSettings.apiKey}
            onChange={(event) => updateLlmSettings({ apiKey: event.target.value })}
          />
        </label>
        <label>
          Model
          <input
            className="setting-input"
            placeholder="gpt-4.1-mini"
            value={llmSettings.model}
            onChange={(event) => updateLlmSettings({ model: event.target.value })}
          />
        </label>
        <p className="settings-status">
          API keys are encrypted before being stored locally in SQLite. Browser fallback storage never keeps the key.
        </p>
      </div>
    </section>
  )
}
