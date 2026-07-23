import type { ActionEvent, SessionResult, SourceLocation, SpeechEvent } from '../types'
import { fmtTime } from '../util/time'
import { CSS } from './styles'

export interface WidgetHandlers {
  onStart(): void
  onStop(): void
  onClear(): void
  onTogglePause(): void
  onToggleMode(): void
  onResume(): void
  onClose(): void
  onCopy(): void
  onDiscard(): void
  onDelete(id: number): void
  onEdit(id: number, text: string): void
  onReorder(ids: number[]): void
  onReselect(id: number): void
  onHover(id: number, on: boolean): void
  onComposeAdd(text: string): void
  onComposeCancel(): void
  onHudDrag(active: boolean): void
}

export type Phase = 'idle' | 'starting' | 'recording' | 'review'
export type CaptureMode = 'voice' | 'clickonly' | 'text'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const MIC_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/></svg>`
const PAUSE_SVG = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`
const PLAY_SVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5l12 7-12 7z"/></svg>`
const PENCIL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`
const GRIP_SVG = `<svg viewBox="0 0 12 18" fill="currentColor"><circle cx="3" cy="3" r="1.6"/><circle cx="9" cy="3" r="1.6"/><circle cx="3" cy="9" r="1.6"/><circle cx="9" cy="9" r="1.6"/><circle cx="3" cy="15" r="1.6"/><circle cx="9" cy="15" r="1.6"/></svg>`
const TRASH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`
const HUD_POS_KEY = 'feedbasha:hud-pos'

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => {
    const m: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
    return m[c] ?? c
  })
}

function srcStr(s: SourceLocation): string {
  const line = s.lineNumber != null ? `:${s.lineNumber}` : ''
  const col = s.lineNumber != null && s.columnNumber != null ? `:${s.columnNumber}` : ''
  return `${s.fileName}${line}${col}`
}

/** The card that the dragged item should be inserted before, given a cursor Y. */
function afterElement(container: HTMLElement, y: number): HTMLElement | null {
  const cards = Array.from(container.querySelectorAll<HTMLElement>('.fb-card:not(.dragging)'))
  let closest: { offset: number; el: HTMLElement | null } = { offset: -Infinity, el: null }
  for (const el of cards) {
    const box = el.getBoundingClientRect()
    const offset = y - box.top - box.height / 2
    if (offset < 0 && offset > closest.offset) closest = { offset, el }
  }
  return closest.el
}

function place(el: HTMLElement, rect: Rect | null): void {
  if (!rect) {
    el.style.display = 'none'
    return
  }
  el.style.display = 'block'
  el.style.left = `${rect.x}px`
  el.style.top = `${rect.y}px`
  el.style.width = `${rect.width}px`
  el.style.height = `${rect.height}px`
}

function mkBtn(cls: string, html: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = cls
  b.title = title
  b.innerHTML = html
  b.addEventListener('click', onClick)
  return b
}

function mkDel(onClick: () => void): HTMLButtonElement {
  return mkBtn('fb-del', '&#10005;', 'Delete this item', onClick)
}

/** All widget UI lives in a Shadow DOM host, isolated from (and excluded from) the page. */
export class Widget {
  private host: HTMLElement
  private pins = new Map<number, HTMLElement>()
  private dragEl: HTMLElement | null = null
  private yielded = false

  private dragOff: { dx: number; dy: number } | null = null

