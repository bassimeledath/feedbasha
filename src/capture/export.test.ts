import { describe, expect, it, vi } from 'vitest'
import { CaptureExporter } from './export'
import type { SessionResult } from '../types'

describe('capture export', () => {
  it('retries failed saves without discarding feedback, then reuses the saved image', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('Disk unavailable')).mockResolvedValue('/project/.karen/captures/image.png')
    const exporter = new CaptureExporter(save)
    const result: SessionResult = { startedAt: 1, durationSec: 1, annotations: [{
      id: 1, n: 1, createdAt: 0, input: 'text', note: 'Keep this note',
      target: { kind: 'region', rect: { x: 1, y: 2, width: 3, height: 4 }, elements: [], screenshot: { blob: new Blob(['pixels']) } },
    }] }
    await expect(exporter.prepare(result)).rejects.toThrow('Disk unavailable')
    expect(result.annotations[0]?.note).toBe('Keep this note')
    await exporter.prepare(result)
    await exporter.prepare(result)
    expect(save).toHaveBeenCalledTimes(2)
  })
})
