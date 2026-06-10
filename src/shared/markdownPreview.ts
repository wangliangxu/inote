export function renderMarkdownPreview(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: string[] = []
  let paragraph: string[] = []
  let listItems: string[] = []
  let codeLines: string[] = []
  let inCodeBlock = false

  function flushParagraph() {
    if (!paragraph.length) return
    blocks.push(`<p>${formatInline(paragraph.join(' '))}</p>`)
    paragraph = []
  }

  function flushList() {
    if (!listItems.length) return
    blocks.push(`<ul>${listItems.map((item) => `<li>${formatInline(item)}</li>`).join('')}</ul>`)
    listItems = []
  }

  function flushCode() {
    blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
    codeLines = []
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        flushCode()
        inCodeBlock = false
      } else {
        flushParagraph()
        flushList()
        inCodeBlock = true
      }
      continue
    }

    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      const level = heading[1].length
      blocks.push(`<h${level}>${formatInline(heading[2])}</h${level}>`)
      continue
    }

    const list = line.match(/^\s*[-*]\s+(.+)$/)
    if (list) {
      flushParagraph()
      listItems.push(list[1])
      continue
    }

    const quote = line.match(/^>\s+(.+)$/)
    if (quote) {
      flushParagraph()
      flushList()
      blocks.push(`<blockquote>${formatInline(quote[1])}</blockquote>`)
      continue
    }

    paragraph.push(line.trim())
  }

  if (inCodeBlock) flushCode()
  flushParagraph()
  flushList()

  return blocks.join('\n')
}

function formatInline(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
