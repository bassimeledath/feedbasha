import type { FeedbashaConfig } from './types'
import { Session } from './session/session'

export * from './types'

export interface FeedbashaInstance {
  /** Start a feedback session programmatically. */
  start(): void
  /** Stop the current session and open review. */
  stop(): void
  /** Remove the widget and clean up. */
  destroy(): void
}

let current: Session | null = null

/**
 * Mount the feedbasha widget. Dev-only tool: source locations only exist in
 * development builds. Safe to call in SSR (no-ops without a DOM).
 */
export function init(config: FeedbashaConfig = {}): FeedbashaInstance {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { start() {}, stop() {}, destroy() {} }
  }
  current?.destroy()
  const session = new Session(config)
  current = session
  return {
    start: () => void session.start(),
    stop: () => void session.stop(),
    destroy: () => {
      session.destroy()
      if (current === session) current = null
    },
  }
}

export default { init }
