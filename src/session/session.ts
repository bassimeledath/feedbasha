import type {
  Annotation,
  ElementContext,
  FeedbashaConfig,
  SessionResult,
  STTProvider,
  TranscriptSegment,
} from '../types'
import { createProvider } from '../stt'
import { buildElementContext } from '../capture/element'
import { toMarkdown } from '../serialize/markdown'
import { copyText } from '../util/clipboard'
import { Widget, type CaptureMode } from '../widget/widget'

const LOOK_BEHIND = 6 // seconds a phrase may precede its pin (talk, then point)
const LOOK_AHEAD = 3 // seconds a phrase may follow its pin (point, then talk)

type Phase = 'idle' | 'starting' | 'recording' | 'review'

interface Rec {
  ann: Annotation
  el: Element
}

/** Orchestrates the widget, STT provider, element capture, and output. */
export class Session {
  private widget: Widget
  private provider: STTProvider | null = null
  private phase: Phase = 'idle'

  // run token invalidates async work from a superseded/cancelled session
  private runToken = 0
  private destroyed = false
  private startupTimeout: number | null = null

  private startPerf = 0
  private startedWall = 0
  private endedSec = 0
  private timerId: number | null = null
  private prevCursor: string | null = null

  private annId = 0
  private records: Rec[] = []
  private segments: TranscriptSegment[] = []
  private pending: Promise<void>[] = []

  private onMove = (e: MouseEvent) => this.handleMove(e)
  private onClick = (e: MouseEvent) => this.handleClick(e)
  private onPointerDown = (e: Event) => this.handlePointerDown(e)
  private onScroll = () => this.repositionPins()
  private onKey = (e: KeyboardEvent) => this.handleKey(e)

  constructor(private config: FeedbashaConfig) {
    this.widget = new Widget(config.position ?? 'bottom-right', {
      onStart: () => void this.start(),
      onStop: () => void this.stop(),
      onCopy: () => void this.copy(),
      onDiscard: () => this.reset(),
      onDelete: (id) => this.deleteAnnotation(id),
    })
  }

  private clock = (): number => (performance.now() - this.startPerf) / 1000

  async start(): Promise<void> {
    if (this.phase !== 'idle' || this.destroyed) return
    const token = ++this.runToken
    this.phase = 'starting'
    this.startPerf = performance.now()
    this.startedWall = Date.now()
    this.widget.setPhase('starting')

    const provider = await createProvider(this.config.stt)
    if (token !== this.runToken || this.destroyed) {
      provider?.dispose()
      return
    }
    this.provider = provider
    if (!provider) {
      this.beginRecording('clickonly', 'Speech recognition unavailable — capturing clicks only.')
      return
    }

    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      if (this.startupTimeout != null) {
        window.clearTimeout(this.startupTimeout)
        this.startupTimeout = null
      }
      if (token !== this.runToken || this.destroyed) {
        provider.dispose()
        return
      }
      fn()
    }
    this.startupTimeout = window.setTimeout(
      () => settle(() => this.beginRecording('clickonly', 'Mic not responding — capturing clicks only.')),
      5000,
    )

