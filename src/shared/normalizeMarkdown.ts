/**
 * Pre-normalizes a Markdown body to match MDXEditor's canonical output format.
 *
 * MDXEditor internally parses Markdown → Lexical AST → re-serializes to Markdown.
 * This round-trip can change formatting (bullet chars, list spacing, table delimiters, etc.).
 * By pre-normalizing the body with the **same** mdast parse/serialize pipeline and options,
 * we ensure the editor's input already matches its output, so:
 *   - The diff view shows no spurious differences
 *   - onChange won't fire with formatting-only changes
 *   - The note won't be marked "unsaved" just from opening it
 */
import { fromMarkdown } from 'mdast-util-from-markdown'
import { toMarkdown } from 'mdast-util-to-markdown'
import { gfmTable } from 'micromark-extension-gfm-table'
import { gfmTableFromMarkdown, gfmTableToMarkdown } from 'mdast-util-gfm-table'
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item'
import { gfmTaskListItemFromMarkdown, gfmTaskListItemToMarkdown } from 'mdast-util-gfm-task-list-item'
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough'
import { gfmStrikethroughFromMarkdown, gfmStrikethroughToMarkdown } from 'mdast-util-gfm-strikethrough'
import type { Options as FromMarkdownOptions } from 'mdast-util-from-markdown'
import type { Options as ToMarkdownOptions } from 'mdast-util-to-markdown'

const fromOptions: FromMarkdownOptions = {
  extensions: [gfmTable(), gfmTaskListItem(), gfmStrikethrough()],
  mdastExtensions: [
    gfmTableFromMarkdown(),
    gfmTaskListItemFromMarkdown(),
    gfmStrikethroughFromMarkdown(),
  ],
}

// Options passed to MDXEditor's toMarkdownOptions prop.
// Must NOT include `extensions` because MDXEditor applies its own extensions
// via `{ extensions: toMarkdownExtensions, ...toMarkdownOptions }` — a spread
// would clobber the editor's own serialization extensions.
export const EDITOR_TO_MARKDOWN_OPTIONS = {
  bullet: '-' as const,
  listItemIndent: 'one' as const,
}

// Full options used locally for pre-normalization (includes GFM extensions).
const localToMarkdownOptions: ToMarkdownOptions = {
  ...EDITOR_TO_MARKDOWN_OPTIONS,
  extensions: [
    gfmTableToMarkdown(),
    gfmTaskListItemToMarkdown(),
    gfmStrikethroughToMarkdown(),
  ],
}

/**
 * Round-trips a Markdown body through the mdast parse → serialize pipeline.
 * The output is in the canonical format that MDXEditor would produce,
 * so feeding this into the editor yields zero diff on first render.
 */
export function normalizeMarkdownBody(body: string): string {
  if (!body.trim()) return body

  const tree = fromMarkdown(body, fromOptions)

  // MDXEditor's LexicalListVisitor hardcodes spread=false on all lists/items,
  // meaning it always produces "tight" lists (no blank lines between items).
  // We replicate that here so our normalization matches the editor's output.
  forceAllListsTight(tree)

  let result = toMarkdown(tree, localToMarkdownOptions)

  // mdast-util-to-markdown always appends a trailing newline;
  // trim to a single trailing newline for consistency.
  result = result.replace(/\n+$/, '\n')

  return result
}

/**
 * Recursively sets spread=false on all list and listItem nodes,
 * matching MDXEditor's LexicalListVisitor behaviour.
 */
function forceAllListsTight(node: any): void {
  if (node.type === 'list' || node.type === 'listItem') {
    node.spread = false
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      forceAllListsTight(child)
    }
  }
}
