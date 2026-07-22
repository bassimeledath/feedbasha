import type { STTProvider, STTCallbacks } from '../types'

// The Web Speech API is not in the standard TS DOM lib; type it loosely.
type AnyRecognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onstart: (() => void) | null
  onresult: ((e: any) => void) | null
  onerror: ((e: any) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

function RecognitionCtor(): (new () => AnyRecognition) | null {
  const w = window as any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function isElectron(): boolean {
  return typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent)
}

const TERMINAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported'])

function noticeFor(err: string): string {
  if (err === 'not-allowed' || err === 'service-not-allowed')
    return 'Microphone blocked — capturing clicks only.'
  if (err === 'audio-capture') return 'No microphone found — capturing clicks only.'
  if (err === 'network') return 'Speech service unreachable — capturing clicks only.'
  return 'Speech recognition unavailable — capturing clicks only.'
}

/**
 * Live speech-to-text via the browser's SpeechRecognition. Timestamps are
 * stamped against the session clock at final-result time (an acknowledged
 * approximation; the future Whisper provider will use audio time).
 */
export class WebSpeechProvider implements STTProvider {
  readonly name = 'webspeech'
  private rec: AnyRecognition | null = null
  private running = false
  private clock: () => number = () => 0

  constructor(private lang = 'en-US') {}

  async isAvailable(): Promise<boolean> {
    return !!RecognitionCtor() && !isElectron()
  }

  async start(cb: STTCallbacks, clock: () => number): Promise<void> {
    const Ctor = RecognitionCtor()
    if (!Ctor) throw new Error('Web Speech API unavailable')
    this.clock = clock
    this.running = true

    const rec = new Ctor()
    this.rec = rec
    rec.lang = this.lang
    rec.continuous = true
    rec.interimResults = true

    rec.onstart = () => cb.onReady?.()

    rec.onresult = (e: any) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        const text: string = res?.[0]?.transcript ?? ''
        if (res?.isFinal) {
          const clean = text.trim()
          if (clean) cb.onSegment?.({ t: this.clock(), text: clean })
        } else {
          interim += text
        }
      }
      const trimmed = interim.trim()
      if (trimmed) cb.onInterim?.(trimmed)
    }

    rec.onerror = (e: any) => {
      const err = String(e?.error ?? '')
      if (TERMINAL.has(err)) {
        this.running = false
        try {
          rec.stop()
        } catch {
          /* noop */
        }
        cb.onNotice?.(noticeFor(err))
      }
      // transient ('no-speech' / 'aborted'): onend re-arms below
    }

    rec.onend = () => {
      if (!this.running) return
      try {
        rec.start()
      } catch {
        this.running = false
        cb.onNotice?.('Speech recognition stopped — capturing clicks only.')
      }
    }

    rec.start()
  }

  /** Resolve after Web Speech delivers its final result(s), or a bounded timeout. */
  async stop(): Promise<void> {
    const rec = this.rec
    this.running = false
    if (!rec) return
    await new Promise<void>((resolve) => {
      let settled = false
      let to = 0
      const finish = () => {
        if (settled) return
        settled = true
        window.clearTimeout(to)
        rec.onstart = null
        rec.onresult = null
        rec.onerror = null
        rec.onend = null
        this.rec = null
        resolve()
      }
      // keep onresult until `finish` so the final segment is still emitted
      rec.onend = finish
      to = window.setTimeout(finish, 1500)
      try {
        rec.stop()
      } catch {
        finish()
      }
    })
  }

  pause(): void {
    this.running = false // stops the onend auto-restart
    try {
      this.rec?.stop()
    } catch {
      /* noop */
    }
  }

  resume(): void {
    if (!this.rec) return
    this.running = true
    try {
      this.rec.start()
    } catch {
      /* noop */
    }
  }

  dispose(): void {
    this.running = false
    const rec = this.rec
    this.rec = null
    if (rec) {
      rec.onstart = null
      rec.onresult = null
      rec.onerror = null
      rec.onend = null
      try {
        rec.abort()
      } catch {
        /* noop */
      }
    }
  }
}
