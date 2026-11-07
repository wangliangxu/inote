const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g

/** Counts CJK characters individually and other text by whitespace-separated words. */
export function countWords(text: string): number {
  const stripped = text
    .replace(/^---[\s\S]*?\n---\n?/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]/g, ' ')
  const cjk = stripped.match(CJK)?.length ?? 0
  const latin = stripped.replace(CJK, ' ').split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length
  return cjk + latin
}

/** Minutes to read, assuming about 300 CJK characters or 220 words per minute. */
export function readingMinutes(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0
  const words = countWords(text) - cjk
  const minutes = cjk / 300 + words / 220
  return Math.max(1, Math.round(minutes))
}
