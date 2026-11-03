import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Note, SearchResult } from '../../shared/types'
import { MINDMAP_KEY, validateMindMap, type MindMap, type MindNode } from './mindmap'
import { visibleMapTopics } from './mindmapLayout'

// Bound both rendering and text even when a fully loaded map has thousands of nodes.
export function thumbnailMap(note: Note | SearchResult): MindMap | null {
  if (!('frontmatter' in note) || !note.frontmatter) return null
  const raw = note.frontmatter[MINDMAP_KEY] ?? note.frontmatter.inote_mindmap_preview
  if (!raw) return null
  try {
    const map = validateMindMap(raw)
    let remaining = 32
    function take(nodes: MindNode[], depth: number): MindNode[] {
      const result: MindNode[] = []
      for (const node of nodes) {
        if (!remaining) break
        remaining--
        result.push({ ...node, text: Array.from(node.text).slice(0, 48).join(''),
          children: depth < 3 && !node.collapsed ? take(node.children, depth + 1) : [] })
      }
      return result
    }
    return { version: 1, roots: take(map.roots, 0) }
  } catch {
    return null
  }
}

export const MindMapThumbnail = memo(function MindMapThumbnail({ map }: { map: MindMap }) {
  const { t } = useTranslation()
  const layout = useMemo(() => {
    const colors = new Map(visibleMapTopics(map).map((topic) => [topic.id, topic.color]))
    const items: { id: string; text: string; x: number; y: number; width: number; root: boolean; color: string }[] = []
    const paths: { id: string; d: string; color: string }[] = []
    let row = 16
    function place(node: MindNode, depth: number): (typeof items)[number] {
      const children = node.children.map((child) => place(child, depth + 1))
      const y = children.length ? (children[0].y + children[children.length - 1].y) / 2 : row
      if (!children.length) row += 25
      const text = Array.from(node.text.replace(/\s+/g, ' '))
      const label = text.length > 18 ? text.slice(0, 17).join('') + '…' : text.join('')
      const width = Math.min(120, Math.max(depth === 0 ? 72 : 24,
        Array.from(label).reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 10 : 5.6), 0) + 12))
      const item = { id: node.id, text: label, x: depth * 145 + 8, y, width, root: depth === 0, color: colors.get(node.id)! }
      items.push(item)
      for (const child of children) {
        const x1 = item.x + item.width, y1 = item.y + (item.root ? 0 : 4)
        const x2 = child.x, y2 = child.y + 4
        paths.push({ id: child.id, color: child.color, d: `M ${x1} ${y1} C ${x1 + 18} ${y1}, ${x2 - 24} ${y2}, ${x2} ${y2}` })
      }
      return item
    }
    for (const root of map.roots) { place(root, 0); row += 12 }
    return { items, paths, width: Math.max(...items.map((item) => item.x + item.width)) + 8, height: row }
  }, [map])
  return (
    <svg className="mindmap-thumbnail" viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img" aria-label={t('mindmap.thumbnail')} focusable="false">
      {layout.paths.map((path) => <path key={path.id} d={path.d} stroke={path.color} strokeWidth="2" fill="none" strokeLinecap="round" />)}
      {layout.items.map((item) => (
        <g key={item.id}>
          {item.root ? <rect x={item.x} y={item.y - 12} width={item.width} height={24} rx="5" fill="var(--bg-panel)" />
            : <path d={`M ${item.x} ${item.y + 4} h ${item.width}`} stroke={item.color} strokeWidth="2" strokeLinecap="round" />}
          <svg x={item.x + 5} y={item.y - 10} width={item.width - 10} height={20} overflow="hidden" aria-hidden="true">
            <text x="0" y="12" fill="var(--text-secondary)" fontSize="10" fontWeight="400">{item.text || '\u00a0'}</text>
          </svg>
        </g>
      ))}
    </svg>
  )
})
