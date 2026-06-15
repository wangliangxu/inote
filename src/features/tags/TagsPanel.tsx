import { useState, useMemo } from 'react'
import { Search, ArrowDownAZ, TrendingDown, X } from 'lucide-react'
import type { Note } from '../../shared/types'
import { groupByTag } from '../../shared/vault'

interface TagsPanelProps {
  notes: Note[]
  onSelectNote: (path: string) => void
  onClose: () => void
}

type SortMode = 'frequency' | 'alpha'

export function TagsPanel({ notes, onSelectNote, onClose }: TagsPanelProps) {
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
          <h2>Tags</h2>
          <span className="tags-popover-count">{allTags.length}</span>
        </div>
        <button
          className="tags-popover-close"
          type="button"
          onClick={onClose}
          aria-label="关闭标签面板"
        >
          <X size={18} />
        </button>
      </div>

      <div className="tags-popover-toolbar">
        <div className="tags-filter-box">
          <Search size={14} />
          <input
            type="text"
            placeholder="筛选标签…"
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
            title="按使用频率排序"
            aria-label="按使用频率排序"
          >
            <TrendingDown size={14} />
          </button>
          <button
            className={sortMode === 'alpha' ? 'active' : ''}
            type="button"
            onClick={() => setSortMode('alpha')}
            title="按字母排序"
            aria-label="按字母排序"
          >
            <ArrowDownAZ size={14} />
          </button>
        </div>
      </div>

      <div className="tags-cloud">
        {filteredTags.length === 0 ? (
          <p className="tags-empty">
            {filter.trim() ? '没有匹配的标签' : '暂无标签'}
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
            <span>{selectedNotes.length} 篇笔记</span>
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
          <span>{allTags.length} 个标签</span>
          <span>·</span>
          <span>{totalTaggedNotes} 篇带标签笔记</span>
        </div>
      )}
    </div>
  )
}
