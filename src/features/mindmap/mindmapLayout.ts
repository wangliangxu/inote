import type { MindMap, MindNode } from './mindmap'

export const BRANCH_COLORS = [
  '#48b34e',
  '#30b9b0',
  '#259fba',
  '#f46b63',
  '#efa400',
  '#edce27',
  '#65c967',
  '#52cfc1',
  '#49b5d5',
  '#ff8274',
  '#ffc13c',
  '#c8d62f',
  '#88db7d',
] as const
const isColor = (color: string | undefined): color is string =>
  !!color && /^#[0-9a-f]{6}$/i.test(color)
export interface VisualTopic {
  id: string
  parentId: string | null
  depth: number
  color: string
}
export function visibleMapTopics(map: MindMap): VisualTopic[] {
  const result: VisualTopic[] = []
  function visit(
    node: MindNode,
    parentId: string | null,
    depth: number,
    inherited: string,
  ) {
    const color = isColor(node.color) ? node.color : inherited
    result.push({ id: node.id, parentId, depth, color })
    if (!node.collapsed)
      node.children.forEach((child, index) =>
        visit(
          child,
          node.id,
          depth + 1,
          depth === 0 ? BRANCH_COLORS[index % BRANCH_COLORS.length] : color,
        ),
      )
  }
  map.roots.forEach((root) => visit(root, null, 0, '#a8cf25'))
  return result
}
export interface TopicRect {
  left: number
  top: number
  width: number
  height: number
}
export interface BranchCurve {
  id: string
  color: string
  d: string
  width: number
}
export function unscaledRect(
  rect: TopicRect,
  origin: { left: number; top: number },
  scale: number,
): TopicRect {
  return {
    left: (rect.left - origin.left) / scale,
    top: (rect.top - origin.top) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  }
}
export function branchCurves(
  topics: VisualTopic[],
  rectangles: Map<string, TopicRect>,
): BranchCurve[] {
  const lookup = new Map(topics.map((topic) => [topic.id, topic]))
  const result: BranchCurve[] = []
  const n = (value: number) => Math.round(value * 100) / 100
  for (const topic of topics) {
    if (!topic.parentId) continue
    const parent = rectangles.get(topic.parentId),
      child = rectangles.get(topic.id)
    if (
      !parent ||
      !child ||
      !parent.width ||
      !child.width ||
      !parent.height ||
      !child.height
    )
      continue
    const root = lookup.get(topic.parentId)?.depth === 0
    const x1 = parent.left + parent.width - (root ? 2 : 0)
    const y1 = parent.top + (root ? parent.height / 2 : parent.height - 1.5)
    const x2 = child.left,
      y2 = child.top + child.height - 1.5
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue
    const bend = Math.max(12, (x2 - x1) * 0.48)
    result.push({
      id: topic.id,
      color: topic.color,
      width: 3,
      d: `M ${n(x1)} ${n(y1)} C ${n(x1 + bend)} ${n(y1)}, ${n(x2 - bend)} ${n(y2)}, ${n(x2)} ${n(y2)}`,
    })
  }
  return result
}
export function fitMapZoom(
  content: { width: number; height: number },
  viewport: { width: number; height: number },
): number {
  if (
    content.width <= 0 ||
    content.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return 1
  return Math.max(
    0.2,
    Math.min(
      1,
      (viewport.width - 64) / content.width,
      (viewport.height - 64) / content.height,
    ),
  )
}
