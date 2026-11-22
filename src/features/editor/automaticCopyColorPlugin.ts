import { $getClipboardDataFromSelection, setLexicalClipboardDataTransfer } from '@lexical/clipboard'
import { createActiveEditorSubscription$, realmPlugin, viewMode$ } from '@mdxeditor/editor'
import {
  $getSelection,
  COMMAND_PRIORITY_LOW,
  COPY_COMMAND,
  getDOMSelectionPoints,
  isSelectionWithinEditor,
} from 'lexical'
import { isDarkThemeDatasetValue } from '../../shared/theme'

export const automaticCopyColorPlugin = realmPlugin({
  init(realm) {
    realm.pub(createActiveEditorSubscription$, (editor) =>
      editor.registerCommand(COPY_COMMAND, (event, sourceEditor) => {
        if (sourceEditor !== editor || !event || !('clipboardData' in event) || !event.clipboardData) return false
        if (realm.getValue(viewMode$) !== 'rich-text') return false

        const root = editor.getRootElement()
        const doc = root?.ownerDocument
        if (!doc || !isDarkThemeDatasetValue(doc.documentElement.dataset.theme)) return false

        const selection = $getSelection()
        const domSelection = doc.getSelection()
        if (!selection || selection.isCollapsed() || !domSelection) return false
        const { anchorNode, focusNode } = getDOMSelectionPoints(domSelection, root)
        if (anchorNode && focusNode && !isSelectionWithinEditor(editor, anchorNode, focusNode)) return false

        const data = $getClipboardDataFromSelection(selection)
        const html = data['text/html']
        if (html) {
          const fragment = doc.createElement('template')
          fragment.innerHTML = html
          for (const element of fragment.content.querySelectorAll<HTMLElement>('[style], font[color]')) {
            element.style.removeProperty('color')
            element.style.removeProperty('-webkit-text-fill-color')
            if (element.tagName === 'FONT') element.removeAttribute('color')
            if (element.getAttribute('style') === '') element.removeAttribute('style')
          }
          data['text/html'] = fragment.innerHTML
        }

        event.preventDefault()
        setLexicalClipboardDataTransfer(event.clipboardData, data)
        return true
      }, COMMAND_PRIORITY_LOW),
    )
  },
})
