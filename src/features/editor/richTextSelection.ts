import {
  $createRangeSelection,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  type LexicalEditor,
} from 'lexical'

type SelectionPointSnapshot = {
  key: string
  offset: number
  type: 'text' | 'element'
}

export type RichTextSelectionSnapshot = {
  anchor: SelectionPointSnapshot
  focus: SelectionPointSnapshot
}

export function captureRichTextSelection(editor: LexicalEditor): RichTextSelectionSnapshot | null {
  let snapshot: RichTextSelectionSnapshot | null = null

  editor.getEditorState().read(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return

    snapshot = {
      anchor: {
        key: selection.anchor.key,
        offset: selection.anchor.offset,
        type: selection.anchor.type,
      },
      focus: {
        key: selection.focus.key,
        offset: selection.focus.offset,
        type: selection.focus.type,
      },
    }
  })

  return snapshot
}

export function restoreRichTextSelection(editor: LexicalEditor, snapshot: RichTextSelectionSnapshot | null): boolean {
  if (!snapshot) return false

  let restored = false
  editor.update(() => {
    const anchorNode = $getNodeByKey(snapshot.anchor.key)
    const focusNode = $getNodeByKey(snapshot.focus.key)
    if (!anchorNode || !focusNode) return

    const selection = $createRangeSelection()
    selection.anchor.set(snapshot.anchor.key, snapshot.anchor.offset, snapshot.anchor.type)
    selection.focus.set(snapshot.focus.key, snapshot.focus.offset, snapshot.focus.type)
    $setSelection(selection)
    restored = true
  }, { discrete: true })

  return restored
}
