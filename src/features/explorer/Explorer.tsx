import type { Note } from '../../shared/types'
import { groupByCategory } from '../../shared/vault'
import { useTranslation } from 'react-i18next'

interface ExplorerProps {
  notes: Note[]
  activeCategory: string
  onSelectCategory: (category: string) => void
}

export function Explorer({ notes, activeCategory, onSelectCategory }: ExplorerProps) {
  const { t } = useTranslation()
  return (
    <section>
      <p className="explorer-title">{t('app.categories')}</p>
      <div className="category-list">
        {groupByCategory(notes).map((category) => (
          <button
            key={category.name}
            className={activeCategory === category.name ? 'active' : ''}
            onClick={() => onSelectCategory(category.name)}
          >
            <span>{category.name}</span>
            <small>{category.count.toString().padStart(2, '0')}</small>
          </button>
        ))}
      </div>
    </section>
  )
}
