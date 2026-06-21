import type { Note, ReviewGroup, ReviewItem, ReviewPlan } from '../../shared/types'
import type { AgentOperation, AgentResult } from './agentTypes'

export function buildReviewPlan(note: Note, result: AgentResult, turnId: string): ReviewPlan {
  const groups: ReviewGroup[] = []

  result.operations.forEach((operation, index) => {
    if (operation.type === 'update_current_note') {
      const items: ReviewItem[] = Object.entries(operation.patch).map(([field, value]) => ({
        label: field,
        before: stringifyValue((note as unknown as Record<string, unknown>)[field]),
        after: stringifyValue(value),
      }))

      groups.push({
        id: `${turnId}-metadata-${index}`,
        operationIndexes: [index],
        kind: 'metadata',
        title: 'Metadata changes',
        summary: `${items.length} ${items.length === 1 ? 'field' : 'fields'} will change.`,
        items,
        selected: true,
      })

      if (operation.patch.title !== undefined || operation.patch.category !== undefined) {
        groups.push({
          id: `${turnId}-risk-path-${index}`,
          operationIndexes: [],
          kind: 'risk',
          title: 'Path may change',
          summary: 'Changing title or category means the file path may change when saved.',
          items: [],
          selected: false,
          requiresConfirmation: true,
        })
      }
      return
    }

    if (operation.type === 'append_to_current_note') {
      groups.push({
        id: `${turnId}-body-append-${index}`,
        operationIndexes: [index],
        kind: 'body_append',
        title: 'Append to note',
        summary: 'Markdown will be appended to the current note.',
        items: [{ label: 'append', previewMarkdown: operation.markdown }],
        selected: true,
        requiresConfirmation: false,
      })
      return
    }

    if (operation.type === 'replace_current_note_body') {
      groups.push({
        id: `${turnId}-body-replace-${index}`,
        operationIndexes: [index],
        kind: 'body_replace',
        title: 'Replace note body',
        summary: 'The current note body will be replaced.',
        items: [
          { label: 'current body', before: note.body },
          { label: 'replacement', previewMarkdown: operation.markdown },
        ],
        selected: false,
        requiresConfirmation: true,
      })
      return
    }

    if (operation.type === 'create_note') {
      groups.push({
        id: `${turnId}-create-note-${index}`,
        operationIndexes: [index],
        kind: 'create_note',
        title: 'Create note',
        summary: `${operation.note.category}/${operation.note.title}`,
        items: [
          { label: 'title', after: operation.note.title },
          { label: 'category', after: operation.note.category },
          { label: 'tags', after: stringifyValue(operation.note.tags ?? []) },
          { label: 'body', previewMarkdown: operation.note.body },
        ],
        selected: true,
      })
      return
    }

    if (operation.type === 'suggest_only') {
      groups.push({
        id: `${turnId}-suggestion-${index}`,
        operationIndexes: [index],
        kind: 'suggestion',
        title: 'Suggestion',
        summary: 'Suggestion only. It will not be applied automatically.',
        items: [{ label: 'suggestion', previewMarkdown: operation.markdown }],
        selected: false,
      })
    }
  })

  return {
    id: `${turnId}-review`,
    turnId,
    message: result.message,
    groups,
    canApply: groups.some((group) => group.selected && group.operationIndexes.length > 0),
    highRisk: groups.some((group) => group.kind === 'risk' || group.requiresConfirmation),
  }
}

export function getSelectedOperations(operations: AgentOperation[], groups: ReviewGroup[]): AgentOperation[] {
  const selectedIndexes = new Set<number>()
  for (const group of groups) {
    if (group.selected && group.kind !== 'suggestion' && group.kind !== 'risk') {
      group.operationIndexes.forEach((index) => selectedIndexes.add(index))
    }
  }
  return operations.filter((_, index) => selectedIndexes.has(index))
}

function stringifyValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (value === undefined || value === null || value === '') return 'empty'
  return String(value)
}
