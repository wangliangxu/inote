/**
 * Shared utility functions for the note agent feature.
 * Eliminates duplicate implementations of ID generation and timestamp helpers
 * that previously existed in both NoteAgent.tsx and App.tsx.
 */

export function makeAgentId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}