  private highlightEl: HTMLElement
  private spotlightEl: HTMLElement
  private pinsEl: HTMLElement
  private widgetEl: HTMLElement
  private bubble: HTMLElement
  private pill: HTMLElement
  private grip: HTMLElement
  private pauseBtn: HTMLElement
  private dot: HTMLElement
  private tip: HTMLElement
  private mswitch: HTMLElement
  private mvoice: HTMLButtonElement
  private mtext: HTMLButtonElement
  private textActive = false
  private confirm: HTMLElement
  private confirmTitle: HTMLElement
  private confirmMsg: HTMLElement
  private confirmOk: HTMLButtonElement
  private confirmAction: (() => void) | null = null
  private pstate: HTMLElement
  private modelbl: HTMLElement
  private timeEl: HTMLElement
  private caption: HTMLElement
  private captext: HTMLElement
  private notice: HTMLElement
  private composer: HTMLElement
  private cbadge: HTMLElement
  private csrc: HTMLElement
  private ctext: HTMLTextAreaElement
  private caddBtn: HTMLButtonElement
  private sheet: HTMLElement
  private slist: HTMLElement
  private copyBtn: HTMLButtonElement
  private fallback: HTMLTextAreaElement
  private resumeBtn: HTMLElement
  private discardBtn: HTMLElement
  private toast: HTMLElement
  private toasttext: HTMLElement

  constructor(
    private position: 'bottom-right' | 'bottom-left',
    private dock: boolean,
    private h: WidgetHandlers,
  ) {
    this.host = document.createElement('div')
    this.host.setAttribute('data-feedbasha', '')
    const root = this.host.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = CSS
    root.appendChild(style)

    const tree = document.createElement('div')
    tree.className = 'fb-host'
    tree.innerHTML = this.template(position)
    root.appendChild(tree)
    document.body.appendChild(this.host)

    const q = <T extends HTMLElement>(sel: string): T => tree.querySelector(sel) as T
    this.highlightEl = q('[data-el="highlight"]')
    this.spotlightEl = q('[data-el="spotlight"]')
    this.pinsEl = q('[data-el="pins"]')
    this.widgetEl = q('[data-el="widget"]')
    this.bubble = q('[data-el="bubble"]')
    this.pill = q('[data-el="pill"]')
    this.grip = q('[data-el="grip"]')
    this.pauseBtn = q('[data-el="pause"]')
    this.dot = q('[data-el="dot"]')
    this.tip = q('[data-el="tip"]')
    this.mswitch = q('[data-el="mswitch"]')
    this.mvoice = q<HTMLButtonElement>('[data-el="mvoice"]')
    this.mtext = q<HTMLButtonElement>('[data-el="mtext"]')
    this.confirm = q('[data-el="confirm"]')
    this.confirmTitle = q('[data-el="confirm-title"]')
    this.confirmMsg = q('[data-el="confirm-msg"]')
    this.confirmOk = q<HTMLButtonElement>('[data-el="confirm-ok"]')
    this.pstate = q('[data-el="pstate"]')
    this.modelbl = q('[data-el="modelbl"]')
    this.timeEl = q('[data-el="time"]')
    this.caption = q('[data-el="caption"]')
    this.captext = q('[data-el="captext"]')
    this.notice = q('[data-el="notice"]')
    this.composer = q('[data-el="composer"]')
    this.cbadge = q('[data-el="cbadge"]')
    this.csrc = q('[data-el="csrc"]')
    this.ctext = q<HTMLTextAreaElement>('[data-el="ctext"]')
    this.caddBtn = q<HTMLButtonElement>('[data-el="cadd"]')
    this.sheet = q('[data-el="sheet"]')
    this.slist = q('[data-el="slist"]')
    this.copyBtn = q<HTMLButtonElement>('[data-el="copy"]')
    this.fallback = q<HTMLTextAreaElement>('[data-el="fallback"]')
    this.resumeBtn = q('[data-el="resume"]')
    this.discardBtn = q('[data-el="discard"]')
    this.toast = q('[data-el="toast"]')
    this.toasttext = q('[data-el="toasttext"]')

    this.bubble.addEventListener('click', () => this.h.onStart())
    this.pauseBtn.addEventListener('click', () => this.h.onTogglePause())
    // Sliding switch: clicking the inactive side flips the mode.
    this.mvoice.addEventListener('click', () => {
      if (this.textActive) this.h.onToggleMode()
    })
    this.mtext.addEventListener('click', () => {
      if (!this.textActive) this.h.onToggleMode()
    })
    this.grip.addEventListener('mousedown', (e) => this.beginDrag(e))
    // Custom HUD tooltips (native `title` is too slow / feels broken on an overlay).
    this.pill.querySelectorAll<HTMLElement>('[data-tip]').forEach((el) => {
      el.addEventListener('mouseenter', () => this.showTip(el))
      el.addEventListener('mouseleave', () => this.hideTip())
    })
    q<HTMLElement>('[data-el="end"]').addEventListener('click', () => this.h.onStop())
    q<HTMLElement>('[data-el="clear"]').addEventListener('click', () =>
      this.showConfirm(
        'Clear this transcript?',
        "This deletes everything you've captured in this session and can't be undone.",
        'Clear transcript',
        () => this.h.onClear(),
      ),
    )
    q<HTMLElement>('[data-el="confirm-cancel"]').addEventListener('click', () => this.hideConfirm())
    q<HTMLElement>('[data-el="confirm-back"]').addEventListener('click', () => this.hideConfirm())
    q<HTMLElement>('[data-el="confirm-ok"]').addEventListener('click', () => {
      const act = this.confirmAction
      this.hideConfirm()
      act?.()
    })
    q('[data-el="sclose"]').addEventListener('click', () => this.h.onClose())
    this.copyBtn.addEventListener('click', () => this.h.onCopy())
    this.resumeBtn.addEventListener('click', () => this.h.onResume())
    // "Discard & start over" is destructive (wipes the session) — confirm first.
    this.discardBtn.addEventListener('click', () =>
      this.showConfirm(
        'Discard this session?',
        "This permanently deletes everything you've captured. You can't undo this.",
        'Discard & start over',
        () => this.h.onDiscard(),
      ),
    )

    // Text-mode composer wiring.
    this.caddBtn.addEventListener('click', () => this.h.onComposeAdd(this.ctext.value))
    q('[data-el="ccancel"]').addEventListener('click', () => this.h.onComposeCancel())
    this.ctext.addEventListener('input', () => {
      this.caddBtn.disabled = this.ctext.value.trim() === ''
    })
    this.ctext.addEventListener('keydown', (e) => {
      // Enter commits; Shift+Enter inserts a newline. Esc is handled by the session.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (this.ctext.value.trim()) this.h.onComposeAdd(this.ctext.value)
      }
    })

