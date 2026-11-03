import type { Note } from '../../shared/types'

export const MINDMAP_KEY = 'inote_mindmap'
export const MAX_NODES = 5000
export const MAX_DEPTH = 64
export const MAX_FILE_BYTES = 10 * 1024 * 1024
export interface MindNode {
  id: string
  text: string
  children: MindNode[]
  note?: string
  link?: string
  color?: string
  collapsed?: boolean
}
export interface MindMap {
  version: 1
  roots: MindNode[]
}
export interface ImportedMap {
  title: string
  map: MindMap
  warnings: string[]
  filename: string
}
export type MapErrorCode =
  | 'invalid'
  | 'limit'
  | 'version'
  | 'mindnode'
  | 'mindnodeVersion'
  | 'mindnodeSchema'
  | 'mindnodeDesktop'
  | 'format'
  | 'xml'
export class MindMapError extends Error {
  constructor(public code: MapErrorCode) {
    super(code)
  }
}
export const newNode = (text: string): MindNode => ({
  id: crypto.randomUUID(),
  text,
  children: [],
})
export const createMindMap = (title: string): MindMap => ({
  version: 1,
  roots: [newNode(title)],
})

/** Validate disk/import data before rendering, including recursion and resource limits. */
export function validateMindMap(value: unknown): MindMap {
  if (!value || typeof value !== 'object') throw new MindMapError('invalid')
  const map = value as Record<string, unknown>
  if (map.version !== 1) throw new MindMapError('version')
  if (!Array.isArray(map.roots) || !map.roots.length)
    throw new MindMapError('invalid')
  const ids = new Set<string>()
  let count = 0
  function node(value: unknown, depth: number): MindNode {
    if (depth > MAX_DEPTH || ++count > MAX_NODES)
      throw new MindMapError('limit')
    if (!value || typeof value !== 'object') throw new MindMapError('invalid')
    const n = value as Record<string, unknown>
    if (
      typeof n.id !== 'string' ||
      !n.id ||
      ids.has(n.id) ||
      typeof n.text !== 'string' ||
      !Array.isArray(n.children)
    )
      throw new MindMapError('invalid')
    ids.add(n.id)
    for (const key of ['note', 'link', 'color'])
      if (n[key] !== undefined && typeof n[key] !== 'string')
        throw new MindMapError('invalid')
    if (n.collapsed !== undefined && typeof n.collapsed !== 'boolean')
      throw new MindMapError('invalid')
    return {
      id: n.id,
      text: n.text,
      children: n.children.map((child) => node(child, depth + 1)),
      ...(typeof n.note === 'string' ? { note: n.note } : {}),
      ...(typeof n.link === 'string' ? { link: n.link } : {}),
      ...(typeof n.color === 'string' ? { color: n.color } : {}),
      ...(typeof n.collapsed === 'boolean' ? { collapsed: n.collapsed } : {}),
    }
  }
  return { version: 1, roots: map.roots.map((root) => node(root, 1)) }
}
export function getNoteMindMap(note: Note): MindMap | null {
  if (note.frontmatter?.[MINDMAP_KEY] === undefined) return null
  return validateMindMap(note.frontmatter[MINDMAP_KEY])
}
export function flattenNodes(
  map: MindMap,
): { node: MindNode; parent: MindNode | null; depth: number }[] {
  const result: ReturnType<typeof flattenNodes> = []
  function visit(nodes: MindNode[], parent: MindNode | null, depth: number) {
    for (const node of nodes) {
      result.push({ node, parent, depth })
      visit(node.children, node, depth + 1)
    }
  }
  visit(map.roots, null, 0)
  return result
}
export function updateNode(
  map: MindMap,
  id: string,
  patch: Partial<Omit<MindNode, 'id' | 'children'>>,
): MindMap {
  function visit(nodes: MindNode[]): MindNode[] {
    return nodes.map((n) => ({
      ...n,
      ...(n.id === id ? patch : {}),
      children: visit(n.children),
    }))
  }
  return { ...map, roots: visit(map.roots) }
}
export function insertNode(
  map: MindMap,
  targetId: string,
  node: MindNode,
  sibling = false,
): MindMap {
  function visit(nodes: MindNode[]): MindNode[] {
    return nodes.flatMap((n) => {
      if (n.id === targetId)
        return sibling
          ? [n, node]
          : [{ ...n, collapsed: false, children: [...n.children, node] }]
      return [{ ...n, children: visit(n.children) }]
    })
  }
  return validateMindMap({ ...map, roots: visit(map.roots) })
}
export function removeNode(map: MindMap, id: string): MindMap {
  function visit(nodes: MindNode[]): MindNode[] {
    return nodes
      .filter((n) => n.id !== id)
      .map((n) => ({ ...n, children: visit(n.children) }))
  }
  return validateMindMap({ ...map, roots: visit(map.roots) })
}
/** Reparent without allowing a node to be moved into its own descendants. */
export function moveNode(
  map: MindMap,
  id: string,
  parentId: string | null,
): MindMap {
  const source = flattenNodes(map).find((item) => item.node.id === id)
  if (!source) return map
  const descendants = flattenNodes({ version: 1, roots: [source.node] }).map(
    (item) => item.node.id,
  )
  if (
    parentId &&
    (descendants.includes(parentId) ||
      !flattenNodes(map).some((item) => item.node.id === parentId))
  )
    throw new MindMapError('invalid')
  function prune(nodes: MindNode[]): MindNode[] {
    return nodes
      .filter((n) => n.id !== id)
      .map((n) => ({ ...n, children: prune(n.children) }))
  }
  let next = { ...map, roots: prune(map.roots) }
  if (parentId === null) next.roots.push(source.node)
  else next = insertNode(next, parentId, source.node)
  return validateMindMap(next)
}
export type NodeDropPosition = 'child' | 'before' | 'after'
/** Move an entire branch, with cycle checks and sibling order preserved. */
export function dropNode(
  map: MindMap,
  id: string,
  targetId: string,
  position: NodeDropPosition,
): MindMap {
  if (id === targetId) return map
  const entries = flattenNodes(map)
  const source = entries.find((entry) => entry.node.id === id)
  const target = entries.find((entry) => entry.node.id === targetId)
  if (!source || !target) throw new MindMapError('invalid')
  if (flattenNodes({ version: 1, roots: [source.node] }).some(({ node }) => node.id === targetId))
    throw new MindMapError('invalid')
  if (position !== 'child' && source.parent?.id === target.parent?.id) {
    const siblings = source.parent?.children ?? map.roots
    const index = siblings.findIndex((node) => node.id === id)
    const targetIndex = siblings.findIndex((node) => node.id === targetId)
    if (index === targetIndex + (position === 'before' ? -1 : 1)) return map
  }
  const next = moveNode(map, id, position === 'child' ? targetId : target.parent?.id ?? null)
  if (position === 'child') return next
  function place(nodes: MindNode[]): MindNode[] {
    const result = nodes.map((node) => ({ ...node, children: place(node.children) }))
    const index = result.findIndex((node) => node.id === id)
    if (index < 0 || !result.some((node) => node.id === targetId)) return result
    const [node] = result.splice(index, 1)
    const targetIndex = result.findIndex((item) => item.id === targetId)
    result.splice(targetIndex + (position === 'after' ? 1 : 0), 0, node)
    return result
  }
  return { ...next, roots: place(next.roots) }
}
export function reorderNode(map: MindMap, id: string, offset: number): MindMap {
  function visit(nodes: MindNode[]): MindNode[] {
    const result = nodes.map((n) => ({ ...n, children: visit(n.children) }))
    const index = result.findIndex((n) => n.id === id)
    if (index >= 0 && index + offset >= 0 && index + offset < result.length) {
      const [node] = result.splice(index, 1)
      result.splice(index + offset, 0, node)
    }
    return result
  }
  return { ...map, roots: visit(map.roots) }
}
const markdownText = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/([`*_{}\[\]<>#!|])/g, '\\$1')
    .replace(/\r?\n/g, ' ')
export function mindMapMarkdown(map: MindMap): string {
  return (
    flattenNodes(map)
      .map(({ node, depth }) => {
        const indent = '  '.repeat(depth)
        return `${indent}- ${markdownText(node.text)}${node.note ? `\n${indent}  ${markdownText(node.note)}` : ''}${node.link && safeNodeLink(node.link) ? `\n${indent}  <${node.link.replace(/[<>\r\n]/g, '')}>` : ''}`
      })
      .join('\n') + '\n'
  )
}
export function withMindMap(note: Note, map: MindMap): Note {
  return {
    ...note,
    rawMarkdown: undefined,
    frontmatter: { ...note.frontmatter, [MINDMAP_KEY]: map },
    body: mindMapMarkdown(map),
  }
}
export function safeNodeLink(link: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(link) && !/[\u0000-\u0020<>]/.test(link)
}

function children(element: Element, tag: string): Element[] {
  return Array.from(element.children).filter((child) => child.localName === tag)
}
function richText(element: Element): string {
  const copy = element.cloneNode(true) as Element
  copy.querySelectorAll('script,style').forEach((n) => n.remove())
  copy.querySelectorAll('br').forEach((n) => n.replaceWith('\n'))
  copy.querySelectorAll('p,div,li').forEach((n) => n.append('\n'))
  return copy.textContent?.trim() ?? ''
}
export interface NativeMindNodeDocument {
  formatVersion: number
  roots: MindNode[]
  warnings: string[]
}

/** Decode HTML inside an inert template: resources/scripts are never attached or loaded. */
function mindNodeText(
  html: string,
  warnings: Set<string>,
): { text: string; links: string[] } {
  const template = document.createElement('template')
  template.innerHTML = html
  if (template.content.querySelector('img')) warnings.add('mindnodeAttachments')
  template.content
    .querySelectorAll(
      'script,style,img,iframe,object,embed,link,base,meta,audio,video,source',
    )
    .forEach((element) => element.remove())
  const links = Array.from(template.content.querySelectorAll('a[href]'))
    .map((element) => element.getAttribute('href')!)
    .filter(Boolean)
  template.content
    .querySelectorAll('br')
    .forEach((element) => element.replaceWith('\n'))
  template.content
    .querySelectorAll('p,div,li')
    .forEach((element) => element.append('\n'))
  if (/<\/?[a-z][^>]*>/i.test(html)) warnings.add('richText')
  return {
    text: (template.content.textContent ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    links,
  }
}

export function importNativeMindNode(
  filename: string,
  source: NativeMindNodeDocument,
): ImportedMap {
  if (![6, 9].includes(source.formatVersion))
    throw new MindMapError('mindnodeVersion')
  if (
    !Array.isArray(source.warnings) ||
    source.warnings.some((value) => typeof value !== 'string')
  )
    throw new MindMapError('mindnodeSchema')
  const raw = validateMindMap({ version: 1, roots: source.roots })
  const warnings = new Set(source.warnings)
  function convert(node: MindNode): MindNode {
    const title = mindNodeText(node.text, warnings)
    const note =
      node.note !== undefined
        ? mindNodeText(node.note, warnings)
        : { text: '', links: [] }
    const links = Array.from(
      new Set([
        ...(node.link ? [node.link] : []),
        ...title.links,
        ...note.links,
      ]),
    )
    if (links.length > 1) warnings.add('mindnodeLinks')
    return {
      ...node,
      text: title.text,
      note:
        [note.text, ...links.slice(1)].filter(Boolean).join('\n') || undefined,
      link: links[0],
      children: node.children.map(convert),
    }
  }
  const map: MindMap = { version: 1, roots: raw.roots.map(convert) }
  return {
    filename,
    title: map.roots[0].text || filename.replace(/\.mindnode$/i, ''),
    map,
    warnings: Array.from(warnings),
  }
}

export function importMindMap(filename: string, content: string): ImportedMap {
  if (new TextEncoder().encode(content).length > MAX_FILE_BYTES)
    throw new MindMapError('limit')
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'mindnode') throw new MindMapError('mindnodeDesktop')
  if (ext === 'json' || ext === 'inote-mindmap') {
    let value: unknown
    try {
      value = JSON.parse(content)
    } catch {
      throw new MindMapError('invalid')
    }
    const map = validateMindMap(value)
    return { filename, title: map.roots[0].text || filename, map, warnings: [] }
  }
  if (ext !== 'mm' && ext !== 'opml') throw new MindMapError('format')
  if (/<!DOCTYPE|<!ENTITY/i.test(content)) throw new MindMapError('xml')
  const xml = new DOMParser().parseFromString(content, 'application/xml')
  if (xml.querySelector('parsererror')) throw new MindMapError('xml')
  const warnings = new Set<string>()
  const ids = new Set<string>()
  let count = 0
  function convert(element: Element, depth: number): MindNode {
    if (depth > MAX_DEPTH || ++count > MAX_NODES)
      throw new MindMapError('limit')
    let id = element.getAttribute('ID') || crypto.randomUUID()
    if (ids.has(id)) {
      id = crypto.randomUUID()
      warnings.add('duplicateIds')
    }
    ids.add(id)
    const node: MindNode = {
      id,
      text: element.getAttribute(ext === 'mm' ? 'TEXT' : 'text') ?? '',
      children: [],
    }
    if (ext === 'mm') {
      const rich = children(element, 'richcontent')
      const label = rich.find((n) => n.getAttribute('TYPE') === 'NODE')
      if (label) node.text = richText(label)
      const note = rich.find((n) => n.getAttribute('TYPE') === 'NOTE')
      if (note) node.note = richText(note)
      node.link = element.getAttribute('LINK') ?? undefined
      node.collapsed = element.getAttribute('FOLDED') === 'true'
      node.color = element.getAttribute('COLOR') ?? undefined
      if (rich.length) warnings.add('richText')
      if (
        Array.from(element.children).some(
          (n) => !['node', 'richcontent'].includes(n.localName),
        ) ||
        Array.from(element.attributes).some(
          (a) =>
            ![
              'ID',
              'TEXT',
              'LINK',
              'FOLDED',
              'COLOR',
              'CREATED',
              'MODIFIED',
            ].includes(a.name),
        )
      )
        warnings.add('appearance')
      node.children = children(element, 'node').map((n) =>
        convert(n, depth + 1),
      )
    } else {
      node.note =
        element.getAttribute('_note') ??
        element.getAttribute('note') ??
        undefined
      node.link =
        element.getAttribute('htmlUrl') ??
        element.getAttribute('url') ??
        undefined
      if (
        Array.from(element.attributes).some(
          (a) =>
            !['text', '_note', 'note', 'htmlUrl', 'url', 'type'].includes(
              a.name,
            ),
        )
      )
        warnings.add('appearance')
      node.children = children(element, 'outline').map((n) =>
        convert(n, depth + 1),
      )
    }
    if (element.querySelector('img')) warnings.add('images')
    return node
  }
  let roots: MindNode[]
  if (ext === 'mm') {
    if (xml.documentElement.localName !== 'map') throw new MindMapError('xml')
    roots = children(xml.documentElement, 'node').map((n) => convert(n, 1))
  } else {
    if (xml.documentElement.localName !== 'opml') throw new MindMapError('xml')
    const body = children(xml.documentElement, 'body')[0]
    if (!body) throw new MindMapError('xml')
    roots = children(body, 'outline').map((n) => convert(n, 1))
  }
  const map = validateMindMap({ version: 1, roots })
  const title =
    ext === 'opml'
      ? xml.querySelector('head > title')?.textContent?.trim()
      : roots[0]?.text
  return {
    filename,
    title: title || filename.replace(/\.[^.]+$/, ''),
    map,
    warnings: Array.from(warnings),
  }
}
const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\r/g, '&#13;')
    .replace(/\n/g, '&#10;')
export function exportFreeMind(map: MindMap): string {
  function node(n: MindNode): string {
    return `<node ID="${escapeXml(n.id)}" TEXT="${escapeXml(n.text)}"${n.link ? ` LINK="${escapeXml(n.link)}"` : ''}${n.collapsed ? ' FOLDED="true"' : ''}${n.color ? ` COLOR="${escapeXml(n.color)}"` : ''}>${n.note ? `<richcontent TYPE="NOTE"><html><body><p>${escapeXml(n.note)}</p></body></html></richcontent>` : ''}${n.children.map(node).join('')}</node>`
  }
  // FreeMind expects one central topic. Keep multiple roots under a synthetic root.
  const roots =
    map.roots.length === 1
      ? map.roots
      : [{ id: crypto.randomUUID(), text: 'iNote', children: map.roots }]
  return `<?xml version="1.0" encoding="UTF-8"?>\n<map version="1.0.1">${roots.map(node).join('')}</map>`
}
export function exportOpml(map: MindMap, title: string): string {
  function node(n: MindNode): string {
    return `<outline text="${escapeXml(n.text)}"${n.note ? ` _note="${escapeXml(n.note)}"` : ''}${n.link ? ` htmlUrl="${escapeXml(n.link)}"` : ''}>${n.children.map(node).join('')}</outline>`
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>${escapeXml(title)}</title></head><body>${map.roots.map(node).join('')}</body></opml>`
}
