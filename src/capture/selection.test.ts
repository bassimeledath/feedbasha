import { describe, expect, it } from 'vitest'
import { clampPoint, contextIdentity, dedupeContexts, intersects, isDrag, rectFromPoints } from './selection'
import type { ElementContext } from '../types'

const context = (overrides: Partial<ElementContext> = {}): ElementContext => ({
  componentTree: [],
  tag: 'button',
  attributes: {},
  rect: { x: 10, y: 20, width: 100, height: 40 },
  outerHTMLSnippet: '<button>',
  ...overrides,
})

describe('selection geometry', () => {
  it('keeps hand jitter as a click and starts a drag at six pixels', () => {
    expect(isDrag({ x: 10, y: 10 }, { x: 14, y: 13 })).toBe(false)
    expect(isDrag({ x: 10, y: 10 }, { x: 16, y: 10 })).toBe(true)
  })

  it('normalizes reverse drags and clamps them to the viewport', () => {
    expect(rectFromPoints({ x: 90, y: 80 }, { x: 20, y: 30 })).toEqual({ x: 20, y: 30, width: 70, height: 50 })
    expect(clampPoint({ x: -12, y: 220 }, 100, 180)).toEqual({ x: 0, y: 180 })
  })

  it('uses strict rectangle overlap', () => {
    expect(intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 9, width: 4, height: 4 })).toBe(true)
    expect(intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 10, width: 4, height: 4 })).toBe(false)
  })
})

describe('logical component identity', () => {
  it('keeps repeated component instances distinct even at the same source location', () => {
    const source = { fileName: 'src/App.tsx', lineNumber: 20 }
    const first = context({ component: 'LineItem', source, selector: 'li:nth-child(1)' })
    const second = context({ component: 'LineItem', source, selector: 'li:nth-child(2)' })
    expect(dedupeContexts([first, second])).toHaveLength(2)
  })
  it('deduplicates descendants resolved to the same source component', () => {
    const first = context({ component: 'Checkout', source: { fileName: 'src/App.tsx', lineNumber: 20 } })
    const second = context({ component: 'Checkout', source: { fileName: 'src/App.tsx', lineNumber: 20 }, tag: 'span' })
    expect(contextIdentity(first)).toBe(contextIdentity(second))
    expect(dedupeContexts([first, second])).toEqual([first])
  })
})
