import type {
  ActionEvent,
  ElementContext,
  FeedbashaConfig,
  SessionEvent,
  SessionResult,
  STTProvider,
} from '../types'
import { createProvider } from '../stt'
import { buildElementContext } from '../capture/element'
import { toMarkdown } from '../serialize/markdown'
import { copyText } from '../util/clipboard'
import { Widget, type CaptureMode } from '../widget/widget'

type Phase = 'idle' | 'starting' | 'recording' | 'review'

/** Orchestrates the widget, STT provider, element capture, and output. */
export class Session {
  private widget: Widget
  private provider: STTProvider | null = null
  private phase: Phase = 'idle'

  // run token invalidates async work from a superseded/cancelled session
  private runToken = 0
  private destroyed = false
  private startupTimeout: number | null = null

  // Clock accumulates recorded time across resume spans, excluding review pauses.
  private accumSec = 0
  private spanStart = 0
  private spanActive = false
  private startedWall = 0
  private endedSec = 0
  private timerId: number | null = null
  private prevCursor: string | null = null

  private seq = 0 // event id counter
  private actionSeq = 0 // pin / badge ordinal (actions only)
  private events: SessionEvent[] = []
  private liveEls = new Map<number, Element>() // action event id → live element
  private pending: Promise<void>[] = []

  private reselectId: number | null = null
  private lastX = -1
  private lastY = -1

