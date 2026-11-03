import type { Note } from './types'

export function firstMarkdownImage(body: string): string | null {
  const text = body.slice(0, 65536).replace(/(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[^\n]*(?=\n|$)|$)/g, '\n')
    .replace(/<!--[^]*?-->/g, '').replace(/`+[^`\n]*`+/g, '')
  const image = /!\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|((?:\\.|[^\s()\\]|\((?:\\.|[^()])*\))+))(?:\s+["'][^\n]*?["'])?\s*\)/g
  for (const match of text.matchAll(image)) {
    const source = safeCoverSource((match[1] ?? match[2]).replace(/\\([()\\ ])/g, '$1'))
    if (source) return source
  }
  return null
}
export function safeCoverSource(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const source = value.trim()
  if (!source || source.length > 2048 || /[\x00-\x1f]/.test(source)) return null
  if (/^(?:https?:\/\/|file:\/\/|[a-z]:[\\/])/i.test(source)) return source
  return /^[a-z][a-z\d+.-]*:|^\/\//i.test(source) ? null : source
}
export function noteCoverSource(note: Note): string | null {
  const cover = note.frontmatter?.cover
  if (cover === false) return null
  if (typeof cover === 'string' && cover.trim()) return safeCoverSource(cover)
  if (note.bodyLoaded === false) return safeCoverSource(note.frontmatter?.inote_card_cover)
  return firstMarkdownImage(note.body)
}
