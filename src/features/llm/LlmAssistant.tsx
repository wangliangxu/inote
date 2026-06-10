import { useMemo, useState } from 'react'
import { executeLlmChat } from '../../shared/api'
import type { LlmProviderSettings, Note } from '../../shared/types'

interface LlmAssistantProps {
  note: Note
  notes: Note[]
  settings: LlmProviderSettings
}

type LlmTask = 'summary' | 'rewrite' | 'continue' | 'suggest' | 'folder' | 'weekly' | 'monthly'

const taskLabels: Record<LlmTask, string> = {
  summary: 'Summary',
  rewrite: 'Rewrite',
  continue: 'Continue',
  suggest: 'Title/tags',
  folder: 'Ask folder',
  weekly: 'Week review',
  monthly: 'Month review',
}

export function LlmAssistant({ note, notes, settings }: LlmAssistantProps) {
  const [task, setTask] = useState<LlmTask>('summary')
  const [question, setQuestion] = useState('What patterns or next actions stand out?')
  const [selection, setSelection] = useState('')
  const [result, setResult] = useState('')
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle')

  const contextPreview = useMemo(() => buildContext(task, note, notes, selection), [note, notes, selection, task])
  const prompt = useMemo(() => buildPrompt(task, question), [question, task])

  async function runTask() {
    setResult('')
    if (!settings.apiKey.trim()) {
      setStatus('error')
      setResult('Add an LLM API key in Settings first.')
      return
    }
    try {
      setStatus('running')
      const response = await executeLlmChat({
        settings,
        prompt,
        context: contextPreview,
      })
      setResult(response.content)
      setStatus('idle')
    } catch (error) {
      setStatus('error')
      setResult(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="llm-box">
      <div className="scope-pill">API assistant</div>
      <div className="llm-task-grid">
        {(Object.keys(taskLabels) as LlmTask[]).map((key) => (
          <button key={key} className={task === key ? 'active' : ''} type="button" onClick={() => setTask(key)}>
            {taskLabels[key]}
          </button>
        ))}
      </div>
      {task === 'rewrite' ? (
        <textarea
          aria-label="Selected text to rewrite"
          placeholder="Paste selected text here, or leave blank to rewrite the current note."
          value={selection}
          onChange={(event) => setSelection(event.target.value)}
        />
      ) : null}
      {task === 'folder' ? (
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} aria-label="Folder question" />
      ) : null}
      <button className="llm-action" type="button" onClick={runTask} disabled={status === 'running'}>
        {status === 'running' ? 'Calling API...' : 'Run assistant'}
      </button>
      <p className="panel-title compact">Context Preview</p>
      <pre>{contextPreview}</pre>
      {result ? (
        <>
          <p className="panel-title compact">{status === 'error' ? 'Error' : 'Result'}</p>
          <pre className={status === 'error' ? 'llm-error' : ''}>{result}</pre>
        </>
      ) : null}
    </div>
  )
}

function buildPrompt(task: LlmTask, question: string): string {
  if (task === 'summary') return 'Summarize the current note in 5 bullets and list concrete follow-ups.'
  if (task === 'rewrite') return 'Rewrite the selected text for clarity while preserving meaning. Return only the rewrite.'
  if (task === 'continue') return 'Continue writing from the current note. Match its tone and return 2-4 useful paragraphs.'
  if (task === 'suggest') return 'Suggest one better title and 5 concise tags. Return a compact Markdown list.'
  if (task === 'folder') return question.trim() || 'Answer using only the current folder notes.'
  if (task === 'weekly') return 'Create a weekly journal review with highlights, patterns, decisions, and follow-ups.'
  return 'Create a monthly journal review with themes, progress, open loops, and next-month focus.'
}

function buildContext(task: LlmTask, note: Note, notes: Note[], selection: string): string {
  if (task === 'rewrite') {
    return selection.trim() || note.body
  }
  if (task === 'folder') {
    return notes
      .filter((item) => item.category === note.category || item.category.startsWith(`${note.category}/`))
      .slice(0, 12)
      .map(noteContext)
      .join('\n\n---\n\n')
  }
  if (task === 'weekly') {
    return notes.filter((item) => item.category.startsWith('journal') && sameIsoWeek(item.createdAt, note.createdAt)).map(noteContext).join('\n\n---\n\n')
  }
  if (task === 'monthly') {
    return notes.filter((item) => item.category.startsWith('journal') && item.createdAt.slice(0, 7) === note.createdAt.slice(0, 7)).map(noteContext).join('\n\n---\n\n')
  }
  return noteContext(note)
}

function noteContext(note: Note): string {
  return `Title: ${note.title}
Path: ${note.path}
Category: ${note.category}
Tags: ${note.tags.join(', ') || 'none'}
Date: ${note.createdAt}

${note.body.slice(0, 2500)}`
}

function sameIsoWeek(a: string, b: string): boolean {
  const left = isoWeekKey(a)
  const right = isoWeekKey(b)
  return Boolean(left && right && left === right)
}

function isoWeekKey(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  const day = date.getDay() || 7
  date.setDate(date.getDate() + 4 - day)
  const yearStart = new Date(date.getFullYear(), 0, 1)
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${date.getFullYear()}-W${week}`
}
