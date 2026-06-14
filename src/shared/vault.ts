import type { CategoryGroup, MonthGroup, Note, TagGroup } from './types'

export function titleFromPath(path: string): string {
  const filename = path.split('/').pop()?.replace(/\.md$/i, '') ?? 'Untitled'
  const withoutDate = filename.replace(/^\d{4}-\d{2}-\d{2}-?/, '')
  return withoutDate
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Untitled'
}

export function groupByCategory(notes: Note[]): CategoryGroup[] {
  const counts = new Map<string, number>()
  for (const note of notes) {
    if (note.category === 'archive' || note.category.startsWith('archive/') || note.path.startsWith('.trash/')) {
      continue
    }
    counts.set(note.category, (counts.get(note.category) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function filterNotesByCategory(notes: Note[], category: string): Note[] {
  return sortByUpdatedDesc(notes.filter((note) => note.category === category || note.category.startsWith(`${category}/`)))
}

export function groupByTag(notes: Note[]): TagGroup[] {
  const counts = new Map<string, number>()
  for (const note of notes) {
    for (const tag of note.tags) {
      const normalized = tag.trim()
      if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function filterNotesByTag(notes: Note[], tag: string): Note[] {
  return sortByUpdatedDesc(notes.filter((note) => note.tags.includes(tag)))
}

export function groupByMonth(notes: Note[]): MonthGroup[] {
  const groups = new Map<string, Note[]>()
  for (const note of notes) {
    const dateToUse = note.updatedAt || note.createdAt
    const month = dateToUse.slice(0, 7)
    groups.set(month, [...(groups.get(month) ?? []), note])
  }
  return Array.from(groups.entries())
    .map(([month, groupedNotes]) => ({ month, notes: sortByUpdatedDesc(groupedNotes) }))
    .sort((a, b) => b.month.localeCompare(a.month))
}

export function sortByUpdatedDesc(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title))
}

export function searchNotes(notes: Note[], query: string): Note[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return sortByUpdatedDesc(notes)

  const orGroups = normalized.split(/\s+or\s+/)

  const parsedGroups = orGroups.map((group) => {
    const tagsToSearch: string[] = []
    const textQueryParts: string[] = []

    group.split(/\s+/).forEach((part) => {
      if (part.startsWith('#') && part.length > 1) {
        tagsToSearch.push(part.slice(1))
      } else if (part.startsWith('tag:') && part.length > 4) {
        tagsToSearch.push(part.slice(4))
      } else if (part) {
        textQueryParts.push(part)
      }
    })
    return { tagsToSearch, textQueryParts }
  })

  return sortByUpdatedDesc(
    notes.filter((note) => {
      const haystack = [note.title, note.category, note.summary, note.body, note.tags.join(' ')].join(' ').toLowerCase()

      return parsedGroups.some(({ tagsToSearch, textQueryParts }) => {
        if (tagsToSearch.length > 0) {
          const hasAllTags = tagsToSearch.every((t) => 
            note.tags.some((nt) => nt.toLowerCase() === t || nt.toLowerCase().startsWith(t))
          )
          if (!hasAllTags) return false
        }

        return textQueryParts.every(part => haystack.includes(part))
      })
    }),
  )
}

export function getTodayNote(notes: Note[], today = new Date().toISOString().slice(0, 10)): Note | undefined {
  return notes.find((note) => note.createdAt === today && note.category.startsWith('journal'))
}
