import type { LlmProviderSettings } from '../../shared/types'

interface SettingsPanelProps {
  vaultRoot: string
  status: string
  llmSettings: LlmProviderSettings
  onVaultRootChange: (path: string) => void
  onLlmSettingsChange: (settings: LlmProviderSettings) => void
  onOpenVault: () => void
  onInitializeVault: () => void
  onCreateToday: () => void
  onCreateInbox: () => void
  onCreateWeeklyReview: () => void
  onCreateMonthlyReview: () => void
  onCreateFolder: () => void
  onRebuildIndex: () => void
}

export function SettingsPanel({
  vaultRoot,
  status,
  llmSettings,
  onVaultRootChange,
  onLlmSettingsChange,
  onOpenVault,
  onInitializeVault,
  onCreateToday,
  onCreateInbox,
  onCreateWeeklyReview,
  onCreateMonthlyReview,
  onCreateFolder,
  onRebuildIndex,
}: SettingsPanelProps) {
  function updateLlmSettings(patch: Partial<LlmProviderSettings>) {
    onLlmSettingsChange({ ...llmSettings, ...patch })
  }

  return (
    <section className="settings-panel">
      <h2>Settings</h2>
      <div className="setting-box">
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
