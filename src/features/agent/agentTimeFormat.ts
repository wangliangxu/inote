/**
 * Formats an ISO timestamp as a human-readable relative time string in Chinese.
 *
 * Examples:
 * - "刚刚"          (< 1 minute)
 * - "3 分钟前"       (< 1 hour)
 * - "1 小时前"       (< today cutoff)
 * - "昨天 14:30"     (yesterday)
 * - "6月25日 10:00"  (this year)
 * - "2025年3月1日"   (older)
 */
export function formatRelativeTime(isoString: string, now?: Date): string {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return isoString

  const reference = now ?? new Date()
  const diffMs = reference.getTime() - date.getTime()

  // Future timestamps or very small negative diffs
  if (diffMs < 0) return formatTimeOnly(date)

  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)

  if (diffMinutes < 1) return '刚刚'
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`
  if (diffHours < 6) return `${diffHours} 小时前`

  // Check if same calendar day
  if (isSameDay(date, reference)) {
    return `今天 ${formatTimeOnly(date)}`
  }

  // Check if yesterday
  const yesterday = new Date(reference)
  yesterday.setDate(yesterday.getDate() - 1)
  if (isSameDay(date, yesterday)) {
    return `昨天 ${formatTimeOnly(date)}`
  }

  // Same year
  if (date.getFullYear() === reference.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${formatTimeOnly(date)}`
  }

  // Different year
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

/**
 * Formats a timestamp as a compact label for turn group headers.
 * Shows time-only for today, date for older.
 */
export function formatTurnTimestamp(isoString: string, now?: Date): string {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return ''

  const reference = now ?? new Date()

  if (isSameDay(date, reference)) {
    return formatTimeOnly(date)
  }

  const yesterday = new Date(reference)
  yesterday.setDate(yesterday.getDate() - 1)
  if (isSameDay(date, yesterday)) {
    return `昨天 ${formatTimeOnly(date)}`
  }

  if (date.getFullYear() === reference.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${formatTimeOnly(date)}`
  }

  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function formatTimeOnly(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}
