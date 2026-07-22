import type { ActionEvent, SessionResult } from '../types'
import { fmtTime } from '../util/time'

function actionLine(ev: ActionEvent): string {
  const el = ev.element
  const label = el.component ?? `<${el.tag}>`
  const s = el.source
  const src = s
    ? ` — ${s.fileName}${s.lineNumber != null ? `:${s.lineNumber}` : ''}${
        s.lineNumber != null && s.columnNumber != null ? `:${s.columnNumber}` : ''
      }`
    : ` — ${el.selector ?? el.outerHTMLSnippet}`
  const note = ev.note ? ` — "${ev.note}"` : ''
  const txt = !ev.note && el.text ? ` — "${el.text}"` : ''
  return `[${fmtTime(ev.t)}] → #${ev.n} ${label}${src}${note}${txt}`
}

/**
 * Chronological session log: each line is either something the user said or an
 * element they selected, in order. `redact`, if provided, scrubs the text once.
 */
export function toMarkdown(result: SessionResult, redact?: (t: string) => string): string {
  const events = result.events
  const refs = events.filter((e) => e.kind === 'action').length
  const out: string[] = []

  out.push(
    `# feedbasha session — ${fmtTime(result.durationSec)}, ${refs} element${refs !== 1 ? 's' : ''} referenced`,
  )
  out.push('')

  if (events.length === 0) {
    out.push('_(nothing captured)_')
  } else {
    for (const ev of events) {
      if (ev.kind === 'speech') {
        const t = ev.text.trim()
        if (t) out.push(`[${fmtTime(ev.t)}] ${t}`)
      } else {
        out.push(actionLine(ev))
      }
    }
  }

  const md = out.join('\n').trim()
  return redact ? redact(md) : md
}
