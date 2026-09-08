import type {
  Annotation,
  AnnotationTarget,
  ElementContext,
  FeedbashaConfig,
  RegionTarget,
  SessionResult,
  ViewportRect,
} from '../types'
import { buildElementContext } from '../capture/element'
import { clampPoint, isDrag, rectFromPoints, type Point } from '../capture/selection'
import { elementsInRegion, normalizeTarget, placeholder, rectOf, resolveContexts } from '../capture/target'
import { toMarkdown } from '../serialize/markdown'
import { CaptureExporter, saveLocalCapture } from '../capture/export'
import { DraftVoice, type VoiceState } from './voice'
import { copyText } from '../util/clipboard'
import { Widget, type CaptureMode } from '../widget/widget'

type Phase = 'idle' | 'active' | 'review'

interface Draft {
  annotationId?: number
  target: AnnotationTarget
  liveElement: Element | null
  input: 'text' | 'voice'
  note: string
  voiceState: VoiceState
  interim?: { base: string; edited: boolean }
}

interface Gesture {
  pointerId: number
  start: Point
  current: Point
  dragging: boolean
}

/** One small orchestrator: phase, mode, annotations, and an optional draft. */
export class Session {
  private widget: Widget
  private phase: Phase = 'idle'
  private mode: CaptureMode = 'voice'
  private annotations: Annotation[] = []
  private draft: Draft | null = null
  private dismissedDraft: Draft | null = null
  private draftBusy = false
  private voice: DraftVoice
  private exporter: CaptureExporter
  private copying = false
  private generation = 0
  private reviewing = false
  private gesture: Gesture | null = null
  private reselectId: number | null = null
  private paused = false
  private destroyed = false
  private hudDragging = false
  private selectionToken = 0
  private sequence = 0
  private startedAt = 0
  private elapsedSec = 0
  private spanStarted = 0
  private spanActive = false
  private endedSec = 0
  private timer: number | null = null
  private liveElements = new Map<number, Element>()
  private previews = new Map<number, string>()
  private staleRegions = new WeakSet<RegionTarget>()
  private layoutObserver: MutationObserver
  private selecting = false

  private onScroll = (event: Event) => {
    if (event.type === 'resize' || (event.target !== document && event.target !== window)) this.invalidateRegions()
    if (this.selecting) this.cancelSelection()
    this.widget.spotlight(null)
    this.widget.hidePinPreview()
    this.repositionPins()
  }
  private onKey = (event: KeyboardEvent) => this.handleKey(event)

  private onVisibility = () => this.voice.checkIdle()

