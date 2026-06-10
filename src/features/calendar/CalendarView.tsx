import type { Note } from '../../shared/types'
import { groupByMonth } from '../../shared/vault'

interface CalendarViewProps {
  notes: Note[]
  onSelectNote: (path: string) => void
}

export function CalendarView({ notes, onSelectNote }: CalendarViewProps) {
  return (
    <section className="calendar-panel">
      <header className="panel-heading">
        <h2>Monthly Notes</h2>
        <span>{notes.length} notes</span>
      </header>
      <div className="month-list">
        {groupByMonth(notes).map((group) => (
          <div className="month-item" key={group.month}>
            <div className="month-title">
              <h3>{group.month}</h3>
              <span>{group.notes.length}</span>
            </div>
            {group.notes.map((note) => (
              <button className="note-row" key={note.path} onClick={() => onSelectNote(note.path)}>
                <span className="note-row-top">
                  <strong>{note.title}</strong>
                  <time>{note.updatedAt}</time>
                </span>
                <span>{note.category}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
