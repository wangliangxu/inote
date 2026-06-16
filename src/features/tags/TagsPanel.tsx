import { useState, useMemo } from 'react'
import { Search, ArrowDownAZ, TrendingDown, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Note } from '../../shared/types'
import { groupByTag } from '../../shared/vault'

interface TagsPanelProps {
  notes: Note[]
  onSelectNote: (path: string) => void
  onClose: () => void
}

type SortMode = 'frequency' | 'alpha'

export function TagsPanel({ notes, onSelectNote, onClose }: TagsPanelProps) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('frequency')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)

  const allTags = useMemo(() => groupByTag(notes), [notes])

  const filteredTags = useMemo(() => {
    let tags = allTags
    if (filter.trim()) {
      const q = filter.trim().toLowerCase()
      tags = tags.filter((t) => t.name.toLowerCase().includes(q))
    }
    if (sortMode === 'frequency') {
      return [...tags].sort((a, b) => b.count - a.count)
    }
    return [...tags].sort((a, b) => a.name.localeCompare(b.name))
  }, [allTags, filter, sortMode])

  const totalTaggedNotes = useMemo(() => {
    const paths = new Set<string>()
    for (const note of notes) {
      if (note.tags.length > 0) paths.add(note.path)
    }
    return paths.size
  }, [notes])

  const selectedNotes = useMemo(() => {
    if (!selectedTag) return []
    return notes.filter((n) => n.tags.includes(selectedTag)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [notes, selectedTag])

  function handleTagClick(tag: string) {
    setSelectedTag(prev => prev === tag ? null : tag)
  }

  function handleNoteClick(path: string) {
    onSelectNote(path)
    onClose()
  }

  return (
    <div className="tags-popover">
      <div className="tags-popover-header">
        <div className="tags-popover-title">
          <h2>{t('tags.title')}</h2>
          <span className="tags-popover-count">{allTags.length}</span>
        </div>
        <button
          className="tags-popover-close"
          type="button"
          onClick={onClose}
          aria-label={t('tags.close')}
        >
          <X size={18} />
        </button>
      </div>

      <div className="tags-popover-toolbar">
        <div className="tags-filter-box">
          <Search size={14} />
          <input
            type="text"
            placeholder={t('tags.filterPlaceholder')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
        </div>
        <div className="tags-sort-toggle">
          <button
            className={sortMode === 'frequency' ? 'active' : ''}
            type="button"
            onClick={() => setSortMode('frequency')}
            title={t('tags.sortByFrequency')}
            aria-label={t('tags.sortByFrequency')}
          >
            <TrendingDown size={14} />
          </button>
          <button
            className={sortMode === 'alpha' ? 'active' : ''}
            type="button"
            onClick={() => setSortMode('alpha')}
            title={t('tags.sortByAlpha')}
            aria-label={t('tags.sortByAlpha')}
          >
            <ArrowDownAZ size={14} />
          </button>
        </div>
      </div>

      <div className="tags-cloud">
        {filteredTags.length === 0 ? (
          <p className="tags-empty">
            {filter.trim() ? t('tags.noMatch') : t('tags.noTags')}
          </p>
        ) : (
          filteredTags.map((tag) => (
            <button
              key={tag.name}
              className={`tag-chip ${selectedTag === tag.name ? 'active' : ''}`}
              type="button"
              onClick={() => handleTagClick(tag.name)}
            >
              <span className="tag-chip-name">#{tag.name}</span>
              <span className="tag-chip-count">{tag.count}</span>
            </button>
          ))
        )}
      </div>

      {selectedTag && (
        <div className="tags-note-section">
          <div className="tags-note-header">
            <h3>#{selectedTag}</h3>
            <span>{t('tags.notesCount', { count: selectedNotes.length })}</span>
          </div>
          <div className="cal-note-list tags-note-list">
            {selectedNotes.map((note) => (
              <button
                className="cal-note-item tags-note-item"
                key={note.path}
                type="button"
                onClick={() => handleNoteClick(note.path)}
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
        </div>
      )}

      {!selectedTag && (
        <div className="tags-popover-footer">
          <span>{t('tags.tagsCount', { count: allTags.length })}</span>
          <span>·</span>
          <span>{t('tags.taggedNotesCount', { count: totalTaggedNotes })}</span>
        </div>
      )}
    </div>
  )
}
