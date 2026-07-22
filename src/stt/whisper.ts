import type { STTCallbacks, STTProvider } from '../types'

export interface WhisperOptions {
  /** ONNX Whisper model id (default 'onnx-community/whisper-base.en'). */
  model?: string
  /** Compute backend. 'auto' tries WebGPU then falls back to WASM. */
  device?: 'auto' | 'webgpu' | 'wasm'
  /** RMS threshold above which a frame counts as speech (default 0.006). */
  speechThreshold?: number
  /** Silence after speech that finalizes an utterance, ms (default 650). */
  silenceMs?: number
  /** Minimum speech to keep an utterance, ms (default 250). */
  minSpeechMs?: number
  /** Hard cap on a single utterance, seconds (default 20). */
  maxUtteranceSec?: number
  /** Emit live partial captions while speaking (default: on only for WebGPU). */
  interim?: boolean
}

const DEFAULT_MODEL = 'Xenova/whisper-base.en'
const TARGET_RATE = 16000

/**
 * Offline speech-to-text via transformers.js Whisper. Runs entirely locally
 * (model is downloaded once and cached by the browser), so it works where the
 * Web Speech API doesn't — notably Electron, and privately on the web.
 *
 * Speech is segmented by a simple energy VAD: audio between onset and a trailing
 * pause becomes one utterance, transcribed and emitted as a timestamped segment.
 * `@huggingface/transformers` must be installed by the host app.
 */
export class WhisperProvider implements STTProvider {
  readonly name = 'whisper'

  private transcriber: unknown = null
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private proc: ScriptProcessorNode | null = null
  private sink: GainNode | null = null

  private running = false
  private clock: () => number = () => 0
  private cb: STTCallbacks | null = null
  private sampleRate = TARGET_RATE

  // VAD + utterance state
  private frames: Float32Array[] = []
  private prevFrame: Float32Array | null = null
  private speaking = false
  private speechMs = 0
  private silenceMs = 0
  private uttStart = 0
  private interimEnabled = false
  private lastInterimAt = 0
  private busy = false
  private pending: Promise<void>[] = []

  constructor(private opts: WhisperOptions = {}) {}

