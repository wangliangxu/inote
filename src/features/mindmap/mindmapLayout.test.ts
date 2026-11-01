import { describe, expect, it } from 'vitest'
import {
  branchCurves,
  BRANCH_COLORS,
  fitMapZoom,
  unscaledRect,
  visibleMapTopics,
  type TopicRect,
} from './mindmapLayout'
import type { MindMap } from './mindmap'
const map: MindMap = {
  version: 1,
  roots: [
    {
      id: 'root',
      text: 'Root',
      color: '#aadd22',
      children: [
        {
          id: 'a',
          text: 'A',
          children: [{ id: 'a1', text: 'Child', children: [] }],
        },
        { id: 'b', text: 'B', color: '#30aabb', children: [] },
      ],
    },
  ],
}
describe('mind map branch layout', () => {
  it('preserves imported colors and inherits a first-level branch color down its subtree', () => {
    const before = JSON.stringify(map)
    const topics = visibleMapTopics(map)
    expect(topics.find((t) => t.id === 'root')?.color).toBe('#aadd22')
    expect(topics.find((t) => t.id === 'a')?.color).toBe(BRANCH_COLORS[0])
    expect(topics.find((t) => t.id === 'a1')?.color).toBe(BRANCH_COLORS[0])
    expect(topics.find((t) => t.id === 'b')?.color).toBe('#30aabb')
    expect(JSON.stringify(map)).toBe(before)
  })
  it('omits all descendants of folded branches, so hidden nodes have no connectors', () => {
    const folded = structuredClone(map)
    folded.roots[0].children[0].collapsed = true
    expect(visibleMapTopics(folded).map((t) => t.id)).toEqual([
      'root',
      'a',
      'b',
    ])
    folded.roots[0].collapsed = true
    expect(visibleMapTopics(folded).map((t) => t.id)).toEqual(['root'])
  })
  it('joins the root at its center and multiline branch labels at their underlines', () => {
    const rectangles = new Map<string, TopicRect>([
      ['root', { left: 40, top: 160, width: 200, height: 70 }],
      ['a', { left: 350, top: 30, width: 240, height: 55 }],
      ['a1', { left: 680, top: 10, width: 300, height: 95 }],
    ])
    const curves = branchCurves(visibleMapTopics(map), rectangles)
    expect(curves).toHaveLength(2)
    expect(curves[0].d).toMatch(/^M 238 195 C .*, 350 83.5$/)
    expect(curves[1].d).toMatch(/^M 590 83.5 C .*, 680 103.5$/)
    expect(curves[0].color).toBe(curves[1].color)
  })
  it('uses the same connector geometry at different zooms and canvas offsets', () => {
    const actual = { left: 340, top: 120, width: 240, height: 80 },
      origin = { left: 80, top: 40 }
    const expected = unscaledRect(actual, origin, 1)
    for (const scale of [0.2, 0.5, 1.5, 2]) {
      const scaled = {
        left: origin.left + (actual.left - origin.left) * scale,
        top: origin.top + (actual.top - origin.top) * scale,
        width: actual.width * scale,
        height: actual.height * scale,
      }
      expect(unscaledRect(scaled, origin, scale)).toEqual(expected)
    }
  })
  it('never emits invalid curves for unmeasured or zero-size nodes', () => {
    const rectangles = new Map<string, TopicRect>([
      ['root', { left: 0, top: 0, width: 0, height: 0 }],
      ['a', { left: NaN, top: 0, width: 200, height: 50 }],
    ])
    expect(branchCurves(visibleMapTopics(map), rectangles)).toEqual([])
  })
  it('fits large diagrams with breathing room and keeps small diagrams readable at 100%', () => {
    expect(
      fitMapZoom({ width: 1000, height: 1200 }, { width: 864, height: 664 }),
    ).toBe(0.5)
    expect(
      fitMapZoom({ width: 400, height: 200 }, { width: 864, height: 664 }),
    ).toBe(1)
    expect(fitMapZoom({ width: 0, height: 0 }, { width: 0, height: 0 })).toBe(1)
  })
})
