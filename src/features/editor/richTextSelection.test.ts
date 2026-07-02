import { describe, expect, it } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $setSelection,
  createEditor,
} from 'lexical'
import { $createHeadingNode, $isHeadingNode, HeadingNode } from '@lexical/rich-text'
import { $setBlocksType } from '@lexical/selection'
import { captureRichTextSelection, restoreRichTextSelection } from './richTextSelection'

describe('rich text selection preservation', () => {
  it('restores the caret to the same text offset after changing a paragraph to a heading', () => {
    const editor = createEditor({ nodes: [HeadingNode] })
    let textKey = ''

    editor.update(() => {
      const root = $getRoot()
      const paragraph = $createParagraphNode()
      const text = $createTextNode('Keep my cursor here')
      textKey = text.getKey()
      paragraph.append(text)
      root.append(paragraph)
      text.select(8, 8)
    }, { discrete: true })

    const snapshot = captureRichTextSelection(editor)

    editor.update(() => {
      const selection = $getSelection()
      expect($isRangeSelection(selection)).toBe(true)
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createHeadingNode('h2'))
      }
      $setSelection(null)
    }, { discrete: true })

    expect(restoreRichTextSelection(editor, snapshot)).toBe(true)

    editor.getEditorState().read(() => {
      const block = $getRoot().getFirstChild()
      const selection = $getSelection()

      expect($isParagraphNode(block)).toBe(false)
      expect($isHeadingNode(block) ? block.getTag() : null).toBe('h2')
      expect($isRangeSelection(selection)).toBe(true)
      if ($isRangeSelection(selection)) {
        expect(selection.anchor.key).toBe(textKey)
        expect(selection.anchor.offset).toBe(8)
        expect(selection.focus.key).toBe(textKey)
        expect(selection.focus.offset).toBe(8)
      }
    })
  })
})
