import type { RegionAsset, SessionResult } from '../types'

/** Save through Karen's optional localhost Vite integration. */
export async function saveLocalCapture(blob: Blob): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch('/_karen/captures', {
      method: 'POST', headers: { 'Content-Type': blob.type, 'X-Karen-Capture': '1' },
      body: blob, signal: controller.signal,
    })
    if (!response.ok) throw new Error('Screenshot saving failed. Check the Karen development-server integration.')
    const data = await response.json() as { reference?: unknown }
    if (typeof data.reference !== 'string' || !data.reference.trim()) throw new Error('No screenshot path returned.')
    return data.reference
  } finally { clearTimeout(timeout) }
}

export class CaptureExporter {
  private saved = new WeakMap<Blob, Promise<string>>()
  constructor(private save: (blob: Blob) => Promise<string>) {}

  private reference(asset: RegionAsset): Promise<string> {
    if (asset.reference) return Promise.resolve(asset.reference)
    let pending = this.saved.get(asset.blob)
    if (!pending) {
      pending = this.save(asset.blob).then((path) => {
        if (!path.trim()) throw new Error('No screenshot path returned.')
        asset.reference = path
        return path
      }).catch((error) => { this.saved.delete(asset.blob); throw error })
      this.saved.set(asset.blob, pending)
    }
    return pending
  }

  async prepare(result: SessionResult): Promise<void> {
    await Promise.all(result.annotations.map(async ({ target }) => {
      if (target.kind === 'region' && target.screenshot) await this.reference(target.screenshot)
    }))
  }
}
