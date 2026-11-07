import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HighlightedText } from '../search/HighlightedText'

interface InlineTitleProps {
  title: string
  searchQuery?: string
  disabled?: boolean
  onCommit: (title: string) => void
}

/** Note title that turns into a text field on click; Enter or blur renames, Esc cancels. */
export function InlineTitle({ title, searchQuery = '', disabled = false, onCommit }: InlineTitleProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    if (!editing) setValue(title)
  }, [title, editing])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  function finish() {
    setEditing(false)
    if (cancelledRef.current) {
      cancelledRef.current = false
      setValue(title)
      return
    }
    const next = value.trim()
    if (next && next !== title) onCommit(next)
    else setValue(title)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        id="editor-title-input"
        className="editor-title-input"
        value={value}
        aria-label={t('editor.title')}
        onChange={(event) => setValue(event.target.value)}
        onBlur={finish}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            inputRef.current?.blur()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            cancelledRef.current = true
            inputRef.current?.blur()
          }
        }}
      />
    )
  }

  if (disabled) {
    return <h2><HighlightedText text={title} query={searchQuery} /></h2>
  }

  return (
    <h2>
      <button
        type="button"
        className="editor-title-button"
        title={t('editor.renameByTitle')}
        onClick={() => setEditing(true)}
      >
        <HighlightedText text={title} query={searchQuery} />
      </button>
    </h2>
  )
}
