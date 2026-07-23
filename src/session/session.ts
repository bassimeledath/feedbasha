import type {
  ActionEvent,
  ElementContext,
  FeedbashaConfig,
  SessionEvent,
  SessionResult,
  STTProvider,
  STTSegmentEvent,
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
  private paused = false
  private pendingReview = false // review was closed to idle but kept for reopening
  private lastX = -1
  private lastY = -1

  private mode: CaptureMode = 'voice'
  private hudDragging = false
  private spanEventStart = 0 // index in `events` where the current recording span began
  // Text-mode compose state: the element being annotated + its (resolving) context.
  private composing = false
  private composeToken = 0 // invalidates a superseded compose's async element lookup
  private composeEl: Element | null = null
  private draft: { el: Element; text: string } | null = null // cached note text per element
  private composeCtx: ElementContext | null = null
  private composeCtxPromise: Promise<ElementContext> | null = null

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
    this.widget = new Widget(config.position ?? 'bottom-right', config.dock ?? true, {
      onStart: () => void this.start(),
      onStop: () => void this.stop(),
      onClear: () => this.reset(), // wipe the log + return to the idle mic
      onTogglePause: () => this.togglePause(),
      onToggleMode: () => void this.switchMode(),
      onResume: () => void this.resume(),
      onClose: () => this.closeReview(),
      onCopy: () => void this.copy(),
      onDiscard: () => this.reset(),
      onDelete: (id) => this.deleteEvent(id),
      onEdit: (id, text) => this.editEvent(id, text),
      onReorder: (ids) => this.reorder(ids),
      onReselect: (id) => this.beginReselect(id),
      onHover: (id, on) => this.hoverElement(id, on),
      onComposeAdd: (text) => this.commitCompose(text),
      onComposeCancel: () => this.cancelCompose(),
      onHudDrag: (active) => this.setHudDragging(active),
    })
  }

  private clock = (): number =>
    this.accumSec + (this.spanActive ? (performance.now() - this.spanStart) / 1000 : 0)

  /** Begin a fresh session — or reopen a review the user closed to the bubble. */
  async start(): Promise<void> {
    if (this.phase !== 'idle' || this.destroyed) return
    if (this.pendingReview) {
      this.reopenReview()
      return
    }
    this.startedWall = Date.now()
    this.accumSec = 0
    await this.arm()
  }

  /** Flip the input method mid-session, keeping one continuous log + the clock.
   *  voice → text silences the mic; text → voice brings it back. */
  private async switchMode(): Promise<void> {
    if (this.phase !== 'recording') return
    if (this.composing) this.endCompose()
    if (this.paused) this.resumeCapture() // choosing an input mode implies resuming

    if (this.mode === 'text') {
      // text → voice: bring the mic back (may degrade to click-only).
      this.mode = 'voice'
      this.widget.setMode('voice')
      await this.startVoiceProvider()
    } else {
      // voice/click-only → text: silence the mic; flush any final segment.
      const prev = this.provider
      this.provider = null
      this.mode = 'text'
      this.widget.setMode('text')
      this.widget.setCaption('')
      if (prev) {
        // Dispose only if the user hasn't flipped back to voice and re-acquired the
        // SAME instance meanwhile (custom providers are reused) — else we'd tear
        // down the newly-active provider.
        const disposeIfStale = () => {
          if (this.provider !== prev) prev.dispose()
        }
        void prev.stop().then(disposeIfStale).catch(disposeIfStale)
      }
    }
  }

  /** (Re)acquire an STT provider while already recording (used by text → voice). */
  private async startVoiceProvider(): Promise<void> {
    const token = this.runToken
    this.widget.setNotice('Starting mic…')
    let provider: STTProvider | null = null
    try {
      provider = await createProvider(this.config.stt)
    } catch {
      provider = null
    }
    if (token !== this.runToken || this.destroyed || this.mode !== 'voice' || this.phase !== 'recording') {
      provider?.dispose()
      return
    }
    if (!provider) {
      this.switchToClickOnly('Mic unavailable, capturing clicks only.')
      return
    }
    this.provider = provider
    const seg = this.sttSegmentHandlers(token)
    try {
      await provider.start(
        {
          onReady: () => {
            if (token === this.runToken && this.mode === 'voice') this.widget.setMode('voice')
          },
          onProgress: (m) => {
            if (token === this.runToken && this.mode === 'voice') this.widget.setNotice(m)
          },
          ...seg,
          onNotice: (m) => {
            if (token === this.runToken) this.switchToClickOnly(m)
          },
        },
        this.clock,
      )
    } catch {
      this.switchToClickOnly('Mic failed, capturing clicks only.')
    }
  }

  /** Enter (or resume) text-mode recording — the mic-free capture path. */
  private enterText(): void {
    this.runToken++ // supersede any in-flight async
    this.provider?.dispose()
    this.provider = null
    this.phase = 'starting'
    this.widget.enableYield(false)
    this.widget.setPhase('starting')
    this.beginRecording('text')
  }

  private setHudDragging(active: boolean): void {
    this.hudDragging = active
    if (active) this.widget.highlight(null)
  }

  /** Close the review to the idle bubble, keeping the session so the mic can
   *  reopen it (distinct from "start a new session", which discards it). */
  private closeReview(): void {
    if (this.phase !== 'review') return
    this.phase = 'idle'
    this.pendingReview = true
    this.widget.spotlight(null)
    this.widget.enableYield(false)
    this.widget.setPinsVisible(false)
    this.widget.setBubbleReopen(true)
    this.widget.setPhase('idle')
  }

  private reopenReview(): void {
    this.pendingReview = false
    this.phase = 'review'
    this.widget.setBubbleReopen(false)
    this.widget.setPinsVisible(true)
    this.widget.renderReview(this.buildResult())
    this.widget.enableYield(true)
  }

  /** Return to recording after review, keeping the existing log and mode. */
  async resume(): Promise<void> {
    if (this.phase !== 'review' || this.destroyed) return
    if (this.mode === 'text') {
      this.enterText()
      return
    }
    await this.arm()
  }

  /** Acquire an STT provider and enter recording (shared by start + resume). */
  private async arm(): Promise<void> {
    const token = ++this.runToken
    this.phase = 'starting'
    this.widget.enableYield(false)
    this.widget.setPhase('starting')

    let provider: STTProvider | null = null
    try {
      provider = await createProvider(this.config.stt)
    } catch {
      provider = null // a custom provider's isAvailable() rejected — degrade cleanly
    }
    if (token !== this.runToken || this.destroyed) {
      provider?.dispose()
      return
    }
    this.provider = provider
    if (!provider) {
      this.beginRecording('clickonly', 'Speech recognition unavailable, capturing clicks only.')
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
    const armTimeout = (ms: number, msg: string) => {
      if (this.startupTimeout != null) window.clearTimeout(this.startupTimeout)
      this.startupTimeout = window.setTimeout(
        () => settle(() => this.beginRecording('clickonly', msg)),
        ms,
      )
    }
    armTimeout(5000, 'Mic not responding, capturing clicks only.')

    try {
      await provider.start(
        {
          onReady: () => settle(() => this.beginRecording('voice')),
          onProgress: (m) => {
            // Slow startup (e.g. model download / mic prompt): keep waiting,
            // show status, and extend the window instead of falling back.
            if (token !== this.runToken || settled) return
            this.widget.setNotice(m)
            armTimeout(120000, 'Speech model took too long, capturing clicks only.')
          },
          ...this.sttSegmentHandlers(token),
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
        this.beginRecording('clickonly', 'Speech recognition failed, capturing clicks only.'),
      )
    }
  }

  /** Interim-caption + finalized-segment handlers, shared by initial arm and
   *  mid-session mic (re)start. Interim only paints while in voice mode. */
  private sttSegmentHandlers(token: number): {
    onInterim: (t: string) => void
    onSegment: (s: STTSegmentEvent) => void
  } {
    return {
      onInterim: (t) => {
        if (
          token === this.runToken &&
          this.phase === 'recording' &&
          !this.paused &&
          this.mode === 'voice'
        ) {
          this.widget.setCaption(t)
        }
      },
      onSegment: (s) => {
        if (token !== this.runToken) return
        // Keep the segment even if we just paused — a final result can arrive from
        // the provider slightly after pause() and must not be dropped.
        this.events.push({ id: ++this.seq, kind: 'speech', t: s.t, text: s.text })
        // Live feedback: echo the freshly transcribed line into the caption. For
        // providers without interim (e.g. Whisper on WASM) this is the ONLY realtime
        // signal — otherwise the caption stays empty until the review sidebar.
        if (!this.paused && this.phase === 'recording' && this.mode === 'voice') {
          this.widget.setCaption(s.text)
        }
      },
    }
  }

  private beginRecording(mode: CaptureMode, notice?: string): void {
    if (this.phase !== 'starting') return
    if (mode === 'clickonly') {
      this.provider?.dispose()
      this.provider = null
    }
    this.phase = 'recording'
    this.mode = mode
    this.paused = false
    this.spanEventStart = this.events.length // only this span's events get time-sorted
    this.spanStart = performance.now()
    this.spanActive = true
    this.widget.setPhase('recording')
    this.widget.setMode(mode)
    this.widget.setPaused(false)
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

  private togglePause(): void {
    if (this.phase !== 'recording') return
    if (this.paused) this.resumeCapture()
    else this.pauseCapture()
  }

  /** Hold capture without ending: freeze the clock, silence the provider, and
   *  let the user interact with the app until they resume. */
  private pauseCapture(): void {
    if (this.composing) this.cancelCompose()
    this.paused = true
    if (this.spanActive) {
      this.accumSec += (performance.now() - this.spanStart) / 1000
      this.spanActive = false
    }
    this.provider?.pause?.()
    this.widget.highlight(null)
    document.body.style.cursor = this.prevCursor ?? ''
    this.widget.setPaused(true)
  }

  private resumeCapture(): void {
    this.paused = false
    this.spanStart = performance.now()
    this.spanActive = true
    this.provider?.resume?.()
    document.body.style.cursor = 'crosshair'
    this.widget.setPaused(false)
    // setPaused(true) hid the caption; re-apply the mode so the active mode's
    // caption/notice comes back (otherwise voice captions stay hidden post-pause).
    this.widget.setMode(this.mode)
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
    if (this.hudDragging) return // don't chase the cursor while moving the HUD
    if (this.composing) return // highlight stays locked on the element being annotated
    if (this.paused && this.reselectId == null) {
      this.widget.highlight(null)
      return
    }
    const el = this.pick(this.lastX, this.lastY)
    const rect = el ? rectOf(el) : null
    // Reselect uses the dramatic spotlight; live recording uses the calm border.
    if (this.reselectId != null) this.widget.spotlight(rect)
    else this.widget.highlight(rect)
  }

  private handlePointerDown(e: Event): void {
    if (this.paused) return // paused: let the user interact with the app normally
    const me = e as MouseEvent
    const el = this.pick(me.clientX, me.clientY)
    if (!el) return // let interactions with our own widget through
    // Non-destructive selection: block host focus/drag/text-select.
    e.preventDefault()
    e.stopImmediatePropagation()
  }

  private handleClick(e: MouseEvent): void {
    if (this.phase !== 'recording' || this.paused) return

    // While composing, a click outside the composer dismisses it (draft is cached
    // so an accidental click-away doesn't lose typed text). A click on another
    // element re-anchors the composer there.
    if (this.composing) {
      const at = document.elementFromPoint(e.clientX, e.clientY)
      if (at && this.widget.contains(at)) return // inside the composer — let it handle
      e.preventDefault()
      e.stopImmediatePropagation()
      const next = this.mode === 'text' ? this.pick(e.clientX, e.clientY) : null
      this.dismissCompose() // stashes a non-empty draft for the current element
      if (next) this.beginCompose(next)
      return
    }

    const el = this.pick(e.clientX, e.clientY)
    if (!el) return
    e.preventDefault()
    e.stopImmediatePropagation()

    // Text mode: open a note composer instead of pinning immediately.
    if (this.mode === 'text') {
      this.beginCompose(el)
      return
    }

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

  // ---- Text mode: click an element, type a note (react-grab style) ----

  /** Open the composer on the clicked element and start resolving its context. */
  private beginCompose(el: Element): void {
    this.composing = true
    this.composeEl = el
    const rect = rectOf(el)
    this.composeCtx = placeholder(el, rect)
    this.widget.highlight(rect) // freeze the highlight on the target
    // Restore a cached draft if this same element was dismissed mid-note.
    const initial = this.draft && this.draft.el === el && el.isConnected ? this.draft.text : ''
    this.widget.openComposer(rect, headerFor(this.composeCtx), initial)

    // Per-compose generation: if this compose is cancelled/committed and another
    // begins, a late element lookup from the old one must not overwrite the new
    // composer's context/header.
    const gen = ++this.composeToken
    this.composeCtxPromise = buildElementContext(el)
      .then((ctx) => {
        if (gen === this.composeToken && !this.destroyed) {
          this.composeCtx = ctx
          this.widget.setComposerHeader(headerFor(ctx))
        }
        return ctx
      })
      .catch(() => this.composeCtx ?? placeholder(el, rect))
  }

  /** Commit the typed note as an action event with an attached annotation. */
  private commitCompose(text: string): void {
    if (!this.composing || !this.composeEl) return
    const clean = text.trim()
    if (!clean) {
      this.cancelCompose()
      return
    }
    const el = this.composeEl
    const id = ++this.seq
    const n = ++this.actionSeq
    const t = this.clock()
    const rect = rectOf(el)
    const ev: ActionEvent = {
      id,
      kind: 'action',
      t,
      n,
      element: this.composeCtx ?? placeholder(el, rect),
      note: clean,
    }
    this.events.push(ev)
    this.liveEls.set(id, el)
    this.widget.addPin(id, n, rect)
    if (this.draft?.el === el) this.draft = null // committed — drop its cached draft

    // If the context is still resolving, patch the event's element when it lands.
    const token = this.runToken
    const p = this.composeCtxPromise
    if (p) {
      this.pending.push(
        p
          .then((ctx) => {
            if (token === this.runToken && !this.destroyed) ev.element = ctx
          })
          .catch(() => {
            /* keep placeholder */
          }),
      )
    }
    this.endCompose()
  }

  /** Explicit discard (Cancel button / Esc): drop the current element's draft too. */
  private cancelCompose(): void {
    if (!this.composing) return
    if (this.draft?.el === this.composeEl) this.draft = null
    this.endCompose()
  }

  /** Accidental dismiss (click outside): keep the typed text as a per-element draft
   *  so re-clicking the element restores it. */
  private dismissCompose(): void {
    if (!this.composing) return
    const text = this.widget.getComposerDraft().trim()
    if (text && this.composeEl) {
      this.draft = { el: this.composeEl, text }
      this.widget.showToast('Draft kept. Click the element to resume.')
    }
    this.endCompose()
  }

  private endCompose(): void {
    this.composing = false
    this.composeToken++ // invalidate any still-resolving lookup for this compose
    this.composeEl = null
    this.composeCtx = null
    this.composeCtxPromise = null
    this.widget.closeComposer()
    this.widget.highlight(null)
    this.refreshHover() // re-enable hover highlight at the cursor
  }

  private handleKey(e: KeyboardEvent): void {
    if (this.composing) {
      // Esc cancels the composer; every other key belongs to the note textarea.
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        this.cancelCompose()
      }
      return
    }
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
        // Surface the otherwise-silent deletion (Backspace is a reflex key).
        this.widget.showToast(`Removed pin ${ev.n}`)
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
    if (this.composing) this.endCompose()
    const token = this.runToken
    this.endedSec = this.clock()
    this.accumSec = this.endedSec // freeze elapsed; resume continues from here
    this.spanActive = false
    this.paused = false
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

    // Sort only THIS span's events by capture time (STT callbacks arrive out of
    // order). The prefix from earlier spans keeps whatever order the user set in
    // review — so drag-reordering survives a Resume → … → End round-trip.
    const head = this.events.slice(0, this.spanEventStart)
    const tail = this.events.slice(this.spanEventStart).sort((a, b) => a.t - b.t)
    this.events = [...head, ...tail]
    this.widget.renderReview(this.buildResult())
    // Panel yields (fades + click-through) when the cursor is over the app.
    this.widget.enableYield(true)
  }

  private buildResult(): SessionResult {
    return { startedAt: this.startedWall, durationSec: this.endedSec, events: [...this.events] }
  }

  private editEvent(id: number, text: string): void {
    const ev = this.events.find((e) => e.id === id)
    if (!ev) return
    if (ev.kind === 'speech') ev.text = text
    else if (ev.note != null) ev.note = text // editable text-mode annotation
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

  /** Spotlight (in review) the on-page element a card points to, on hover,
   *  scrolling it into view and isolating its pin from the rest. */
  private hoverElement(id: number, on: boolean): void {
    if (this.reselectId != null) return // don't fight the reselect spotlight
    if (!on) {
      this.widget.spotlight(null)
      this.isolatePin(null) // restore all pins
      return
    }
    const el = this.liveEls.get(id)
    if (!el || !el.isConnected) {
      this.widget.spotlight(null)
      return
    }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    this.isolatePin(id) // show only the hovered card's pin
    this.widget.spotlight(rectOf(el))
  }

  /** Show only the pin for `only` (null = show every connected pin). */
  private isolatePin(only: number | null): void {
    for (const [pid, el] of this.liveEls) {
      const show = (only == null || pid === only) && el.isConnected
      this.widget.updatePin(pid, show ? rectOf(el) : null)
    }
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
      this.widget.showToast('Copied context to clipboard. Paste it into your agent.')
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
    if (this.composing) this.endCompose()
    if (this.reselectId != null) this.endReselect()
    if (this.startupTimeout != null) {
      window.clearTimeout(this.startupTimeout)
      this.startupTimeout = null
    }
    this.teardownRecording()
    this.widget.enableYield(false)
    this.provider?.dispose()
    this.provider = null
    this.widget.clearPins()
    this.widget.setPinsVisible(true)
    this.widget.setBubbleReopen(false)
    this.mode = 'voice'
    this.hudDragging = false
    this.draft = null
    this.events = []
    this.liveEls.clear()
    this.pending = []
    this.seq = 0
    this.actionSeq = 0
    this.accumSec = 0
    this.spanActive = false
    this.endedSec = 0
    this.paused = false
    this.pendingReview = false
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

/** Compact "Component · file:line" label shown in the text-mode composer. */
function headerFor(ctx: ElementContext): string {
  const label = ctx.component ?? `<${ctx.tag}>`
  const s = ctx.source
  const ref = s
    ? `${s.fileName}${s.lineNumber != null ? `:${s.lineNumber}` : ''}`
    : (ctx.selector ?? ctx.outerHTMLSnippet)
  return `${label} · ${ref}`
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
