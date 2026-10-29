import { invoke, isTauri } from '@tauri-apps/api/core'
import { MAX_FILE_BYTES } from './mindmap'
export interface MapFile {
  name: string
  content?: string
  error?: string
}
export async function pickMindMapFiles(): Promise<MapFile[]> {
  return invoke<MapFile[]>('pick_mindmap_files')
}
export async function readBrowserMapFile(file: File): Promise<MapFile> {
  if (file.size > MAX_FILE_BYTES) return { name: file.name, error: 'limit' }
  const bytes = await file.arrayBuffer()
  return {
    name: file.name,
    content: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  }
}
export async function saveMindMapFile(
  filename: string,
  content: string,
): Promise<void> {
  if (isTauri()) {
    await invoke('export_mindmap_file', { filename, content })
    return
  }
  const url = URL.createObjectURL(
    new Blob([content], { type: 'application/octet-stream' }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
