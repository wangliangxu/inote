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

/**
 * Characters whose phrasing-level escape rules we suppress.
 *
 * In GFM-compatible renderers, intra-word underscores (`foo_bar`) never trigger
 * emphasis, so escaping them as `foo\_bar` is unnecessary and produces noisy
 * diffs in source/diff mode. With MDXEditor's HTML processing disabled, `<`
 * is also ordinary text and should stay readable in saved notes.
 */
const SUPPRESSED_PHRASING_CHARS = new Set(['_', '<', '[', ']', '(', ')'])

/**
 * A custom text handler that temporarily filters `state.unsafe` before calling
 * `state.safe()`. This removes the overly-aggressive underscore escaping at its
 * source — inside mdast-util-to-markdown's serializer — so it works everywhere:
 * pre-normalization, MDXEditor onChange, and the internal source/diff views.
 */
function textHandlerNoOverEscape(node: any, _parent: any, state: any, info: any): string {
  const originalUnsafe = state.unsafe
  state.unsafe = originalUnsafe.filter((pattern: any) => {
    // Remove phrasing-level escape rules for suppressed characters.
    // Keep atBreak rules (line-start `_` can start a thematic break).
    const inPhrasing =
      pattern.inConstruct === 'phrasing' ||
      (Array.isArray(pattern.inConstruct) && pattern.inConstruct.includes('phrasing'))

    if (
      SUPPRESSED_PHRASING_CHARS.has(pattern.character) &&
      inPhrasing &&
      !pattern.atBreak
    ) {
      return false
    }
    return true
  })
  const result = state.safe(node.value, info)
  state.unsafe = originalUnsafe
  return result
}

/**
 * toMarkdown extension that replaces the default `text` handler to suppress
 * overly-aggressive underscore escaping. Safe to pass as both a local extension
 * and via MDXEditor's `toMarkdownOptions.handlers`.
 */
export const noOverEscapeExtension = {
  handlers: {
    text: textHandlerNoOverEscape,
  },
}

// Options passed to MDXEditor's toMarkdownOptions prop.
// Must NOT include `extensions` because MDXEditor applies its own extensions
// via `{ extensions: toMarkdownExtensions, ...toMarkdownOptions }` — a spread
// would clobber the editor's own serialization extensions.
export const EDITOR_TO_MARKDOWN_OPTIONS = {
  bullet: '-' as const,
  listItemIndent: 'one' as const,
  incrementListMarker: true,
  // Force links to use [text](url) format instead of <url> autolinks.
  // MDXEditor's MDX parser treats `<` as JSX tag start, so autolinks like
  // <user@example.com> cause "Unexpected character `@`" parse errors.
  resourceLink: true,
  // Override the text handler to suppress over-escaping of underscores.
  handlers: {
    text: textHandlerNoOverEscape,
  },
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

  try {
    // Convert [text]("url") to [text](<url>) before parsing.
    // Some editors/tools wrap link URLs in quotes, but CommonMark treats
    // "..." inside () as a title attribute, not a URL. The angle-bracket
    // form <url> is the standard way to include spaces/special chars in URLs.
    body = body.replace(/\[([^\]]*)\]\("([^"]+)"\)/g, (_match, text, url) => {
      return `[${text}](<${url}>)`
    })

    const tree = fromMarkdown(body, fromOptions)

    // MDXEditor's LexicalListVisitor hardcodes spread=false on all lists/items,
    // meaning it always produces "tight" lists (no blank lines between items).
    // We replicate that here so our normalization matches the editor's output.
    forceAllListsTight(tree)

    let result = toMarkdown(tree, localToMarkdownOptions)

    // mdast-util-to-markdown always appends a trailing newline;
    // but the original body might have multiple trailing newlines (e.g. empty paragraphs).
    // Preserve the exact ending, including the absence of a final newline.
    const trailingNewlines = body.match(/(?:\r?\n)*$/)?.[0] ?? ''
    result = result.replace(/\n+$/, trailingNewlines)

    return result
  } catch {
    // If normalization fails (e.g. unusual syntax), return the original body
    // so the editor can still attempt to render it.
    return body
  }
}

/** Restore the whitespace MDXEditor's rich-text exporter unconditionally trims. */
export function preserveMarkdownTrailingWhitespace(markdown: string, reference: string): string {
  const ending = reference.match(/[ \t\r\n]*$/)?.[0] ?? ''
  return markdown.replace(/[ \t\r\n]*$/, ending)
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
