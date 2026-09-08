import type { STTOptions, STTProvider } from '../types'
import { createProvider } from '../stt'

export type VoiceState = 'off' | 'preparing' | 'listening' | 'voice-paused' | 'finalizing' | 'unavailable'
interface VoiceSink {
  state(state: VoiceState, message?: string): void
  interim(text: string): void
  segment(text: string): void
}
interface Run {
  provider: STTProvider | null
  sink: VoiceSink
  state: VoiceState
  timer?: ReturnType<typeof setTimeout>
  lastActivity: number
  drain?: Promise<void>
}

/** Owns one microphone lifetime. Normal stop drains; cancel invalidates immediately. */
export class DraftVoice {
  private run: Run | null = null
  constructor(private options: STTOptions | undefined, private clock: () => number) {}

  async start(sink: VoiceSink): Promise<void> {
    this.cancel()
    const run: Run = { provider: null, sink, state: 'preparing', lastActivity: Date.now() }
    this.run = run
    sink.state('preparing')
    try {
      const provider = await createProvider(this.options)
      if (this.run !== run) return
      if (!provider) throw new Error('Voice is unavailable. You can still type.')
      run.provider = provider
      await provider.start({
        onReady: () => {
          if (this.run !== run || run.state !== 'preparing') return
          this.setState(run, 'listening')
          this.activity(run)
        },
        onProgress: (message) => {
          if (this.run === run && run.state === 'preparing') sink.state('preparing', message)
        },
        onActivity: () => this.activity(run),
        onInterim: (text) => {
          if (this.run !== run) return
          this.activity(run)
          sink.interim(text)
        },
        onSegment: (segment) => {
          if (this.run === run) sink.segment(segment.text)
        },
        onNotice: (message) => this.fail(run, message),
      }, this.clock)
    } catch (error) {
      this.fail(run, error instanceof Error ? error.message : 'Voice is unavailable. You can still type.')
    }
  }

  private setState(run: Run, state: VoiceState, message?: string): void {
    run.state = state
    run.sink.state(state, message)
  }

  private fail(run: Run, message: string): void {
    if (this.run !== run) return
    this.cancel()
    run.sink.state('unavailable', message)
  }

  private activity(run: Run): void {
    if (this.run !== run || run.state !== 'listening') return
    run.lastActivity = Date.now()
    clearTimeout(run.timer)
    run.timer = setTimeout(() => this.checkIdle(), 60_000)
  }

  /** Also called on visibility changes, where background timers may have been throttled. */
  checkIdle(): void {
    const run = this.run
    if (!run || run.state !== 'listening') return
    if (Date.now() - run.lastActivity >= 60_000) void this.finish('voice-paused', 'Stopped after 60 seconds without speech.')
  }

  finish(next: VoiceState = 'off', message?: string): Promise<void> {
    const run = this.run
    if (!run) return Promise.resolve()
    if (run.drain) return run.drain
    clearTimeout(run.timer)
    if (run.state === 'preparing') {
      this.cancel()
      run.sink.state(next, message)
      return Promise.resolve()
    }
    this.setState(run, 'finalizing')
    run.drain = this.drain(run, next, message)
    return run.drain
  }

  private async drain(run: Run, next: VoiceState, message?: string): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        run.provider?.stop(),
        new Promise<void>((resolve) => { timeout = setTimeout(resolve, 30_000) }),
      ])
    } catch { /* Keep the editable transcript if the provider cannot finalize. */ }
    finally { clearTimeout(timeout) }
    if (this.run !== run) return
    this.cancel()
    run.sink.state(next, message)
  }

  cancel(): void {
    const run = this.run
    this.run = null
    if (!run) return
    clearTimeout(run.timer)
    run.provider?.dispose()
  }
}
