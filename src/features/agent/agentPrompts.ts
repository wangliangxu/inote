import type { Note } from '../../shared/types'
import type { QuickAgentAction } from './agentTypes'

interface BuildAgentPromptInput {
  command: string
  note: Note
  notes: Note[]
  action?: QuickAgentAction
  maxContextLength?: number
  sessionSummary?: string
}

export function buildAgentPrompt({ command, note, notes, action, maxContextLength, sessionSummary }: BuildAgentPromptInput): { prompt: string, context: string } {
  return {
    prompt: [
      'You are iNote Note Agent. Return only valid JSON and no Markdown wrapper.',
      'The JSON shape must be: {"message":"summary","operations":[{"type":"operation_name", ...}]}',
      'Allowed operation types: update_current_note, append_to_current_note, replace_current_note_body, create_note, suggest_only.',
      'For append/replace/suggest, include a "markdown" string field. For update, include a "patch" object. For create, include a "note" object.',
      'Allowed patch fields: title, category, tags, summary, due, status, priority, project.',
      '请用中文回复 message 字段内容。',
      actionInstruction(action),
      `User command: ${command.trim() || actionInstruction(action)}`,
    ].filter(Boolean).join('\n'),
    context: buildContext(note, notes, maxContextLength, sessionSummary),
  }
}

function buildContext(note: Note, notes: Note[], maxContextLength?: number, sessionSummary?: string): string {
  const activeNotes = notes.filter((item) => !isArchiveOrTrashNote(item))

  const lines: string[] = []

  // Session summary first (if available)
  if (sessionSummary?.trim()) {
    lines.push(sessionSummary.trim(), '')
  }

  // Current note metadata
  lines.push('Current note:')
  lines.push(`Title: ${note.title}`)
  lines.push(`Path: ${note.path}`)
  lines.push(`Category: ${note.category}`)
  lines.push(`Created: ${note.createdAt}`)
  lines.push(`Updated: ${note.updatedAt}`)
  if (note.tags.length > 0) lines.push(`Tags: ${note.tags.join(', ')}`)
  if (note.summary) lines.push(`Summary: ${note.summary}`)
  if (note.status) lines.push(`Status: ${note.status}`)
  if (note.priority && note.priority !== 'none') lines.push(`Priority: ${note.priority}`)
  if (note.project) lines.push(`Project: ${note.project}`)
  if (note.due) lines.push(`Due: ${note.due}`)

  // Existing categories and tags for context
  lines.push(`Existing categories: ${unique(activeNotes.map((item) => item.category)).join(', ') || 'none'}`)
  const existingTags = uniqueTags(activeNotes)
  if (existingTags.length > 0) {
    lines.push(`Existing tags: ${existingTags.slice(0, 50).join(', ')}`)
  }

  lines.push('')

  // Note body
  lines.push(note.body.slice(0, maxContextLength ?? 10000))

  return lines.filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n')
}

function actionInstruction(action?: QuickAgentAction): string {
  if (action === 'summarize') return 'Summarize the note by updating summary or returning suggest_only markdown.'
  if (action === 'suggest_tags') return 'Suggest concise tags. Use update_current_note when the user asks to apply tags.'
  if (action === 'clean_metadata') return 'Clean title, tags, summary, status, priority, project, due, or category only.'
  if (action === 'extract_tasks') return 'Extract tasks as Markdown that can be appended to the current note.'
  if (action === 'continue_writing') return 'Continue the current note with append_to_current_note.'
  if (action === 'create_related') return 'Create a related note with create_note and set linkBackToCurrent true.'
  return 'Follow the user command using the smallest safe operation set.'
}

function unique(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).sort((a, b) => a.localeCompare(b))
}

function uniqueTags(notes: Note[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const note of notes) {
    for (const tag of note.tags) {
      const normalized = tag.trim()
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized)
        result.push(normalized)
      }
    }
  }
  return result.sort((a, b) => a.localeCompare(b))
}

function isArchiveOrTrashNote(note: Note): boolean {
  const blockedRoots = new Set(['archive', 'archives', 'archived', 'trash', '存档', '归档', '回收站'])
  const categoryRoot = firstPathPart(note.category)
  const pathRoot = firstPathPart(note.path)
  return blockedRoots.has(categoryRoot) || blockedRoots.has(pathRoot)
}

function firstPathPart(value: string): string {
  return value.trim().replace(/^\/+/, '').split(/[\\/]/)[0]?.toLowerCase() ?? ''
}
