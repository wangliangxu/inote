export type DueTone = 'overdue' | 'today' | 'soon' | 'later'

export function localDateString(date = new Date()): string {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return localDateString(new Date(year, month - 1, day + days))
}

/** Classifies a due date relative to today: overdue, today, within three days, or later. */
export function dueTone(due: string, today = localDateString()): DueTone {
  const date = due.slice(0, 10)
  if (date < today) return 'overdue'
  if (date === today) return 'today'
  if (date <= addDays(today, 3)) return 'soon'
  return 'later'
}

/** Keeps the time part when moving a due date to another day. */
export function moveDueDate(current: string | undefined, date: string): string {
  if (current && current.length > 10 && current.includes('T')) return `${date}${current.slice(10)}`
  return date
}
