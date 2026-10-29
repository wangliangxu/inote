// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  noteToMarkdown,
  parseMarkdownWithFrontmatter,
} from '../../shared/noteMarkdown'
import type { MindMap } from './mindmap'
import type { Note } from '../../shared/types'
import {
  createMindMap,
  exportFreeMind,
  exportOpml,
  flattenNodes,
  getNoteMindMap,
  importMindMap,
  insertNode,
  MAX_DEPTH,
  MAX_NODES,
  mindMapMarkdown,
  moveNode,
  newNode,
  removeNode,
  reorderNode,
  safeNodeLink,
  updateNode,
  validateMindMap,
  withMindMap,
} from './mindmap'
const fixture = `<map version="1.0.1"><node ID="root" TEXT="项目 &amp; 计划" COLOR="#123456" FOLDED="true"><node ID="a" TEXT="调研" LINK="https://example.com?a=1&amp;b=2"><richcontent TYPE="NOTE"><html><body><p>第一行</p><p>第二行</p></body></html></richcontent></node><node ID="b"><richcontent TYPE="NODE"><html><body><p>设计 &lt;方案&gt;</p></body></html></richcontent><icon BUILTIN="idea"/></node></node></map>`
describe('mind map import and persistence', () => {
  it('imports FreeMind hierarchy, Unicode, escaped text, notes, links and folding', () => {
    const { map, warnings, title } = importMindMap('项目.MM', fixture)
    expect(title).toBe('项目 & 计划')
    expect(map.roots[0]).toMatchObject({
      id: 'root',
      color: '#123456',
      collapsed: true,
    })
    expect(map.roots[0].children[0]).toMatchObject({
      text: '调研',
      link: 'https://example.com?a=1&b=2',
      note: '第一行\n第二行',
    })
    expect(map.roots[0].children[1].text).toBe('设计 <方案>')
    expect(warnings).toContain('appearance')
    expect(warnings).toContain('richText')
  })
  it('round-trips a map through Markdown and keeps unrelated metadata', () => {
    const map = importMindMap('project.mm', fixture).map
    const note: Note = {
      path: 'knowledge/project.md',
      category: 'knowledge',
      title: '项目',
      body: '',
      tags: ['work'],
      createdAt: '2026-10-29',
      updatedAt: '2026-10-29',
      wordCount: 0,
      frontmatter: { custom: { keep: true } },
    }
    const markdown = noteToMarkdown(withMindMap(note, map))
    const { body, metadata } = parseMarkdownWithFrontmatter(markdown)
    const restored = { ...note, ...metadata, body }
    expect(getNoteMindMap(restored)).toEqual(map)
    expect(restored.frontmatter?.custom).toEqual({ keep: true })
    expect(body).toContain('调研')
    expect(body).toContain('第一行 第二行')
    expect(body).toContain('https://example.com?a=1&b=2')
    expect(noteToMarkdown(restored)).toBe(markdown)
  })
  it('round-trips FreeMind exported text, notes, colors and links', () => {
    const map = importMindMap('a.mm', fixture).map
    const restored = importMindMap('again.mm', exportFreeMind(map)).map
    expect(restored).toEqual(map)
  })
  it('imports multi-root OPML and round-trips hierarchy, links and notes', () => {
    const data = `<opml version="2.0"><head><title>旧笔记</title></head><body><outline text="A &amp; B" _note="笔记&#10;换行" htmlUrl="https://example.com"><outline text="子节点"/></outline><outline text="第二主题"/></body></opml>`
    const imported = importMindMap('old.opml', data)
    expect(imported.title).toBe('旧笔记')
    expect(imported.map.roots).toHaveLength(2)
    const again = importMindMap(
      'again.opml',
      exportOpml(imported.map, imported.title),
    )
    expect(
      again.map.roots.map((n) => [
        n.text,
        n.note,
        n.link,
        n.children.map((c) => c.text),
      ]),
    ).toEqual(
      imported.map.roots.map((n) => [
        n.text,
        n.note,
        n.link,
        n.children.map((c) => c.text),
      ]),
    )
  })
  it('uses a central parent when exporting multiple FreeMind roots', () => {
    const map = { version: 1 as const, roots: [newNode('A'), newNode('B')] }
    const imported = importMindMap('map.mm', exportFreeMind(map)).map
    expect(imported.roots).toHaveLength(1)
    expect(imported.roots[0].children.map((n) => n.text)).toEqual(['A', 'B'])
  })
  it('round-trips native JSON without losing IDs or properties', () => {
    const map = importMindMap('a.mm', fixture).map
    expect(importMindMap('a.inote-mindmap', JSON.stringify(map)).map).toEqual(
      map,
    )
  })
  it('reports unsupported formats and rejects malformed XML and JSON', () => {
    for (const [filename, data] of [
      ['a.mm', '<map><node></map>'],
      ['a.opml', '<map/>'],
      ['a.mm', '<map/>'],
      ['a.opml', '<opml/>'],
      ['a.json', '{'],
      [
        'a.mm',
        '<!DOCTYPE map [<!ENTITY x "foo">]><map><node TEXT="&x;"/></map>',
      ],
      ['a.mm', '<opml><node TEXT="x"/></opml>'],
    ])
      expect(() => importMindMap(filename, data)).toThrow()
    expect(() => importMindMap('a.mindnode', '')).toThrow('mindnode')
    expect(() => importMindMap('a.xmind', '')).toThrow('format')
    expect(() => importMindMap('a.json', '{"version":2,"roots":[]}')).toThrow(
      'version',
    )
  })
  it('regenerates duplicate import IDs and rejects duplicate native IDs', () => {
    const imported = importMindMap(
      'a.mm',
      '<map><node ID="same" TEXT="A"><node ID="same" TEXT="B"/></node></map>',
    )
    expect(imported.warnings).toContain('duplicateIds')
    expect(imported.map.roots[0].id).not.toBe(
      imported.map.roots[0].children[0].id,
    )
    expect(() =>
      validateMindMap({
        version: 1,
        roots: [
          {
            id: 'a',
            text: '',
            children: [{ id: 'a', text: '', children: [] }],
          },
        ],
      }),
    ).toThrow('invalid')
  })
  it('enforces node and depth limits before rendering', () => {
    expect(() =>
      validateMindMap({
        version: 1,
        roots: Array.from({ length: MAX_NODES + 1 }, (_, i) => ({
          id: String(i),
          text: '',
          children: [],
        })),
      }),
    ).toThrow('limit')
    let node = newNode('leaf')
    for (let i = 0; i < MAX_DEPTH; i++)
      node = { ...newNode('branch'), children: [node] }
    expect(() => validateMindMap({ version: 1, roots: [node] })).toThrow(
      'limit',
    )
    expect(() =>
      importMindMap(
        'a.mm',
        '<map>' +
          '<node TEXT="x">'.repeat(65) +
          '</node>'.repeat(65) +
          '</map>',
      ),
    ).toThrow('limit')
  })
  it('never turns text into HTML or executable links', () => {
    const map = createMindMap('<script>alert(1)</script> [x](javascript:x)')
    map.roots[0].link = 'javascript:alert(1)'
    expect(mindMapMarkdown(map)).not.toContain('<script>')
    expect(mindMapMarkdown(map)).not.toContain('<javascript:')
    expect(safeNodeLink('https://example.com')).toBe(true)
    expect(safeNodeLink('javascript:alert(1)')).toBe(false)
    expect(safeNodeLink('file:///etc/passwd')).toBe(false)
    const imported = importMindMap(
      'a.mm',
      '<map><node><richcontent TYPE="NODE"><html><body><script>bad()</script><p>Visible</p></body></html></richcontent></node></map>',
    )
    expect(imported.map.roots[0].text).toBe('Visible')
  })
})
describe('tree editing invariants', () => {
  it('inserts, updates, reorders and removes branches without mutating snapshots', () => {
    const original = createMindMap('Root'),
      a = newNode('A'),
      b = newNode('B')
    let map = insertNode(original, original.roots[0].id, a)
    map = insertNode(map, a.id, b, true)
    expect(original.roots[0].children).toEqual([])
    map = reorderNode(map, b.id, -1)
    expect(map.roots[0].children.map((n) => n.text)).toEqual(['B', 'A'])
    map = updateNode(map, a.id, { text: 'Updated', collapsed: true })
    expect(flattenNodes(map).find((n) => n.node.id === a.id)?.node.text).toBe(
      'Updated',
    )
    map = removeNode(map, a.id)
    expect(flattenNodes(map).map((n) => n.node.text)).toEqual(['Root', 'B'])
    expect(() => removeNode(original, original.roots[0].id)).toThrow('invalid')
  })
  it('moves entire subtrees while preventing cycles or missing parents', () => {
    const root = newNode('Root'),
      a = newNode('A'),
      b = newNode('B'),
      child = newNode('Child')
    a.children = [child]
    root.children = [a, b]
    const map: MindMap = { version: 1, roots: [root] }
    expect(() => moveNode(map, a.id, child.id)).toThrow('invalid')
    expect(() => moveNode(map, a.id, 'missing')).toThrow('invalid')
    const next = moveNode(map, a.id, b.id)
    expect(next.roots[0].children[0].children[0].children[0].text).toBe('Child')
    expect(root.children).toHaveLength(2)
    expect(moveNode(next, a.id, null).roots).toHaveLength(2)
  })
})
