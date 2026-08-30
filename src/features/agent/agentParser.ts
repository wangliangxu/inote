import type { AgentOperation, AgentResult, AgentStep, AgentToolCall, AgentToolName, NewNoteDraft, NotePatch } from './agentTypes'

const allowedPatchFields = new Set(['title', 'category', 'tags', 'summary', 'due', 'status', 'priority', 'project'])
const allowedStatuses = new Set(['todo', 'in_progress', 'done', 'cancelled'])
const allowedPriorities = new Set(['none', 'low', 'medium', 'high'])
const MAX_OPERATIONS = 12
const MAX_MARKDOWN_LENGTH = 50000
const MAX_TOTAL_MARKDOWN_LENGTH = 100000
const MAX_TITLE_LENGTH = 200
const MAX_CATEGORY_LENGTH = 500
const MAX_TAGS = 30

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
  const step = parseAgentStep(raw)
  if ('toolCalls' in step) {
    throw new Error('Agent response requested tools instead of returning operations.')
  }
  return step
}

export function parseAgentStep(raw: string): AgentStep {
  const parsed = parseJsonObject(raw)
  if (parsed.version !== undefined && parsed.version !== 1) {
    throw new Error(`Unsupported agent protocol version: ${String(parsed.version)}.`)
  }
  const message = typeof parsed.message === 'string' ? parsed.message : ''
  if (parsed.toolCalls !== undefined && parsed.toolCalls !== null) {
    if (!Array.isArray(parsed.toolCalls) || parsed.toolCalls.length === 0) {
      throw new Error('Agent toolCalls must be a non-empty array.')
    }
    if (parsed.operations !== undefined && parsed.operations !== null) {
      throw new Error('Agent response cannot contain toolCalls and operations together.')
    }
    return {
      version: 1,
      message,
      toolCalls: parsed.toolCalls.map(validateToolCall),
    }
  }
  if (!Array.isArray(parsed.operations)) {
    throw new Error('Agent response must include an operations array.')
  }
  if (parsed.operations.length > MAX_OPERATIONS) {
    throw new Error(`Agent response exceeds the ${MAX_OPERATIONS}-operation limit.`)
  }

  const operations: AgentOperation[] = parsed.operations.map(validateOperation)
  const totalMarkdownLength = operations.reduce((total, operation) => {
    if ('markdown' in operation) return total + operation.markdown.length
    if (operation.type === 'create_note') return total + operation.note.body.length
    return total
  }, 0)
  if (totalMarkdownLength > MAX_TOTAL_MARKDOWN_LENGTH) {
    throw new Error(`Agent response exceeds the ${MAX_TOTAL_MARKDOWN_LENGTH}-character content limit.`)
  }

  return {
    version: 1,
    message,
    operations,
  }
}

const allowedToolNames = new Set<AgentToolName>(['search_notes', 'read_note', 'list_backlinks'])

function validateToolCall(value: any): AgentToolCall {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Agent tool call must be an object.')
  }
  if (typeof value.id !== 'string' || !value.id.trim()) {
    throw new Error('Agent tool call requires an id.')
  }
  if (typeof value.name !== 'string' || !allowedToolNames.has(value.name as AgentToolName)) {
    throw new Error(`Unsupported agent tool: ${String(value.name)}.`)
  }
  if (!value.arguments || typeof value.arguments !== 'object' || Array.isArray(value.arguments)) {
    throw new Error('Agent tool call requires an arguments object.')
  }
  return { id: value.id.trim(), name: value.name as AgentToolName, arguments: value.arguments }
}