    try {
      await provider.start(
        {
          onReady: () => settle(() => this.beginRecording('voice')),
          onInterim: (t) => {
            if (token === this.runToken && this.phase === 'recording') this.widget.setCaption(t)
          },
          onSegment: (s) => {
            if (token === this.runToken) this.segments.push({ t: s.t, end: s.end, text: s.text })
          },
          onNotice: (m) => {
            if (token !== this.runToken) return
            if (!settled) settle(() => this.beginRecording('clickonly', m))
            else this.switchToClickOnly(m)
          },
        },
        this.clock,
      )
    } catch {
      settle(() =>
        this.beginRecording('clickonly', 'Speech recognition failed — capturing clicks only.'),
      )
    }
  }

  private beginRecording(mode: CaptureMode, notice?: string): void {
    if (this.phase !== 'starting') return
    if (mode === 'clickonly') {
      this.provider?.dispose()
      this.provider = null
    }
    this.phase = 'recording'
    this.widget.setPhase('recording')
    this.widget.setMode(mode)
    if (notice) this.widget.setNotice(notice)

    this.prevCursor = document.body.style.cursor
    document.body.style.cursor = 'crosshair'
    this.timerId = window.setInterval(() => {
      this.widget.setTimer(this.clock())
      this.repositionPins()
    }, 250)

    window.addEventListener('mousemove', this.onMove, true)
    window.addEventListener('click', this.onClick, true)
    window.addEventListener('pointerdown', this.onPointerDown, true)
    window.addEventListener('scroll', this.onScroll, true)
    window.addEventListener('resize', this.onScroll, true)
    window.addEventListener('keydown', this.onKey, true)
  }

  private switchToClickOnly(msg: string): void {
    this.provider?.dispose()
    this.provider = null
    if (this.phase === 'recording') {
      this.widget.setMode('clickonly')
      this.widget.setNotice(msg)
      this.widget.setCaption('')
    }
  }

  private teardownRecording(): void {
    if (this.timerId != null) {
      window.clearInterval(this.timerId)
      this.timerId = null
    }
    if (this.prevCursor != null) {
      document.body.style.cursor = this.prevCursor
      this.prevCursor = null
    }
    this.widget.highlight(null)
    window.removeEventListener('mousemove', this.onMove, true)
    window.removeEventListener('click', this.onClick, true)
    window.removeEventListener('pointerdown', this.onPointerDown, true)
    window.removeEventListener('scroll', this.onScroll, true)
    window.removeEventListener('resize', this.onScroll, true)
    window.removeEventListener('keydown', this.onKey, true)
  }

  private pick(x: number, y: number): Element | null {
    const el = document.elementFromPoint(x, y)
    if (!el || this.widget.contains(el)) return null
    return el
  }

  private handleMove(e: MouseEvent): void {
    const el = this.pick(e.clientX, e.clientY)
    this.widget.highlight(el ? rectOf(el) : null)
  }

  private handlePointerDown(e: Event): void {
    const me = e as MouseEvent
    const el = this.pick(me.clientX, me.clientY)
    if (!el) return // let interactions with our own widget through
    // Non-destructive selection: block host focus/drag/text-select.
    e.preventDefault()
    e.stopImmediatePropagation()
  }

  private handleClick(e: MouseEvent): void {
    if (this.phase !== 'recording') return
    const el = this.pick(e.clientX, e.clientY)
    if (!el) return
    e.preventDefault()
    e.stopImmediatePropagation()

    // Reserve the record synchronously (click order); fill context async.
    const id = ++this.annId
    const t = this.clock()
    const rect = rectOf(el)
    const record: Rec = { ann: { id, t, element: placeholder(el, rect) }, el }
    this.records.push(record)
    this.widget.addPin(id, rect)

    const token = this.runToken
    this.pending.push(
      buildElementContext(el)
        .then((ctx) => {
          if (token === this.runToken && !this.destroyed) record.ann.element = ctx
        })
        .catch(() => {
          /* keep placeholder */
        }),
    )
  }

  private handleKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      void this.stop()
      return
    }
    if (e.key === 'Backspace' && !isEditable(document.activeElement)) {
      e.preventDefault()
      this.undoLast()
    }
  }

  private undoLast(): void {
    const last = this.records.pop()
    if (last) this.widget.removePin(last.ann.id)
  }

  private repositionPins(): void {
    for (const r of this.records) {
      this.widget.updatePin(r.ann.id, r.el.isConnected ? rectOf(r.el) : null)
    }
  }

  async stop(): Promise<void> {
    if (this.phase !== 'recording') return
    const token = this.runToken
    this.endedSec = this.clock()
    this.teardownRecording()
    this.phase = 'review'
    this.widget.setPhase('review')
    this.widget.showToast('Finishing transcript…')

    if (this.provider) {
      try {
        await this.provider.stop()
      } catch {
        /* noop */
      }
    }
    await Promise.allSettled(this.pending)
    if (token !== this.runToken || this.destroyed) return

    this.records.sort((a, b) => a.ann.id - b.ann.id)
    this.widget.renderReview(this.buildResult())
  }

  private buildResult(): SessionResult {
    for (const s of this.segments) delete s.annotationIds
    const annotations = this.records.map((r) => {
      r.ann.transcript = undefined
      return r.ann
    })
    this.correlate(annotations)
    return {
      startedAt: this.startedWall,
      durationSec: this.endedSec,
      transcript: this.segments,
      annotations,
    }
  }

  /** Attach each pin to its nearest phrase within a bounded window (a phrase may serve several pins). */
  private correlate(anns: Annotation[]): void {
    for (const a of anns) {
      let best = -1
      let bestDist = Infinity
      for (let i = 0; i < this.segments.length; i++) {
        const seg = this.segments[i]
        if (!seg) continue
        const d = seg.t - a.t
        if (d < -LOOK_BEHIND || d > LOOK_AHEAD) continue
        if (Math.abs(d) < bestDist) {
          bestDist = Math.abs(d)
          best = i
        }
      }
      if (best >= 0) {
        const seg = this.segments[best]
        if (seg) {
          ;(seg.annotationIds ??= []).push(a.id)
          a.transcript = seg.text
        }
      }
    }
  }

  private deleteAnnotation(id: number): void {
    this.records = this.records.filter((r) => r.ann.id !== id)
    this.widget.removePin(id)
    this.widget.renderReview(this.buildResult())
  }

  async copy(): Promise<void> {
    const result = this.buildResult()
    const md = toMarkdown(result, this.config.redact)
    const ok = await copyText(md)
    if (ok) {
      this.widget.showCopied()
      this.widget.showToast('Copied context to clipboard — paste into your agent')
      try {
        this.config.onCopy?.(md, result)
      } catch (err) {
        console.error('[feedbasha] onCopy callback threw:', err)
      }
    } else {
      this.widget.showCopyFallback(md)
    }
  }

  reset(): void {
    this.runToken++ // invalidate any in-flight async
    if (this.startupTimeout != null) {
      window.clearTimeout(this.startupTimeout)
      this.startupTimeout = null
    }
    this.teardownRecording()
    this.provider?.dispose()
    this.provider = null
    this.widget.clearPins()
    this.records = []
    this.segments = []
    this.pending = []
    this.annId = 0
    this.endedSec = 0
    this.phase = 'idle'
    this.widget.setPhase('idle')
  }

  destroy(): void {
    this.destroyed = true
    this.reset()
    this.widget.destroy()
  }
}

function rectOf(el: Element): { x: number; y: number; width: number; height: number } {
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

function placeholder(
  el: Element,
  rect: { x: number; y: number; width: number; height: number },
): ElementContext {
  const tag = el.tagName.toLowerCase()
  return { componentTree: [], tag, attributes: {}, rect, outerHTMLSnippet: tag }
}

function isEditable(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable === true
  )
}
