import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { requireTorReady, torStatusRoute } from '../src/routes/tor'
import { startTor, stopTor, type TorTransport } from '../src/tor'

// Same wiring as src/index.ts, with stand-in data routes, so the gate is
// tested without the ENS or payment code behind it.
function app() {
  const a = new Hono()
  a.use('*', requireTorReady)
  a.get('/health', (c) => c.json({ ok: true }))
  a.get('/devices', (c) => c.json({ labels: ['a'] }))
  a.post('/rendezvous-token', (c) => c.json({ token: 't' }))
  a.route('/', torStatusRoute)
  return a
}

function controllableTransport() {
  let settle: { resolve: () => void; reject: (e: Error) => void } | null = null
  const transport: TorTransport = {
    ready: () =>
      new Promise<void>((resolve, reject) => {
        settle = { resolve, reject }
      }),
    fetch: async () => new Response('ok'),
    close: () => {},
  }
  return {
    transport,
    resolve: () => settle?.resolve(),
    reject: (m: string) => settle?.reject(new Error(m)),
  }
}

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => stopTor())

describe('Tor status route and readiness gate', () => {
  it('answers /health and /tor/status while Tor starts, and 503 "starting Tor" on data routes', async () => {
    const t = controllableTransport()
    void startTor({ transport: () => t.transport, retryDelayMs: 0 })
    const a = app()

    expect((await a.request('/health')).status).toBe(200)

    const status = await a.request('/tor/status')
    expect(status.status).toBe(200)
    expect(await status.json()).toEqual({ state: 'starting', message: 'starting Tor' })

    for (const [path, method] of [
      ['/devices', 'GET'],
      ['/rendezvous-token', 'POST'],
    ] as const) {
      const res = await a.request(path, { method })
      expect(res.status).toBe(503)
      expect(res.headers.get('Retry-After')).toBe('5')
      expect(await res.json()).toEqual({ error: 'starting Tor', tor: { state: 'starting' } })
    }
  })

  it('serves data routes once Tor is ready', async () => {
    const t = controllableTransport()
    const started = startTor({ transport: () => t.transport, now: () => 42, retryDelayMs: 0 })
    await flush()
    t.resolve()
    await started
    const a = app()

    expect(await (await a.request('/tor/status')).json()).toEqual({ state: 'ready', readyAt: 42, message: 'Tor ready' })
    const res = await a.request('/devices')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ labels: ['a'] })
  })

  it('reports a failed bootstrap on /tor/status and in the 503 body', async () => {
    const t = controllableTransport()
    const started = startTor({ transport: () => t.transport, retryDelayMs: 0 })
    await flush()
    t.reject('no guard')
    await expect(started).rejects.toThrow()
    const a = app()

    expect(await (await a.request('/tor/status')).json()).toEqual({
      state: 'failed',
      lastError: 'no guard',
      message: 'Tor failed to start: no guard',
    })
    const res = await a.request('/devices')
    expect(res.status).toBe(503)
    expect(((await res.json()) as { error: string }).error).toBe('Tor failed to start: no guard')
  })
})
