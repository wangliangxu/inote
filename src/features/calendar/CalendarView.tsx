import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Note } from '../../shared/types'

interface CalendarViewProps {
  notes: Note[]
  onSelectNote: (path: string) => void
  onClose: () => void
}

function toLocalDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/** Monday = 0 … Sunday = 6 */
function getStartDayOfWeek(year: number, month: number): number {
  const d = new Date(year, month, 1).getDay()
  return d === 0 ? 6 : d - 1
}

function buildCalendarDays(year: number, month: number) {
  const daysInMonth = getDaysInMonth(year, month)
  const startDay = getStartDayOfWeek(year, month)
  const prevMonth = month === 0 ? 11 : month - 1
  const prevYear = month === 0 ? year - 1 : year
  const daysInPrevMonth = getDaysInMonth(prevYear, prevMonth)

  const cells: { day: number; dateStr: string; isCurrentMonth: boolean }[] = []

  // Previous month's trailing days
  for (let i = startDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i
    const ds = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ day: d, dateStr: ds, isCurrentMonth: false })
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ day: d, dateStr: ds, isCurrentMonth: true })
  }

  // Next month leading days (fill to complete last week row)
  const remaining = 7 - (cells.length % 7)
  if (remaining < 7) {
    const nextMonth = month === 11 ? 0 : month + 1
    const nextYear = month === 11 ? year + 1 : year
    for (let d = 1; d <= remaining; d++) {
      const ds = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      cells.push({ day: d, dateStr: ds, isCurrentMonth: false })
    }
  }

  return cells
}

function getNoteDateKey(note: Note): string {
  // Use updatedAt as the primary date for calendar placement
  return (note.updatedAt || note.createdAt || '').slice(0, 10)
}

function heatLevel(count: number): number {
  if (count === 0) return 0
  if (count <= 1) return 1
  if (count <= 3) return 2
  if (count <= 6) return 3
  return 4
}

export function CalendarView({ notes, onSelectNote, onClose }: CalendarViewProps) {
  const { t, i18n } = useTranslation()
  const WEEKDAYS = t('calendar.weekdays', { returnObjects: true }) as string[]
  
  function formatMonthTitle(year: number, month: number): string {
    const date = new Date(year, month)
    return date.toLocaleDateString(i18n.language, { year: 'numeric', month: 'long' })
  }

  const today = toLocalDateString(new Date())
  const todayYear = new Date().getFullYear()
  const todayMonth = new Date().getMonth()

  const [viewYear, setViewYear] = useState(todayYear)
  const [viewMonth, setViewMonth] = useState(todayMonth)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  // Build lookup: dateStr -> Note[]
  const notesByDate = useMemo(() => {
    const map = new Map<string, Note[]>()
    for (const note of notes) {
      const key = getNoteDateKey(note)
      if (!key) continue
      const existing = map.get(key)
      if (existing) {
        existing.push(note)
      } else {
        map.set(key, [note])
      }
    }
    return map
  }, [notes])

  const cells = useMemo(() => buildCalendarDays(viewYear, viewMonth), [viewYear, viewMonth])

  const selectedNotes = useMemo(() => {
    if (!selectedDate) return []
    const list = notesByDate.get(selectedDate) ?? []
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [selectedDate, notesByDate])

  // Total notes in current month
  const monthNoteCount = useMemo(() => {
    let count = 0
    for (const cell of cells) {
      if (cell.isCurrentMonth) {
        count += (notesByDate.get(cell.dateStr) ?? []).length
      }
    }
    return count
  }, [cells, notesByDate])

  function prevMonth() {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1)
      setViewMonth(11)
    } else {
      setViewMonth(viewMonth - 1)
    }
    setSelectedDate(null)
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewYear(viewYear + 1)
      setViewMonth(0)
    } else {
      setViewMonth(viewMonth + 1)
    }
    setSelectedDate(null)
  }

  function goToday() {
    setViewYear(todayYear)
    setViewMonth(todayMonth)
    setSelectedDate(today)
  }

  return (
    <section className="calendar-panel">
      {/* Header */}
      <div className="cal-header">
        <div className="cal-nav">
          <button
            className="cal-nav-btn"
            type="button"
            onClick={prevMonth}
            aria-label={t('calendar.prevMonth')}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="cal-title-btn"
            type="button"
            onClick={goToday}
            title={t('calendar.goToday')}
          >
            {formatMonthTitle(viewYear, viewMonth)}
          </button>
          <button
            className="cal-nav-btn"
            type="button"
            onClick={nextMonth}
            aria-label={t('calendar.nextMonth')}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <span className="cal-stats">{t('calendar.notesCount', { count: monthNoteCount })}</span>
      </div>

      {/* Weekday header */}
      <div className="cal-weekday-row">
        {WEEKDAYS.map((wd) => (
          <span key={wd} className="cal-weekday">{wd}</span>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="cal-grid">
        {cells.map((cell) => {
          const dayNotes = notesByDate.get(cell.dateStr) ?? []
          const count = dayNotes.length
          const level = heatLevel(count)
          const isToday = cell.dateStr === today
          const isSelected = cell.dateStr === selectedDate
          const classes = [
            'cal-day',
            cell.isCurrentMonth ? '' : 'other-month',
            isToday ? 'today' : '',
            isSelected ? 'selected' : '',
            level > 0 ? `heat-${level}` : '',
          ].filter(Boolean).join(' ')

          return (
            <button
              key={cell.dateStr}
              className={classes}
              type="button"
              onClick={() => setSelectedDate(cell.dateStr === selectedDate ? null : cell.dateStr)}
              aria-label={`${cell.dateStr}，${t('calendar.notesCount', { count })}`}
            >
              <span className="cal-day-num">{cell.day}</span>
              {count > 0 && (
                <span className="cal-dot-row">
                  {count <= 3
                    ? Array.from({ length: count }, (_, i) => (
                        <span key={i} className="cal-dot" />
                      ))
                    : <>
                        <span className="cal-dot" />
                        <span className="cal-dot-count">{count}</span>
                      </>
                  }
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Selected day's notes */}
      {selectedDate && (
        <div className="cal-day-detail">
          <div className="cal-day-detail-header">
            <h3>{selectedDate}</h3>
            <span>{t('calendar.notesCount', { count: selectedNotes.length })}</span>
          </div>
          {selectedNotes.length === 0 ? (
            <p className="cal-empty">{t('calendar.noNotesThisDay')}</p>
          ) : (
            <div className="cal-note-list">
              {selectedNotes.map((note) => (
                <button
                  className="cal-note-item"
                  key={note.path}
                  type="button"
                  onClick={() => { onClose(); onSelectNote(note.path) }}
                >
                  <div className="cal-note-main">
                    <strong>{note.title}</strong>
                    {note.summary && <small>{note.summary}</small>}
                  </div>
                  <div className="cal-note-meta">
                    <span>{note.category}</span>
                    <time>{note.updatedAt}</time>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
