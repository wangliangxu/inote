import { describe, expect, it } from 'vitest'
import { formatRelativeTime, formatTurnTimestamp } from './agentTimeFormat'

function makeDate(year: number, month: number, day: number, hour = 14, minute = 30): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

function toIso(date: Date): string {
  return date.toISOString()
}

describe('formatRelativeTime', () => {
  const now = makeDate(2026, 6, 26, 14, 30)

  it('returns "刚刚" for less than 1 minute ago', () => {
    const recent = new Date(now.getTime() - 30_000) // 30 seconds
    expect(formatRelativeTime(toIso(recent), now)).toBe('刚刚')
  })

  it('returns minutes ago', () => {
    const fiveMinAgo = new Date(now.getTime() - 5 * 60_000)
    expect(formatRelativeTime(toIso(fiveMinAgo), now)).toBe('5 分钟前')
  })

  it('returns hours ago for less than 6 hours', () => {
    const twoHoursAgo = new Date(now.getTime() - 2 * 3600_000)
    expect(formatRelativeTime(toIso(twoHoursAgo), now)).toBe('2 小时前')
  })

  it('returns "今天 HH:MM" for same day but more than 6 hours ago', () => {
    const earlyToday = makeDate(2026, 6, 26, 8, 0)
    expect(formatRelativeTime(toIso(earlyToday), now)).toBe('今天 08:00')
  })

  it('returns "昨天 HH:MM" for yesterday', () => {
    const yesterday = makeDate(2026, 6, 25, 10, 15)
    expect(formatRelativeTime(toIso(yesterday), now)).toBe('昨天 10:15')
  })

  it('returns date with time for same year', () => {
    const earlier = makeDate(2026, 3, 15, 9, 0)
    expect(formatRelativeTime(toIso(earlier), now)).toBe('3月15日 09:00')
  })

  it('returns full date for different year', () => {
    const oldDate = makeDate(2025, 12, 1, 10, 0)
    expect(formatRelativeTime(toIso(oldDate), now)).toBe('2025年12月1日')
  })

  it('handles invalid ISO strings gracefully', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('not-a-date')
  })
})

describe('formatTurnTimestamp', () => {
  const now = makeDate(2026, 6, 26, 14, 30)

  it('returns time only for today', () => {
    const today = makeDate(2026, 6, 26, 10, 0)
    expect(formatTurnTimestamp(toIso(today), now)).toBe('10:00')
  })

  it('returns "昨天 HH:MM" for yesterday', () => {
    const yesterday = makeDate(2026, 6, 25, 16, 45)
    expect(formatTurnTimestamp(toIso(yesterday), now)).toBe('昨天 16:45')
  })

  it('returns date with time for same year', () => {
    const earlier = makeDate(2026, 1, 5, 11, 30)
    expect(formatTurnTimestamp(toIso(earlier), now)).toBe('1月5日 11:30')
  })

  it('returns empty string for invalid input', () => {
    expect(formatTurnTimestamp('bad-date', now)).toBe('')
  })
})
