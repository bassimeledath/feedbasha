import { createHash } from 'node:crypto'
import { mkdir, lstat, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const MAX_BYTES = 8 * 1024 * 1024
const ENDPOINT = '/_karen/captures'

/** Minimal structural Vite types keep Vite out of the browser/package runtime. */
interface DevServer {
  config: { root: string }
  middlewares: { use(handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): void }
}

async function captureDirectory(root: string): Promise<string> {
  const project = await realpath(root)
  let directory = project
  for (const name of ['.karen', 'captures']) {
    directory = join(directory, name)
    await mkdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })
    if (!(await lstat(directory)).isDirectory() || (await realpath(directory)) !== directory) {
      throw new Error('Capture directory must be a real directory inside the project.')
    }
  }
  return directory
}

export function captureMiddleware(root: string) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    if (req.url?.split('?')[0] !== ENDPOINT) return next()
    const respond = (status: number, body: object) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    const host = req.headers.host ?? ''
    const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)
    const localPeer = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
    if (!localHost || !localPeer || req.headers.origin !== `http://${host}` || req.headers['x-karen-capture'] !== '1') {
      respond(403, { error: 'Capture saving requires a same-origin localhost request.' })
      return
    }
    if (req.method !== 'POST' || req.headers['content-type'] !== 'image/png') {
      respond(415, { error: 'Expected a PNG upload.' })
      return
    }
    try {
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > MAX_BYTES) { respond(413, { error: 'Screenshot exceeds 8 MB.' }); return }
        chunks.push(buffer)
      }
      const png = Buffer.concat(chunks)
      if (png.length < 33 || !png.subarray(0, 8).equals(PNG) || png.toString('ascii', 12, 16) !== 'IHDR') {
        respond(400, { error: 'Invalid PNG.' })
        return
      }
      const directory = await captureDirectory(resolve(root))
      const name = `${createHash('sha256').update(png).digest('hex')}.png`
      const path = join(directory, name)
      try { await writeFile(path, png, { flag: 'wx', mode: 0o600 }) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (!(await lstat(path)).isFile() || await realpath(path) !== path) throw new Error('Invalid capture file.')
      }
      respond(200, { reference: path })
    } catch { respond(500, { error: 'Could not save the screenshot in this project.' }) }
  }
}

/** Development-only: add karen() to the host project's Vite plugins. */
export function karen() {
  return {
    name: 'karen-local-captures',
    apply: 'serve' as const,
    configureServer(server: DevServer) { server.middlewares.use(captureMiddleware(server.config.root)) },
  }
}
