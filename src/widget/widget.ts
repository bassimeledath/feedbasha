import type { Annotation, RegionTarget, SessionResult, SourceLocation, ViewportRect } from '../types'
import { fmtTime } from '../util/time'
import { CSS } from './styles'
import { installFont } from './font'
import karenIcon from './karen-icon.png'

export type Phase = 'idle' | 'active' | 'review'
export type CaptureMode = 'voice' | 'text'
export type ComposerState = 'text' | 'preparing' | 'listening' | 'voice-paused' | 'finalizing' | 'unavailable'

export interface WidgetHandlers {
  onStart(): void
  onReview(): void
  onClear(): void
  onTogglePause(): void
  onToggleMode(): void
  onResumeSession(): void
  onClose(): void
  onCopy(): void
  onDiscard(): void
  onDelete(id: number): void
  onEdit(id: number, text: string): void
  onReorder(ids: number[]): void
  onReselect(id: number): void
  onHover(id: number, on: boolean): void
  onPinHover(id: number, on: boolean): void
  onPinEdit(id: number): void
  onComposeAdd(): void
  onComposeCancel(): void
  onComposeInput(text: string): void
  onComposeResumeVoice(): void
  onHudDrag(active: boolean): void
  onGestureStart(point: { x: number; y: number }, pointerId: number): void
  onGestureMove(point: { x: number; y: number }, pointerId: number): void
  onGestureEnd(point: { x: number; y: number }, pointerId: number): void
  onGestureCancel(pointerId: number): void
}

