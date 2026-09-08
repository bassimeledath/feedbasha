import type { ElementContext, ViewportRect } from '../types'

export const DRAG_THRESHOLD_PX = 6

export interface Point {
  x: number
  y: number
}

export function clampPoint(point: Point, width: number, height: number): Point {
  return {
    x: Math.max(0, Math.min(point.x, width)),
    y: Math.max(0, Math.min(point.y, height)),
  }
}

export function rectFromPoints(a: Point, b: Point): ViewportRect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

export function isDrag(a: Point, b: Point, threshold = DRAG_THRESHOLD_PX): boolean {
  return Math.hypot(b.x - a.x, b.y - a.y) >= threshold
}

export function intersects(a: ViewportRect, b: ViewportRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/** Snapshot identity; a shared source location does not identify a rendered instance. */
export function contextIdentity(ctx: ElementContext): string {
  if (ctx.selector) return `selector:${ctx.selector}`
  return `dom:${ctx.source?.fileName ?? ctx.tag}:${ctx.source?.lineNumber ?? ''}:${ctx.rect.x}:${ctx.rect.y}:${ctx.rect.width}:${ctx.rect.height}`
}

export function dedupeContexts(contexts: ElementContext[]): ElementContext[] {
  const seen = new Set<string>()
  return contexts.filter((ctx) => {
    const key = contextIdentity(ctx)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
