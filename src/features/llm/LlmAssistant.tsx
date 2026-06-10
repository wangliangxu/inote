import { useMemo, useState } from 'react'
import type { Note } from '../../shared/types'

interface LlmAssistantProps {
  note: Note
}

export function LlmAssistant({ note }: LlmAssistantProps) {
  const [prompt, setPrompt] = useState('Summarize this note and suggest three tags.')
  const contextPreview = useMemo(() => `${note.title}\n${note.body.slice(0, 600)}`, [note])

  return (
    <div className="llm-box">
      <div className="scope-pill">current note</div>
      <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} aria-label="LLM prompt" />
      <button className="llm-action" type="button">
        Prepare request
      </button>
      <p className="panel-title compact">Context Preview</p>
      <pre>{contextPreview}</pre>
    </div>
  )
}
