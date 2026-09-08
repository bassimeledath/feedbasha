import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { init, type FeedbashaInstance } from '../index'
import type { STTCallbacks, STTProvider } from '../types'

vi.mock('react-grab/primitives', () => ({
  getElementContext: async (element: Element) => ({
    componentName: element.getAttribute('data-component') ?? 'DemoButton',
    filePath: 'src/App.tsx',
    lineNumber: 42,
    selector: '#target',
    htmlPreview: '<button id="target">Send</button>',
    stack: [],
  }),
}))

class FakeProvider implements STTProvider {
  readonly name = 'fake'
  starts = 0
  stops = 0
  callbacks: STTCallbacks | null = null
  constructor(private available = true) {}
  async isAvailable() { return this.available }
  async start(callbacks: STTCallbacks) {
    this.starts++
    this.callbacks = callbacks
    callbacks.onReady?.()
  }
  async stop() { this.stops++ }
  pause() {}
  resume() {}
  dispose() {}
}

const flush = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve()
}

describe('target-first session', () => {
  let instance: FeedbashaInstance | null = null
  let target: HTMLButtonElement

  beforeEach(() => {
    document.body.innerHTML = '<button id="target" data-component="DemoButton">Send</button>'
    target = document.querySelector('#target') as HTMLButtonElement
    target.getBoundingClientRect = () => ({ x: 40, y: 50, width: 120, height: 44, top: 50, left: 40, right: 160, bottom: 94, toJSON: () => ({}) })
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [target, document.body] })
  })

  afterEach(() => {
    instance?.destroy()
    instance = null
    vi.useRealTimers()
  })

  function shadow(): ShadowRoot {
    return (document.querySelector('[data-karen]') as HTMLElement).shadowRoot as ShadowRoot
  }

  async function selectTarget(): Promise<void> {
    const capture = shadow().querySelector('[data-el="capture"]') as HTMLElement
    ;(capture as any).setPointerCapture = () => {}
    capture.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, isPrimary: true, clientX: 60, clientY: 70, bubbles: true }))
    capture.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 60, clientY: 70, bubbles: true }))
    await flush()
  }

  it('does not start voice until a target is selected, then commits one editable annotation', async () => {
    const provider = new FakeProvider()
    instance = init({ stt: { provider } })
    ;(shadow().querySelector('[data-el="bubble"]') as HTMLElement).click()
    expect(provider.starts).toBe(0)

    await selectTarget()
    expect(provider.starts).toBe(1)
    provider.callbacks?.onSegment?.({ t: 1, text: 'Make this button warmer' })
    const textarea = shadow().querySelector('[data-el="composer-text"]') as HTMLTextAreaElement
    expect(textarea.value).toBe('Make this button warmer')

    ;(shadow().querySelector('[data-el="composer-add"]') as HTMLButtonElement).click()
    await flush()
    expect((shadow().querySelector('[data-el="review-count"]') as HTMLElement).textContent).toBe('1')

    ;(shadow().querySelector('[data-el="review"]') as HTMLButtonElement).click()
    await flush()
    expect(shadow().querySelector('.fb-say')?.textContent).toBe('Make this button warmer')
    expect(shadow().querySelector('.fb-src')?.textContent).toContain('src/App.tsx:42')
  })

  it('stops after a minute without speech and resumes on the same draft', async () => {
    vi.useFakeTimers()
    const provider = new FakeProvider()
    instance = init({ stt: { provider } })
    ;(shadow().querySelector('[data-el="bubble"]') as HTMLElement).click()
    await selectTarget()
    provider.callbacks?.onSegment?.({ t: 1, text: 'Keep this draft' })

    await vi.advanceTimersByTimeAsync(60_001)
    expect(provider.stops).toBe(1)
    expect((shadow().querySelector('[data-el="composer-text"]') as HTMLTextAreaElement).value).toBe('Keep this draft')
    const resume = shadow().querySelector('.fb-cresume') as HTMLButtonElement
    expect(resume.textContent).toBe('Resume')
    resume.click()
    await flush()
    expect(provider.starts).toBe(2)
  })

  it('keeps the same composer editable when voice is unavailable', async () => {
    const provider = new FakeProvider(false)
    instance = init({ stt: { provider } })
    ;(shadow().querySelector('[data-el="bubble"]') as HTMLElement).click()
    await selectTarget()

    expect(provider.starts).toBe(0)
    expect(shadow().querySelector('[data-el="composer-status"]')?.textContent).toContain('Voice is unavailable')
    const textarea = shadow().querySelector('[data-el="composer-text"]') as HTMLTextAreaElement
    textarea.value = 'Typed fallback'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    expect((shadow().querySelector('[data-el="composer-add"]') as HTMLButtonElement).disabled).toBe(false)
  })

  it('Review flushes an interim-only spoken note before checking whether it is empty', async () => {
    const provider = new FakeProvider()
    provider.stop = async () => { provider.callbacks?.onSegment?.({ t: 1, text: 'Finished spoken note' }) }
    instance = init({ stt: { provider } })
    await instance.start()
    await selectTarget()
    provider.callbacks?.onInterim?.('Unfinished spoken note')
    expect((shadow().querySelector('[data-el="composer-text"]') as HTMLTextAreaElement).value).toBe('Unfinished spoken note')
    await instance.stop()
    expect(shadow().querySelector('.fb-say')?.textContent).toBe('Finished spoken note')
  })

  it('preserves a user correction of provisional speech when its final result arrives', async () => {
    const provider = new FakeProvider()
    instance = init({ stt: { provider } })
    await instance.start()
    await selectTarget()
    provider.callbacks?.onInterim?.('Wrong words')
    typeNote(shadow().querySelector('[data-el="composer-text"]') as HTMLTextAreaElement, 'My correction')
    provider.callbacks?.onSegment?.({ t: 1, text: 'Wrong words finalized' })
    await instance.stop()
    expect(shadow().querySelector('.fb-say')?.textContent).toBe('My correction')
  })

  it('does not reopen Review after destroying a session during pending finalization', async () => {
    const provider = new FakeProvider()
    let finish!: () => void
    provider.stop = () => new Promise<void>((resolve) => { finish = resolve })
    instance = init({ stt: { provider } })
    await instance.start()
    await selectTarget()
    provider.callbacks?.onInterim?.('Pending note')
    const stopping = instance.stop()
    instance.destroy()
    finish()
    await stopping
    expect(document.querySelector('[data-karen]')).toBeNull()
  })

  it('Reset wins over an older Review finalization and permits a fresh draft', async () => {
    const provider = new FakeProvider()
    let finish!: () => void
    provider.stop = () => new Promise<void>((resolve) => { finish = resolve })
    instance = init({ stt: { provider } })
    await instance.start()
    await selectTarget()
    provider.callbacks?.onInterim?.('Old note')
    const reviewing = instance.stop()
    ;(shadow().querySelector('[data-el="clear"]') as HTMLButtonElement).click()
    ;(shadow().querySelector('[data-el="confirm-ok"]') as HTMLButtonElement).click()
    await instance.start()
    ;(shadow().querySelector('[data-el="text"]') as HTMLButtonElement).click()
    await selectTarget()
    finish()
    await reviewing
    expect(shadow().querySelector('.fb-sheet.open')).toBeNull()
    expect(shadow().querySelector('.fb-composer.open')).not.toBeNull()
    expect(shadow().querySelectorAll('.fb-pin')).toHaveLength(0)
  })

  async function startTextDraft() {
    instance = init({ stt: { provider: new FakeProvider() } })
    ;(shadow().querySelector('[data-el="bubble"]') as HTMLElement).click()
    ;(shadow().querySelector('[data-el="text"]') as HTMLElement).click()
    await selectTarget()
    return shadow().querySelector('[data-el="composer-text"]') as HTMLTextAreaElement
  }

  function typeNote(textarea: HTMLTextAreaElement, text: string) {
    textarea.value = text
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  }

  it('dismisses without saving and restores the last draft through Undo or the same element', async () => {
    const textarea = await startTextDraft()
    typeNote(textarea, 'Keep my unfinished thought')
    await selectTarget() // Outside click dismisses; it must not select again in the same gesture.
    expect(shadow().querySelector('.fb-composer.open')).toBeNull()
    expect(shadow().querySelectorAll('.fb-pin')).toHaveLength(0)
    ;(shadow().querySelector('[data-el="toast-action"]') as HTMLButtonElement).click()
    expect(textarea.value).toBe('Keep my unfinished thought')
    await selectTarget()
    await selectTarget()
    expect(textarea.value).toBe('Keep my unfinished thought')
    expect(shadow().querySelector('.fb-composer.open')).not.toBeNull()
  })

  it('Enter saves, Shift+Enter and IME composition do not, and clicking a pin edits without duplicating', async () => {
    const textarea = await startTextDraft()
    typeNote(textarea, 'Original feedback')
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
    expect(shadow().querySelectorAll('.fb-pin')).toHaveLength(0)
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flush()
    const pin = shadow().querySelector('.fb-pin') as HTMLButtonElement
    pin.dispatchEvent(new MouseEvent('mouseenter'))
    expect(shadow().querySelector('.fb-pin-preview')?.textContent).toBe('Original feedback')
    expect((shadow().querySelector('[data-el="spotlight"]') as HTMLElement).style.display).toBe('block')
    pin.click()
    await flush()
    expect(textarea.value).toBe('Original feedback')
    typeNote(textarea, 'Edited feedback')
    ;(shadow().querySelector('[data-el="composer-add"]') as HTMLButtonElement).click()
    await flush()
    expect(shadow().querySelectorAll('.fb-pin')).toHaveLength(1)
    await instance!.stop()
    expect(shadow().querySelector('.fb-say')?.textContent).toBe('Edited feedback')
  })

  it('hides the text timer and closing review immediately resumes capture', async () => {
    const textarea = await startTextDraft()
    expect((shadow().querySelector('[data-el="time"]') as HTMLElement).hidden).toBe(true)
    typeNote(textarea, 'One item')
    await instance!.stop()
    ;(shadow().querySelector('[data-el="sheet-close"]') as HTMLButtonElement).click()
    expect(shadow().querySelector('.fb-sheet.open')).toBeNull()
    expect(shadow().querySelector('.fb-capture.off')).toBeNull()
    expect(shadow().querySelectorAll('.fb-pin')).toHaveLength(1)
  })

  it('can select another target after reselecting a saved annotation', async () => {
    const textarea = await startTextDraft()
    typeNote(textarea, 'Reselect this')
    await instance!.stop()
    ;(shadow().querySelector('.fb-edit') as HTMLButtonElement).click()
    await selectTarget()
    ;(shadow().querySelector('[data-el="sheet-close"]') as HTMLButtonElement).click()
    await selectTarget()
    expect(shadow().querySelector('.fb-composer.open')).not.toBeNull()
  })

  it('Escape cancels the composer without opening Review, and Backspace deletion stays active', async () => {
    const textarea = await startTextDraft()
    typeNote(textarea, 'Cancel this')
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }))
    await flush()
    expect(shadow().querySelector('.fb-sheet.open')).toBeNull()
    expect(shadow().querySelector('.fb-composer.open')).toBeNull()
    await selectTarget()
    typeNote(textarea, 'Delete this later')
    ;(shadow().querySelector('[data-el="composer-add"]') as HTMLButtonElement).click()
    await flush()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }))
    expect(shadow().querySelectorAll('.fb-pin')).toHaveLength(0)
    expect(shadow().querySelector('.fb-sheet.open')).toBeNull()
    expect(shadow().querySelector('.fb-capture.off')).toBeNull()
  })
})
