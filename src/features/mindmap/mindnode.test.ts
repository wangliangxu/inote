// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  noteToMarkdown,
  parseMarkdownWithFrontmatter,
} from '../../shared/noteMarkdown'
import type { Note } from '../../shared/types'
import {
  flattenNodes,
  getNoteMindMap,
  importNativeMindNode,
  withMindMap,
  type NativeMindNodeDocument,
} from './mindmap'
function fixture(): NativeMindNodeDocument {
  return {
    formatVersion: 6,
    warnings: ['appearance'],
    roots: [
      {
        id: 'root',
        text: '<p style="font: 18px PingFang SC">课程 &amp; 计划</p>',
        collapsed: true,
        color: '#336699',
        children: [
          {
            id: 'child',
            text: '<p>Python&nbsp;<span>基础</span><br>第二行</p>',
            note: '<p>第一段</p><p>第二段 &lt;示例&gt;</p>',
            children: [],
          },
        ],
      },
    ],
  }
}
const base: Note = {
  path: 'knowledge/course.md',
  title: 'Course',
  category: 'knowledge',
  body: '',
  tags: ['course'],
  createdAt: '2026-11-01',
  updatedAt: '2026-11-01',
  wordCount: 0,
}
describe('native MindNode conversion', () => {
  it('converts rich Chinese text and notes while preserving order, IDs, folding and colors', () => {
    const source = fixture(),
      before = JSON.stringify(source)
    const imported = importNativeMindNode('course.mindnode', source)
    expect(imported.title).toBe('课程 & 计划')
    expect(imported.map.roots[0]).toMatchObject({
      id: 'root',
      collapsed: true,
      color: '#336699',
    })
    expect(imported.map.roots[0].children[0]).toMatchObject({
      id: 'child',
      text: 'Python 基础\n第二行',
      note: '第一段\n第二段 <示例>',
    })
    expect(imported.warnings).toContain('richText')
    expect(JSON.stringify(source)).toBe(before)
  })
  it('extracts HTML hyperlinks and retains extra URLs in notes', () => {
    const source = fixture()
    source.roots[0].text =
      '<p><a href="https://example.com/first?a=1&amp;b=2">First</a> <a href="https://example.com/second">Second</a></p>'
    source.roots[0].note =
      '<p><a href="https://example.com/third">Notes</a></p>'
    const imported = importNativeMindNode('links.mindnode', source)
    expect(imported.map.roots[0].link).toBe('https://example.com/first?a=1&b=2')
    expect(imported.map.roots[0].note).toBe(
      'Notes\nhttps://example.com/second\nhttps://example.com/third',
    )
    expect(imported.warnings).toContain('mindnodeLinks')
  })
  it('keeps malicious HTML inert and strips scripts, styles and resource elements', () => {
    const source = fixture()
    source.roots[0].text =
      '<script>window.__bad = true</script><style>bad</style><img src="https://example.invalid/a.png" onerror="window.__bad=true"><iframe src="https://example.invalid"></iframe><p>Safe</p>'
    const imported = importNativeMindNode('unsafe.mindnode', source)
    expect(imported.title).toBe('Safe')
    expect(imported.warnings).toContain('mindnodeAttachments')
    expect(document.querySelector('img,script,iframe')).toBeNull()
    expect((window as unknown as Record<string, unknown>).__bad).toBeUndefined()
  })
  it('rejects unsupported format versions and malformed or duplicate nodes', () => {
    expect(() =>
      importNativeMindNode('map.mindnode', {
        ...fixture(),
        formatVersion: 100,
      }),
    ).toThrow('mindnodeVersion')
    expect(() =>
      importNativeMindNode('map.mindnode', {
        ...fixture(),
        warnings: null,
      } as unknown as NativeMindNodeDocument),
    ).toThrow('mindnodeSchema')
    const source = fixture()
    source.roots[0].children[0].id = 'root'
    expect(() => importNativeMindNode('map.mindnode', source)).toThrow(
      'invalid',
    )
  })
  it('persists imported native maps through the existing Markdown note format', () => {
    const imported = importNativeMindNode('course.mindnode', fixture())
    const saved = withMindMap({ ...base, title: imported.title }, imported.map)
    const { body, metadata } = parseMarkdownWithFrontmatter(
      noteToMarkdown(saved),
    )
    expect(body).toContain('Python 基础 第二行')
    expect(body).not.toContain('<span>')
    expect(getNoteMindMap({ ...base, ...metadata, body })).toEqual(imported.map)
  })
  it('accepts the documented version 9 node schema and multiple maps', () => {
    const source = fixture()
    source.formatVersion = 9
    source.roots.push({
      id: 'another',
      text: '<p>Another topic</p>',
      children: [],
    })
    expect(
      importNativeMindNode('v9.mindnode', source).map.roots.map((n) => n.text),
    ).toEqual(['课程 & 计划', 'Another topic'])
  })
  it.skipIf(!process.env.INOTE_MINDNODE_PAYLOAD)(
    'verifies a local sample through HTML conversion and note save/reopen',
    () => {
      const source = JSON.parse(
        readFileSync(process.env.INOTE_MINDNODE_PAYLOAD!, 'utf8'),
      ) as NativeMindNodeDocument
      const imported = importNativeMindNode('local-sample.mindnode', source)
      const raw = flattenNodes({ version: 1, roots: source.roots }),
        converted = flattenNodes(imported.map)
      expect(converted.map((item) => item.node.id)).toEqual(
        raw.map((item) => item.node.id),
      )
      expect(
        converted.map((item) => [item.depth, item.node.collapsed]),
      ).toEqual(raw.map((item) => [item.depth, item.node.collapsed]))
      if (process.env.INOTE_MINDNODE_REFERENCE) {
        const reference = JSON.parse(
          readFileSync(process.env.INOTE_MINDNODE_REFERENCE, 'utf8'),
        )
        expect(
          converted.map(({ node, depth }) => ({
            id: node.id,
            text: node.text,
            depth,
            collapsed: node.collapsed,
          })),
        ).toEqual(reference)
      }
      if (process.env.INOTE_MINDNODE_EXPECTED_TITLE)
        expect(imported.title).toBe(process.env.INOTE_MINDNODE_EXPECTED_TITLE)
      if (process.env.INOTE_MINDNODE_EXPECTED_NODES)
        expect(converted.length).toBe(
          Number(process.env.INOTE_MINDNODE_EXPECTED_NODES),
        )
      const note = withMindMap({ ...base, title: imported.title }, imported.map)
      const { body, metadata } = parseMarkdownWithFrontmatter(
        noteToMarkdown(note),
      )
      expect(getNoteMindMap({ ...base, ...metadata, body })).toEqual(
        imported.map,
      )
      expect(body).not.toMatch(/<\/?(?:p|span|br)(?:\s|>)/)
    },
  )
})
