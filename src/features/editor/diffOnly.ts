import { RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { getChunks } from '@codemirror/merge'

function unchangedRanges(state: EditorState): DecorationSet {
  const diff = getChunks(state)
  if (!diff?.side || !diff.chunks.length) return Decoration.none

  const ranges = new RangeSetBuilder<Decoration>()
  const { doc } = state
  const context = 3
  let nextLine = 1
  const hide = (first: number, last: number) => {
    const from = doc.line(first).from
    const to = doc.line(last).to
    if (from < to) ranges.add(from, to, Decoration.replace({ block: true }))
  }
  for (const chunk of diff.chunks) {
    const from = diff.side === 'a' ? chunk.fromA : chunk.fromB
    const to = diff.side === 'a' ? chunk.toA : chunk.toB
    const first = Math.max(1, doc.lineAt(Math.min(from, doc.length)).number - context)
    const last = Math.min(doc.lines, doc.lineAt(Math.min(Math.max(from, to - 1), doc.length)).number + context)
    if (nextLine < first) hide(nextLine, first - 1)
    nextLine = Math.max(nextLine, last + 1)
  }
  if (nextLine <= doc.lines) hide(nextLine, doc.lines)
  return ranges.finish()
}

const hiddenUnchanged = StateField.define<DecorationSet>({
  create: unchangedRanges,
  update(ranges, transaction) {
    const before = getChunks(transaction.startState)
    const after = getChunks(transaction.state)
    return transaction.docChanged || before?.chunks !== after?.chunks
      ? unchangedRanges(transaction.state)
      : ranges
  },
  provide: field => EditorView.decorations.from(field),
})

// Keep full documents in state: collapsing is visual and never emits a text edit.
// getChunks returns null in source mode and in fenced-code editors.
export const diffOnlyExtension: Extension = [
  hiddenUnchanged,
  EditorView.atomicRanges.of(view => view.state.field(hiddenUnchanged)),
  EditorView.editorAttributes.of(view => {
    const diff = getChunks(view.state)
    return diff?.side ? { 'data-inote-diff-empty': String(diff.chunks.length === 0) } : null
  }),
]
