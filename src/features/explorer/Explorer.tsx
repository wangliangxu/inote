import type { Note } from '../../shared/types'
import { groupByCategory } from '../../shared/vault'

interface ExplorerProps {
  notes: Note[]
  activeCategory: string
  onSelectCategory: (category: string) => void
}

export function Explorer({ notes, activeCategory, onSelectCategory }: ExplorerProps) {
  return (
    <section>
      <p className="explorer-title">Categories</p>
      <div className="category-list">
        {groupByCategory(notes).map((category) => (
          <button
            key={category.name}
            className={activeCategory === category.name ? 'active' : ''}
            onClick={() => onSelectCategory(category.name)}
          >
            <span>{category.name}</span>
            <small>{category.count}</small>
          </button>
        ))}
      </div>
    </section>
  )
}
