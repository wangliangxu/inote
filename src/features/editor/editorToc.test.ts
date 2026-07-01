import { describe, expect, it } from 'vitest'
import { computeScrollTopForChild, extractMarkdownHeadings, findActiveHeadingFromLine, findRichTextHeadingElementIndex, isScrollableOverflowY } from './editorToc'

describe('editor TOC helpers', () => {
  it('extracts markdown headings while ignoring fenced code blocks', () => {
    const headings = extractMarkdownHeadings([
      '# Intro',
      '',
      '```md',
      '# Not a heading',
      '```',
      '## Details',
    ].join('\n'))

    expect(headings.map(({ level, text, lineIndex }) => ({ level, text, lineIndex }))).toEqual([
      { level: 1, text: 'Intro', lineIndex: 0 },
      { level: 2, text: 'Details', lineIndex: 5 },
    ])
  })

  it('finds the active markdown heading for a source cursor line', () => {
    const headings = extractMarkdownHeadings('# Intro\n\nBody\n## Details\nMore')

    expect(findActiveHeadingFromLine(headings, 0)).toBe(0)
    expect(findActiveHeadingFromLine(headings, 2)).toBe(0)
    expect(findActiveHeadingFromLine(headings, 3)).toBe(1)
  })

  it('maps a markdown heading to the same rendered rich text heading occurrence', () => {
    const headings = extractMarkdownHeadings('# Intro\n\n## Same\n\nText\n\n## Same')

    expect(findRichTextHeadingElementIndex(headings, headings[1])).toBe(0)
    expect(findRichTextHeadingElementIndex(headings, headings[2])).toBe(1)
  })

  it('computes a scroll position that aligns a child with its scroll container top', () => {
    expect(computeScrollTopForChild({
      containerScrollTop: 120,
      containerTop: 200,
      childTop: 640,
    })).toBe(560)
  })

  it('recognizes overflow modes that can own editor scrolling', () => {
    expect(isScrollableOverflowY('auto')).toBe(true)
    expect(isScrollableOverflowY('scroll')).toBe(true)
    expect(isScrollableOverflowY('overlay')).toBe(true)
    expect(isScrollableOverflowY('visible')).toBe(false)
    expect(isScrollableOverflowY('hidden')).toBe(false)
  })
})
