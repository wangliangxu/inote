import { useMemo, useState } from 'react'
import type { Note, SearchResult } from '../../shared/types'
import { useTranslation } from 'react-i18next'
import { CalendarDays, Flag, LayoutList, Plus } from 'lucide-react'
import { dueTone } from '../../shared/dueDates'
import './TodoDashboard.css'

type TaskNote = Note | SearchResult

interface TodoDashboardProps {
  notes: TaskNote[]
  onSelectNote: (path: string) => void
  onUpdateNoteStatus: (path: string, status: string) => void
  onCreateTask?: (title: string, status: string) => Promise<void> | void
  canCreate?: boolean
}

const STATUSES = ['todo', 'in_progress', 'done'] as const
const PRIORITIES = ['high', 'medium', 'low', 'none'] as const

export function TodoDashboard({ notes, onSelectNote, onUpdateNoteStatus, onCreateTask, canCreate = false }: TodoDashboardProps) {
  const { t } = useTranslation()
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState<string | null>(null)

  const projects = useMemo(() => {
    const names = new Set<string>()
    for (const note of notes) if ('project' in note && note.project) names.add(note.project)
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [notes])

  const filtered = useMemo(() => notes.filter((note) => {
    if (priorityFilter !== 'all' && (note.priority || 'none') !== priorityFilter) return false
    if (projectFilter !== 'all' && (note.project || '') !== projectFilter) return false
    return true
  }), [notes, priorityFilter, projectFilter])

  const columns = useMemo(() => {
    const cols: Record<string, TaskNote[]> = { todo: [], in_progress: [], done: [] }
    for (const note of filtered) {
      if (note.status) {
        if (cols[note.status]) cols[note.status].push(note)
        else if (note.status !== 'cancelled') cols.todo.push(note)
      } else if (note.due) {
        cols.todo.push(note)
      }
    }
    return cols
  }, [filtered])

  const handleDragStart = (e: React.DragEvent, path: string) => {
    e.dataTransfer.setData('application/x-inote-note', path)
    e.dataTransfer.setData('text/plain', path)
    e.currentTarget.classList.add('dragging')
  }

  const handleDragEnd = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('dragging')
  }

  const handleDrop = (e: React.DragEvent, status: string) => {
    e.preventDefault()
    e.currentTarget.classList.remove('drag-over')
    const path = e.dataTransfer.getData('application/x-inote-note') || e.dataTransfer.getData('text/plain')
    if (path) onUpdateNoteStatus(path, status)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    if (e.currentTarget instanceof HTMLElement) e.currentTarget.classList.add('drag-over')
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement && !e.currentTarget.contains(e.relatedTarget as Node | null)) {
      e.currentTarget.classList.remove('drag-over')
    }
  }

  async function submit(status: string) {
    const title = (drafts[status] ?? '').trim()
    if (!title || !onCreateTask) return
    setCreating(status)
    try {
      await onCreateTask(title, status)
      setDrafts((current) => ({ ...current, [status]: '' }))
    } finally {
      setCreating(null)
    }
  }

  const statusLabel = (status: string) => status === 'todo' ? t('todo.todoStatus') : status === 'in_progress' ? t('todo.inProgressStatus') : t('todo.doneStatus')

  return (
    <div className="todo-dashboard">
      <header className="todo-dashboard-header">
        <h2><LayoutList size={22} /> {t('todo.title')}</h2>
        <div className="todo-filters">
          <label>
            <span>{t('editor.priority')}</span>
            <select id="todo-priority-filter" className="select select-sm" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
              <option value="all">{t('todo.all')}</option>
              {PRIORITIES.map((priority) => <option key={priority} value={priority}>{t(`editor.${priority}`)}</option>)}
            </select>
          </label>
          {projects.length ? (
            <label>
              <span>{t('editor.project')}</span>
              <select id="todo-project-filter" className="select select-sm" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
                <option value="all">{t('todo.all')}</option>
                {projects.map((project) => <option key={project} value={project}>{project}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      </header>
      <div className="todo-board">
        {STATUSES.map((status) => (
          <section
            key={status}
            className="todo-column"
            aria-label={statusLabel(status)}
            onDrop={(e) => handleDrop(e, status)}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
          >
            <div className="todo-column-header">
              <h3>{statusLabel(status)}</h3>
              <span className="count-badge">{columns[status].length}</span>
            </div>
            {onCreateTask && canCreate && status !== 'done' ? (
              <form
                className="todo-quick-add"
                onSubmit={(event) => {
                  event.preventDefault()
                  void submit(status)
                }}
              >
                <Plus size={14} aria-hidden="true" />
                <input
                  id={`todo-quick-add-${status}`}
                  value={drafts[status] ?? ''}
                  disabled={creating === status}
                  placeholder={t('todo.quickAdd')}
                  aria-label={t('todo.quickAddIn', { column: statusLabel(status) })}
                  onChange={(event) => setDrafts((current) => ({ ...current, [status]: event.target.value }))}
                />
              </form>
            ) : null}
            <div className="todo-column-list">
              {columns[status].length === 0 ? <p className="todo-column-empty">{t('todo.dropHere')}</p> : null}
              {columns[status].map((note) => {
                const tone = note.due && status !== 'done' ? dueTone(note.due) : ''
                return (
                  <button
                    type="button"
                    key={note.path}
                    className={`todo-card ${tone ? `due-${tone}` : ''}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, note.path)}
                    onDragEnd={handleDragEnd}
                    onClick={() => onSelectNote(note.path)}
                  >
                    <h4>{note.title}</h4>
                    <div className="todo-card-footer">
                      {note.due ? (
                        <span className={`todo-due-badge ${tone}`} title={tone ? t(`todo.due_${tone}`) : undefined}>
                          <CalendarDays size={12} /> {note.due.split('T')[0]}
                        </span>
                      ) : null}
                      {note.project ? <span className="todo-project">{note.project}</span> : null}
                      {note.priority && note.priority !== 'none' ? (
                        <Flag size={12} className={`priority-icon ${note.priority}`} aria-label={t('todo.priorityLabel', { priority: t(`editor.${note.priority}`) })} />
                      ) : null}
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
