import { describe, expect, it, vi } from 'vitest'
import { WhisperProvider } from './whisper'

describe('Whisper asynchronous ownership', () => {
  it('suppresses a disposed inference and serializes later jobs', async () => {
    const provider = new WhisperProvider() as any
    let resolve!: (value: { text: string }) => void
    const model = vi.fn(() => new Promise<{ text: string }>((done) => { resolve = done }))
    provider.transcriber = model
    const first = vi.fn(), second = vi.fn(), third = vi.fn()
    const old = provider.run(new Float32Array([1]), first)
    await Promise.resolve()
    provider.dispose()
    provider.transcriber = model
    const next = provider.run(new Float32Array([2]), second)
    const last = provider.run(new Float32Array([3]), third)
    expect(model).toHaveBeenCalledTimes(1)
    resolve({ text: 'Old result' })
    await old
    await Promise.resolve()
    expect(first).not.toHaveBeenCalled()
    expect(model).toHaveBeenCalledTimes(2)
    resolve({ text: 'Second result' })
    await next
    await Promise.resolve()
    expect(second).toHaveBeenCalledWith('Second result')
    resolve({ text: 'Third result' })
    await last
    expect(third).toHaveBeenCalledWith('Third result')
  })

  it('releases a microphone permission result received after disposal', async () => {
    const provider = new WhisperProvider() as any
    provider.loadModel = async () => () => Promise.resolve({ text: '' })
    let resolve!: (stream: unknown) => void
    const stop = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: () => new Promise((done) => { resolve = done }),
    } })
    const starting = provider.start({}, () => 0)
    await Promise.resolve()
    provider.dispose()
    resolve({ getTracks: () => [{ stop }] })
    await starting
    expect(stop).toHaveBeenCalledTimes(1)
    expect(provider.stream).toBeNull()
  })
})