    // Drag-to-reorder within the review list.
    this.slist.addEventListener('dragover', (e) => {
      if (!this.dragEl) return
      e.preventDefault()
      const after = afterElement(this.slist, e.clientY)
      if (after == null) this.slist.appendChild(this.dragEl)
      else this.slist.insertBefore(this.dragEl, after)
    })
    this.slist.addEventListener('drop', (e) => {
      if (!this.dragEl) return
      e.preventDefault()
      const ids = Array.from(this.slist.querySelectorAll<HTMLElement>('.fb-card')).map((c) =>
        Number(c.dataset.eid),
      )
      this.h.onReorder(ids)
    })

    this.setPhase('idle')
  }

  private template(position: 'bottom-right' | 'bottom-left'): string {
    const pos = position === 'bottom-left' ? 'pos-bl' : 'pos-br'
    return `
      <div class="fb-overlay"><div class="fb-spotlight" data-el="spotlight"></div><div class="fb-highlight" data-el="highlight"></div><div data-el="pins"></div></div>
      <div class="fb-widget ${pos}" data-el="widget">
        <div class="fb-bubble" data-el="bubble" title="Start feedback session">${MIC_SVG}</div>
      </div>
      <div class="fb-pill" data-el="pill"><button class="fb-hgrip" data-el="grip" aria-label="Drag to move">${GRIP_SVG}</button><span class="fb-mswitch" data-el="mswitch"><span class="fb-mknob"></span><button class="fb-mopt fb-mopt-v" data-el="mvoice" data-tip="Voice mode">${MIC_SVG}</button><button class="fb-mopt fb-mopt-t" data-el="mtext" data-tip="Text mode">${PENCIL_SVG}</button></span><span class="fb-vsep"></span><span class="fb-dot" data-el="dot" data-tip="Recording"></span><span class="fb-time" data-el="time" data-tip="Elapsed time">0:00</span><span class="fb-modelbl" data-el="modelbl"></span><span class="fb-pstate" data-el="pstate"></span><span class="fb-vsep"></span><button class="fb-pctl" data-el="pause" data-tip="Pause">${PAUSE_SVG}</button><span class="fb-vsep"></span><button class="fb-pctl fb-clear" data-el="clear" data-tip="Clear">${TRASH_SVG}</button><span class="fb-vsep"></span><button class="fb-pctl fb-end" data-el="end" data-tip="You can resume after"><span>Review</span> &#9656;</button></div>
      <div class="fb-tip" data-el="tip"></div>
      <div class="fb-confirm" data-el="confirm">
        <div class="fb-confirm-back" data-el="confirm-back"></div>
        <div class="fb-confirm-box">
          <div class="fb-confirm-title" data-el="confirm-title">Clear this transcript?</div>
          <div class="fb-confirm-msg" data-el="confirm-msg"></div>
          <div class="fb-confirm-row">
            <button class="fb-confirm-cancel" data-el="confirm-cancel">Cancel</button>
            <button class="fb-confirm-ok" data-el="confirm-ok">Clear transcript</button>
          </div>
        </div>
      </div>
      <div class="fb-composer" data-el="composer">
        <div class="fb-chead"><span class="fb-cbadge" data-el="cbadge">${PENCIL_SVG}</span><span class="fb-csrc" data-el="csrc"></span></div>
        <textarea class="fb-ctext" data-el="ctext" placeholder="Add a note about this element…" spellcheck="false"></textarea>
        <div class="fb-cfoot"><button class="fb-ccancel" data-el="ccancel" title="Cancel (Esc)">Cancel</button><button class="fb-cadd" data-el="cadd" title="Add note (Enter)" disabled>Add &#9656;</button></div>
      </div>
      <div class="fb-caption" data-el="caption"><span class="lbl">listening</span><span data-el="captext"></span></div>
      <div class="fb-notice" data-el="notice"></div>
      <div class="fb-sheet" data-el="sheet">
        <div class="fb-shead"><h2>Review your feedback</h2><button class="fb-sclose" data-el="sclose" title="Close (keeps this session, mic reopens it)">&#10005;</button></div>
        <div class="fb-slist" data-el="slist"></div>
        <div class="fb-sfoot">
          <button class="fb-copy" data-el="copy">Copy feedback</button>
          <textarea class="fb-fallback" data-el="fallback" readonly></textarea>
          <div class="fb-sfoot-row">
            <button class="fb-resume" data-el="resume">&#8635; Resume recording</button>
            <button class="fb-discard" data-el="discard" title="Deletes this session and starts fresh">Discard &amp; start over</button>
          </div>
        </div>
      </div>
      <div class="fb-toast" data-el="toast"><span class="ok">&#10003;</span> <span data-el="toasttext"></span></div>
    `
  }

  contains(el: Element): boolean {
    return el === this.host || this.host.contains(el)
  }

  setPhase(p: Phase): void {
    this.bubble.classList.remove('starting')
    this.bubble.style.display = p === 'idle' || p === 'starting' ? 'flex' : 'none'
    this.bubble.innerHTML = p === 'starting' ? '<div class="fb-spinner"></div>' : MIC_SVG
    if (p === 'starting') this.bubble.classList.add('starting')
    this.pill.style.display = p === 'recording' ? 'flex' : 'none'
    if (p === 'recording') this.placeHud()
    this.caption.style.display = 'none'
    this.notice.style.display = 'none'
    this.hideConfirm() // any phase change dismisses a pending confirm
    this.hideTip()
    if (p !== 'recording') this.closeComposer()
    if (p !== 'review') this.sheet.classList.remove('open')
    if (p === 'idle') this.captext.textContent = ''
  }

  /** Open a confirmation modal for a destructive action (Clear or Discard). */
  showConfirm(title: string, message: string, okLabel: string, onConfirm: () => void): void {
    this.confirmTitle.textContent = title
    this.confirmMsg.textContent = message
    this.confirmOk.textContent = okLabel
    this.confirmAction = onConfirm
    this.confirm.classList.add('open')
  }

  hideConfirm(): void {
    this.confirmAction = null
    this.confirm.classList.remove('open')
  }

  setMode(mode: CaptureMode): void {
    this.caption.style.display = mode === 'voice' ? 'block' : 'none'
    this.notice.style.display = mode === 'clickonly' || mode === 'text' ? 'block' : 'none'
    this.pill.classList.toggle('text', mode === 'text')
    this.pill.classList.toggle('clickonly', mode === 'clickonly')
    // Persistent HUD chip so the active capture mode is always legible — including
    // the click-only degradation (mic unavailable), which a fading notice hides.
    this.modelbl.textContent = mode === 'text' ? 'text' : mode === 'clickonly' ? 'clicks only' : ''
    if (mode === 'text') this.notice.textContent = 'Click any element to annotate it'
    this.dot.dataset.tip =
      mode === 'text' ? 'Text mode' : mode === 'clickonly' ? 'Clicks only' : 'Recording'
    // Slide the switch knob + highlight the active side (text vs voice/click-only).
    this.textActive = mode === 'text'
    this.mswitch.classList.toggle('text', mode === 'text')
  }

  setPaused(on: boolean): void {
    this.pill.classList.toggle('paused', on)
    this.pauseBtn.innerHTML = on ? PLAY_SVG : PAUSE_SVG
    this.pauseBtn.dataset.tip = on ? 'Resume' : 'Pause'
    this.pstate.textContent = on ? 'paused' : ''
    if (on) this.dot.dataset.tip = 'Paused'
    if (on) this.caption.style.display = 'none'
  }

  setTimer(sec: number): void {
    this.timeEl.textContent = fmtTime(sec)
  }

  setCaption(text: string): void {
    this.captext.textContent = text
  }

  setNotice(text: string): void {
    this.notice.textContent = text
    this.notice.style.display = 'block'
  }

  addPin(id: number, label: number, rect: Rect): void {
    const p = document.createElement('div')
    p.className = 'fb-pin'
    p.textContent = String(label)
    p.style.left = `${rect.x}px`
    p.style.top = `${rect.y}px`
    this.pinsEl.appendChild(p)
    this.pins.set(id, p)
  }

  updatePin(id: number, rect: Rect | null): void {
    const p = this.pins.get(id)
    if (!p) return
    if (!rect) {
      p.style.display = 'none'
      return
    }
    p.style.display = ''
    p.style.left = `${rect.x}px`
    p.style.top = `${rect.y}px`
  }

  removePin(id: number): void {
    const p = this.pins.get(id)
    if (p) {
      p.remove()
      this.pins.delete(id)
    }
  }

  clearPins(): void {
    this.pins.forEach((p) => p.remove())
    this.pins.clear()
  }

  /** Hide/show the on-page pins without discarding them (used when the review
   *  is closed to the idle bubble but the session is kept). */
  setPinsVisible(on: boolean): void {
    this.pinsEl.style.display = on ? '' : 'none'
  }

  /** Mark the idle mic as reopening a kept-but-closed review. */
  setBubbleReopen(on: boolean): void {
    this.bubble.classList.toggle('has-review', on)
    this.bubble.title = on ? 'Reopen your feedback' : 'Start feedback session'
  }

  /** Show a custom tooltip above (or below, if clipped) a HUD control. */
  private showTip(el: HTMLElement): void {
    const text = el.dataset.tip
    if (!text) return
    this.tip.textContent = text
    const r = el.getBoundingClientRect()
    const tw = this.tip.offsetWidth
    const th = this.tip.offsetHeight
    const left = Math.max(6, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 6))
    let top = r.top - th - 8
    if (top < 6) top = r.bottom + 8 // flip below when near the top edge
    this.tip.style.left = `${left}px`
    this.tip.style.top = `${top}px`
    this.tip.classList.add('show')
  }

  private hideTip(): void {
    this.tip.classList.remove('show')
  }

  // ---- Draggable HUD: remembered position (localStorage) or default corner ----

  /** Position the HUD at its remembered spot, or the default corner. */
  private placeHud(): void {
    const p = this.loadPos()
    if (p) {
      this.pill.style.left = `${p.x}px`
      this.pill.style.top = `${p.y}px`
      this.pill.style.right = 'auto'
      this.pill.style.bottom = 'auto'
      this.clampHud()
    } else {
      const br = this.position !== 'bottom-left'
      this.pill.style.left = br ? 'auto' : '22px'
      this.pill.style.right = br ? '22px' : 'auto'
      this.pill.style.top = 'auto'
      this.pill.style.bottom = '22px'
    }
  }

  /** Keep a left/top-positioned HUD inside the viewport. */
  private clampHud(): void {
    const x = parseFloat(this.pill.style.left)
    const y = parseFloat(this.pill.style.top)
    if (Number.isNaN(x) || Number.isNaN(y)) return
    const w = this.pill.offsetWidth
    const h = this.pill.offsetHeight
    this.pill.style.left = `${Math.max(6, Math.min(x, window.innerWidth - w - 6))}px`
    this.pill.style.top = `${Math.max(6, Math.min(y, window.innerHeight - h - 6))}px`
  }

  private beginDrag(e: MouseEvent): void {
    const r = this.pill.getBoundingClientRect()
    this.dragOff = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    this.pill.style.left = `${r.left}px`
    this.pill.style.top = `${r.top}px`
    this.pill.style.right = 'auto'
    this.pill.style.bottom = 'auto'
    this.pill.classList.add('dragging')
    this.hideTip()
    this.h.onHudDrag(true)
    window.addEventListener('mousemove', this.onDragMove, true)
    window.addEventListener('mouseup', this.onDragUp, true)
    e.preventDefault()
  }

  private onDragMove = (e: MouseEvent): void => {
    if (!this.dragOff) return
    const w = this.pill.offsetWidth
    const h = this.pill.offsetHeight
    const x = Math.max(6, Math.min(e.clientX - this.dragOff.dx, window.innerWidth - w - 6))
    const y = Math.max(6, Math.min(e.clientY - this.dragOff.dy, window.innerHeight - h - 6))
    this.pill.style.left = `${x}px`
    this.pill.style.top = `${y}px`
    e.preventDefault()
  }

  private onDragUp = (): void => {
    if (!this.dragOff) return
    this.dragOff = null
    this.pill.classList.remove('dragging')
    window.removeEventListener('mousemove', this.onDragMove, true)
    window.removeEventListener('mouseup', this.onDragUp, true)
    this.savePos()
    this.h.onHudDrag(false)
  }

  private loadPos(): { x: number; y: number } | null {
    try {
      const raw = localStorage.getItem(HUD_POS_KEY)
      if (!raw) return null
      const p = JSON.parse(raw) as { x?: unknown; y?: unknown }
      if (typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x, y: p.y }
    } catch {
      /* storage unavailable / malformed */
    }
    return null
  }

  private savePos(): void {
    const x = parseFloat(this.pill.style.left)
    const y = parseFloat(this.pill.style.top)
    if (Number.isNaN(x) || Number.isNaN(y)) return
    try {
      localStorage.setItem(HUD_POS_KEY, JSON.stringify({ x, y }))
    } catch {
      /* storage unavailable */
    }
  }

  highlight(rect: Rect | null): void {
    place(this.highlightEl, rect)
  }

  /** Dramatic focus: dims the rest of the page, leaving the target bright + ringed. */
  spotlight(rect: Rect | null): void {
    place(this.spotlightEl, rect)
  }

  /** Read the composer's current text (used to cache a draft on dismissal). */
  getComposerDraft(): string {
    return this.ctext.value
  }

  /** Open the note composer anchored beside the given element rect (text mode).
   *  `initial` pre-fills a cached draft when re-opening the same element. */
  openComposer(rect: Rect, header: string, initial = ''): void {
    this.csrc.textContent = header
    this.ctext.value = initial
    this.caddBtn.disabled = initial.trim() === ''
    this.composer.style.display = 'block'
    // Measure, then place: right of the element, flipping to left/below if clipped.
    const w = this.composer.offsetWidth
    const h = this.composer.offsetHeight
    const gap = 10
    let left = rect.x + rect.width + gap
    if (left + w > window.innerWidth - 8) left = rect.x - w - gap
    if (left < 8) left = Math.min(rect.x, window.innerWidth - w - 8)
    let top = rect.y
    if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8
    this.composer.style.left = `${Math.max(8, left)}px`
    this.composer.style.top = `${Math.max(8, top)}px`
    // Restart the grow-in animation on each open (it otherwise only runs on mount).
    this.composer.style.animation = 'none'
    void this.composer.offsetWidth
    this.composer.style.animation = ''
    this.ctext.focus()
  }

  /** Update the composer's source label once the element context resolves. */
  setComposerHeader(header: string): void {
    if (this.composer.style.display !== 'none') this.csrc.textContent = header
  }

  closeComposer(): void {
    this.composer.style.display = 'none'
    this.ctext.value = ''
  }

  /**
   * Let the panel yield to the app: while the review panel is open, fade it out
   * and make it click-through whenever the cursor is over the app (left of the
   * panel), snapping it back when the cursor returns to the right edge. Works on
   * any host layout — unlike a reflow "push", which full-viewport app shells
   * (fixed / 100vw) ignore.
   */
  enableYield(on: boolean): void {
    if (!this.dock) return
    if (on) {
      window.addEventListener('mousemove', this.onYieldMove, true)
    } else {
      window.removeEventListener('mousemove', this.onYieldMove, true)
      this.yielded = false
      this.sheet.classList.remove('yield')
    }
  }

  private onYieldMove = (e: MouseEvent): void => {
    // Fade once the cursor is left of the panel's leading edge (over the app).
    const left = window.innerWidth - this.sheet.offsetWidth
    const should = e.clientX < left - 4
    if (should !== this.yielded) {
      this.yielded = should
      this.sheet.classList.toggle('yield', should)
    }
  }

  renderReview(result: SessionResult): void {
    this.setPhase('review')
    this.sheet.classList.add('open')

    this.copyBtn.classList.remove('done')
    this.copyBtn.textContent = 'Copy feedback'
    this.fallback.style.display = 'none'

    const scroll = this.slist.scrollTop
    this.slist.innerHTML = ''

    if (result.events.length === 0) {
      const e = document.createElement('div')
      e.className = 'fb-empty'
      e.textContent =
        'Nothing was captured. Resume to keep talking, or start a new session.'
      this.slist.appendChild(e)
      return
    }

    for (const ev of result.events) {
      this.slist.appendChild(ev.kind === 'speech' ? this.speechCard(ev) : this.actionCard(ev))
    }
    this.slist.scrollTop = scroll
  }

  /** Add a drag handle + drag wiring so a card can be reordered. */
  private makeDraggable(card: HTMLElement, id: number): void {
    card.dataset.eid = String(id)
    const grip = document.createElement('div')
    grip.className = 'fb-grip'
    grip.title = 'drag to reorder'
    grip.innerHTML = '&#10303;'
    grip.addEventListener('mousedown', () => (card.draggable = true))
    grip.addEventListener('mouseup', () => (card.draggable = false))
    card.addEventListener('dragstart', (e) => {
      this.dragEl = card
      card.classList.add('dragging')
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', String(id))
      }
    })
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging')
      card.draggable = false
      this.dragEl = null
    })
    card.appendChild(grip)
  }

  /** An editable card for something the user said. */
  private speechCard(ev: SpeechEvent): HTMLElement {
    const card = document.createElement('div')
    card.className = 'fb-card fb-card-speech'
    this.makeDraggable(card, ev.id)
    card.appendChild(mkDel(() => this.h.onDelete(ev.id)))

    const time = document.createElement('span')
    time.className = 'fb-ctime'
    time.textContent = fmtTime(ev.t)
    card.appendChild(time)

    const body = document.createElement('div')
    body.className = 'fb-say'
    body.contentEditable = 'true'
    body.spellcheck = false
    body.title = 'Click to edit'
    body.textContent = ev.text
    body.addEventListener('input', () => this.h.onEdit(ev.id, body.textContent ?? ''))
    card.appendChild(body)
    return card
  }

  /** A card marking an element the user selected. */
  private actionCard(ev: ActionEvent): HTMLElement {
    const el = ev.element
    const card = document.createElement('div')
    card.className = 'fb-card fb-card-action'
    const label = el.component ? esc(el.component) : `&lt;${esc(el.tag)}&gt;`
    const refText = el.source ? srcStr(el.source) : (el.selector ?? el.outerHTMLSnippet)
    // The element's own text is context (muted, labelled) — NOT the user's words,
    // so it must not look like a transcript quote.
    const said = el.text ? `<div class="fb-eltext">element text: &ldquo;${esc(el.text)}&rdquo;</div>` : ''
    card.innerHTML =
      `<div class="top"><span class="fb-badge">${ev.n}</span>` +
      `<span class="fb-ctime">${fmtTime(ev.t)}</span>` +
      `<span class="fb-comp">${label}</span></div>` +
      `<div class="fb-src">${esc(refText)}</div>${said}`
    // A typed note (text mode) is editable inline, like a speech card.
    if (ev.note != null) {
      const note = document.createElement('div')
      note.className = 'fb-say'
      note.contentEditable = 'true'
      note.spellcheck = false
      note.textContent = ev.note
      note.addEventListener('input', () => this.h.onEdit(ev.id, note.textContent ?? ''))
      card.appendChild(note)
    }
    this.makeDraggable(card, ev.id)
    card.appendChild(mkBtn('fb-edit', '&#9998;', 'reselect element', () => this.h.onReselect(ev.id)))
    card.appendChild(mkDel(() => this.h.onDelete(ev.id)))
    // Hovering a card spotlights the element it points to, on the page.
    card.addEventListener('mouseenter', () => {
      if (!this.dragEl) this.h.onHover(ev.id, true)
    })
    card.addEventListener('mouseleave', () => this.h.onHover(ev.id, false))
    return card
  }

  /** Toggle the one-shot reselect mode (dims the sheet, shows a hint). */
  setReselecting(on: boolean, hint = 'Click the correct element · Esc to cancel'): void {
    this.sheet.classList.toggle('dim', on)
    if (on) {
      this.notice.textContent = hint
      this.notice.style.display = 'block'
    } else {
      this.notice.style.display = 'none'
    }
  }

  showCopied(): void {
    this.copyBtn.classList.add('done')
    this.copyBtn.textContent = '✓ Copied'
  }

  showToast(text: string): void {
    this.toasttext.textContent = text
    this.toast.classList.add('show')
    window.setTimeout(() => this.toast.classList.remove('show'), 2600)
  }

  showCopyFallback(text: string): void {
    this.fallback.style.display = 'block'
    this.fallback.value = text
    this.fallback.focus()
    this.fallback.select()
    this.showToast('Copy blocked. Select the text and copy manually.')
  }

  destroy(): void {
    this.enableYield(false)
    window.removeEventListener('mousemove', this.onDragMove, true)
    window.removeEventListener('mouseup', this.onDragUp, true)
    this.clearPins()
    this.host.remove()
  }
}
