export interface EditorHeading {
  id: string
  text: string
  level: number
  numberPrefix?: string
  lineIndex: number
}

export function extractMarkdownHeadings(markdown: string): EditorHeading[] {
  const lines = markdown.split('\n')
  const result: EditorHeading[] = []
  let inCodeBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue

    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      result.push({
        id: `h-${i}`,
        level: match[1].length,
        text: match[2].trim(),
        lineIndex: i
      })
    }
  }

  if (result.length > 0) {
    const numberPath: number[] = []
    const minLevel = Math.min(...result.map(h => h.level))
    result.forEach(h => {
      const relLevel = h.level - minLevel
      numberPath.length = relLevel + 1
      for (let j = 0; j < relLevel; j++) {
        if (numberPath[j] === undefined) numberPath[j] = 1
      }
      numberPath[relLevel] = (numberPath[relLevel] || 0) + 1
      h.numberPrefix = numberPath.join('.') + '. '
    })
  }

  return result
}

export function findActiveHeadingFromLine(headings: readonly EditorHeading[], lineIndex: number): number {
  let activeIndex = -1
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].lineIndex <= lineIndex) {
      activeIndex = i
    } else {
      break
    }
  }
  return activeIndex
}

export function findRichTextHeadingElementIndex(headings: readonly EditorHeading[], heading: EditorHeading): number {
  return headings
    .filter(candidate => candidate.level === heading.level)
    .findIndex(candidate => candidate.lineIndex === heading.lineIndex)
}

export function computeScrollTopForChild({
  containerScrollTop,
  containerTop,
  childTop,
}: {
  containerScrollTop: number
  containerTop: number
  childTop: number
}): number {
  return containerScrollTop + childTop - containerTop
}

export function isScrollableOverflowY(overflowY: string): boolean {
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay'
}
