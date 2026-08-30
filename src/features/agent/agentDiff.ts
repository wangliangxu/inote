import type { ReviewDiffLine } from '../../shared/types'

const MAX_DIFF_LINES = 400

export function buildLineDiff(before: string, after: string): ReviewDiffLine[] {
  const left = before.split('\n')
  const right = after.split('\n')
  if (left.length > MAX_DIFF_LINES || right.length > MAX_DIFF_LINES) {
    return [
      ...left.slice(0, 200).map((text): ReviewDiffLine => ({ kind: 'remove', text })),
      { kind: 'same', text: '… diff 已截断 …' },
      ...right.slice(0, 200).map((text): ReviewDiffLine => ({ kind: 'add', text })),
    ]
  }

  const lengths = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1))
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = left[i] === right[j]
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }

  const diff: ReviewDiffLine[] = []
  let i = 0
  let j = 0
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      diff.push({ kind: 'same', text: left[i] })
      i += 1
      j += 1
    } else if (j < right.length && (i >= left.length || lengths[i][j + 1] >= lengths[i + 1][j])) {
      diff.push({ kind: 'add', text: right[j] })
      j += 1
    } else {
      diff.push({ kind: 'remove', text: left[i] })
      i += 1
    }
  }
  return diff
}
