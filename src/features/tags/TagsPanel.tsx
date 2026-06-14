import type { Note } from '../../shared/types'
import { groupByTag } from '../../shared/vault'

interface TagsPanelProps {
  notes: Note[]
  onSearchTag: (tag: string) => void
}

export function TagsPanel({ notes, onSearchTag }: TagsPanelProps) {
  const tags = groupByTag(notes).sort((a, b) => b.count - a.count)

  return (
    <section className="tags-panel" style={{ display: 'block' }}>
      <div className="tag-browser">
        <header className="panel-heading">
          <h2>Tags</h2>
          <span>{tags.length} tags</span>
        </header>
        <div className="tag-list" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {tags.map((tag) => (
            <button 
              key={tag.name} 
              onClick={() => onSearchTag(tag.name)}
              style={{ width: 'auto', display: 'inline-flex', gap: '8px' }}
            >
              <span>#{tag.name}</span>
              <small>{tag.count}</small>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
