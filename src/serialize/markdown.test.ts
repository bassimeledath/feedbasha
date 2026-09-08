import { describe, expect, it } from 'vitest'
import { toMarkdown } from './markdown'
import type { SessionResult } from '../types'

describe('Karen Markdown', () => {
  it('serializes one block per annotation with input and target metadata', () => {
    const result: SessionResult = {
      startedAt: 1,
      durationSec: 64,
      annotations: [
        {
          id: 1,
          n: 1,
          createdAt: 2,
          input: 'voice',
          note: 'Tighten this spacing',
          target: {
            kind: 'element',
            element: {
              component: 'PaymentPanel',
              componentTree: [],
              source: { fileName: 'src/App.tsx', lineNumber: 24 },
              tag: 'section',
              attributes: {},
              rect: { x: 0, y: 0, width: 200, height: 100 },
              outerHTMLSnippet: '<section>',
            },
          },
        },
        {
          id: 2,
          n: 2,
          createdAt: 4,
          input: 'text',
          note: 'These controls feel disconnected',
          target: {
            kind: 'region',
            rect: { x: 10, y: 20, width: 300, height: 180 },
            screenshot: { blob: new Blob(), reference: '/tmp/region-2.png' },
            elements: [],
          },
        },
      ],
    }
    const markdown = toMarkdown(result)
    expect(markdown).toContain('# Karen feedback — 1:04, 2 items')
    expect(markdown).toContain('## 1. PaymentPanel — voice')
    expect(markdown).toContain('Source: src/App.tsx:24')
    expect(markdown).toContain('## 2. Region — text')
    expect(markdown).toContain('Screenshot: /tmp/region-2.png')
  })

  it('applies redaction after assembling the whole document', () => {
    const result: SessionResult = { startedAt: 1, durationSec: 0, annotations: [] }
    expect(toMarkdown(result, (text) => text.replace('Karen', '[tool]'))).toContain('# [tool] feedback')
  })

  it('distinguishes a local preview from an attached screenshot and includes viewport context', () => {
    const result: SessionResult = { startedAt: 1, durationSec: 1, annotations: [{
      id: 1, n: 1, createdAt: 0, input: 'text', note: 'Change the spacing',
      target: { kind: 'region', rect: { x: 20, y: 30, width: 100, height: 80 },
        viewport: { width: 1200, height: 800, scrollX: 0, scrollY: 200, devicePixelRatio: 2, url: 'http://localhost:5174/' },
        screenshot: { blob: new Blob() }, elements: [] },
    }] }
    const markdown = toMarkdown(result)
    expect(markdown).toContain('captured locally; not attached to this text export')
    expect(markdown).toContain('1200×800 CSS px; scroll: 0, 200; pixel ratio: 2')
    expect(markdown).toContain('Page: http://localhost:5174/')
    expect(markdown).not.toContain('blob:')
  })
})
