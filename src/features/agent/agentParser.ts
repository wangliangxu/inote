import type { AgentOperation, AgentResult, NewNoteDraft, NotePatch } from './agentTypes'

const allowedPatchFields = new Set(['title', 'category', 'tags', 'summary', 'due', 'status', 'priority', 'project'])
const allowedStatuses = new Set(['todo', 'in_progress', 'done', 'cancelled'])
const allowedPriorities = new Set(['none', 'low', 'medium', 'high'])

export function normalizeAgentTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('Tags must be an array.')
  }

  const tags: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new Error('Tags must be strings.')
    }
    const tag = item.trim().replace(/^#/, '')
    if (tag && !tags.includes(tag)) {
      tags.push(tag)
    }
  }
  return tags
}

export function parseAgentResult(raw: string): AgentResult {
  const parsed = parseJsonObject(raw)
  const message = typeof parsed.message === 'string' ? parsed.message : ''
  if (!Array.isArray(parsed.operations)) {
    throw new Error('Agent response must include an operations array.')
  }

  return {
    message,
    operations: parsed.operations.map(validateOperation),
  }
}

function parseJsonObject(raw: string): any {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  const candidate = fenced ? fenced[1].trim() : trimmed
  try {
    const parsed = JSON.parse(candidate)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('object')
    }
    return parsed
  } catch {
    throw new Error('Agent response was not valid JSON.')
  }
}

function validateOperation(value: any): AgentOperation {
  if (!value || typeof value !== 'object') {
    throw new Error('Agent operation must be an object.')
  }

  if (value.type === 'update_current_note') {
    return { type: value.type, patch: validatePatch(value.patch) }
  }
  if (value.type === 'append_to_current_note' || value.type === 'replace_current_note_body' || value.type === 'suggest_only') {
    if (typeof value.markdown !== 'string') {
      throw new Error(`${value.type} requires markdown text.`)
    }
    return { type: value.type, markdown: value.markdown }
  }
  if (value.type === 'create_note') {
    return { type: value.type, note: validateNewNote(value.note) }
  }

  throw new Error(`Unsupported agent operation: ${String(value.type)}.`)
}

function validatePatch(value: any): NotePatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Current note update requires a patch object.')
  }

  const patch: NotePatch = {}
  for (const key of Object.keys(value)) {
    if (!allowedPatchFields.has(key)) {
      throw new Error(`Unsupported note patch field: ${key}.`)
    }
  }

  for (const key of ['title', 'category', 'summary', 'due', 'status', 'priority', 'project'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw new Error(`${key} must be a string.`)
    }
  }

  if (value.status !== undefined && !allowedStatuses.has(value.status)) {
    throw new Error(`Invalid status: ${value.status}.`)
  }
  if (value.priority !== undefined && !allowedPriorities.has(value.priority)) {
    throw new Error(`Invalid priority: ${value.priority}.`)
  }
  if (value.title !== undefined) patch.title = value.title.trim()
  if (value.category !== undefined) patch.category = value.category.trim().replace(/^\/+|\/+$/g, '')
  if (value.tags !== undefined) patch.tags = normalizeAgentTags(value.tags)
  if (value.summary !== undefined) patch.summary = value.summary.trim()
  if (value.due !== undefined) patch.due = value.due.trim()
  if (value.status !== undefined) patch.status = value.status
  if (value.priority !== undefined) patch.priority = value.priority
  if (value.project !== undefined) patch.project = value.project.trim()

  return patch
}

function validateNewNote(value: any): NewNoteDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Create note requires a note object.')
  }
  if (typeof value.title !== 'string' || !value.title.trim()) {
    throw new Error('New note title is required.')
  }
  if (typeof value.category !== 'string' || !value.category.trim()) {
    throw new Error('New note category is required.')
  }
  if (typeof value.body !== 'string') {
    throw new Error('New note body is required.')
  }

  return {
    title: value.title.trim(),
    category: value.category.trim().replace(/^\/+|\/+$/g, ''),
    tags: value.tags === undefined ? undefined : normalizeAgentTags(value.tags),
    summary: typeof value.summary === 'string' ? value.summary.trim() : undefined,
    body: value.body,
    linkBackToCurrent: value.linkBackToCurrent === true,
  }
}
