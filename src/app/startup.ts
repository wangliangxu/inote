import type { Note, SaveState } from '../shared/types'

export const LAST_VAULT_KEY = 'inote.lastVaultRoot'
export const LAST_ACTIVE_PATH_KEY = 'inote.activePath'

export interface InitialWorkspaceState {
  notes: Note[]
  activePath: string
  vaultRoot: string
  status: string
  saveState: SaveState
}

export function createInitialWorkspaceState(localStorage: Pick<Storage, 'getItem'> | undefined): InitialWorkspaceState {
  return {
    notes: [],
    activePath: localStorage?.getItem(LAST_ACTIVE_PATH_KEY) ?? '',
    vaultRoot: localStorage?.getItem(LAST_VAULT_KEY) ?? '',
    status: 'Loading workspace settings...',
    saveState: 'loading',
  }
}