  private onMove = (e: MouseEvent) => this.handleMove(e)
  private onClick = (e: MouseEvent) => this.handleClick(e)
  private onPointerDown = (e: Event) => this.handlePointerDown(e)
  private onScroll = () => {
    this.repositionPins()
    this.refreshHover()
  }
  private onKey = (e: KeyboardEvent) => this.handleKey(e)
  private onReselectClick = (e: MouseEvent) => this.handleReselectClick(e)
  private onReselectKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      this.endReselect()
    }
  }

  constructor(private config: FeedbashaConfig) {
    this.widget = new Widget(config.position ?? 'bottom-right', {
      onStart: () => void this.start(),
      onStop: () => void this.stop(),
      onResume: () => void this.resume(),
      onCopy: () => void this.copy(),
      onDiscard: () => this.reset(),
      onDelete: (id) => this.deleteEvent(id),
      onEdit: (id, text) => this.editEvent(id, text),
      onReorder: (ids) => this.reorder(ids),
      onReselect: (id) => this.beginReselect(id),
      onHover: (id, on) => this.hoverElement(id, on),
    })
  }

  private clock = (): number =>
    this.accumSec + (this.spanActive ? (performance.now() - this.spanStart) / 1000 : 0)

  /** Begin a fresh session. */
  async start(): Promise<void> {
    if (this.phase !== 'idle' || this.destroyed) return
    this.startedWall = Date.now()
    this.accumSec = 0
    await this.arm()
  }

  /** Return to recording after review, keeping the existing log. */
  async resume(): Promise<void> {
    if (this.phase !== 'review' || this.destroyed) return
    await this.arm()
  }

  /** Acquire an STT provider and enter recording (shared by start + resume). */
  private async arm(): Promise<void> {
    const token = ++this.runToken
    this.phase = 'starting'
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
            if (token === this.runToken) {
              this.events.push({ id: ++this.seq, kind: 'speech', t: s.t, text: s.text })
            }
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
    this.spanStart = performance.now()
    this.spanActive = true
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
    if (
      !el ||
      el === document.body ||
      el === document.documentElement ||
      this.widget.contains(el)
    ) {
      return null
    }
    return normalizeTarget(el)
  }

  private handleMove(e: MouseEvent): void {
    this.lastX = e.clientX
    this.lastY = e.clientY
    this.refreshHover()
  }

  /** Re-run the pick at the last pointer position and update the active overlay.
   *  Called on mousemove and on scroll/resize so the box never goes stale. */
  private refreshHover(): void {
    if (this.lastX < 0) return
    const el = this.pick(this.lastX, this.lastY)
    const rect = el ? rectOf(el) : null
    // Reselect uses the dramatic spotlight; live recording uses the calm border.
    if (this.reselectId != null) this.widget.spotlight(rect)
    else this.widget.highlight(rect)
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

    // Append an action event to the log; fill its element context async.
    const id = ++this.seq
    const n = ++this.actionSeq
    const t = this.clock()
    const rect = rectOf(el)
    const ev: ActionEvent = { id, kind: 'action', t, n, element: placeholder(el, rect) }
    this.events.push(ev)
    this.liveEls.set(id, el)
    this.widget.addPin(id, n, rect)

    const token = this.runToken
    this.pending.push(
      buildElementContext(el)
        .then((ctx) => {
          if (token === this.runToken && !this.destroyed) ev.element = ctx
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
      this.undoLastAction()
    }
  }

  /** Backspace removes the most recent pinned selection (speech is edited in review). */
  private undoLastAction(): void {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const ev = this.events[i]
      if (ev && ev.kind === 'action') {
        this.events.splice(i, 1)
        this.widget.removePin(ev.id)
        this.liveEls.delete(ev.id)
        return
      }
    }
  }

  private repositionPins(): void {
    for (const [id, el] of this.liveEls) {
      this.widget.updatePin(id, el.isConnected ? rectOf(el) : null)
    }
  }

  async stop(): Promise<void> {
    if (this.phase !== 'recording') return
    const token = this.runToken
    this.endedSec = this.clock()
    this.accumSec = this.endedSec // freeze elapsed; resume continues from here
    this.spanActive = false
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
      this.provider = null
    }
    await Promise.allSettled(this.pending)
    if (token !== this.runToken || this.destroyed) return

    // Order the log chronologically on entering review; the user can then drag
    // to reorder, and that manual order is preserved from here on.
    this.events.sort((a, b) => a.t - b.t)
    this.widget.renderReview(this.buildResult())
  }

  private buildResult(): SessionResult {
    return { startedAt: this.startedWall, durationSec: this.endedSec, events: [...this.events] }
  }

  private editEvent(id: number, text: string): void {
    const ev = this.events.find((e) => e.id === id)
    if (ev && ev.kind === 'speech') ev.text = text
    // No re-render: keeps the caret where the user is typing.
  }

  private deleteEvent(id: number): void {
    const ev = this.events.find((e) => e.id === id)
    this.events = this.events.filter((e) => e.id !== id)
    if (ev && ev.kind === 'action') {
      this.widget.removePin(id)
      this.liveEls.delete(id)
    }
    this.widget.renderReview(this.buildResult())
  }

  /** Spotlight (in review) the on-page element a card points to, on hover. */
  private hoverElement(id: number, on: boolean): void {
    if (this.reselectId != null) return // don't fight the reselect spotlight
    if (!on) {
      this.widget.spotlight(null)
      return
    }
    const el = this.liveEls.get(id)
    this.widget.spotlight(el && el.isConnected ? rectOf(el) : null)
  }

  private reorder(ids: number[]): void {
    const rank = new Map(ids.map((id, i) => [id, i]))
    this.events.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
    // DOM already reflects the drop; keep the model in sync (no re-render needed).
  }

  // ---- Reselect: fix a mis-clicked element without redoing the session ----

  private beginReselect(id: number): void {
    if (this.phase !== 'review' || this.reselectId != null) return
    this.reselectId = id
    this.prevCursor = document.body.style.cursor
    document.body.style.cursor = 'crosshair'
    this.widget.setReselecting(true)
    window.addEventListener('mousemove', this.onMove, true)
    window.addEventListener('pointerdown', this.onPointerDown, true)
    window.addEventListener('click', this.onReselectClick, true)
    window.addEventListener('keydown', this.onReselectKey, true)
  }

  private handleReselectClick(e: MouseEvent): void {
    const el = this.pick(e.clientX, e.clientY)
    if (!el) return
    e.preventDefault()
    e.stopImmediatePropagation()
    const id = this.reselectId
    this.endReselect()
    const ev = this.events.find((x) => x.id === id && x.kind === 'action') as ActionEvent | undefined
    if (!ev) return

    const rect = rectOf(el)
    ev.element = placeholder(el, rect)
    this.liveEls.set(ev.id, el)
    this.widget.updatePin(ev.id, rect)
    this.widget.renderReview(this.buildResult())

    const token = this.runToken
    this.pending.push(
      buildElementContext(el)
        .then((ctx) => {
          if (token === this.runToken && !this.destroyed) {
            ev.element = ctx
            this.widget.renderReview(this.buildResult())
          }
        })
        .catch(() => {
          /* keep placeholder */
        }),
    )
  }

  private endReselect(): void {
    this.reselectId = null
    if (this.prevCursor != null) {
      document.body.style.cursor = this.prevCursor
      this.prevCursor = null
    }
    this.widget.highlight(null)
    this.widget.spotlight(null)
    this.widget.setReselecting(false)
    window.removeEventListener('mousemove', this.onMove, true)
    window.removeEventListener('pointerdown', this.onPointerDown, true)
    window.removeEventListener('click', this.onReselectClick, true)
    window.removeEventListener('keydown', this.onReselectKey, true)
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
    if (this.reselectId != null) this.endReselect()
    if (this.startupTimeout != null) {
      window.clearTimeout(this.startupTimeout)
      this.startupTimeout = null
    }
    this.teardownRecording()
    this.provider?.dispose()
    this.provider = null
    this.widget.clearPins()
    this.events = []
    this.liveEls.clear()
    this.pending = []
    this.seq = 0
    this.actionSeq = 0
    this.accumSec = 0
    this.spanActive = false
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

const SVG_NS = 'http://www.w3.org/2000/svg'
const CONTROL_TAGS = new Set([
  'BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL', 'SUMMARY', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'DETAILS',
])

/** A genuine control or explicitly-marked target — kept as-is, never climbed past. */
function isMeaningfulTarget(el: Element): boolean {
  if (CONTROL_TAGS.has(el.tagName)) return true
  if ((el as HTMLElement).isContentEditable) return true
  return el.hasAttribute('role') || el.hasAttribute('data-testid')
}

function isInlineish(el: Element): boolean {
  if (el.namespaceURI === SVG_NS) return true
  return getComputedStyle(el).display.startsWith('inline')
}

/**
 * Climb out of decorative inline leaves (text spans, icons, SVG internals) to the
 * nearest block-level element or control the user likely means — so the highlight
 * snaps to a sensible box instead of a sub-word `<span>`.
 */
function normalizeTarget(el: Element): Element {
  if (isMeaningfulTarget(el)) return el
  let cur: Element = el
  while (
    cur.parentElement &&
    cur.parentElement !== document.body &&
    !isMeaningfulTarget(cur) &&
    isInlineish(cur)
  ) {
    cur = cur.parentElement
  }
  return cur
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
