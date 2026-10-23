import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export function getCodeMirrorCspExtensions(): Extension[] {
  if (typeof document === 'undefined') return []

  // Tauri adds a per-page nonce to this bundled style. CodeMirror's generated
  // styles need the same nonce under the packaged app's CSP. Use the property:
  // browsers hide nonce attribute values from getAttribute().
  const nonce = document.querySelector<HTMLStyleElement>('#inote-startup-theme')?.nonce
  return nonce ? [EditorView.cspNonce.of(nonce)] : []
}
