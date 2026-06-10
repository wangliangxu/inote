import type { Note } from '../../shared/types'
import { groupByMonth } from '../../shared/vault'

interface CalendarViewProps {
  notes: Note[]
  onSelectNote: (path: string) => void
}

export function CalendarView({ notes, onSelectNote }: CalendarViewProps) {
  return (
    <section className="calendar-panel">
      <h2>Monthly Notes</h2>
      <div className="month-list">
        {groupByMonth(notes).map((group) => (
          <div className="month-item" key={group.month}>
            <h3>{group.month}</h3>
            {group.notes.map((note) => (
              <button className="note-row" key={note.path} onClick={() => onSelectNote(note.path)}>
                <strong>{note.title}</strong>
                <span>{note.category}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
