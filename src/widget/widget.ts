import type { SessionResult, SourceLocation } from '../types'
import { fmtTime } from '../util/time'
import { CSS } from './styles'

export interface WidgetHandlers {
  onStart(): void
  onStop(): void
  onCopy(): void
  onDiscard(): void
  onDelete(id: number): void
}

export type Phase = 'idle' | 'starting' | 'recording' | 'review'
export type CaptureMode = 'voice' | 'clickonly'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const MIC_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/></svg>`

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

/** All widget UI lives in a Shadow DOM host, isolated from (and excluded from) the page. */
export class Widget {
  private host: HTMLElement
  private pins = new Map<number, HTMLElement>()

  private highlightEl: HTMLElement
  private pinsEl: HTMLElement
  private widgetEl: HTMLElement
  private bubble: HTMLElement
  private pill: HTMLElement
  private timeEl: HTMLElement
  private caption: HTMLElement
  private captext: HTMLElement
  private notice: HTMLElement
  private sheet: HTMLElement
  private slist: HTMLElement
  private copyBtn: HTMLButtonElement
  private fallback: HTMLTextAreaElement
  private discardBtn: HTMLElement
  private toast: HTMLElement
  private toasttext: HTMLElement

  constructor(
    position: 'bottom-right' | 'bottom-left',
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
    this.pinsEl = q('[data-el="pins"]')
    this.widgetEl = q('[data-el="widget"]')
    this.bubble = q('[data-el="bubble"]')
    this.pill = q('[data-el="pill"]')
    this.timeEl = q('[data-el="time"]')
    this.caption = q('[data-el="caption"]')
    this.captext = q('[data-el="captext"]')
    this.notice = q('[data-el="notice"]')
    this.sheet = q('[data-el="sheet"]')
    this.slist = q('[data-el="slist"]')
    this.copyBtn = q<HTMLButtonElement>('[data-el="copy"]')
    this.fallback = q<HTMLTextAreaElement>('[data-el="fallback"]')
    this.discardBtn = q('[data-el="discard"]')
    this.toast = q('[data-el="toast"]')
    this.toasttext = q('[data-el="toasttext"]')

    this.bubble.addEventListener('click', () => this.h.onStart())
    this.pill.addEventListener('click', () => this.h.onStop())
    this.copyBtn.addEventListener('click', () => this.h.onCopy())
    this.discardBtn.addEventListener('click', () => this.h.onDiscard())

    this.setPhase('idle')
  }

  private template(position: 'bottom-right' | 'bottom-left'): string {
    const pos = position === 'bottom-left' ? 'pos-bl' : 'pos-br'
    return `
      <div class="fb-overlay"><div class="fb-highlight" data-el="highlight"></div><div data-el="pins"></div></div>
      <div class="fb-widget ${pos}" data-el="widget">
        <div class="fb-bubble" data-el="bubble" title="Start feedback session">${MIC_SVG}</div>
        <div class="fb-pill" data-el="pill" title="End session"><span class="fb-dot"></span><span class="fb-time" data-el="time">0:00</span><span class="fb-endlbl">End &#9656;</span></div>
      </div>
      <div class="fb-caption" data-el="caption"><span class="lbl">listening</span><span data-el="captext"></span></div>
      <div class="fb-notice" data-el="notice"></div>
      <div class="fb-sheet" data-el="sheet">
        <div class="fb-shead"><h2>Review your feedback</h2><p>Talk freely; delete anything you didn't mean. Speech recognition is provided by your browser and may be processed by its service.</p></div>
        <div class="fb-slist" data-el="slist"></div>
        <div class="fb-sfoot">
          <button class="fb-copy" data-el="copy">Copy feedback</button>
          <textarea class="fb-fallback" data-el="fallback" readonly></textarea>
          <button class="fb-discard" data-el="discard">start a new session</button>
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
    this.caption.style.display = 'none'
    this.notice.style.display = 'none'
    if (p !== 'review') this.sheet.classList.remove('open')
    if (p === 'idle') this.captext.textContent = ''
  }

  setMode(mode: CaptureMode): void {
    this.caption.style.display = mode === 'voice' ? 'block' : 'none'
    this.notice.style.display = mode === 'clickonly' ? 'block' : 'none'
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

  addPin(id: number, rect: Rect): void {
    const p = document.createElement('div')
    p.className = 'fb-pin'
    p.textContent = String(id)
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

  highlight(rect: Rect | null): void {
    if (!rect) {
      this.highlightEl.style.display = 'none'
      return
    }
    this.highlightEl.style.display = 'block'
    this.highlightEl.style.left = `${rect.x}px`
    this.highlightEl.style.top = `${rect.y}px`
    this.highlightEl.style.width = `${rect.width}px`
    this.highlightEl.style.height = `${rect.height}px`
  }

  renderReview(result: SessionResult): void {
    this.setPhase('review')
    this.sheet.classList.add('open')

    this.copyBtn.classList.remove('done')
    this.copyBtn.textContent = 'Copy feedback'
    this.fallback.style.display = 'none'

    const scroll = this.slist.scrollTop
    this.slist.innerHTML = ''

    if (result.transcript.length === 0 && result.annotations.length === 0) {
      const e = document.createElement('div')
      e.className = 'fb-empty'
      e.textContent = 'Nothing was captured this session. Start a new one to try again.'
      this.slist.appendChild(e)
      this.slist.scrollTop = scroll
      return
    }

    const tx = document.createElement('div')
    tx.className = 'fb-tx'
    if (result.transcript.length === 0) {
      tx.innerHTML = `<span style="color:#94a3b8">No speech captured.</span>`
    } else {
      tx.innerHTML = result.transcript
        .map((s) => {
          const marks = s.annotationIds?.length
            ? ' ' + s.annotationIds.map((id) => `<span class="mk">[#${id}]</span>`).join('')
            : ''
          return `[${fmtTime(s.t)}] ${esc(s.text)}${marks}`
        })
        .join('<br>')
    }
    this.slist.appendChild(tx)

    if (result.annotations.length === 0) {
      const e = document.createElement('div')
      e.className = 'fb-empty'
      e.textContent = 'No pinned elements — talk-only feedback is fine.'
      this.slist.appendChild(e)
    }

    for (const a of result.annotations) {
      const item = document.createElement('div')
      item.className = 'fb-item'
      const label = a.element.component ? esc(a.element.component) : `&lt;${esc(a.element.tag)}&gt;`
      const refText = a.element.source
        ? srcStr(a.element.source)
        : (a.element.selector ?? a.element.outerHTMLSnippet)
      const said = a.transcript
        ? `<div class="fb-said"><b>near:</b> "${esc(a.transcript)}"</div>`
        : ''
      item.innerHTML =
        `<button class="fb-del" title="remove">&#10005;</button>` +
        `<div class="top"><span class="fb-badge">${a.id}</span><span class="fb-comp">${label}</span></div>` +
        `<div class="fb-src">${esc(refText)}</div>${said}`
      const del = item.querySelector('.fb-del')
      if (del) del.addEventListener('click', () => this.h.onDelete(a.id))
      this.slist.appendChild(item)
    }

    this.slist.scrollTop = scroll
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
    this.showToast('Copy blocked — select the text and copy manually')
  }

  destroy(): void {
    this.clearPins()
    this.host.remove()
  }
}
