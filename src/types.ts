// Public + internal types for feedbasha (thin-loop MVP).

export type STTProviderName = 'auto' | 'webspeech'

export interface STTOptions {
  /** Which speech-to-text backend to use. Default 'auto' (Web Speech where available). */
  provider?: STTProviderName
  /** BCP-47 language hint, e.g. 'en-US'. */
  language?: string
}

export interface FeedbashaConfig {
  stt?: STTOptions
  /** Widget corner. Default 'bottom-right'. */
  position?: 'bottom-right' | 'bottom-left'
  /** Called after the user copies. `markdown` is redacted; `session` is raw local data. */
  onCopy?: (markdown: string, session: SessionResult) => void
  /** Optionally scrub the assembled context before it is copied. */
  redact?: (text: string) => string
}

export interface SourceLocation {
  fileName: string
  lineNumber?: number
  columnNumber?: number
}

/** A snapshot of a single DOM element + its React context, taken at selection time. */
export interface ElementContext {
  /** React component display name (no angle brackets), if resolvable. */
  component?: string
  /** Named component ancestors, inner → outer (best-effort). */
  componentTree: string[]
  source?: SourceLocation
  tag: string
  attributes: Record<string, string>
  text?: string
  rect: { x: number; y: number; width: number; height: number }
  /** Stable CSS selector, used as a fallback when source is unavailable. */
  selector?: string
  /** Compact HTML preview, e.g. `<button class="btn">Place order</button>`. */
  outerHTMLSnippet: string
}

/** One entry in the chronological session log. The log is the whole model:
 *  what the user said and what they selected, in the exact order it happened. */
export type SessionEvent = SpeechEvent | ActionEvent

export interface SpeechEvent {
  id: number
  kind: 'speech'
  /** Seconds from session start. */
  t: number
  text: string
}

export interface ActionEvent {
  id: number
  kind: 'action'
  /** Seconds from session start. */
  t: number
  /** Display ordinal shown on the on-screen pin and the review card. */
  n: number
  element: ElementContext
}

export interface SessionResult {
  startedAt: number
  durationSec: number
  /** Speech + element selections, ordered by time. */
  events: SessionEvent[]
}

// ---- STT provider contract (kept intentionally tiny) ----

export interface STTSegmentEvent {
  /** Seconds from session start. */
  t: number
  end?: number
  text: string
}

export interface STTCallbacks {
  /** Fired once audio capture is actually live. */
  onReady?: () => void
  /** Live partial text for the caption (may be called many times). */
  onInterim?: (text: string) => void
  /** A finalized, timestamped segment. */
  onSegment?: (seg: STTSegmentEvent) => void
  /** Non-fatal status/notice (e.g. "mic blocked"). */
  onNotice?: (message: string) => void
}

export interface STTProvider {
  readonly name: string
  isAvailable(): Promise<boolean>
  /** Begin capturing. `clock` returns elapsed seconds from session start. */
  start(cb: STTCallbacks, clock: () => number): Promise<void>
  /** Stop capturing; resolves once all final segments have been emitted. */
  stop(): Promise<void>
  dispose(): void
}
