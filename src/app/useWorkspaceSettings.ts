import { useEffect, useRef } from 'react'
import { saveUserSettings } from '../shared/api'
import type { UserSettings } from '../shared/types'
import { LAST_ACTIVE_PATH_KEY, LAST_VAULT_KEY } from './startup'

export function useWorkspaceSettings(settingsLoaded: boolean, settings: UserSettings, onError: (message: string) => void) {
  const skipInitial = useRef(true)
  const serialized = JSON.stringify(settings)
  useEffect(() => {
    if (!settingsLoaded) return
    if (skipInitial.current) { skipInitial.current = false; return }
    const value = JSON.parse(serialized) as UserSettings
    let disposed = false
    const timeout = window.setTimeout(() => {
      saveUserSettings(value).then(() => {
        if (disposed) return
        window.localStorage.setItem(LAST_VAULT_KEY, value.vaultRoot)
        window.localStorage.setItem(LAST_ACTIVE_PATH_KEY, value.activePath)
        window.localStorage.removeItem('inote.llmSettings')
      }).catch((error) => {
        if (disposed) return
        onError(`Settings Save Error: ${String(error)}`)
        window.localStorage.setItem(LAST_VAULT_KEY, value.vaultRoot)
        window.localStorage.setItem(LAST_ACTIVE_PATH_KEY, value.activePath)
        window.localStorage.setItem('inote.llmSettings', JSON.stringify({ ...value.llmSettings, apiKey: '' }))
      })
    }, 300)
    return () => { disposed = true; window.clearTimeout(timeout) }
  }, [settingsLoaded, serialized, onError])
}
