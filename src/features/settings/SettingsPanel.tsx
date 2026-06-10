interface SettingsPanelProps {
  vaultRoot: string
  status: string
  onVaultRootChange: (path: string) => void
  onOpenVault: () => void
  onCreateToday: () => void
  onCreateInbox: () => void
}

export function SettingsPanel({
  vaultRoot,
  status,
  onVaultRootChange,
  onOpenVault,
  onCreateToday,
  onCreateInbox,
}: SettingsPanelProps) {
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
          <button className="secondary-action" type="button" onClick={onCreateToday}>
            Today note
          </button>
          <button className="secondary-action" type="button" onClick={onCreateInbox}>
            Inbox note
          </button>
        </div>
        <p className="settings-status">{status}</p>
        <label>
          LLM API base URL
          <input className="setting-input" placeholder="https://api.openai.com/v1" />
        </label>
        <label>
          Model
          <input className="setting-input" placeholder="gpt-4.1-mini" />
        </label>
      </div>
    </section>
  )
}
