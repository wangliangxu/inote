import { getNoteLinks, readNote, searchIndex } from '../../shared/api'
import type { Note } from '../../shared/types'
import type { AgentReference, AgentToolCall } from './agentTypes'

export interface AgentToolResult {
  callId: string
  name: AgentToolCall['name']
  ok: boolean
  content: string
  references: AgentReference[]
}

interface ExecuteAgentToolInput {
  call: AgentToolCall
  vaultRoot: string
  notes: Note[]
}

const MAX_SEARCH_RESULTS = 5
const MAX_NOTE_BODY = 6000
const blockedRoots = new Set(['archive', 'archives', 'archived', 'trash', '存档', '归档', '回收站'])

export async function executeAgentTool({ call, vaultRoot, notes }: ExecuteAgentToolInput): Promise<AgentToolResult> {
  try {
    if (call.name === 'search_notes') {
      const query = requireStringArgument(call, 'query', 200)
      const requestedLimit = optionalIntegerArgument(call, 'limit') ?? MAX_SEARCH_RESULTS
      const limit = Math.min(Math.max(requestedLimit, 1), MAX_SEARCH_RESULTS)
      const results = (await searchIndex({ vaultRoot, query }))
        .filter((result) => !isBlockedNote(result.path, result.category))
        .slice(0, limit)
      return {
        callId: call.id,
        name: call.name,
        ok: true,
        content: JSON.stringify(results.map((result) => ({
          path: result.path,
          title: result.title,
          category: result.category,
          tags: result.tags,
          updatedAt: result.updatedAt,
          summary: result.summary,
          excerpt: result.excerpt,
        }))),
        references: results.map((result) => ({ path: result.path, title: result.title, reason: 'search' })),
      }
    }

    const path = requireStringArgument(call, 'path', 500)
    const known = notes.find((note) => note.path === path && !isBlockedNote(note.path, note.category))
    if (!known) throw new Error('The requested note path is not available in the active vault.')

    if (call.name === 'read_note') {
      const note = await readNote(vaultRoot, path)
      return {
        callId: call.id,
        name: call.name,
        ok: true,
        content: JSON.stringify({
          path: note.path,
          title: note.title,
          category: note.category,
          tags: note.tags,
          summary: note.summary,
          updatedAt: note.updatedAt,
          body: note.body.slice(0, MAX_NOTE_BODY),
          truncated: note.body.length > MAX_NOTE_BODY,
        }),
        references: [{ path: note.path, title: note.title, reason: 'read' }],
      }
    }

    const links = await getNoteLinks({ vaultRoot, path })
    const backlinks = links.backlinks
      .filter((link) => {
        const source = notes.find((note) => note.path === link.sourcePath)
        return source ? !isBlockedNote(source.path, source.category) : false
      })
      .slice(0, 20)
    return {
      callId: call.id,
      name: call.name,
      ok: true,
      content: JSON.stringify(backlinks.map((link) => ({
        path: link.sourcePath,
        title: link.sourceTitle,
        label: link.label,
        kind: link.kind,
      }))),
      references: backlinks.map((link) => ({ path: link.sourcePath, title: link.sourceTitle, reason: 'backlink' })),
    }
  } catch (error) {
    return {
      callId: call.id,
      name: call.name,
      ok: false,
      content: error instanceof Error ? error.message : String(error),
      references: [],
    }
  }
}

function requireStringArgument(call: AgentToolCall, name: string, maxLength: number): string {
  const value = call.arguments[name]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${call.name} requires a non-empty ${name}.`)
  return value.trim().slice(0, maxLength)
}

function optionalIntegerArgument(call: AgentToolCall, name: string): number | undefined {
  const value = call.arguments[name]
  if (value === undefined) return undefined
  if (!Number.isInteger(value)) throw new Error(`${call.name} ${name} must be an integer.`)
  return value as number
}

function isBlockedPath(path: string): boolean {
  const root = path.trim().replace(/^\/+/, '').split(/[\\/]/)[0]?.toLowerCase() ?? ''
  return blockedRoots.has(root)
}

function isBlockedNote(path: string, category: string): boolean {
  return isBlockedPath(path) || isBlockedPath(category)
}
