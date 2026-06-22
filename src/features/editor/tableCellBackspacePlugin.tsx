/**
 * DOM-level guard that prevents Backspace / Delete in an empty MDXEditor table
 * cell from crashing or freezing the editor.
 *
 * MDXEditor renders tables as Lexical DecoratorNodes. Each cell gets its own
 * nested LexicalNestedComposer with a RichTextPlugin.  When the cell is empty
 * and the user presses Backspace (or Delete), Lexical's RichTextPlugin tries to
 * delete backward/forward across node boundaries.  In a nested editor whose
 * root contains only a single empty paragraph, this can remove the last child
 * of the root, leaving it in an invalid state that triggers an infinite
 * reconciliation loop and freezes the entire UI.
 *
 * We fix this at the DOM `keydown` capture phase – before Lexical sees the
 * event – by checking whether the caret is inside a table cell whose
 * contenteditable area is empty.  If so we call `preventDefault()` and
 * `stopPropagation()` to swallow the key entirely.
 *
 * Usage: call `installTableCellBackspaceGuard(container)` once with the
 * element that wraps the MDXEditor.  It returns a cleanup function.
 */

/**
 * Returns `true` when `el` is inside an MDXEditor table-cell contenteditable
 * and that contenteditable's text content is empty (or whitespace-only).
 */
function isEmptyTableCell(el: Node | null): boolean {
  let node: Node | null = el
  while (node) {
    if (node instanceof HTMLElement) {
      // MDXEditor table cells render a <td> or <th> containing a
      // contenteditable div managed by a nested Lexical editor.
      if (node.getAttribute('contenteditable') === 'true') {
        // Walk up to see if this contenteditable is inside a <td>/<th>
        let parent: HTMLElement | null = node.parentElement
        while (parent) {
          const tag = parent.tagName
          if (tag === 'TD' || tag === 'TH') {
            // Found a table cell – check if the contenteditable is empty
            const text = node.textContent ?? ''
            return text.trim().length === 0
          }
          // Stop walking if we leave the table
          if (tag === 'TABLE' || tag === 'ARTICLE') break
          parent = parent.parentElement
        }
        // This contenteditable is NOT inside a table cell – bail.
        return false
      }
    }
    node = node.parentNode
  }
  return false
}

export function installTableCellBackspaceGuard(
  container: HTMLElement,
): () => void {
  function handler(e: KeyboardEvent) {
    if (e.key !== 'Backspace' && e.key !== 'Delete') return

    // Only guard if the focused element is inside this container
    const target = e.target as Node | null
    if (!target || !container.contains(target)) return

    if (isEmptyTableCell(target)) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  // Use capture phase so we fire before Lexical's own keydown listener.
  container.addEventListener('keydown', handler, true)
  return () => container.removeEventListener('keydown', handler, true)
}
