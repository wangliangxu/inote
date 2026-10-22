import type { AgentMessage, AgentOperationEvent, AgentUndoSnapshot, Note } from '../../shared/types'
import type { NoteCommitInput } from '../../shared/api'
import type { AgentResult } from './agentTypes'
import { noteToMarkdown } from '../../shared/noteMarkdown'
import { newNotePath, noteSavePath } from '../../shared/notePaths'
import { applyCurrentNoteOperations, filterOperationsByIndexes, getCreateNoteDraft } from './applyAgentOperations'
import { buildOperationEventMessage } from './agentConversation'
import { makeAgentId, nowIso } from './agentUtils'
import { noteRevision } from './noteRevision'

export function buildAgentNoteCommit(before: Note, result: AgentResult, indexes: number[], turnId: string, sessionId: string, date: string, create: boolean, existingPaths: string[] = []) {
  if (before.bodyLoaded === false) throw new Error('Load the note before applying a review.')
  if (result.baseNoteRevision && result.baseNoteRevision !== noteRevision(before)) throw new Error('The note changed after this review was generated. Run the Agent again to avoid overwriting newer edits.')
  const operations = filterOperationsByIndexes(result.operations, indexes)
  if (!operations.length) throw new Error('请先选择要应用的修改。')
  let note: Note
  let changedFields: string[]
  if (create) {
    const draft = getCreateNoteDraft(operations)
    note = {
      path: newNotePath(draft.title, draft.category, existingPaths), title: draft.title, category: draft.category,
      body: `${draft.body.trimEnd()}${draft.linkBackToCurrent ? `\n\nRelated: [[${before.title}]]` : ''}`,
      tags: draft.tags ?? [], summary: draft.summary, createdAt: date, updatedAt: date, wordCount: 0,
    }
    changedFields = []
  } else {
    const applied = applyCurrentNoteOperations(before, operations, date)
    note = applied.note
    changedFields = applied.changedFields
  }
  const targetPath = create ? note.path : noteSavePath(note)
  const now = nowIso()
  const event: AgentOperationEvent = {
    id: makeAgentId('event'), sessionId, turnId, notePath: create ? before.path : targetPath,
    operationTypes: operations.map((operation) => operation.type), changedFields,
    createdNotePath: create ? targetPath : null, appliedAt: now,
  }
  const undoSnapshot: AgentUndoSnapshot = {
    id: makeAgentId('undo'), sessionId, eventId: event.id, notePath: event.notePath,
    noteBeforeMarkdown: noteToMarkdown(before), noteBeforePath: before.path,
    activePathAfterApply: targetPath, createdNotePath: create ? targetPath : null, createdAt: now,
  }
  const messages: AgentMessage[] = [buildOperationEventMessage({ id: makeAgentId('message'), sessionId, notePath: event.notePath, turnId, now, event, action: create ? 'created' : 'applied', canUndo: true })]
  const agent: NoteCommitInput['agent'] = { event, undoSnapshot, messages }
  return { note, targetPath, changedFields, agent }
}
