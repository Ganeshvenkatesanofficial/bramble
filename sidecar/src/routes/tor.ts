import type { MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import { getTorStatus, type TorStatus } from '../tor'

// GET /tor/status reports the sidecar's Tor client: brambled waits on it at
// startup (brambled/sidecar/manager.go), and the W11 preflight checks it on
// every node. It always answers 200, because it reports state rather than
// health. /health stays plain process liveness so brambled can tell its own
// sidecar from a stray one within seconds, long before Tor is ready.
export const torStatusRoute = new Hono()

function describe(status: TorStatus): string {
  switch (status.state) {
    case 'ready':
      return 'Tor ready'
    case 'starting':
      return 'starting Tor'
    case 'failed':
      return `Tor failed to start: ${status.lastError ?? 'unknown error'}`
  }
}

torStatusRoute.get('/tor/status', (c) => {
  const status = getTorStatus()
  return c.json({ ...status, message: describe(status) })
})

// Paths that answer before Tor is ready. Everything else is gated, so a
// route added later is gated by default rather than by remembering to.
const UNGATED = new Set(['/health', '/tor/status'])

// The sidecar must not serve fresh chain results or make payments until its
// traffic can go through Tor (handoff 5.1). Until then every data route
// answers 503 "starting Tor". brambled treats a non-200 as a resolve error
// and keeps its last-known peer set (admission.Loop.handleResolveError).
export const requireTorReady: MiddlewareHandler = async (c, next) => {
  if (UNGATED.has(c.req.path)) return next()
  const status = getTorStatus()
  if (status.state === 'ready') return next()
  c.header('Retry-After', '5')
  return c.json({ error: describe(status), tor: status }, 503)
}
