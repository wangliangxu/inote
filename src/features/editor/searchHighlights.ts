import { findSearchMatches } from '../search/searchHighlight'

const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, td, th, pre, blockquote, .cm-line'

// Ranges can cross inline formatting, but never join unrelated paragraphs or lines.
export function collectSearchRanges(root: HTMLElement, query: string): Range[] {
  const segments: Array<{ node: Text, start: number, end: number }> = []
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let text = ''
  let previousBlock: Element | null = null
  let node: Node | null
  while ((node = walker.nextNode())) {
    const parent = node.parentElement
    if (!parent || parent.closest('button, script, style, [aria-hidden="true"]')) continue
    const block = parent.closest(BLOCK_SELECTOR)
    if (segments.length && block !== previousBlock) text += '\n'
    previousBlock = block
    const start = text.length
    text += node.textContent ?? ''
    segments.push({ node: node as Text, start, end: text.length })
  }

  const ranges: Range[] = []
  let segmentIndex = 0
  for (const match of findSearchMatches(text, query)) {
    while (segmentIndex < segments.length && segments[segmentIndex].end <= match.start) segmentIndex++
    const first = segments[segmentIndex]
    let endIndex = segmentIndex
    while (endIndex < segments.length && segments[endIndex].end < match.end) endIndex++
    const last = segments[endIndex]
    if (!first || !last) continue
    const range = root.ownerDocument.createRange()
    range.setStart(first.node, match.start - first.start)
    range.setEnd(last.node, match.end - last.start)
    ranges.push(range)
  }
  return ranges
}

export function installSearchHighlights(wrapper: HTMLElement, query: string): () => void {
  // Paint ranges without changing Lexical/CodeMirror DOM, selection, or saved Markdown.
  if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return () => {}
  const registry = CSS.highlights
  const highlight = new Highlight()
  const name = 'inote-search'
  registry.set(name, highlight)
  let frame: number | undefined
  const update = () => {
    frame = undefined
    highlight.clear()
    if (!query.trim()) return
    const roots = Array.from(wrapper.querySelectorAll<HTMLElement>('.mdxeditor-root-contenteditable, .cm-content'))
    for (const root of roots.filter(root => !roots.some(other => other !== root && other.contains(root)))) {
      for (const range of collectSearchRanges(root, query)) highlight.add(range)
    }
  }
  update()
  const observer = new MutationObserver(() => {
    if (frame === undefined) frame = requestAnimationFrame(update)
  })
  observer.observe(wrapper, { childList: true, characterData: true, subtree: true })
  return () => {
    observer.disconnect()
    if (frame !== undefined) cancelAnimationFrame(frame)
    if (registry.get(name) === highlight) registry.delete(name)
  }
}
