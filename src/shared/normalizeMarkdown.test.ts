import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { toMarkdown } from 'mdast-util-to-markdown'
import { mdxJsxToMarkdown } from 'mdast-util-mdx-jsx'
import { EDITOR_TO_MARKDOWN_OPTIONS } from './normalizeMarkdown'

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