  async isAvailable(): Promise<boolean> {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof AudioContext !== 'undefined'
    )
  }

  async start(cb: STTCallbacks, clock: () => number): Promise<void> {
    this.cb = cb
    this.clock = clock
    this.running = true

    // Signal immediately so the session extends its startup window (model load
    // and the mic-permission prompt both take longer than the default timeout).
    cb.onProgress?.('Preparing local speech model…')

    this.transcriber = await this.loadModel(cb)
    if (!this.running) return
    cb.onProgress?.('Requesting microphone…')

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })
    if (!this.running) {
      this.teardownAudio()
      return
    }

    this.ctx = new AudioContext({ sampleRate: TARGET_RATE })
    this.sampleRate = this.ctx.sampleRate
    if (this.ctx.state === 'suspended') await this.ctx.resume()

    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.proc = this.ctx.createScriptProcessor(2048, 1, 1)
    this.proc.onaudioprocess = (e) => this.onAudio(e.inputBuffer.getChannelData(0))
    // A muted sink keeps the ScriptProcessor firing without echoing the mic.
    this.sink = this.ctx.createGain()
    this.sink.gain.value = 0
    this.source.connect(this.proc)
    this.proc.connect(this.sink)
    this.sink.connect(this.ctx.destination)

    cb.onReady?.()
  }

  private async loadModel(cb: STTCallbacks): Promise<unknown> {
    let transformers: typeof import('@huggingface/transformers')
    try {
      transformers = await import('@huggingface/transformers')
    } catch {
      cb.onNotice?.('Local speech model not installed — capturing clicks only.')
      throw new Error('feedbasha: @huggingface/transformers is not installed')
    }

    const model = this.opts.model ?? DEFAULT_MODEL
    const wantGpu =
      (this.opts.device ?? 'auto') !== 'wasm' &&
      typeof navigator !== 'undefined' &&
      'gpu' in navigator
    this.interimEnabled = this.opts.interim ?? wantGpu

    let lastPct = -1
    const progress = (p: { status?: string; progress?: number }) => {
      if (!this.running) return
      if (p?.status === 'progress' && typeof p.progress === 'number') {
        const pct = Math.round(p.progress)
        if (pct !== lastPct) {
          lastPct = pct
          cb.onProgress?.(`Loading speech model… ${pct}%`)
        }
      }
    }

    const build = (device: 'webgpu' | 'wasm') =>
      transformers.pipeline('automatic-speech-recognition', model, {
        device,
        progress_callback: progress,
      })

    if (wantGpu) {
      try {
        return await build('webgpu')
      } catch {
        // WebGPU does not auto-fall-back; retry on WASM explicitly.
        if (!this.running) return null
      }
    }
    return build('wasm')
  }

  private onAudio(frame: Float32Array): void {
    if (!this.running) return
    const frameMs = (frame.length / this.sampleRate) * 1000
    const copy = frame.slice()
    const loud = rms(frame) >= (this.opts.speechThreshold ?? 0.006)

    if (loud) {
      if (!this.speaking) {
        this.speaking = true
        this.speechMs = 0
        this.silenceMs = 0
        this.uttStart = this.clock()
        if (this.prevFrame) this.frames.push(this.prevFrame) // small pre-roll
      }
      this.speechMs += frameMs
      this.silenceMs = 0
      this.frames.push(copy)
      this.maybeInterim()
    } else if (this.speaking) {
      this.silenceMs += frameMs
      this.frames.push(copy) // keep trailing audio
      if (this.silenceMs >= (this.opts.silenceMs ?? 650)) this.finalize()
    }

    if (this.speaking && this.utteranceSec() >= (this.opts.maxUtteranceSec ?? 20)) {
      this.finalize()
    }
    this.prevFrame = copy
  }

  private utteranceSec(): number {
    let n = 0
    for (const f of this.frames) n += f.length
    return n / this.sampleRate
  }

  private maybeInterim(): void {
    if (!this.interimEnabled || this.busy) return
    const now = this.clock() * 1000
    if (now - this.lastInterimAt < 1000) return
    this.lastInterimAt = now
    const audio = this.collect()
    void this.run(audio, (text) => {
      if (text) this.cb?.onInterim?.(text)
    })
  }

  private finalize(): void {
    const speech = this.speechMs
    const audio = this.collect()
    const start = this.uttStart
    const end = this.clock()
    this.speaking = false
    this.speechMs = 0
    this.silenceMs = 0
    this.frames = []
    if (speech < (this.opts.minSpeechMs ?? 250)) return

    const p = this.run(audio, (text) => {
      if (text) this.cb?.onSegment?.({ t: start, end, text })
    })
    this.pending.push(p)
    void p.finally(() => {
      this.pending = this.pending.filter((x) => x !== p)
    })
  }

  /** Concatenate the current frames and resample to 16 kHz for the model. */
  private collect(): Float32Array {
    let total = 0
    for (const f of this.frames) total += f.length
    const merged = new Float32Array(total)
    let o = 0
    for (const f of this.frames) {
      merged.set(f, o)
      o += f.length
    }
    return this.sampleRate === TARGET_RATE ? merged : resample(merged, this.sampleRate, TARGET_RATE)
  }

  private async run(audio: Float32Array, emit: (text: string) => void): Promise<void> {
    const t = this.transcriber as ((a: Float32Array) => Promise<{ text?: string }>) | null
    if (!t || audio.length === 0) return
    this.busy = true
    try {
      const out = await t(audio)
      if (this.running) emit((out?.text ?? '').trim())
    } catch {
      /* skip this chunk */
    } finally {
      this.busy = false
    }
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.speaking && this.speechMs >= (this.opts.minSpeechMs ?? 250)) {
      // flush the in-progress utterance so its text lands in the log
      const audio = this.collect()
      const start = this.uttStart
      const end = this.clock()
      this.running = true // allow this last emit through
      const p = this.run(audio, (text) => {
        if (text) this.cb?.onSegment?.({ t: start, end, text })
      })
      this.pending.push(p)
      this.running = false
    }
    this.speaking = false
    this.frames = []
    await Promise.allSettled(this.pending)
    this.teardownAudio()
  }

  dispose(): void {
    this.running = false
    this.speaking = false
    this.frames = []
    this.pending = []
    this.transcriber = null
    this.teardownAudio()
  }

  private teardownAudio(): void {
    if (this.proc) {
      this.proc.onaudioprocess = null
      try {
        this.proc.disconnect()
      } catch {
        /* noop */
      }
    }
    try {
      this.source?.disconnect()
      this.sink?.disconnect()
    } catch {
      /* noop */
    }
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close()
    this.stream?.getTracks().forEach((tr) => tr.stop())
    this.proc = null
    this.source = null
    this.sink = null
    this.ctx = null
    this.stream = null
  }
}

function rms(frame: Float32Array): number {
  let sum = 0
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i] ?? 0
    sum += v * v
  }
  return Math.sqrt(sum / (frame.length || 1))
}

/** Linear-interpolation resample (adequate for speech ASR input). */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const ratio = from / to
  const outLen = Math.round(input.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = pos - i0
    out[i] = (input[i0] ?? 0) * (1 - frac) + (input[i1] ?? 0) * frac
  }
  return out
}
