import { getElementContext } from 'react-grab/primitives'
import type { ElementContext } from '../types'

const KEEP_ATTRS = [
  'id',
  'class',
  'role',
  'name',
  'type',
  'href',
  'alt',
  'placeholder',
  'title',
  'aria-label',
  'data-testid',
]

function collectAttrs(el: Element): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of KEEP_ATTRS) {
    const v = el.getAttribute(name)
    if (v != null) out[name] = name === 'class' ? v.split(/\s+/).slice(0, 3).join(' ') : v
  }
  for (const attr of Array.from(el.attributes)) {
    if ((attr.name.startsWith('data-') || attr.name.startsWith('aria-')) && !(attr.name in out)) {
      out[attr.name] = attr.value
    }
  }
  return out
}

function visibleText(el: Element): string | undefined {
  const raw = (el as HTMLElement).innerText ?? el.textContent ?? ''
  const t = raw.replace(/\s+/g, ' ').trim()
  if (!t) return undefined
  return t.length > 120 ? `${t.slice(0, 117)}…` : t
}

function compactTag(el: Element, attrs: Record<string, string>): string {
  const tag = el.tagName.toLowerCase()
  if (attrs['data-testid']) return `${tag}[data-testid="${attrs['data-testid']}"]`
  if (attrs.id) return `${tag}#${attrs.id}`
  const cls = attrs.class?.split(' ')[0]
  return cls ? `${tag}.${cls}` : tag
}

/**
 * Build a serializable snapshot of an element. Uses react-grab primitives for
 * component/source resolution and degrades gracefully (quality ladder:
 * source+line+component → source+component → selector+DOM → DOM only).
 */
export async function buildElementContext(el: Element): Promise<ElementContext> {
  const rect = el.getBoundingClientRect()
  const attributes = collectAttrs(el)
  const tag = el.tagName.toLowerCase()
  const text = visibleText(el)

  let component: string | undefined
  let source: ElementContext['source']
  let componentTree: string[] = []
  let selector: string | undefined
  let outerHTMLSnippet = compactTag(el, attributes)

  try {
    const ctx = await getElementContext(el)
    component = ctx.componentName ?? undefined
    if (ctx.filePath) {
      source = {
        fileName: ctx.filePath,
        lineNumber: ctx.lineNumber ?? undefined,
        columnNumber: ctx.columnNumber ?? undefined,
      }
    }
    selector = ctx.selector ?? undefined
    if (ctx.htmlPreview) outerHTMLSnippet = ctx.htmlPreview.replace(/\s+/g, ' ').trim()
    componentTree = (ctx.stack ?? [])
      .map((f) => f.functionName)
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
      .slice(0, 4)
  } catch {
    // DOM-only fallback (source stays undefined; selector stays undefined)
  }

  return {
    component,
    componentTree,
    source,
    tag,
    attributes,
    text,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    selector,
    outerHTMLSnippet,
  }
}