function parseJsonObject(raw: string): any {
  let processed = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()

  try {
    return parseCandidate(processed)
  } catch (e1) {}

  let unfenced = processed
  if (unfenced.startsWith('```')) {
    const lines = unfenced.split('\n')
    if (lines[0].startsWith('```')) lines.shift()
    if (lines.length > 0 && lines[lines.length - 1].trim() === '```') lines.pop()
    unfenced = lines.join('\n').trim()
    try {
      return parseCandidate(unfenced)
    } catch (e2) {}
  }

  const lines = processed.split('\n')
  let insideBlock = false
  let currentBlock: string[] = []
  for (const line of lines) {
    if (!insideBlock && line.trim().startsWith('```json')) {
      insideBlock = true
      currentBlock = []
    } else if (insideBlock && line.trim() === '```') {
      insideBlock = false
      try {
        return parseCandidate(currentBlock.join('\n').trim())
      } catch (e3) {}
    } else if (insideBlock) {
      currentBlock.push(line)
    }
  }

  const firstBrace = processed.indexOf('{')
  const lastBrace = processed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
    const candidate = processed.slice(firstBrace, lastBrace + 1)
    try {
      return parseCandidate(candidate)
    } catch (e4) {
      const errorMessage = e4 instanceof Error ? e4.message : String(e4)
      throw new Error(`Agent response was not valid JSON. Parse error: ${errorMessage}`)
    }
  }

  throw new Error('Agent response was not valid JSON. No JSON object found.')
}

function parseCandidate(candidate: string): any {
  const parsed = JSON.parse(candidate)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Parsed result is not a JSON object.')
  }
  return parsed
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
    if (value.markdown.length > MAX_MARKDOWN_LENGTH) {
      throw new Error(`${value.type} exceeds the ${MAX_MARKDOWN_LENGTH}-character limit.`)
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
    if (value[key] !== undefined && value[key] !== null && typeof value[key] !== 'string') {
      throw new Error(`${key} must be a string.`)
    }
  }

  if (value.status !== undefined && value.status !== null && !allowedStatuses.has(value.status)) {
    throw new Error(`Invalid status: ${value.status}.`)
  }
  if (value.priority !== undefined && value.priority !== null && !allowedPriorities.has(value.priority)) {
    throw new Error(`Invalid priority: ${value.priority}.`)
  }
  if (value.title != null) patch.title = value.title.trim()
  if (value.category != null) patch.category = value.category.trim().replace(/^\/+|\/+$/g, '')
  if (value.tags != null) patch.tags = normalizeAgentTags(value.tags)
  if (value.summary != null) patch.summary = value.summary.trim()
  if (value.due != null) patch.due = value.due.trim()
  if (value.status != null) patch.status = value.status
  if (value.priority != null) patch.priority = value.priority
  if (value.project != null) patch.project = value.project.trim()

  if (patch.title && patch.title.length > MAX_TITLE_LENGTH) throw new Error(`title exceeds ${MAX_TITLE_LENGTH} characters.`)
  if (patch.category && patch.category.length > MAX_CATEGORY_LENGTH) throw new Error(`category exceeds ${MAX_CATEGORY_LENGTH} characters.`)
  if (patch.tags && patch.tags.length > MAX_TAGS) throw new Error(`tags exceeds the ${MAX_TAGS}-tag limit.`)

  return patch
}

function validateNewNote(value: any): NewNoteDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Create note requires a note object.')
  }
  if (typeof value.title !== 'string' || !value.title.trim()) {
    throw new Error('New note title is required.')
  }
  if (value.title.trim().length > MAX_TITLE_LENGTH) throw new Error(`New note title exceeds ${MAX_TITLE_LENGTH} characters.`)
  if (typeof value.category !== 'string' || !value.category.trim()) {
    throw new Error('New note category is required.')
  }
  if (value.category.trim().length > MAX_CATEGORY_LENGTH) throw new Error(`New note category exceeds ${MAX_CATEGORY_LENGTH} characters.`)
  if (typeof value.body !== 'string') {
    throw new Error('New note body is required.')
  }
  if (value.body.length > MAX_MARKDOWN_LENGTH) throw new Error(`New note body exceeds ${MAX_MARKDOWN_LENGTH} characters.`)

  const tags = value.tags == null ? undefined : normalizeAgentTags(value.tags)
  if (tags && tags.length > MAX_TAGS) throw new Error(`New note tags exceeds the ${MAX_TAGS}-tag limit.`)

  return {
    title: value.title.trim(),
    category: value.category.trim().replace(/^\/+|\/+$/g, ''),
    tags,
    summary: typeof value.summary === 'string' ? value.summary.trim() : undefined,
    body: value.body,
    linkBackToCurrent: value.linkBackToCurrent === true,
  }
}
