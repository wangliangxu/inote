import { describe, expect, it } from 'vitest'
import { renderMarkdownPreview } from './markdownPreview'

describe('renderMarkdownPreview', () => {
  it('renders headings, paragraphs, lists, quotes, and code blocks', () => {
    const html = renderMarkdownPreview(`# Title

Hello **world**.

- one
- two

> quoted

\`\`\`
const x = 1
\`\`\``)

    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<p>Hello <strong>world</strong>.</p>')
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>')
    expect(html).toContain('<blockquote>quoted</blockquote>')
    expect(html).toContain('<pre><code>const x = 1</code></pre>')
  })

  it('escapes raw html before applying markdown formatting', () => {
    const html = renderMarkdownPreview('# <script>alert("x")</script>')

    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })
})
