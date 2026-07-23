import type { ActionEvent, SessionResult } from '../types'
import { fmtTime } from '../util/time'

function srcOf(el: ActionEvent['element']): string {
  const s = el.source
  if (s) {
    return `${s.fileName}${s.lineNumber != null ? `:${s.lineNumber}` : ''}${
      s.lineNumber != null && s.columnNumber != null ? `:${s.columnNumber}` : ''
    }`
  }
  return el.selector ?? el.outerHTMLSnippet
}

function actionLine(ev: ActionEvent): string {
  const el = ev.element
  const label = el.component ?? `<${el.tag}>`
  const ref = `${label} (${srcOf(el)})`
  const t = fmtTime(ev.t)

  // Text mode: the note is feedback the user explicitly attached to this element.
  // State that binding outright so the agent doesn't have to infer which comment
  // maps to which component (the inference voice mode needs by necessity).
  if (ev.note) {
    return `[${t}] #${ev.n} FEEDBACK on ${ref}: "${ev.note}"`
  }
  // No note (e.g. a voice-mode pin): just a reference marker, with the element's
  // own visible text as context (clearly labelled so it isn't read as feedback).
  const txt = el.text ? ` — text: "${el.text}"` : ''
  return `[${t}] #${ev.n} referenced ${ref}${txt}`
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
