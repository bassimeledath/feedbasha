import { buildElementContext } from './element'
import { dedupeContexts, intersects } from './selection'
import type { ElementContext, ViewportRect } from '../types'

const SVG_NS = 'http://www.w3.org/2000/svg'
const CONTROL_TAGS = new Set([
  'BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL', 'SUMMARY', 'IMG', 'VIDEO',
  'AUDIO', 'CANVAS', 'DETAILS',
])

export function isMeaningfulTarget(el: Element): boolean {
  if (CONTROL_TAGS.has(el.tagName)) return true
  if ((el as HTMLElement).isContentEditable) return true
  return el.hasAttribute('role') || el.hasAttribute('data-testid')
}

function isInlineish(el: Element): boolean {
  if (el.namespaceURI === SVG_NS) return true
  return getComputedStyle(el).display.startsWith('inline')
}

/** Climb out of decorative text/icon leaves to the box a person likely means. */
export function normalizeTarget(el: Element): Element {
  if (isMeaningfulTarget(el)) return el
  let current = el
  while (
    current.parentElement &&
    current.parentElement !== document.body &&
    !isMeaningfulTarget(current) &&
    isInlineish(current)
  ) {
    current = current.parentElement
  }
  return current
}

export function rectOf(el: Element): ViewportRect {
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

export function placeholder(el: Element, rect = rectOf(el)): ElementContext {
  const tag = el.tagName.toLowerCase()
  return { componentTree: [], tag, attributes: {}, rect, outerHTMLSnippet: tag }
}

/**
 * Collect a bounded set of plausible targets touched by a region. Sampling finds
 * stacked/nested controls; the DOM pass catches large components between samples.
 */
export function elementsInRegion(
  region: ViewportRect,
  elementsAt: (x: number, y: number) => Element[],
  excluded: (el: Element) => boolean,
): Element[] {
  const found = new Set<Element>()
  const add = (el: Element) => {
    if (excluded(el) || el === document.body || el === document.documentElement) return
    const normalized = normalizeTarget(el)
    if (!excluded(normalized)) found.add(normalized)
  }

  const xs = [region.x + 1, region.x + region.width / 2, region.x + region.width - 1]
  const ys = [region.y + 1, region.y + region.height / 2, region.y + region.height - 1]
  for (const x of xs) for (const y of ys) elementsAt(x, y).forEach(add)

  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    if (excluded(el)) continue
    const r = rectOf(el)
    if (r.width <= 0 || r.height <= 0 || !intersects(region, r)) continue
    const centerInside =
      r.x + r.width / 2 >= region.x &&
      r.x + r.width / 2 <= region.x + region.width &&
      r.y + r.height / 2 >= region.y &&
      r.y + r.height / 2 <= region.y + region.height
    if (centerInside || isMeaningfulTarget(el)) add(el)
  }

  // Prefer the most specific candidates. Ancestors only add noise when a child
  // already represents the same physical portion of the selection.
  return Array.from(found).filter(
    (candidate) => !Array.from(found).some((other) => other !== candidate && candidate.contains(other)),
  ).slice(0, 24)
}

export async function resolveContexts(elements: Element[]): Promise<{
  contexts: ElementContext[]
  representative: Element | null
}> {
  const pairs = await Promise.all(
    elements.map(async (element) => {
      try {
        return { element, context: await buildElementContext(element) }
      } catch {
        return { element, context: placeholder(element) }
      }
    }),
  )
  const contexts = dedupeContexts(pairs.map((pair) => pair.context))
  // Collapse only a single physical target. Metadata labels are not instance identity.
  return { contexts, representative: elements.length === 1 ? elements[0]! : null }
}
