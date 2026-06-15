import type { Note } from '../../shared/types'
import type { AgentOperation, AppliedCurrentNoteChange, NewNoteDraft } from './agentTypes'

export function applyCurrentNoteOperations(note: Note, operations: AgentOperation[], today: string): AppliedCurrentNoteChange {
  const changedFields: string[] = []
  let next: Note = { ...note, tags: [...note.tags] }

  for (const operation of operations) {
    if (operation.type === 'update_current_note') {
      for (const [field, value] of Object.entries(operation.patch)) {
        ;(next as any)[field] = Array.isArray(value) ? [...value] : value
        changedFields.push(field)
      }
    } else if (operation.type === 'append_to_current_note') {
      next.body = appendMarkdown(next.body, operation.markdown)
      changedFields.push('body')
    } else if (operation.type === 'replace_current_note_body') {
      next.body = operation.markdown
      changedFields.push('body')
    } else {
      throw new Error('Apply current note can only use current-note operations.')
    }
  }

  const uniqueChangedFields = changedFields.filter((field, index, all) => all.indexOf(field) === index)
  next = {
    ...next,
    updatedAt: today,
    wordCount: countWords(next.body),
    isDirty: true,
  }

  return { note: next, changedFields: uniqueChangedFields }
}

export function getCreateNoteDraft(operations: AgentOperation[]): NewNoteDraft {
  const createOperations = operations.filter((operation): operation is Extract<AgentOperation, { type: 'create_note' }> => operation.type === 'create_note')
  if (createOperations.length === 0) {
    throw new Error('Agent result does not contain a note draft.')
  }
  if (createOperations.length > 1 || createOperations.length !== operations.length) {
    throw new Error('Only one note can be created at a time.')
  }
  return createOperations[0].note
}

export function hasCurrentNoteWrite(operations: AgentOperation[]): boolean {
  return operations.some((operation) =>
    operation.type === 'update_current_note' ||
    operation.type === 'append_to_current_note' ||
    operation.type === 'replace_current_note_body'
  )
}

export function hasCreateNoteWrite(operations: AgentOperation[]): boolean {
  return operations.some((operation) => operation.type === 'create_note')
}

function appendMarkdown(body: string, markdown: string): string {
  const left = body.trimEnd()
  const right = markdown.trim()
  if (!left) return right
  if (!right) return left
  return `${left}\n\n${right}`
}

function countWords(body: string): number {
  return body.trim() ? body.trim().split(/\s+/).length : 0
}
