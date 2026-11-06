// Operator-sponsored relay sessions (docs/adr/0018, spec D11). A device with
// no Hedera key asks for a rendezvous token and a capped data-relay session
// by naming its enrolled label. The relay checks the label against the
// tailnet registry and then pays nothing on-chain: the operator carries the
// cost. These routes sit OUTSIDE the x402 paymentMiddleware routes config,
// so the paid POST /rendezvous-token and POST /data-relay-session are
// unchanged.
//
// A label is public, so this proves "that label is enrolled", not "the
// caller owns it". The per-label hourly limit and the byte cap bound what
// anyone who knows a label can spend.
import { Hono } from 'hono'
import type { EnrollmentReader } from './ens'
import type { MintedToken } from './token'

const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
const HOUR_MS = 60 * 60 * 1000
const CACHE_TTL_MS = 30_000
const CACHE_MAX = 1024

export type SponsorSession = { sessionId: string; port: number; expiresAt: number; bytes: number }

export type SponsorDeps = {
  readEnrollment: EnrollmentReader
  mintToken: () => MintedToken
  allocate: (bytes: number) => Promise<SponsorSession>
  bytes: number
  maxPerHour: number
  now?: () => number
}

export function createSponsorRoute(deps: SponsorDeps): Hono {
  const now = deps.now ?? Date.now
  const uses = new Map<string, number[]>()
  const cache = new Map<string, { at: number; enrolled: boolean; reason?: string }>()

  function withinLimit(kind: string, label: string): boolean {
    const key = `${kind}:${label}`
    const recent = (uses.get(key) ?? []).filter((t) => now() - t < HOUR_MS)
    if (recent.length >= deps.maxPerHour) {
      uses.set(key, recent)
      return false
    }
    recent.push(now())
    uses.set(key, recent)
    return true
  }

  async function enrolled(label: string) {
    const hit = cache.get(label)
    if (hit && now() - hit.at < CACHE_TTL_MS) return hit
    const res = await deps.readEnrollment(label)
    if (cache.size >= CACHE_MAX) cache.clear()
    const entry = { at: now(), ...res }
    cache.set(label, entry)
    return entry
  }

  const app = new Hono()

  // Shared gate: parse label, check enrollment, check the hourly limit.
  async function gate(kind: string, c: { req: { json: () => Promise<unknown> } }) {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return { status: 400 as const, error: 'body must be JSON {"label": "<enrolled label>"}' }
    }
    const label = (body as { label?: unknown } | null)?.label
    if (typeof label !== 'string' || !LABEL_RE.test(label)) {
      return { status: 400 as const, error: 'label must be a lowercase DNS label' }
    }
    let check
    try {
      check = await enrolled(label)
    } catch (err) {
      return {
        status: 502 as const,
        error: `registry read failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
    if (!check.enrolled) {
      return { status: 403 as const, error: `label is not enrolled: ${check.reason ?? 'unknown'}` }
    }
    if (!withinLimit(kind, label)) {
      return { status: 429 as const, error: `sponsored ${kind} limit reached for this label (${deps.maxPerHour}/hour)` }
    }
    return { label }
  }

  app.post('/sponsored/rendezvous-token', async (c) => {
    const g = await gate('token', c)
    if ('error' in g) return c.json({ error: g.error }, g.status)
    return c.json(deps.mintToken())
  })

  app.post('/sponsored/data-relay-session', async (c) => {
    const g = await gate('session', c)
    if ('error' in g) return c.json({ error: g.error }, g.status)
    try {
      return c.json(await deps.allocate(deps.bytes))
    } catch (err) {
      return c.json({ error: `relay allocation failed: ${err instanceof Error ? err.message : String(err)}` }, 502)
    }
  })

  return app
}