const KAREN_MARK = `<img class="fb-karen-mark" src="${karenIcon}" alt="" />`
const MIC_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`
const PENCIL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`
const PAUSE_SVG = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`
const PLAY_SVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5l12 7-12 7z"/></svg>`
const GRIP_SVG = `<svg viewBox="0 0 12 18" fill="currentColor"><circle cx="3" cy="3" r="1.5"/><circle cx="9" cy="3" r="1.5"/><circle cx="3" cy="9" r="1.5"/><circle cx="9" cy="9" r="1.5"/><circle cx="3" cy="15" r="1.5"/><circle cx="9" cy="15" r="1.5"/></svg>`
const TRASH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>`
const HUD_POS_KEY = 'karen:hud-pos'

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char)
}

function srcStr(source: SourceLocation): string {
  const line = source.lineNumber == null ? '' : `:${source.lineNumber}`
  const column = source.lineNumber == null || source.columnNumber == null ? '' : `:${source.columnNumber}`
  return `${source.fileName}${line}${column}`
}

function place(element: HTMLElement, rect: ViewportRect | null): void {
  if (!rect) {
    element.style.display = 'none'
    return
  }
  element.style.display = 'block'
  element.style.left = `${rect.x}px`
  element.style.top = `${rect.y}px`
  element.style.width = `${rect.width}px`
  element.style.height = `${rect.height}px`
}

function mkButton(className: string, html: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = className
  button.innerHTML = html
  button.title = title
  button.addEventListener('click', onClick)
  return button
}

function insertBeforeForY(container: HTMLElement, y: number): HTMLElement | null {
  const cards = Array.from(container.querySelectorAll<HTMLElement>('.fb-card:not(.dragging)'))
  let best: { offset: number; card: HTMLElement | null } = { offset: -Infinity, card: null }
  for (const card of cards) {
    const box = card.getBoundingClientRect()
    const offset = y - box.top - box.height / 2
    if (offset < 0 && offset > best.offset) best = { offset, card }
  }
  return best.card
}

export class Widget {
  private host: HTMLElement
  private root: ShadowRoot
  private capture: HTMLElement
  private highlightEl: HTMLElement
  private selectionEl: HTMLElement
  private spotlightEl: HTMLElement
  private pinsEl: HTMLElement
  private widgetEl: HTMLElement
  private bubble: HTMLElement
  private pill: HTMLElement
  private grip: HTMLElement
  private pauseButton: HTMLButtonElement
  private modeSwitch: HTMLElement
  private voiceButton: HTMLButtonElement
  private textButton: HTMLButtonElement
  private modeLabel: HTMLElement
  private pauseState: HTMLElement
  private timeElement: HTMLElement
  private reviewCount: HTMLElement
  private tip: HTMLElement
  private notice: HTMLElement
  private composer: HTMLElement
  private composerText: HTMLTextAreaElement
  private composerPreview: HTMLImageElement
  private composerPreviewUrl: string | null = null
  private composerResize: ResizeObserver
  private composerStatus: HTMLElement
  private composerAdd: HTMLButtonElement
  private sheet: HTMLElement
  private list: HTMLElement
  private copyButton: HTMLButtonElement
  private fallback: HTMLTextAreaElement
  private toast: HTMLElement
  private toastText: HTMLElement
  private toastAction: HTMLButtonElement
  private toastTimer: number | null = null
  private pinPreview: HTMLElement
  private confirm: HTMLElement
  private confirmTitle: HTMLElement
  private confirmMessage: HTMLElement
  private confirmOkay: HTMLButtonElement
  private confirmAction: (() => void) | null = null
  private pins = new Map<number, HTMLElement>()
  private dragOrder: HTMLElement[] = []
  private dragCard: HTMLElement | null = null
  private dragOffset: { dx: number; dy: number } | null = null
  private yielded = false
  private textMode = false
  private selectionAnimation: Animation | null = null

  constructor(
    private position: 'bottom-right' | 'bottom-left',
    private dock: boolean,
    private handlers: WidgetHandlers,
  ) {
    installFont()
    this.host = document.createElement('div')
    this.host.setAttribute('data-feedbasha', '')
    this.host.setAttribute('data-karen', '')
    this.root = this.host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = CSS
    this.root.appendChild(style)
    const tree = document.createElement('div')
    tree.className = 'fb-host'
    tree.innerHTML = this.template(position)
    this.root.appendChild(tree)
    document.body.appendChild(this.host)

    const query = <T extends HTMLElement>(selector: string): T => tree.querySelector(selector) as T
    this.capture = query('[data-el="capture"]')
    this.highlightEl = query('[data-el="highlight"]')
    this.selectionEl = query('[data-el="selection"]')
    this.spotlightEl = query('[data-el="spotlight"]')
    this.pinsEl = query('[data-el="pins"]')
    this.widgetEl = query('[data-el="widget"]')
    this.bubble = query('[data-el="bubble"]')
    this.pill = query('[data-el="pill"]')
    this.grip = query('[data-el="grip"]')
    this.pauseButton = query('[data-el="pause"]')
    this.modeSwitch = query('[data-el="mode-switch"]')
    this.voiceButton = query('[data-el="voice"]')
    this.textButton = query('[data-el="text"]')
    this.modeLabel = query('[data-el="mode-label"]')
    this.pauseState = query('[data-el="pause-state"]')
    this.timeElement = query('[data-el="time"]')
    this.reviewCount = query('[data-el="review-count"]')
    this.tip = query('[data-el="tip"]')
    this.notice = query('[data-el="notice"]')
    this.composer = query('[data-el="composer"]')
    this.composerText = query('[data-el="composer-text"]')
    this.composerPreview = query('[data-el="composer-preview"]')
    this.composerResize = new ResizeObserver(() => this.clampComposer())
    this.composerResize.observe(this.composer)
    this.composerStatus = query('[data-el="composer-status"]')
    this.composerAdd = query('[data-el="composer-add"]')
    this.sheet = query('[data-el="sheet"]')
    this.list = query('[data-el="list"]')
    this.copyButton = query('[data-el="copy"]')
    this.fallback = query('[data-el="fallback"]')
    this.toast = query('[data-el="toast"]')
    this.toastText = query('[data-el="toast-text"]')
    this.toastAction = query('[data-el="toast-action"]')
    this.pinPreview = query('[data-el="pin-preview"]')
    this.confirm = query('[data-el="confirm"]')
    this.confirmTitle = query('[data-el="confirm-title"]')
    this.confirmMessage = query('[data-el="confirm-message"]')
    this.confirmOkay = query('[data-el="confirm-ok"]')

    this.bubble.addEventListener('click', () => this.handlers.onStart())
    this.pauseButton.addEventListener('click', () => this.handlers.onTogglePause())
    this.voiceButton.addEventListener('click', () => this.textMode && this.handlers.onToggleMode())
    this.textButton.addEventListener('click', () => !this.textMode && this.handlers.onToggleMode())
    this.grip.addEventListener('pointerdown', (event) => this.beginHudDrag(event))
    query('[data-el="review"]').addEventListener('click', () => this.handlers.onReview())
    query('[data-el="clear"]').addEventListener('click', () => this.showConfirm(
      'Clear this feedback?',
      'This removes every note in the current session.',
      'Clear feedback',
      () => this.handlers.onClear(),
    ))
    query('[data-el="sheet-close"]').addEventListener('click', () => this.handlers.onClose())
    query('[data-el="resume-session"]').addEventListener('click', () => this.handlers.onResumeSession())
    query('[data-el="discard"]').addEventListener('click', () => this.showConfirm(
      'Discard this feedback?',
      'This session will be removed so you can start fresh.',
      'Discard',
      () => this.handlers.onDiscard(),
    ))
    this.copyButton.addEventListener('click', () => this.handlers.onCopy())
    query('[data-el="composer-cancel"]').addEventListener('click', () => this.handlers.onComposeCancel())
    this.composerAdd.addEventListener('click', () => this.handlers.onComposeAdd())
    this.composerText.addEventListener('input', () => {
      this.composerAdd.disabled = this.composerText.value.trim() === ''
      this.handlers.onComposeInput(this.composerText.value)
    })
    this.composerText.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        this.handlers.onComposeCancel()
      } else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault()
        event.stopPropagation()
        if (!this.composerAdd.disabled) this.handlers.onComposeAdd()
      }
    })
    query('[data-el="confirm-cancel"]').addEventListener('click', () => this.hideConfirm())
    query('[data-el="confirm-back"]').addEventListener('click', () => this.hideConfirm())
    this.confirmOkay.addEventListener('click', () => {
      const action = this.confirmAction
      this.hideConfirm()
      action?.()
    })
    this.pill.querySelectorAll<HTMLElement>('[data-tip]').forEach((element) => {
      element.addEventListener('mouseenter', () => this.showTip(element))
      element.addEventListener('mouseleave', () => this.hideTip())
    })

    this.capture.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !event.isPrimary) return
      this.capture.setPointerCapture(event.pointerId)
      this.handlers.onGestureStart({ x: event.clientX, y: event.clientY }, event.pointerId)
      event.preventDefault()
    })
    this.capture.addEventListener('pointermove', (event) => this.handlers.onGestureMove({ x: event.clientX, y: event.clientY }, event.pointerId))
    this.capture.addEventListener('pointerup', (event) => this.handlers.onGestureEnd({ x: event.clientX, y: event.clientY }, event.pointerId))
    this.capture.addEventListener('pointercancel', (event) => this.handlers.onGestureCancel(event.pointerId))

    this.list.addEventListener('dragover', (event) => {
      event.preventDefault()
      if (!this.dragCard) return
      const before = insertBeforeForY(this.list, event.clientY)
      if (before) this.list.insertBefore(this.dragCard, before)
      else this.list.appendChild(this.dragCard)
    })
    this.list.addEventListener('drop', () => {
      if (!this.dragCard) return
      const ids = Array.from(this.list.querySelectorAll<HTMLElement>('.fb-card')).map((card) => Number(card.dataset.id))
      this.handlers.onReorder(ids)
      this.dragOrder = []
    })

    this.setPhase('idle')
  }

  private template(position: 'bottom-right' | 'bottom-left'): string {
    const corner = position === 'bottom-left' ? 'pos-bl' : 'pos-br'
    return `
      <div class="fb-capture off" data-el="capture"></div>
      <div class="fb-overlay"><div class="fb-spotlight" data-el="spotlight"></div><div class="fb-selection" data-el="selection"></div><div class="fb-highlight" data-el="highlight"></div><div data-el="pins"></div></div>
      <div class="fb-widget ${corner}" data-el="widget"><button class="fb-bubble" data-el="bubble" title="Start Karen" aria-label="Start Karen">${KAREN_MARK}</button></div>
      <div class="fb-pill" data-el="pill">
        <button class="fb-hgrip" data-el="grip" data-tip="Move Karen" aria-label="Move Karen">${GRIP_SVG}</button>
        <span class="fb-mswitch" data-el="mode-switch"><span class="fb-mknob"></span><button class="fb-mopt fb-mopt-v" data-el="voice" data-tip="Voice notes" aria-label="Voice notes">${MIC_SVG}</button><button class="fb-mopt fb-mopt-t" data-el="text" data-tip="Text notes" aria-label="Text notes">${PENCIL_SVG}</button></span>
        <span class="fb-vsep"></span><span class="fb-dot"></span><span class="fb-mode-label" data-el="mode-label">voice</span><span class="fb-time" data-el="time">0:00</span><span class="fb-pstate" data-el="pause-state"></span>
        <span class="fb-vsep"></span><button class="fb-pctl" data-el="pause" data-tip="Pause" aria-label="Pause">${PAUSE_SVG}</button><button class="fb-pctl fb-clear" data-el="clear" data-tip="Clear" aria-label="Clear">${TRASH_SVG}</button><button class="fb-pctl fb-end" data-el="review" data-tip="Review feedback"><span>Review</span><span class="fb-review-count" data-el="review-count"></span></button>
      </div>
      <div class="fb-tip" data-el="tip"></div>
      <div class="fb-notice" data-el="notice"></div>
      <div class="fb-composer" data-el="composer">
        <img class="fb-region-img" data-el="composer-preview" alt="Original captured region" hidden />
        <textarea class="fb-ctext" data-el="composer-text" aria-label="Annotation" placeholder="What needs saying?" spellcheck="true"></textarea>
        <div class="fb-cstatus" data-el="composer-status"></div>
        <div class="fb-cfoot"><span class="fb-key-hint">Enter to save · Shift+Enter for newline</span><button class="fb-ccancel" data-el="composer-cancel">Cancel</button><button class="fb-cadd" data-el="composer-add" disabled>Add</button></div>
      </div>
      <div class="fb-confirm" data-el="confirm"><div class="fb-confirm-back" data-el="confirm-back"></div><div class="fb-confirm-box"><div class="fb-confirm-title" data-el="confirm-title"></div><div class="fb-confirm-msg" data-el="confirm-message"></div><div class="fb-confirm-row"><button class="fb-confirm-cancel" data-el="confirm-cancel">Cancel</button><button class="fb-confirm-ok" data-el="confirm-ok"></button></div></div></div>
      <aside class="fb-sheet" data-el="sheet" aria-hidden="true" inert><header class="fb-shead"><h2>Review with Karen</h2><button class="fb-sclose" data-el="sheet-close" aria-label="Close">×</button></header><div class="fb-slist" data-el="list"></div><footer class="fb-sfoot"><button class="fb-copy" data-el="copy">Copy feedback</button><textarea class="fb-fallback" data-el="fallback" readonly></textarea><div class="fb-sfoot-row"><button class="fb-resume" data-el="resume-session">Resume</button><button class="fb-discard" data-el="discard">Discard &amp; start over</button></div></footer></aside>
      <div class="fb-toast" data-el="toast"><span data-el="toast-text" role="status" aria-live="polite"></span><button data-el="toast-action" hidden></button></div>
      <div class="fb-pin-preview" data-el="pin-preview" role="tooltip"></div>
    `
  }

  contains(element: Element): boolean {
    return element === this.host || element.getRootNode() === this.root
  }

  setPhase(phase: Phase, starting = false): void {
    this.hidePinPreview()
    this.spotlight(null)
    this.bubble.style.display = phase === 'idle' ? 'flex' : 'none'
    this.bubble.classList.toggle('starting', starting)
    this.bubble.innerHTML = starting ? '<span class="fb-spinner"></span>' : KAREN_MARK
    this.pill.style.display = phase === 'active' ? 'flex' : 'none'
    if (phase === 'active') this.placeHud()
    this.sheet.classList.toggle('open', phase === 'review')
    this.sheet.toggleAttribute('inert', phase !== 'review')
    this.sheet.setAttribute('aria-hidden', phase === 'review' ? 'false' : 'true')
    if (phase !== 'active') {
      this.setCaptureEnabled(false)
      this.closeComposer()
      this.hideNotice()
    }
    this.hideConfirm()
    this.hideTip()
    this.positionToast()
  }

  setCaptureEnabled(enabled: boolean): void {
    this.capture.classList.toggle('off', !enabled)
  }

  elementsAt(x: number, y: number): Element[] {
    const wasOff = this.capture.classList.contains('off')
    this.capture.classList.add('off')
    const elements = document.elementsFromPoint(x, y).filter((element) => !this.contains(element))
    if (!wasOff) this.capture.classList.remove('off')
    return elements
  }

  highlight(rect: ViewportRect | null): void { place(this.highlightEl, rect) }
  spotlight(rect: ViewportRect | null): void { place(this.spotlightEl, rect) }

  setGestureRect(rect: ViewportRect | null): void {
    if (!rect) {
      this.selectionAnimation?.cancel()
      this.selectionAnimation = null
    }
    place(this.selectionEl, rect)
    this.selectionEl.classList.toggle('dragging', !!rect)
  }

  async morphSelection(from: ViewportRect, to: ViewportRect): Promise<void> {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.setGestureRect(null)
      this.highlight(to)
      return
    }
    place(this.selectionEl, from)
    this.selectionEl.classList.add('dragging')
    const dx = to.x - from.x
    const dy = to.y - from.y
    const sx = from.width ? to.width / from.width : 1
    const sy = from.height ? to.height / from.height : 1
    const animation = this.selectionEl.animate(
      [{ transform: 'none' }, { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` }],
      { duration: 180, easing: 'cubic-bezier(.23,1,.32,1)' },
    )
    this.selectionAnimation = animation
    try { await animation.finished } catch { /* interrupted */ }
    if (this.selectionAnimation !== animation) return
    this.setGestureRect(null)
    this.selectionEl.style.transform = ''
    this.highlight(to)
  }

  setMode(mode: CaptureMode): void {
    this.textMode = mode === 'text'
    this.modeSwitch.classList.toggle('text', this.textMode)
    this.pill.classList.toggle('text', this.textMode)
    this.modeLabel.textContent = mode
    this.timeElement.hidden = this.textMode
  }

  setListening(listening: boolean): void { this.pill.classList.toggle('listening', listening) }

  setPaused(paused: boolean): void {
    this.pill.classList.toggle('paused', paused)
    this.pauseButton.innerHTML = paused ? PLAY_SVG : PAUSE_SVG
    this.pauseButton.dataset.tip = paused ? 'Resume' : 'Pause'
    this.pauseButton.ariaLabel = paused ? 'Resume' : 'Pause'
    this.pauseState.textContent = paused ? 'paused' : ''
  }

  setTimer(seconds: number): void { this.timeElement.textContent = fmtTime(seconds) }

  setReviewCount(count: number): void {
    this.reviewCount.textContent = String(count)
    this.reviewCount.classList.toggle('show', count > 0)
    if (count > 0) {
      this.reviewCount.style.animation = 'none'
      void this.reviewCount.offsetWidth
      this.reviewCount.style.animation = ''
    }
    this.bubble.dataset.count = String(count)
  }

  showNotice(message: string): void {
    this.notice.textContent = message
    this.notice.style.display = 'block'
  }
  hideNotice(): void { this.notice.style.display = 'none' }

  openComposer(rect: ViewportRect, mode: CaptureMode, initial = '', editing = false): void {
    this.hideToast()
    this.composerText.value = initial
    this.composerAdd.textContent = editing ? 'Save' : 'Add'
    this.composerAdd.disabled = initial.trim() === ''
    this.composer.classList.add('open')
    this.setComposerState(mode === 'voice' ? 'preparing' : 'text')
    const width = this.composer.offsetWidth
    const height = this.composer.offsetHeight
    const gap = 10
    let left = rect.x + rect.width + gap
    if (left + width > window.innerWidth - 8) left = rect.x - width - gap
    if (left < 8) left = Math.min(rect.x, window.innerWidth - width - 8)
    let top = Math.max(8, rect.y)
    if (top + height > window.innerHeight - 8) top = window.innerHeight - height - 8
    this.composer.style.left = `${Math.max(8, left)}px`
    this.composer.style.top = `${Math.max(8, top)}px`
    this.composerText.focus()
  }

  setComposerState(state: ComposerState, message?: string): void {
    this.composerStatus.innerHTML = ''
    this.composerAdd.disabled = state === 'finalizing' || this.composerText.value.trim() === ''
    if (state === 'text') return
    if (state === 'listening') {
      this.composerStatus.innerHTML = '<span class="fb-listen-dot"></span><span>Listening — edit as you go</span>'
      return
    }
    if (state === 'preparing') this.composerStatus.textContent = message ?? 'Getting the microphone ready…'
    if (state === 'finalizing') this.composerStatus.textContent = 'Finishing your note…'
    if (state === 'unavailable') this.composerStatus.textContent = message ?? 'Voice is unavailable. You can still type.'
    if (state === 'voice-paused') {
      const label = document.createElement('span')
      label.textContent = message ?? 'Stopped after 60 seconds without speech.'
      const resume = document.createElement('button')
      resume.className = 'fb-cresume'
      resume.textContent = 'Resume'
      resume.addEventListener('click', () => this.handlers.onComposeResumeVoice())
      this.composerStatus.append(label, resume)
    }
  }

  setComposerText(text: string): void {
    const active = this.root.activeElement === this.composerText
    const start = this.composerText.selectionStart
    const end = this.composerText.selectionEnd
    this.composerText.value = text
    this.composerAdd.disabled = text.trim() === ''
    if (active) {
      const nextStart = Math.min(start, text.length)
      const nextEnd = Math.min(end, text.length)
      this.composerText.setSelectionRange(nextStart, nextEnd)
    }
  }

  getComposerText(): string { return this.composerText.value }

  setComposerPreview(blob: Blob | null): void {
    if (this.composerPreviewUrl) URL.revokeObjectURL(this.composerPreviewUrl)
    this.composerPreviewUrl = blob ? URL.createObjectURL(blob) : null
    this.composerPreview.hidden = !blob
    if (this.composerPreviewUrl) this.composerPreview.src = this.composerPreviewUrl
    else this.composerPreview.removeAttribute('src')
  }

  private clampComposer(): void {
    if (!this.composer.classList.contains('open')) return
    const rect = this.composer.getBoundingClientRect()
    this.composer.style.top = `${Math.max(8, Math.min(rect.top, innerHeight - rect.height - 8))}px`
    this.composer.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - rect.width - 8))}px`
  }

  closeComposer(): void {
    this.setComposerPreview(null)
    this.composer.classList.remove('open')
    this.composerText.value = ''
    this.composerStatus.innerHTML = ''
  }

  addPin(id: number, label: number, rect: ViewportRect): void {
    const pin = document.createElement('button')
    pin.className = 'fb-pin'
    pin.type = 'button'
    pin.ariaLabel = `Edit annotation ${label}`
    pin.textContent = String(label)
    pin.addEventListener('mouseenter', () => this.handlers.onPinHover(id, true))
    pin.addEventListener('mouseleave', () => this.handlers.onPinHover(id, false))
    pin.addEventListener('focus', () => this.handlers.onPinHover(id, true))
    pin.addEventListener('blur', () => this.handlers.onPinHover(id, false))
    pin.addEventListener('click', () => this.handlers.onPinEdit(id))
    this.pinsEl.appendChild(pin)
    this.pins.set(id, pin)
    this.updatePin(id, rect)
  }

  updatePin(id: number, rect: ViewportRect | null): void {
    const pin = this.pins.get(id)
    if (!pin || !rect) {
      if (pin) pin.style.display = 'none'
      return
    }
    pin.style.display = 'flex'
    pin.style.left = `${rect.x}px`
    pin.style.top = `${rect.y}px`
  }

  setPinLabel(id: number, label: number): void {
    const pin = this.pins.get(id)
    if (pin) pin.textContent = String(label)
    if (pin) pin.ariaLabel = `Edit annotation ${label}`
    const badge = this.list.querySelector(`[data-id="${id}"] .fb-badge`)
    if (badge) badge.textContent = String(label)
  }

  showPinPreview(note: string, rect: ViewportRect): void {
    this.pinPreview.textContent = note
    this.pinPreview.classList.add('show')
    const width = this.pinPreview.offsetWidth
    const height = this.pinPreview.offsetHeight
    this.pinPreview.style.left = `${Math.max(8, Math.min(rect.x + 18, innerWidth - width - 8))}px`
    this.pinPreview.style.top = `${Math.max(8, Math.min(rect.y + 18, innerHeight - height - 8))}px`
  }

  hidePinPreview(): void { this.pinPreview.classList.remove('show') }

  removePin(id: number): void { this.pins.get(id)?.remove(); this.pins.delete(id) }
  clearPins(): void { this.pins.forEach((pin) => pin.remove()); this.pins.clear() }
  setPinsVisible(visible: boolean): void { this.pinsEl.style.display = visible ? '' : 'none' }

  setBubbleReview(count: number): void {
    this.bubble.classList.toggle('has-review', count > 0)
    this.bubble.dataset.count = String(count)
    this.bubble.title = count > 0 ? `Reopen ${count} feedback item${count === 1 ? '' : 's'}` : 'Start Karen'
  }

  renderReview(result: SessionResult, previews: Map<number, string>): void {
    this.copyButton.classList.remove('done')
    this.copyButton.textContent = 'Copy feedback'
    this.fallback.style.display = 'none'
    const scroll = this.list.scrollTop
    this.list.innerHTML = ''
    if (!result.annotations.length) {
      const empty = document.createElement('div')
      empty.className = 'fb-empty'
      empty.textContent = 'Nothing here yet. Resume, pick something, and tell Karen what needs attention.'
      this.list.appendChild(empty)
      return
    }
    for (const annotation of result.annotations) this.list.appendChild(this.annotationCard(annotation, previews.get(annotation.id)))
    this.list.scrollTop = scroll
  }

  focusReviewNote(id: number): void {
    const note = this.list.querySelector<HTMLElement>(`[data-id="${id}"] .fb-say`)
    note?.scrollIntoView({ block: 'nearest' })
    note?.focus()
  }

  private annotationCard(annotation: Annotation, preview?: string): HTMLElement {
    const card = document.createElement('article')
    card.className = `fb-card ${annotation.target.kind === 'region' ? 'fb-card-region' : 'fb-card-element'}`
    card.dataset.id = String(annotation.id)
    const top = document.createElement('div')
    top.className = 'fb-card-top'
    const target = annotation.target
    const title = target.kind === 'element' ? target.element.component ?? `<${target.element.tag}>` : 'Region'
    top.innerHTML = `<span class="fb-badge">${annotation.n}</span><span class="fb-input">${annotation.input}</span><span class="fb-comp">${esc(title)}</span>`
    card.appendChild(top)
    if (target.kind === 'element') {
      const ref = document.createElement('div')
      ref.className = 'fb-src'
      ref.textContent = target.element.source ? srcStr(target.element.source) : target.element.selector ?? target.element.outerHTMLSnippet
      card.appendChild(ref)
    } else {
      card.appendChild(this.regionDetails(target, preview))
    }
    const note = document.createElement('div')
    note.className = 'fb-say'
    note.contentEditable = 'true'
    note.setAttribute('role', 'textbox')
    note.setAttribute('aria-label', `Annotation ${annotation.n}`)
    note.spellcheck = true
    note.textContent = annotation.note
    note.addEventListener('input', () => this.handlers.onEdit(annotation.id, note.textContent ?? ''))
    card.appendChild(note)
    this.makeDraggable(card, annotation.id)
    card.appendChild(mkButton('fb-edit', '✎', 'Reselect target', () => this.handlers.onReselect(annotation.id)))
    card.appendChild(mkButton('fb-del', '×', 'Delete item', () => this.handlers.onDelete(annotation.id)))
    card.addEventListener('mouseenter', () => !this.dragCard && this.handlers.onHover(annotation.id, true))
    card.addEventListener('mouseleave', () => this.handlers.onHover(annotation.id, false))
    return card
  }

  private regionDetails(target: RegionTarget, preview?: string): HTMLElement {
    const wrapper = document.createElement('div')
    const meta = document.createElement('div')
    meta.className = 'fb-region-meta'
    meta.textContent = `${Math.round(target.rect.width)} × ${Math.round(target.rect.height)} px · ${target.elements.length} component${target.elements.length === 1 ? '' : 's'}`
    wrapper.appendChild(meta)
    if (preview) {
      const image = document.createElement('img')
      image.className = 'fb-region-img'
      image.src = preview
      image.alt = 'Captured feedback region'
      wrapper.appendChild(image)
    }
    if (target.elements.length) {
      const components = document.createElement('details')
      components.className = 'fb-components'
      const summary = document.createElement('summary')
      summary.textContent = Array.from(
        new Set(target.elements.map((element) => element.component ?? `<${element.tag}>`)),
      ).join(' · ')
      components.appendChild(summary)
      for (const element of target.elements) {
        const source = document.createElement('div')
        source.className = 'fb-src'
        source.textContent = `${element.component ?? element.tag} · ${element.source ? srcStr(element.source) : element.selector ?? element.outerHTMLSnippet}`
        components.appendChild(source)
      }
      wrapper.appendChild(components)
    }
    return wrapper
  }

  private makeDraggable(card: HTMLElement, id: number): void {
    const grip = document.createElement('div')
    grip.className = 'fb-grip'
    grip.title = 'Drag to reorder'
    grip.textContent = '⠿'
    grip.addEventListener('pointerdown', () => { card.draggable = true })
    card.addEventListener('dragstart', (event) => {
      this.dragOrder = Array.from(this.list.querySelectorAll<HTMLElement>('.fb-card'))
      this.dragCard = card
      card.classList.add('dragging')
      event.dataTransfer?.setData('text/plain', String(id))
    })
    card.addEventListener('dragend', () => {
      for (const item of this.dragOrder) this.list.appendChild(item)
      this.dragOrder = []
      this.dragCard = null
      card.draggable = false
      card.classList.remove('dragging')
    })
    card.appendChild(grip)
  }

  setReselecting(active: boolean): void {
    this.sheet.classList.toggle('dim', active)
    if (active) this.showNotice('Pick or drag the replacement · Esc to cancel')
    else this.hideNotice()
  }

  enableYield(enabled: boolean): void {
    if (!this.dock) return
    if (enabled) window.addEventListener('mousemove', this.onYieldMove, true)
    else {
      window.removeEventListener('mousemove', this.onYieldMove, true)
      this.yielded = false
      this.sheet.classList.remove('yield')
    }
  }

  private onYieldMove = (event: MouseEvent): void => {
    const shouldYield = event.clientX < window.innerWidth - this.sheet.offsetWidth - 4
    if (shouldYield !== this.yielded) {
      this.yielded = shouldYield
      this.sheet.classList.toggle('yield', shouldYield)
    }
  }

  showCopied(): void { this.copyButton.classList.add('done'); this.copyButton.textContent = '✓ Copied' }
  setCopyBusy(busy: boolean): void {
    this.copyButton.disabled = busy
    if (busy) this.copyButton.textContent = 'Saving images…'
    else if (!this.copyButton.classList.contains('done')) this.copyButton.textContent = 'Copy feedback'
  }
  showCopyFallback(text: string): void { this.fallback.style.display = 'block'; this.fallback.value = text; this.fallback.select() }
  showToast(text: string, action?: { label: string; run: () => void }): void {
    this.hideToast()
    this.toastText.textContent = text
    this.toastAction.hidden = !action
    this.toastAction.textContent = action?.label ?? ''
    this.toastAction.onclick = action ? () => { this.hideToast(); action.run() } : null
    this.toast.classList.add('show')
    this.positionToast()
    this.toastTimer = window.setTimeout(() => this.hideToast(), action ? 7000 : 3200)
  }

  hideToast(): void {
    if (this.toastTimer != null) window.clearTimeout(this.toastTimer)
    this.toastTimer = null
    this.toast.classList.remove('show')
    this.toastAction.hidden = true
    this.toastAction.onclick = null
  }

  private positionToast(): void {
    if (!this.toast.classList.contains('show')) return
    const width = this.toast.offsetWidth
    const height = this.toast.offsetHeight
    const obstacles = [this.pill, this.composer, this.sheet].filter((el) =>
      el === this.sheet ? el.classList.contains('open') : el.getBoundingClientRect().width > 0,
    ).map((el) => el.getBoundingClientRect())
    const maxLeft = Math.max(8, innerWidth - width - 8)
    const positions = [
      { left: Math.max(8, (innerWidth - width) / 2), top: 16 },
      { left: 8, top: 16 }, { left: maxLeft, top: 16 },
      ...obstacles.map((r) => ({ left: Math.min(maxLeft, Math.max(8, r.left)), top: r.bottom + 12 })),
    ]
    const fits = (p: { left: number; top: number }) => p.top + height <= innerHeight - 8 && obstacles.every((r) =>
      p.left + width + 8 <= r.left || p.left >= r.right + 8 || p.top + height + 8 <= r.top || p.top >= r.bottom + 8,
    )
    const position = positions.find(fits) ?? positions[0]!
    this.toast.style.left = `${position.left}px`
    this.toast.style.top = `${position.top}px`
  }

  private showConfirm(title: string, message: string, okay: string, action: () => void): void {
    this.confirmTitle.textContent = title
    this.confirmMessage.textContent = message
    this.confirmOkay.textContent = okay
    this.confirmAction = action
    this.confirm.classList.add('open')
  }
  private hideConfirm(): void { this.confirmAction = null; this.confirm.classList.remove('open') }

  private showTip(element: HTMLElement): void {
    const text = element.dataset.tip
    if (!text) return
    this.tip.textContent = text
    const rect = element.getBoundingClientRect()
    const width = this.tip.offsetWidth
    const height = this.tip.offsetHeight
    this.tip.style.left = `${Math.max(6, Math.min(rect.left + rect.width / 2 - width / 2, innerWidth - width - 6))}px`
    this.tip.style.top = `${rect.top - height - 8 < 6 ? rect.bottom + 8 : rect.top - height - 8}px`
    this.tip.classList.add('show')
  }
  private hideTip(): void { this.tip.classList.remove('show') }

  private beginHudDrag(event: PointerEvent): void {
    const rect = this.pill.getBoundingClientRect()
    this.dragOffset = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
    this.pill.style.left = `${rect.left}px`; this.pill.style.top = `${rect.top}px`; this.pill.style.right = 'auto'; this.pill.style.bottom = 'auto'
    this.pill.classList.add('dragging')
    this.handlers.onHudDrag(true)
    window.addEventListener('pointermove', this.onHudMove, true)
    window.addEventListener('pointerup', this.onHudUp, true)
    event.preventDefault()
  }
  private onHudMove = (event: PointerEvent): void => {
    if (!this.dragOffset) return
    const x = Math.max(6, Math.min(event.clientX - this.dragOffset.dx, innerWidth - this.pill.offsetWidth - 6))
    const y = Math.max(6, Math.min(event.clientY - this.dragOffset.dy, innerHeight - this.pill.offsetHeight - 6))
    this.pill.style.left = `${x}px`; this.pill.style.top = `${y}px`
    this.positionToast()
  }
  private onHudUp = (): void => {
    this.dragOffset = null
    this.pill.classList.remove('dragging')
    window.removeEventListener('pointermove', this.onHudMove, true)
    window.removeEventListener('pointerup', this.onHudUp, true)
    this.savePosition()
    this.handlers.onHudDrag(false)
  }
  private placeHud(): void {
    const saved = this.loadPosition()
    if (saved) {
      this.pill.style.left = `${Math.max(6, Math.min(saved.x, innerWidth - this.pill.offsetWidth - 6))}px`
      this.pill.style.top = `${Math.max(6, Math.min(saved.y, innerHeight - this.pill.offsetHeight - 6))}px`
      this.pill.style.right = 'auto'; this.pill.style.bottom = 'auto'
    } else {
      const right = this.position === 'bottom-right'
      this.pill.style.left = right ? 'auto' : '22px'; this.pill.style.right = right ? '22px' : 'auto'; this.pill.style.top = 'auto'; this.pill.style.bottom = '22px'
    }
  }
  private loadPosition(): { x: number; y: number } | null {
    try {
      const value = JSON.parse(localStorage.getItem(HUD_POS_KEY) ?? 'null') as { x?: unknown; y?: unknown } | null
      return value && typeof value.x === 'number' && typeof value.y === 'number' ? { x: value.x, y: value.y } : null
    } catch { return null }
  }
  private savePosition(): void {
    const x = Number.parseFloat(this.pill.style.left); const y = Number.parseFloat(this.pill.style.top)
    if (!Number.isNaN(x) && !Number.isNaN(y)) try { localStorage.setItem(HUD_POS_KEY, JSON.stringify({ x, y })) } catch { /* unavailable */ }
  }

  destroy(): void {
    this.composerResize.disconnect()
    this.setComposerPreview(null)
    this.hideToast()
    this.enableYield(false)
    window.removeEventListener('pointermove', this.onHudMove, true)
    window.removeEventListener('pointerup', this.onHudUp, true)
    this.clearPins()
    this.host.remove()
  }
}
