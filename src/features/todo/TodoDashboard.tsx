import { useMemo } from 'react'
import type { Note, SearchResult } from '../../shared/types'
import { CalendarDays, Flag, LayoutList } from 'lucide-react'
import './TodoDashboard.css'

interface TodoDashboardProps {
  notes: Array<Note | SearchResult>
  onSelectNote: (path: string) => void
  onUpdateNoteStatus: (path: string, status: string) => void
}

export function TodoDashboard({ notes, onSelectNote, onUpdateNoteStatus }: TodoDashboardProps) {
  const columns = useMemo(() => {
    const cols: Record<string, Array<Note | SearchResult>> = {
      todo: [],
      in_progress: [],
      done: []
    }
    for (const note of notes) {
      if ('status' in note && note.status) {
        if (cols[note.status]) {
          cols[note.status].push(note)
        } else if (note.status === 'cancelled') {
           // Ignore
        } else {
          // Default to todo if status is something weird
          cols.todo.push(note)
        }
      } else {
        // If it's just due without status, assume todo
        if ('due' in note && note.due) {
          cols.todo.push(note)
        }
      }
    }
    return cols
  }, [notes])

  const handleDragStart = (e: React.DragEvent, path: string) => {
    e.dataTransfer.setData('text/plain', path)
    e.currentTarget.classList.add('dragging')
  }

  const handleDragEnd = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('dragging')
  }

  const handleDrop = (e: React.DragEvent, status: string) => {
    e.preventDefault()
    e.currentTarget.classList.remove('drag-over')
    const path = e.dataTransfer.getData('text/plain')
    if (path) {
      onUpdateNoteStatus(path, status)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.classList.add('drag-over')
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.classList.remove('drag-over')
    }
  }

  return (
    <div className="todo-dashboard">
      <header className="todo-dashboard-header">
        <h2><LayoutList size={22} /> Todo Board</h2>
      </header>
      <div className="todo-board">
        {['todo', 'in_progress', 'done'].map((status) => (
          <div 
            key={status} 
            className="todo-column"
            onDrop={(e) => handleDrop(e, status)}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
          >
            <div className="todo-column-header">
              <h3>{status === 'todo' ? 'Todo' : status === 'in_progress' ? 'In Progress' : 'Done'}</h3>
              <span className="count-badge">{columns[status].length}</span>
            </div>
            <div className="todo-column-list">
              {columns[status].map(note => (
                <div 
                  key={note.path} 
                  className="todo-card" 
                  draggable
                  onDragStart={(e) => handleDragStart(e, note.path)}
                  onDragEnd={handleDragEnd}
                  onClick={() => onSelectNote(note.path)}
                >
                  <h4>{note.title}</h4>
                  <div className="todo-card-footer">
                    {('due' in note && note.due) && (
                      <span className="todo-due-badge"><CalendarDays size={12}/> {note.due.split('T')[0]}</span>
                    )}
                    {('priority' in note && note.priority && note.priority !== 'none') && (
                      <Flag size={12} className={`priority-icon ${note.priority}`} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
