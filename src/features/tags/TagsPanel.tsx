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
    <div className="tags-popover card bg-base-100 text-base-content shadow-2xl">
      <div className="tags-popover-header flex items-center justify-between border-b border-base-300 px-5 py-4">
        <div className="tags-popover-title flex items-center gap-2">
          <h2 className="m-0 text-lg font-bold">{t('tags.title')}</h2>
          <span className="tags-popover-count badge badge-primary badge-sm">{allTags.length}</span>
        </div>
        <button
          className="tags-popover-close btn btn-ghost btn-sm btn-circle"
          type="button"
          onClick={onClose}
          aria-label={t('tags.close')}
        >
          <X size={18} />
        </button>
      </div>

      <div className="tags-popover-toolbar flex items-center gap-2 px-5 py-4">
        <label className="tags-filter-box input input-bordered input-sm flex flex-1 items-center gap-2">
          <Search size={14} className="text-base-content/50" />
          <input
            className="grow"
            type="text"
            placeholder={t('tags.filterPlaceholder')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
        </label>
        <div className="tags-sort-toggle join">
          <button
            className={`join-item btn btn-sm btn-square ${sortMode === 'frequency' ? 'active btn-primary' : 'btn-ghost'}`}
            type="button"
            onClick={() => setSortMode('frequency')}
            title={t('tags.sortByFrequency')}
            aria-label={t('tags.sortByFrequency')}
          >
            <TrendingDown size={14} />
          </button>
          <button
            className={`join-item btn btn-sm btn-square ${sortMode === 'alpha' ? 'active btn-primary' : 'btn-ghost'}`}
            type="button"
            onClick={() => setSortMode('alpha')}
            title={t('tags.sortByAlpha')}
            aria-label={t('tags.sortByAlpha')}
          >
            <ArrowDownAZ size={14} />
          </button>
        </div>
      </div>

      <div className="tags-cloud flex flex-wrap gap-2 overflow-y-auto px-5 pb-4">
        {filteredTags.length === 0 ? (
          <p className="tags-empty text-sm text-base-content/60">
            {filter.trim() ? t('tags.noMatch') : t('tags.noTags')}
          </p>
        ) : (
          filteredTags.map((tag) => (
            <button
              key={tag.name}
              className={`tag-chip btn btn-sm rounded-full ${selectedTag === tag.name ? 'active btn-primary' : 'btn-outline'}`}
              type="button"
              onClick={() => handleTagClick(tag.name)}
            >
              <span className="tag-chip-name truncate">#{tag.name}</span>
              <span className="tag-chip-count badge badge-sm">{tag.count}</span>
            </button>
          ))
        )}
      </div>

      {selectedTag && (
        <div className="tags-note-section border-t border-base-300 px-5 py-4">
          <div className="tags-note-header mb-3 flex items-center justify-between gap-3">
            <h3 className="m-0 truncate text-sm font-bold">#{selectedTag}</h3>
            <span className="badge badge-ghost">{t('tags.notesCount', { count: selectedNotes.length })}</span>
          </div>
          <div className="cal-note-list tags-note-list grid max-h-56 gap-2 overflow-y-auto">
            {selectedNotes.map((note) => (
              <button
                className="cal-note-item tags-note-item btn h-auto justify-start rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-left hover:bg-base-200"
                key={note.path}
                type="button"
                onClick={() => handleNoteClick(note.path)}
              >
                <div className="cal-note-main min-w-0 flex-1">
                  <strong className="block truncate text-sm">{note.title}</strong>
                  {note.summary && <small className="block truncate text-xs text-base-content/60">{note.summary}</small>}
                </div>
                <div className="cal-note-meta ml-auto flex shrink-0 flex-col items-end gap-0.5 text-xs text-base-content/50">
                  <span>{note.category}</span>
                  <time>{note.updatedAt}</time>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {!selectedTag && (
        <div className="tags-popover-footer flex items-center gap-2 border-t border-base-300 px-5 py-3 text-xs text-base-content/60">
          <span>{t('tags.tagsCount', { count: allTags.length })}</span>
          <span>·</span>
          <span>{t('tags.taggedNotesCount', { count: totalTaggedNotes })}</span>
        </div>
      )}
    </div>
  )
}