  constructor(private config: FeedbashaConfig) {
    this.voice = new DraftVoice(config.stt, this.clock)
    this.exporter = new CaptureExporter(config.saveCapture ?? saveLocalCapture)
    this.widget = new Widget(config.position ?? 'bottom-right', config.dock ?? true, {
      onStart: () => void this.start(),
      onReview: () => void this.review(),
      onClear: () => this.reset(),
      onTogglePause: () => this.togglePause(),
      onToggleMode: () => void this.toggleMode(),
      onResumeSession: () => void this.resumeSession(),
      onClose: () => this.closeReview(),
      onCopy: () => void this.copy(),
      onDiscard: () => this.reset(),
      onDelete: (id) => this.deleteAnnotation(id),
      onEdit: (id, text) => this.editAnnotation(id, text),
      onReorder: (ids) => this.reorder(ids),
      onReselect: (id) => this.beginReselect(id),
      onHover: (id, active) => this.hoverAnnotation(id, active),
      onPinHover: (id, active) => this.previewAnnotation(id, active),
      onPinEdit: (id) => void this.openAnnotation(id),
      onComposeAdd: () => void this.commitDraft(),
      onComposeCancel: () => void this.cancelDraft(),
      onComposeInput: (text) => {
        if (!this.draft) return
        this.draft.note = text
        if (this.draft.interim) this.draft.interim.edited = true
      },
      onComposeResumeVoice: () => void this.resumeDraftVoice(),
      onHudDrag: (active) => { this.hudDragging = active },
      onGestureStart: (point, pointerId) => this.gestureStart(point, pointerId),
      onGestureMove: (point, pointerId) => this.gestureMove(point, pointerId),
      onGestureEnd: (point, pointerId) => void this.gestureEnd(point, pointerId),
      onGestureCancel: (pointerId) => this.gestureCancel(pointerId),
    })
    window.addEventListener('scroll', this.onScroll, true)
    window.addEventListener('resize', this.onScroll, true)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.layoutObserver = new MutationObserver((records) => {
      // DOM rasterizers measure fonts with nodes added and removed in one task.
      // Those transient probes do not change the page's lasting layout.
      const transient = new Set(records.flatMap((record) => Array.from(record.addedNodes)).filter((node) => !node.isConnected))
      const changed = records.some((record) => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement
        if (!target || !target.isConnected || this.widget.contains(target)) return false
        const nodes = [...record.addedNodes, ...record.removedNodes]
        if (record.type === 'childList' && nodes.length && nodes.every((node) => transient.has(node) || node instanceof Element &&
          (node.matches('iframe.html2canvas-container') ||
            (node instanceof HTMLIFrameElement && node.style.visibility === 'hidden') || this.widget.contains(node)))) return false
        if (target instanceof HTMLIFrameElement && target.style.visibility === 'hidden') return false
        return true
      })
      if (changed) {
        this.invalidateRegions()
        if (this.selecting) this.cancelSelection()
      }
    })
    this.layoutObserver.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
  }

  private invalidateRegions(): void {
    for (const annotation of this.annotations) {
      if (annotation.target.kind === 'region') this.staleRegions.add(annotation.target)
    }
    if (this.draft?.target.kind === 'region') this.staleRegions.add(this.draft.target)
    if (this.dismissedDraft?.target.kind === 'region') this.staleRegions.add(this.dismissedDraft.target)
    if (this.draft?.target.kind === 'region') this.widget.setComposerPreview(this.draft.target.screenshot?.blob ?? null)
    this.widget.spotlight(null)
    this.widget.highlight(null)
    this.widget.hidePinPreview()
    this.repositionPins()
  }

  private cancelSelection(): void {
    this.selectionToken++
    this.selecting = false
    this.gesture = null
    this.widget.setGestureRect(null)
    this.widget.highlight(null)
    this.widget.hideNotice()
    this.widget.setCaptureEnabled(this.phase === 'active' && !this.paused)
  }

  private clock = (): number =>
    this.elapsedSec + (this.spanActive ? (performance.now() - this.spanStarted) / 1000 : 0)

  async start(): Promise<void> {
    if (this.destroyed || this.phase !== 'idle') return
    this.startedAt = Date.now()
    this.elapsedSec = 0
    this.endedSec = 0
    this.enterActive()
  }

  private enterActive(): void {
    this.phase = 'active'
    this.paused = false
    this.spanStarted = performance.now()
    this.spanActive = true
    this.widget.setPhase('active')
    this.widget.setMode(this.mode)
    this.widget.setPaused(false)
    this.widget.setListening(false)
    this.widget.setReviewCount(this.annotations.length)
    this.widget.setPinsVisible(true)
    this.widget.setCaptureEnabled(true)
    this.timer = window.setInterval(() => {
      this.widget.setTimer(this.clock())
      this.repositionPins()
    }, 250)
    window.addEventListener('keydown', this.onKey)
  }

  private leaveActive(): void {
    if (this.timer != null) window.clearInterval(this.timer)
    this.timer = null
    window.removeEventListener('keydown', this.onKey)
    this.widget.setCaptureEnabled(false)
    this.widget.setGestureRect(null)
    this.widget.highlight(null)
    this.widget.hideNotice()
    this.gesture = null
  }

  private togglePause(): void {
    if (this.phase !== 'active') return
    if (this.paused) this.resumeCapture()
    else this.pauseCapture()
  }

  private pauseCapture(): void {
    this.paused = true
    if (this.spanActive) {
      this.elapsedSec += (performance.now() - this.spanStarted) / 1000
      this.spanActive = false
    }
    this.cancelSelection()
    this.gesture = null
    void this.voice.finish('voice-paused', 'Paused. Resume to keep speaking.')
    this.widget.setPaused(true)
    this.widget.setListening(false)
    this.widget.setCaptureEnabled(false)
    this.widget.setGestureRect(null)
    this.widget.highlight(this.draft ? this.liveTargetRect(this.draft.target, this.draft.liveElement) : null)
  }

  private resumeCapture(): void {
    this.paused = false
    this.spanStarted = performance.now()
    this.spanActive = true
    this.widget.setPaused(false)
    this.widget.setCaptureEnabled(true)
  }

  private async toggleMode(): Promise<void> {
    if (this.phase !== 'active' || this.draftBusy || this.reviewing) return
    const draft = this.draft
    this.mode = this.mode === 'voice' ? 'text' : 'voice'
    this.widget.setMode(this.mode)
    if (!this.draft) return
    this.draft.input = this.mode
    if (this.mode === 'text') {
      await this.voice.finish('off')
      if (this.draft === draft && this.mode === 'text') this.widget.setComposerState('text')
    } else {
      await this.startDraftVoice()
    }
  }

  private gestureStart(point: Point, pointerId: number): void {
    if (this.paused || this.hudDragging || this.draftBusy || this.reviewing || this.gesture || this.selecting) return
    if (this.phase !== 'active' && this.reselectId == null) return
    if (this.draft) {
      void this.dismissDraft()
      return
    }
    const start = clampPoint(point, innerWidth, innerHeight)
    this.gesture = { pointerId, start, current: start, dragging: false }
    this.widget.hideNotice()
  }

  private gestureMove(point: Point, pointerId: number): void {
    const gesture = this.gesture
    if (!gesture || gesture.pointerId !== pointerId) return
    gesture.current = clampPoint(point, innerWidth, innerHeight)
    if (!gesture.dragging && isDrag(gesture.start, gesture.current)) gesture.dragging = true
    if (gesture.dragging) this.widget.setGestureRect(rectFromPoints(gesture.start, gesture.current))
  }

  private async gestureEnd(point: Point, pointerId: number): Promise<void> {
    const gesture = this.gesture
    if (!gesture || gesture.pointerId !== pointerId) return
    gesture.current = clampPoint(point, innerWidth, innerHeight)
    this.gesture = null
    const dragged = gesture.dragging || isDrag(gesture.start, gesture.current)
    const selection = dragged ? rectFromPoints(gesture.start, gesture.current) : null
    this.selecting = true
    const token = ++this.selectionToken
    try {
      const resolved = await this.resolveTarget(dragged, gesture.current, selection, token)
      if (!resolved || token !== this.selectionToken || this.destroyed) return
      if (this.reselectId != null) {
        this.applyReselect(resolved.target, resolved.liveElement)
      } else if (this.phase === 'active') {
        this.openDraft(resolved.target, resolved.liveElement)
      }
    } finally {
      if (token === this.selectionToken && (this.phase === 'active' || this.reselectId != null)) {
        this.selecting = false
        this.widget.setCaptureEnabled(!this.paused)
      }
    }
  }

  private gestureCancel(pointerId: number): void {
    if (this.gesture?.pointerId !== pointerId) return
    this.gesture = null
    this.widget.setGestureRect(null)
  }

  private async resolveTarget(
    dragged: boolean,
    point: Point,
    region: ViewportRect | null,
    token: number,
  ): Promise<{ target: AnnotationTarget; liveElement: Element | null } | null> {
    if (!dragged || !region) {
      this.widget.setGestureRect(null)
      const raw = this.widget.elementsAt(point.x, point.y)[0]
      if (!raw) return null
      const element = normalizeTarget(raw)
      this.widget.highlight(rectOf(element))
      this.widget.showNotice('Reading the target…')
      let context: ElementContext
      try { context = await buildElementContext(element) } catch { context = placeholder(element) }
      if (token !== this.selectionToken) return null
      this.widget.hideNotice()
      return { target: { kind: 'element', element: context }, liveElement: element }
    }

    this.widget.showNotice('Understanding the region…')
    const candidates = elementsInRegion(region, (x, y) => this.widget.elementsAt(x, y), (el) => this.widget.contains(el))
    const viewport = { width: innerWidth, height: innerHeight, scrollX, scrollY, devicePixelRatio, url: location.href }
    // Begin the crop at selection time, before asynchronous component resolution.
    const image = candidates.length === 1 ? Promise.resolve(null) : Promise.resolve().then(() => this.config.captureRegion?.(region) ?? null).catch(() => null)
    const { contexts, representative } = await resolveContexts(candidates)
    if (token !== this.selectionToken) return null
    if (contexts.length === 1 && representative) {
      const rect = rectOf(representative)
      await this.widget.morphSelection(region, rect)
      if (token !== this.selectionToken) return null
      this.widget.hideNotice()
      return { target: { kind: 'element', element: contexts[0] as ElementContext }, liveElement: representative }
    }

    const screenshot = await image
    if (token !== this.selectionToken) return null
    this.widget.setGestureRect(null)
    this.widget.highlight(region)
    this.widget.hideNotice()
    const target: RegionTarget = { kind: 'region', rect: region, screenshot, elements: contexts,
      viewport }
    return { target, liveElement: null }
  }

  private openDraft(target: AnnotationTarget, liveElement: Element | null): void {
    if (liveElement && this.dismissedDraft?.liveElement === liveElement) {
      this.restoreDraft()
      return
    }
    this.draft = {
      target,
      liveElement,
      input: this.mode,
      note: '',
      voiceState: this.mode === 'voice' ? 'preparing' : 'off',
    }
    const rect = this.targetRect(target)
    this.widget.highlight(rect)
    this.widget.openComposer(rect, this.mode)
    if (this.mode === 'voice') void this.startDraftVoice()
  }

  private async dismissDraft(): Promise<void> {
    const draft = this.draft
    if (!draft || this.draftBusy) return
    const generation = this.generation
    this.draftBusy = true
    try {
      draft.note = this.widget.getComposerText()
      await this.voice.finish('voice-paused')
      if (this.draft !== draft) return
      draft.note = this.widget.getComposerText()
      this.dismissedDraft = draft.note.trim() ? draft : null
      await this.cancelDraft()
      if (this.dismissedDraft) this.widget.showToast('Draft kept.', { label: 'Undo', run: () => this.restoreDraft() })
    } finally {
      if (generation === this.generation) this.draftBusy = false
    }
  }

  private restoreDraft(): void {
    const draft = this.dismissedDraft
    if (!draft || this.draft || this.draftBusy || this.phase !== 'active' || this.paused) return
    this.dismissedDraft = null
    this.draft = draft
    const rect = this.liveTargetRect(draft.target, draft.liveElement)
    this.widget.highlight(rect)
    this.widget.openComposer(rect ?? { x: innerWidth / 2, y: innerHeight / 3, width: 0, height: 0 }, draft.input, draft.note, draft.annotationId != null)
    if (!rect && draft.target.kind === 'region') this.widget.setComposerPreview(draft.target.screenshot?.blob ?? null)
    // Restoring a draft never silently restarts the microphone.
    if (draft.input === 'voice') this.widget.setComposerState('voice-paused', 'Draft restored. Resume to keep speaking.')
    this.widget.hideToast()
  }

  private async openAnnotation(id: number): Promise<void> {
    const generation = this.generation
    if (this.phase === 'review' && this.reselectId == null) {
      this.widget.enableYield(false)
      this.widget.focusReviewNote(id)
      return
    }
    if (this.phase !== 'active' || this.paused || this.draftBusy) return
    if (this.draft) await this.dismissDraft()
    if (generation !== this.generation || this.phase !== 'active' || this.draft) return
    const annotation = this.annotations.find((item) => item.id === id)
    if (!annotation) return
    this.widget.hidePinPreview()
    this.widget.spotlight(null)
    this.draft = { annotationId: id, target: annotation.target, liveElement: this.liveElements.get(id) ?? null,
      input: annotation.input, note: annotation.note, voiceState: 'off' }
    const rect = this.annotationRect(annotation)
    if (!rect) { this.draft = null; return }
    this.widget.highlight(rect)
    this.widget.openComposer(rect, 'text', annotation.note, true)
  }

  private async startDraftVoice(): Promise<void> {
    const draft = this.draft
    if (!draft || draft.input !== 'voice' || this.phase !== 'active' || this.paused || this.draftBusy) return
    await this.voice.start({
      state: (state, message) => {
        if (this.draft !== draft) return
        draft.voiceState = state
        this.widget.setListening(state === 'listening' && !this.paused)
        this.widget.setComposerState(state === 'off' ? 'text' : state, message)
      },
      interim: (text) => {
        if (this.draft !== draft || !text.trim()) return
        draft.interim ??= { base: this.widget.getComposerText().trim(), edited: false }
        if (draft.interim.edited) return
        draft.note = [draft.interim.base, text.trim()].filter(Boolean).join(' ')
        this.widget.setComposerText(draft.note)
      },
      segment: (text) => {
        if (this.draft !== draft) return
        const interim = draft.interim
        draft.interim = undefined
        if (interim?.edited) return // Preserve the user's correction of the provisional words.
        const base = interim?.base ?? this.widget.getComposerText().trim()
        draft.note = [base, text.trim()].filter(Boolean).join(' ')
        this.widget.setComposerText(draft.note)
      },
    })
  }

  private async resumeDraftVoice(): Promise<void> {
    await this.startDraftVoice()
  }

  private async commitDraft(): Promise<boolean> {
    const draft = this.draft
    if (!draft || this.draftBusy) return false
    const generation = this.generation
    this.draftBusy = true
    try {
      draft.note = this.widget.getComposerText()
      if (draft.input === 'voice') {
        draft.voiceState = 'finalizing'
        this.widget.setComposerState('finalizing')
        await this.voice.finish('off')
        if (this.draft !== draft) return false
        draft.note = this.widget.getComposerText()
      }
      const note = draft.note.trim()
      if (!note) {
        this.widget.setComposerState(draft.input === 'voice' ? 'voice-paused' : 'text', 'Say or type a note before adding it.')
        return false
      }
      const existing = this.annotations.find((item) => item.id === draft.annotationId)
      const annotation: Annotation = existing ?? {
        id: ++this.sequence,
        n: this.annotations.length + 1,
        createdAt: this.clock(),
        input: draft.input,
        target: draft.target,
        note,
      }
      annotation.note = note
      if (!existing) this.annotations.push(annotation)
      if (draft.liveElement) this.liveElements.set(annotation.id, draft.liveElement)
      const rect = this.targetRect(annotation.target)
      if (!existing) this.widget.addPin(annotation.id, annotation.n, rect)
      if (!existing && annotation.target.kind === 'region' && annotation.target.screenshot) {
        this.previews.set(annotation.id, URL.createObjectURL(annotation.target.screenshot.blob))
      }
      this.draft = null
      this.voice.cancel()
      this.widget.closeComposer()
      this.widget.highlight(null)
      this.widget.setReviewCount(this.annotations.length)
      if (this.dismissedDraft?.annotationId === annotation.id) this.dismissedDraft = null
      this.widget.showToast(existing ? `Updated item ${annotation.n}.` : `Added item ${annotation.n}.`)
      return true
    } finally {
      if (generation === this.generation) this.draftBusy = false
    }
  }

  private async cancelDraft(): Promise<void> {
    this.voice.cancel()
    this.draft = null
    this.widget.setListening(false)
    this.widget.closeComposer()
    this.widget.highlight(null)
  }

  async review(): Promise<void> {
    if (this.phase !== 'active' || this.draftBusy || this.reviewing) return
    const generation = this.generation
    this.reviewing = true
    this.cancelSelection()
    try {
      if (this.draft) {
        await this.commitDraft() // Flush speech before testing whether the note is empty.
        if (generation !== this.generation || this.destroyed) return
        if (this.draft) await this.cancelDraft()
      }
      if (generation !== this.generation || this.destroyed) return
      this.endedSec = this.clock()
      this.elapsedSec = this.endedSec
      this.spanActive = false
      this.paused = false
      this.leaveActive()
      this.phase = 'review'
      this.widget.setPhase('review')
      this.widget.renderReview(this.buildResult(), this.previews)
      this.widget.enableYield(true)
    } finally {
      if (generation === this.generation) this.reviewing = false
    }
  }

  /** Public API alias: end active capture and open review. */
  async stop(): Promise<void> {
    await this.review()
  }

  private closeReview(): void {
    this.resumeSession()
  }

  private resumeSession(): void {
    if (this.phase !== 'review') return
    if (this.reselectId != null) this.endReselect()
    this.widget.enableYield(false)
    this.enterActive()
  }

  private buildResult(): SessionResult {
    return { startedAt: this.startedAt, durationSec: this.phase === 'active' ? this.clock() : this.endedSec, annotations: [...this.annotations] }
  }

  private editAnnotation(id: number, text: string): void {
    const annotation = this.annotations.find((item) => item.id === id)
    if (annotation) annotation.note = text
  }

  private deleteAnnotation(id: number): void {
    this.annotations = this.annotations.filter((item) => item.id !== id)
    this.liveElements.delete(id)
    this.widget.removePin(id)
    const preview = this.previews.get(id)
    if (preview) URL.revokeObjectURL(preview)
    this.previews.delete(id)
    this.renumber()
    this.widget.setReviewCount(this.annotations.length)
    if (this.dismissedDraft?.annotationId === id) this.dismissedDraft = null
    if (this.phase === 'review') this.widget.renderReview(this.buildResult(), this.previews)
  }

  private reorder(ids: number[]): void {
    const rank = new Map(ids.map((id, index) => [id, index]))
    this.annotations.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
    this.renumber()
  }

  private renumber(): void {
    this.annotations.forEach((annotation, index) => {
      annotation.n = index + 1
      this.widget.setPinLabel(annotation.id, annotation.n)
    })
  }

  private hoverAnnotation(id: number, active: boolean): void {
    if (this.reselectId != null || !active) {
      this.widget.spotlight(null)
      return
    }
    const annotation = this.annotations.find((item) => item.id === id)
    this.widget.spotlight(annotation ? this.annotationRect(annotation) : null)
  }

  private annotationRect(annotation: Annotation): ViewportRect | null {
    return this.liveTargetRect(annotation.target, this.liveElements.get(annotation.id) ?? null)
  }

  private liveTargetRect(target: AnnotationTarget, element: Element | null): ViewportRect | null {
    if (target.kind === 'region') {
      if (this.staleRegions.has(target)) return null
      const viewport = target.viewport
      // A responsive reflow cannot be inferred from the original rectangle.
      if (viewport && (viewport.width !== innerWidth || viewport.height !== innerHeight)) return null
      return this.targetRect(target)
    }
    return element?.isConnected ? rectOf(element) : null
  }

  private previewAnnotation(id: number, active: boolean): void {
    this.widget.hidePinPreview()
    if (!active || this.draft || this.reselectId != null) {
      this.widget.spotlight(null)
      return
    }
    const annotation = this.annotations.find((item) => item.id === id)
    const rect = annotation && this.annotationRect(annotation)
    if (!annotation || !rect) return
    this.widget.spotlight(rect)
    this.widget.showPinPreview(annotation.note, rect)
  }

  private beginReselect(id: number): void {
    if (this.phase !== 'review' || this.reselectId != null) return
    this.reselectId = id
    this.widget.enableYield(false)
    this.widget.setReselecting(true)
    this.widget.setCaptureEnabled(true)
    window.addEventListener('keydown', this.onKey)
  }

  private applyReselect(target: AnnotationTarget, liveElement: Element | null): void {
    const id = this.reselectId
    const annotation = this.annotations.find((item) => item.id === id)
    if (!annotation) return this.endReselect()
    annotation.target = target
    if (liveElement) this.liveElements.set(annotation.id, liveElement)
    else this.liveElements.delete(annotation.id)
    const oldPreview = this.previews.get(annotation.id)
    if (oldPreview) URL.revokeObjectURL(oldPreview)
    this.previews.delete(annotation.id)
    if (target.kind === 'region' && target.screenshot) this.previews.set(annotation.id, URL.createObjectURL(target.screenshot.blob))
    this.widget.updatePin(annotation.id, this.targetRect(target))
    this.endReselect()
    this.widget.renderReview(this.buildResult(), this.previews)
  }

  private endReselect(): void {
    this.reselectId = null
    this.selectionToken++
    this.selecting = false
    this.gesture = null
    this.widget.setCaptureEnabled(false)
    this.widget.setGestureRect(null)
    this.widget.highlight(null)
    this.widget.setReselecting(false)
    window.removeEventListener('keydown', this.onKey)
    if (this.phase === 'review') this.widget.enableYield(true)
  }

  private repositionPins(): void {
    for (const annotation of this.annotations) this.widget.updatePin(annotation.id, this.annotationRect(annotation))
  }

  private targetRect(target: AnnotationTarget): ViewportRect {
    if (target.kind === 'element') return target.element.rect
    if (!target.viewport) return target.rect
    return { ...target.rect, x: target.rect.x + target.viewport.scrollX - scrollX, y: target.rect.y + target.viewport.scrollY - scrollY }
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.reselectId != null) {
      event.preventDefault()
      this.endReselect()
      return
    }
    if (this.phase !== 'active' || this.paused || this.draft) return
    if (event.key === 'Escape') {
      event.preventDefault()
      if (this.selecting) this.cancelSelection()
      else if (this.gesture) this.gestureCancel(this.gesture.pointerId)
      else void this.review()
    } else if (event.key === 'Backspace' && !isEditable(event.target)) {
      event.preventDefault()
      const latest = this.annotations[this.annotations.length - 1]
      if (latest) {
        this.deleteAnnotation(latest.id)
        this.widget.showToast('Removed the last item.')
      }
    }
  }

  async copy(): Promise<void> {
    if (this.copying || this.phase !== 'review') return
    const generation = this.generation
    this.copying = true
    const result = this.buildResult()
    result.annotations = result.annotations.map((annotation) => ({ ...annotation }))
    this.widget.setCopyBusy(true)
    try {
      await this.exporter.prepare(result)
      if (generation !== this.generation || this.destroyed) return
      await this.copyResult(result, generation)
    } catch {
      if (generation !== this.generation || this.destroyed) return
      this.widget.showToast('Images could not be saved. Your feedback is still here.', {
        label: 'Copy text only', run: () => void this.copyResult(result, generation),
      })
    } finally {
      if (generation === this.generation) {
        this.copying = false
        this.widget.setCopyBusy(false)
      }
    }
  }

  private async copyResult(result: SessionResult, generation: number): Promise<void> {
    if (generation !== this.generation || this.destroyed) return
    const markdown = toMarkdown(result, this.config.redact)
    if (await copyText(markdown)) {
      if (generation !== this.generation || this.destroyed) return
      this.widget.showCopied()
      const unattached = result.annotations.some((item) => item.target.kind === 'region' && item.target.screenshot && !item.target.screenshot.reference)
      this.widget.showToast(unattached ? 'Text copied. Region images are not attached.' : 'Feedback copied.')
      try { this.config.onCopy?.(markdown, result) } catch (error) { console.error('[Karen] onCopy failed:', error) }
    } else {
      if (generation !== this.generation || this.destroyed) return
      this.widget.showCopyFallback(markdown)
      this.widget.showToast('Copy was blocked. The feedback is selected below.')
    }
  }

  reset(): void {
    this.selectionToken++
    this.selecting = false
    this.generation++
    this.voice.cancel()
    this.draftBusy = false
    this.reviewing = false
    this.copying = false
    this.widget.setCopyBusy(false)
    this.leaveActive()
    if (this.reselectId != null) this.endReselect()
    this.widget.enableYield(false)
    this.widget.clearPins()
    this.widget.setPinsVisible(true)
    this.widget.setBubbleReview(0)
    this.previews.forEach((url) => URL.revokeObjectURL(url))
    this.previews.clear()
    this.annotations = []
    this.liveElements.clear()
    this.draft = null
    this.dismissedDraft = null
    this.gesture = null
    this.sequence = 0
    this.startedAt = 0
    this.elapsedSec = 0
    this.endedSec = 0
    this.spanActive = false
    this.paused = false
    this.mode = 'voice'
    this.phase = 'idle'
    this.widget.setReviewCount(0)
    this.widget.setPhase('idle')
  }

  destroy(): void {
    this.destroyed = true
    this.reset()
    window.removeEventListener('scroll', this.onScroll, true)
    window.removeEventListener('resize', this.onScroll, true)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.widget.destroy()
    this.layoutObserver.disconnect()
  }
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || (target as HTMLElement).isContentEditable
}
