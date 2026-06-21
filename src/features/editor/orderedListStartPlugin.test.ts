import { describe, expect, it } from 'vitest'
import { createEditor, $getRoot } from 'lexical'
import {
  $createListNode,
  $isListNode,
  ListItemNode,
  ListNode,
} from '@lexical/list'
import {
  orderedListStartExportVisitor,
  orderedListStartImportVisitor,
} from './orderedListStartPlugin'

describe('orderedListStartPlugin', () => {
  it('imports ordered markdown lists with their explicit start number', () => {
    const editor = createEditor({ nodes: [ListNode, ListItemNode] })

    editor.update(() => {
      const root = $getRoot()

      orderedListStartImportVisitor.visitNode({
        mdastNode: {
          type: 'list',
          ordered: true,
          start: 4,
          children: [],
        },
        lexicalParent: root,
        actions: {
          visitChildren: () => {},
        },
      } as never)

      const list = root.getFirstChild()
      expect($isListNode(list)).toBe(true)
      expect($isListNode(list) ? list.getStart() : undefined).toBe(4)
    }, { discrete: true })
  })

  it('exports ordered lexical lists with their start number', () => {
    const editor = createEditor({ nodes: [ListNode, ListItemNode] })

    editor.update(() => {
      const list = $createListNode('number', 7)
      let props: Record<string, unknown> | undefined

      orderedListStartExportVisitor.visitLexicalNode?.({
        lexicalNode: list,
        actions: {
          addAndStepInto: (_type: string, nextProps?: Record<string, unknown>) => {
            props = nextProps
          },
        },
      } as never)

      expect(props).toMatchObject({
        ordered: true,
        start: 7,
        spread: false,
      })
    }, { discrete: true })
  })
})
