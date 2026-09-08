import { afterEach, describe, expect, it, vi } from 'vitest'
import { DraftVoice } from './voice'
import type { STTCallbacks, STTProvider } from '../types'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
class Provider implements STTProvider {
  name = 'test'
  cb: STTCallbacks = {}
  recording = false
  available = Promise.resolve()
  stopped = Promise.resolve()
  async isAvailable() { await this.available; return true }
  async start(cb: STTCallbacks) { this.cb = cb; this.recording = true; cb.onReady?.() }
  async stop() { this.recording = false; await this.stopped; this.cb.onSegment?.({ t: 1, text: 'Final words' }) }
  dispose() { this.recording = false }
}
const sink = () => ({ state: vi.fn(), interim: vi.fn(), segment: vi.fn() })

afterEach(() => vi.useRealTimers())
describe('draft voice ownership', () => {
  it('does not start after cancellation during availability', async () => {
    const p = new Provider(), gate = deferred(), output = sink()
    p.available = gate.promise
    const voice = new DraftVoice({ provider: p }, () => 0)
    const starting = voice.start(output)
    await voice.finish('voice-paused')
    gate.resolve()
    await starting
    expect(p.recording).toBe(false)
    expect(output.state).toHaveBeenLastCalledWith('voice-paused', undefined)
  })
  it('drains final words before stopping, once for concurrent finish calls', async () => {
    const p = new Provider(), gate = deferred(), output = sink()
    p.stopped = gate.promise
    const stop = vi.spyOn(p, 'stop')
    const voice = new DraftVoice({ provider: p }, () => 0)
    await voice.start(output)
    const a = voice.finish(), b = voice.finish()
    expect(p.recording).toBe(false)
    gate.resolve()
    await Promise.all([a, b])
    expect(stop).toHaveBeenCalledTimes(1)
    expect(output.segment).toHaveBeenCalledWith('Final words')
  })
  it('ignores callbacks owned by an old draft after cancel and restart', async () => {
    const p = new Provider(), first = sink(), second = sink()
    const voice = new DraftVoice({ provider: p }, () => 0)
    await voice.start(first)
    const old = p.cb
    voice.cancel()
    await voice.start(second)
    old.onSegment?.({ t: 0, text: 'Wrong draft' })
    expect(first.segment).not.toHaveBeenCalled()
    expect(second.segment).not.toHaveBeenCalled()
    voice.cancel()
  })
  it('stops at sixty seconds, including a delayed background timer check', async () => {
    vi.useFakeTimers()
    const p = new Provider(), output = sink(), voice = new DraftVoice({ provider: p }, () => 0)
    await voice.start(output)
    vi.setSystemTime(Date.now() + 60_001)
    voice.checkIdle()
    await voice.finish()
    expect(p.recording).toBe(false)
    expect(output.state).toHaveBeenLastCalledWith('voice-paused', 'Stopped after 60 seconds without speech.')
  })
})
