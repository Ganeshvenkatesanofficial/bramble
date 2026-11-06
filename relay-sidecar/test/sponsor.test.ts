import { describe, expect, it, vi } from 'vitest'
import { createSponsorRoute, type SponsorDeps } from '../src/sponsor'

function setup(
  over: Partial<SponsorDeps> & { enrolled?: Record<string, { enrolled: boolean; reason?: string }> } = {}
) {
  const clock = { t: 1_000_000 }
  const reads: string[] = []
  const allocs: number[] = []
  const enrolled = over.enrolled ?? { alice: { enrolled: true }, mallory: { enrolled: false, reason: 'revoked' } }
  const app = createSponsorRoute({
    readEnrollment: async (label) => {
      reads.push(label)
      return enrolled[label] ?? { enrolled: false, reason: 'no pubkey record' }
    },
    mintToken: () => ({ token: 'tok', expiresAt: 123 }),
    allocate: async (bytes) => {
      allocs.push(bytes)
      return { sessionId: 's1', port: 40000, expiresAt: 999, bytes }
    },
    bytes: 1 << 20,
    maxPerHour: 2,
    now: () => clock.t,
    ...over,
  })
  const post = (path: string, body: unknown) =>
    app.request(path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
  return { app, post, clock, reads, allocs }
}

describe('sponsored routes', () => {
  it('mints a token and grants exactly the configured cap for an enrolled label', async () => {
    const { post, allocs } = setup()
    const tok = await post('/sponsored/rendezvous-token', { label: 'alice' })
    expect(tok.status).toBe(200)
    expect(await tok.json()).toEqual({ token: 'tok', expiresAt: 123 })

    const sess = await post('/sponsored/data-relay-session', { label: 'alice' })
    expect(sess.status).toBe(200)
    expect(await sess.json()).toMatchObject({ port: 40000, bytes: 1 << 20 })
    expect(allocs).toEqual([1 << 20])
  })

  it('refuses an unenrolled or revoked label without allocating or minting', async () => {
    const { post, allocs } = setup()
    for (const label of ['mallory', 'nobody']) {
      for (const path of ['/sponsored/rendezvous-token', '/sponsored/data-relay-session']) {
        const res = await post(path, { label })
        expect(res.status).toBe(403)
        expect(((await res.json()) as { error: string }).error).toContain('not enrolled')
      }
    }
    expect(allocs).toEqual([])
  })

  it('rejects malformed bodies and labels before any registry read', async () => {
    const { post, reads } = setup()
    expect((await post('/sponsored/data-relay-session', 'not json')).status).toBe(400)
    expect((await post('/sponsored/data-relay-session', {})).status).toBe(400)
    expect((await post('/sponsored/data-relay-session', { label: 'Alice.eth' })).status).toBe(400)
    expect((await post('/sponsored/data-relay-session', { label: '-x' })).status).toBe(400)
    expect(reads).toEqual([])
  })

  it('limits sessions per label per hour, then recovers', async () => {
    const { post, clock, allocs } = setup()
    expect((await post('/sponsored/data-relay-session', { label: 'alice' })).status).toBe(200)
    expect((await post('/sponsored/data-relay-session', { label: 'alice' })).status).toBe(200)
    expect((await post('/sponsored/data-relay-session', { label: 'alice' })).status).toBe(429)
    expect(allocs).toHaveLength(2)
    clock.t += 60 * 60 * 1000 + 1
    expect((await post('/sponsored/data-relay-session', { label: 'alice' })).status).toBe(200)
  })

  it('caches a registry answer briefly so unauthenticated callers cannot force a read per request', async () => {
    const { post, reads } = setup({ maxPerHour: 100 })
    for (let i = 0; i < 5; i++) await post('/sponsored/rendezvous-token', { label: 'nobody' })
    expect(reads).toEqual(['nobody'])
  })

  // A viem error message includes the RPC URL, which can carry an API key.
  const SECRET_URL = 'https://rpc.example/v2/SECRET-KEY-123?apikey=SECRET-QUERY'

  it('returns a fixed 502 when the registry read fails and leaks nothing of the error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { post } = setup({
      readEnrollment: async () => {
        throw new Error(`HTTP request failed. URL: ${SECRET_URL} Status: 500`)
      },
    })
    const res = await post('/sponsored/data-relay-session', { label: 'alice' })
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).not.toContain('SECRET')
    expect(text).not.toContain('rpc.example')
    expect(JSON.parse(text)).toEqual({ error: 'registry read failed' })
    expect(log.mock.calls.flat().join(' ')).not.toContain('SECRET')
    log.mockRestore()
  })

  it('returns a fixed 502 when the relay allocation fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { post } = setup({
      allocate: async () => {
        throw new Error(`fetch failed: ${SECRET_URL}`)
      },
    })
    const res = await post('/sponsored/data-relay-session', { label: 'alice' })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'relay allocation failed' })
    expect(log.mock.calls.flat().join(' ')).not.toContain('SECRET')
    log.mockRestore()
  })
})
