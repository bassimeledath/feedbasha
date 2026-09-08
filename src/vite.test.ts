// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, readdir, rm, mkdir, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureMiddleware } from './vite'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
let root: string, server: Server
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  if (root) await rm(root, { recursive: true, force: true })
})
async function setup() {
  root = await mkdtemp(join(tmpdir(), 'karen-export-test-'))
  const handler = captureMiddleware(root)
  server = createServer((req, res) => void handler(req, res, () => { res.writeHead(404); res.end() }))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const origin = `http://127.0.0.1:${port}`
  return (body: Uint8Array = png, override: Record<string, string> = {}) => fetch(`${origin}/_karen/captures`, {
    method: 'POST', headers: { Origin: origin, 'X-Karen-Capture': '1', 'Content-Type': 'image/png', ...override }, body: new Uint8Array(body).buffer,
  })
}
describe('local screenshot handoff', () => {
  it('writes the original image and reuses its path on repeated uploads', async () => {
    const upload = await setup()
    const first = await upload()
    expect(first.status).toBe(200)
    const { reference } = await first.json() as { reference: string }
    expect(reference.startsWith(join(await realpath(root), '.karen', 'captures'))).toBe(true)
    expect(await readFile(reference)).toEqual(png)
    expect(await (await upload()).json()).toEqual({ reference })
    expect(await readdir(join(root, '.karen', 'captures'))).toHaveLength(1)
  })
  it('rejects cross-origin requests and invalid images', async () => {
    const upload = await setup()
    expect((await upload(png, { Origin: 'http://evil.example' })).status).toBe(403)
    expect((await upload(Buffer.from('not an image'))).status).toBe(400)
    expect(await readdir(root)).toEqual([])
  })
  it('refuses a symlink capture directory', async () => {
    const upload = await setup()
    const elsewhere = join(root, 'elsewhere')
    await mkdir(elsewhere)
    await symlink(elsewhere, join(root, '.karen'))
    expect((await upload()).status).toBe(500)
    expect(await readdir(elsewhere)).toEqual([])
  })
})
