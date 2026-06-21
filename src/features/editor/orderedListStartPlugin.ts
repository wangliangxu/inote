import {
  addExportVisitor$,
  addImportVisitor$,
  realmPlugin,
  type LexicalExportVisitor,
  type MdastImportVisitor,
} from '@mdxeditor/editor'
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  type ListNode,
} from '@lexical/list'
import type { ElementNode } from 'lexical'
import type { List } from 'mdast'

export const orderedListStartImportVisitor: MdastImportVisitor<List> = {
  testNode: 'list',
  priority: 10,
  visitNode({ mdastNode, lexicalParent, actions }) {
    const listType = mdastNode.children.some((item) => typeof item.checked === 'boolean')
      ? 'check'
      : mdastNode.ordered
        ? 'number'
        : 'bullet'
    const start = mdastNode.ordered && typeof mdastNode.start === 'number' ? mdastNode.start : 1
    const lexicalNode = $createListNode(listType, start)

    if ($isListItemNode(lexicalParent)) {
      const dedicatedParent = $createListItemNode()
      dedicatedParent.append(lexicalNode)
      lexicalParent.insertAfter(dedicatedParent)
    } else {
      const parent = lexicalParent as ElementNode
      parent.append(lexicalNode)
    }

    actions.visitChildren(mdastNode, lexicalNode)
  },
}

export const orderedListStartExportVisitor: LexicalExportVisitor<ListNode, List> = {
  testLexicalNode: $isListNode,
  priority: 10,
  visitLexicalNode({ lexicalNode, actions }) {
    const ordered = lexicalNode.getListType() === 'number'

    actions.addAndStepInto('list', {
      ordered,
      start: ordered ? lexicalNode.getStart() : undefined,
      spread: false,
    })
  },
}

export const orderedListStartPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({
      [addImportVisitor$]: orderedListStartImportVisitor,
      [addExportVisitor$]: orderedListStartExportVisitor,
    })
  },
})
