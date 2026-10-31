import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { toMarkdown } from 'mdast-util-to-markdown'
import { mdxJsxToMarkdown } from 'mdast-util-mdx-jsx'
import { EDITOR_TO_MARKDOWN_OPTIONS, normalizeMarkdownBody, preserveMarkdownTrailingWhitespace } from './normalizeMarkdown'

describe('Markdown endings', () => {
  it.each(['', '\n', '\n\n', '\n\n\n', '\r\n\r\n'])('preserves the exact ending %j during normalization', (ending) => {
    expect(normalizeMarkdownBody(`* Item${ending}`)).toBe(`- Item${ending}`)
    expect(preserveMarkdownTrailingWhitespace('- Item', `* Item${ending}`)).toBe(`- Item${ending}`)
  })
})

describe('EDITOR_TO_MARKDOWN_OPTIONS', () => {
  it('keeps comparison angle brackets readable when HTML processing is disabled', () => {
    const tree = fromMarkdown('1<2 and a > b\n')
    const markdown = toMarkdown(tree, {
      extensions: [mdxJsxToMarkdown()],
      ...EDITOR_TO_MARKDOWN_OPTIONS,
    })

    expect(markdown).toBe('1<2 and a > b\n')
  })
})
