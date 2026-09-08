/** Public contracts for Karen's target-first feedback model. */

export type STTProviderName = 'auto' | 'webspeech'

export interface STTOptions {
  /** Speech backend. Custom providers keep heavyweight STT out of the core bundle. */
  provider?: STTProviderName | STTProvider
  /** BCP-47 language hint, e.g. `en-US`. */
  language?: string
}

export interface ViewportRect {
  x: number
  y: number
  width: number
  height: number
}

/** A host-produced screenshot for a dragged region. */
export interface RegionAsset {
  blob: Blob
  /** Durable host path or URL to include in copied Markdown. */
  reference?: string
}

export interface FeedbashaConfig {
  stt?: STTOptions
  /** Widget corner. Default `bottom-right`. */
  position?: 'bottom-right' | 'bottom-left'
  /** Let the review panel yield to the host app when the pointer leaves it. */
  dock?: boolean
  /** Optional host screenshot adapter, called only for multi-component regions. */
  captureRegion?: (rect: ViewportRect) => Promise<RegionAsset | null>
  /** Persist a PNG on Copy; defaults to the optional Karen localhost Vite integration. */
  saveCapture?: (blob: Blob) => Promise<string>
  /** Called after copy. Markdown is redacted; the session contains raw local data. */
  onCopy?: (markdown: string, session: SessionResult) => void
  /** Optionally scrub assembled text before it is copied. */
  redact?: (text: string) => string
}

export interface SourceLocation {
  fileName: string
  lineNumber?: number
  columnNumber?: number
}

/** A serializable DOM/React snapshot taken at selection time. */
export interface ElementContext {
  component?: string
  componentTree: string[]
  source?: SourceLocation
  tag: string
  attributes: Record<string, string>
  text?: string
  rect: ViewportRect
  selector?: string
  outerHTMLSnippet: string
}

export interface ElementTarget {
  kind: 'element'
  element: ElementContext
}

export interface RegionTarget {
  kind: 'region'
  rect: ViewportRect
  /** Viewport at capture time; bounds above are relative to this viewport. */
  viewport?: { width: number; height: number; scrollX: number; scrollY: number; devicePixelRatio: number; url: string }
  screenshot: RegionAsset | null
  /** Deduplicated metadata for meaningful components involved in the region. */
  elements: ElementContext[]
}

export type AnnotationTarget = ElementTarget | RegionTarget

export interface Annotation {
  id: number
  /** Display ordinal shown in the pin and review card. */
  n: number
  /** Seconds from session start. */
  createdAt: number
  input: 'text' | 'voice'
  target: AnnotationTarget
  /** Editable user feedback, whether typed or transcribed. */
  note: string
}

export interface SessionResult {
  startedAt: number
  durationSec: number
  annotations: Annotation[]
}

// ---- STT provider contract ----

export interface STTSegmentEvent {
  t: number
  end?: number
  text: string
}

export interface STTCallbacks {
  onReady?: () => void
  onInterim?: (text: string) => void
  onSegment?: (seg: STTSegmentEvent) => void
  /** Actual detected speech/audio activity; used for Karen's idle safety stop. */
  onActivity?: () => void
  onNotice?: (message: string) => void
  onProgress?: (message: string) => void
}

export interface STTProvider {
  readonly name: string
  isAvailable(): Promise<boolean>
  start(cb: STTCallbacks, clock: () => number): Promise<void>
  /** Stop and flush final segments. */
  stop(): Promise<void>
  pause?(): void
  resume?(): void
  dispose(): void
}
