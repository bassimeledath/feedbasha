import type { Annotation, ElementContext, SessionResult } from '../types'
import { fmtTime } from '../util/time'

function srcOf(el: ElementContext): string {
  const s = el.source
  if (s) {
    return `${s.fileName}${s.lineNumber != null ? `:${s.lineNumber}` : ''}${
      s.lineNumber != null && s.columnNumber != null ? `:${s.columnNumber}` : ''
    }`
  }
  return el.selector ?? el.outerHTMLSnippet
}

function elementLabel(el: ElementContext): string {
  return `${el.component ?? `<${el.tag}>`} — ${srcOf(el)}`
}

function annotationBlock(annotation: Annotation): string[] {
  const input = annotation.input === 'voice' ? 'voice' : 'text'
  const lines: string[] = []
  if (annotation.target.kind === 'element') {
    const el = annotation.target.element
    lines.push(`## ${annotation.n}. ${el.component ?? `<${el.tag}>`} — ${input}`)
    lines.push('', `“${annotation.note.trim()}”`, '', `Source: ${srcOf(el)}`)
    if (el.text) lines.push(`Element text: “${el.text}”`)
    return lines
  }

  const { rect, screenshot, elements, viewport } = annotation.target
  lines.push(`## ${annotation.n}. Region — ${input}`)
  lines.push('', `“${annotation.note.trim()}”`, '')
  lines.push(`Region: x=${Math.round(rect.x)}, y=${Math.round(rect.y)}, ${Math.round(rect.width)}×${Math.round(rect.height)} CSS px`)
  if (viewport) {
    lines.push(`Page: ${viewport.url}`, `Capture viewport: ${viewport.width}×${viewport.height} CSS px; scroll: ${viewport.scrollX}, ${viewport.scrollY}; pixel ratio: ${viewport.devicePixelRatio}`)
  }
  if (screenshot?.reference) lines.push(`Screenshot: ${screenshot.reference}`)
  else lines.push(screenshot ? 'Screenshot: captured locally; not attached to this text export.' : 'Screenshot: unavailable.')
  if (elements.length) {
    lines.push('', 'Components:')
    for (const el of elements) {
      lines.push(`- ${elementLabel(el)}`)
      if (el.selector) lines.push(`  Selector: ${el.selector}`)
      if (el.text) lines.push(`  Text: ${el.text}`)
    }
  }
  return lines
}

/** Serialize one self-contained block per target-bound annotation. */
export function toMarkdown(result: SessionResult, redact?: (text: string) => string): string {
  const count = result.annotations.length
  const out = [
    `# Karen feedback — ${fmtTime(result.durationSec)}, ${count} item${count === 1 ? '' : 's'}`,
    '',
  ]

  if (!count) out.push('_(nothing captured)_')
  result.annotations.forEach((annotation, index) => {
    if (index) out.push('', '---', '')
    out.push(...annotationBlock(annotation))
  })

  const markdown = out.join('\n').trim()
  return redact ? redact(markdown) : markdown
}
