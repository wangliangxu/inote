import type { LlmProviderSettings } from '../../shared/types'
import type { EffectiveTheme, ThemePreference } from '../../shared/theme'

interface SettingsPanelProps {
  vaultRoot: string
  status: string
  llmSettings: LlmProviderSettings
  themePreference: ThemePreference
  effectiveTheme: EffectiveTheme
  onVaultRootChange: (path: string) => void
  onLlmSettingsChange: (settings: LlmProviderSettings) => void
  onThemePreferenceChange: (preference: ThemePreference) => void
  onOpenVault: () => void
  onInitializeVault: () => void
  onCreateToday: () => void
  onCreateInbox: () => void
  onCreateWeeklyReview: () => void
  onCreateMonthlyReview: () => void
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
  onVaultRootChange,
  onLlmSettingsChange,
  onThemePreferenceChange,
  onOpenVault,
  onInitializeVault,
  onCreateToday,
  onCreateInbox,
  onCreateWeeklyReview,
  onCreateMonthlyReview,
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
          Vault path
          <input
            className="setting-input"
            placeholder="/Users/you/Notes"
            value={vaultRoot}
            onChange={(event) => onVaultRootChange(event.target.value)}
          />
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
          <button className="secondary-action" type="button" onClick={onCreateInbox}>
            Inbox note
          </button>
          <button className="secondary-action" type="button" onClick={onCreateWeeklyReview}>
            Weekly review
          </button>
          <button className="secondary-action" type="button" onClick={onCreateMonthlyReview}>
            Monthly review
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
