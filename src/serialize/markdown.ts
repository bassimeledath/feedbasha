import type { SessionResult, Annotation } from '../types'
import { fmtTime } from '../util/time'

function headLabel(a: Annotation): string {
  return a.element.component ?? `<${a.element.tag}>`
}

function sourceSuffix(a: Annotation): string {
  const s = a.element.source
  if (!s) return ''
  const line = s.lineNumber != null ? `:${s.lineNumber}` : ''
  const col = s.lineNumber != null && s.columnNumber != null ? `:${s.columnNumber}` : ''
  return ` — ${s.fileName}${line}${col}`
}

function disambiguator(a: Annotation): string {
  const el = a.element
  const sel = el.selector ?? el.outerHTMLSnippet ?? `<${el.tag}>`
  return el.text ? `${sel} — "${el.text}"` : sel
}

/**
 * Single-representation output: an annotated transcript, followed by compact
 * reference definitions. `redact`, if provided, scrubs the final text once.
 */
export function toMarkdown(result: SessionResult, redact?: (t: string) => string): string {
  const anns = result.annotations
  const out: string[] = []

  out.push(
    `# feedbasha session — ${anns.length} annotation${anns.length !== 1 ? 's' : ''} (${fmtTime(result.durationSec)})`,
  )
  out.push('')

  // Annotated transcript
  if (result.transcript.length === 0) {
    out.push('_(no speech captured)_')
  } else {
    for (const seg of result.transcript) {
      const marker = seg.annotationIds?.length
        ? ' ' + seg.annotationIds.map((id) => `[#${id}]`).join('')
        : ''
      out.push(`[${fmtTime(seg.t)}] ${seg.text}${marker}`)
    }
  }

  // Reference definitions
  if (anns.length) {
    out.push('')
    for (const a of anns) {
      out.push(`[#${a.id}] ${headLabel(a)}${sourceSuffix(a)}`)
      out.push(`     ${disambiguator(a)}`)
    }
  }

  const md = out.join('\n').trim()
  return redact ? redact(md) : md
}
