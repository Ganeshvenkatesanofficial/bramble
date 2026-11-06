/**
 * In-memory implementation of the `bramble` local API (contract v1, ETH-177), including the
 * `/api/admin/*` proxy. It exists so the UI and its browser tests do not wait for the real daemon.
 * Test hooks live under `/__test/*`; the real daemon has none of them.
 */
import type { BrambleState, JoinRecord, Peer } from '../src/lib/contract'

export type Scenario =
  'fresh' | 'ready' | 'pending' | 'approved' | 'denied' | 'connected' | 'connected-empty' | 'error' | 'error-first-join'

export interface Flags {
  /** `/api/state` answers 503, as if the daemon were down. */
  offline: boolean
  /** Admin calls answer 401 (token rejected) or 502 (approval service down). */
  admin: 'ok' | 'rejected' | 'down'
  /** `/api/test` returns this result. */
  test: { ok: boolean; status: number; ms: number }
  /** Delay in ms before an approved device becomes connected. */
  connectDelayMs: number
  testDelayMs: number
}

const FINGERPRINT = '9f3ac1d27b4e86a05c13de7f2a98b410'

const seconds = (offset: number) => new Date(Date.now() - offset * 1000).toISOString()

function peers(): Peer[] {
  return [
    { label: 'gateway-1', meshIp: '100.64.0.2', path: 'direct', lastHandshake: seconds(4), rttMs: 18 },
    { label: 'agent-1', meshIp: '100.64.0.3', path: 'relay', lastHandshake: seconds(37), rttMs: 71 },
    { label: 'laptop-bo', meshIp: '100.64.0.9', path: 'none', lastHandshake: null },
  ]
}

function seedJoins(): JoinRecord[] {
  return [
    {
      id: 'join-103',
      label: 'laptop-bo',
      tailnet: 'acme.bramble.eth',
      status: 'pending',
      pubkey: 'kP3x0uQ1mV8sT2yNfR7aWc4dEhJ6bZgLoXi9UvYn5Bk=',
      createdAt: seconds(35),
    },
    {
      id: 'join-102',
      label: 'agent-1',
      tailnet: 'acme.bramble.eth',
      status: 'approved',
      pubkey: 'Zq1Wc8Lr0TnY5uXe3VbHg7JdKfA2oMsPiN4yRxC6tEw=',
      meshIp: '100.64.0.3',
      createdAt: seconds(900),
      decidedAt: seconds(850),
    },
    {
      id: 'join-101',
      label: 'gateway-1',
      tailnet: 'acme.bramble.eth',
      status: 'approved',
      pubkey: 'Hm9Ds2Ke6Vp0QaXyU7oLcN1bTgR4wFiJ8zEtB5nYr3A=',
      meshIp: '100.64.0.2',
      createdAt: seconds(3600),
      decidedAt: seconds(3500),
    },
    {
      id: 'join-100',
      label: 'old-phone',
      tailnet: 'acme.bramble.eth',
      status: 'revoked',
      pubkey: 'Bt6Fn0Wy3Ck8Ls2Ph5Zr1Ud9Ja4Vm7XgQeOiNjTy8Kc=',
      createdAt: seconds(7200),
      decidedAt: seconds(5000),
    },
  ]
}

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
const failure = (status: number, message: string, nextStep: string) => json({ error: { message, nextStep } }, status)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function createMock() {
  let state: BrambleState
  let joins: JoinRecord[]
  let flags: Flags
  let nextId = 200
  let connectTimer: ReturnType<typeof setTimeout> | undefined

  function reset(scenario: Scenario = 'fresh', admin = false) {
    clearTimeout(connectTimer)
    flags = {
      offline: false,
      admin: 'ok',
      test: { ok: true, status: 200, ms: 38 },
      connectDelayMs: 2500,
      testDelayMs: 600,
    }
    joins = admin ? seedJoins() : []
    nextId = 200
    const base: BrambleState = {
      phase: 'setup',
      name: '',
      fingerprint: FINGERPRINT,
      isAdmin: admin,
      peers: [],
    }
    const named = { ...base, phase: 'ready' as const, name: 'laptop-ana' }
    const tailnet = 'acme.bramble.eth'
    const scenarios: Record<Scenario, BrambleState> = {
      fresh: base,
      ready: named,
      pending: { ...named, phase: 'pending', tailnet, joinId: 'join-099' },
      approved: { ...named, phase: 'approved', tailnet, joinId: 'join-099', meshIp: '100.64.0.7' },
      denied: { ...named, phase: 'denied', tailnet, joinId: 'join-099' },
      connected: {
        ...named,
        phase: 'connected',
        tailnet,
        joinId: 'join-099',
        meshIp: '100.64.0.7',
        peers: peers(),
      },
      'connected-empty': { ...named, phase: 'connected', tailnet, joinId: 'join-099', meshIp: '100.64.0.7' },
      'error-first-join': {
        ...named,
        phase: 'error',
        error: {
          message: 'Bramble could not reach the approval service for acme.bramble.eth.',
          nextStep: 'Check your internet connection, then start over and request to join again.',
        },
      },
      error: {
        ...named,
        phase: 'error',
        tailnet,
        joinId: 'join-099',
        error: {
          message: 'Bramble could not reach the relay for acme.bramble.eth.',
          nextStep: 'Check your internet connection. Bramble retries on its own and this page updates when it works.',
        },
      },
    }
    state = scenarios[scenario]
  }
  reset()

  function connectSoon() {
    clearTimeout(connectTimer)
    connectTimer = setTimeout(() => {
      if (state.phase === 'approved') state = { ...state, phase: 'connected', peers: peers() }
    }, flags.connectDelayMs)
  }

  function decide(id: string, action: 'approve' | 'deny' | 'revoke'): Response {
    const join = joins.find((candidate) => candidate.id === id)
    if (!join) return failure(404, 'That request no longer exists.', 'Reload the list.')
    const allowed = { approve: 'pending', deny: 'pending', revoke: 'approved' } as const
    if (join.status !== allowed[action]) {
      return failure(409, `That request is already ${join.status}.`, 'Reload the list.')
    }
    const status = { approve: 'approved', deny: 'denied', revoke: 'revoked' } as const
    join.status = status[action]
    join.decidedAt = new Date().toISOString()
    if (action === 'approve') join.meshIp = `100.64.0.${10 + joins.length}`
    if (id === state.joinId) {
      if (action === 'approve') {
        state = { ...state, phase: 'approved', meshIp: join.meshIp }
        connectSoon()
      } else {
        state = { ...state, phase: 'denied', meshIp: undefined, peers: [] }
      }
    }
    return json(join)
  }

  async function admin(path: string, request: Request): Promise<Response> {
    if (!state.isAdmin) return failure(403, 'This device is not an admin.', 'Run `bramble admin login`.')
    if (flags.admin === 'rejected') return failure(401, 'unauthorized', 'Run `bramble admin login`.')
    if (flags.admin === 'down') return failure(502, 'Bad gateway.', 'Retry.')
    if (path === 'joins' && request.method === 'GET') return json({ joins })
    if (path === 'members' && request.method === 'GET') {
      return json({ members: joins.filter((join) => join.status === 'approved') })
    }
    const match = /^joins\/([^/]+)\/(approve|deny|revoke)$/.exec(path)
    if (match && request.method === 'POST') return decide(decodeURIComponent(match[1]), match[2] as 'approve')
    return failure(404, 'Route not found.', 'Update Bramble.')
  }

  async function local(path: string, request: Request): Promise<Response> {
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}
    if (path === 'state' && request.method === 'GET') {
      return flags.offline ? failure(503, 'Bramble is restarting.', 'Wait a moment.') : json(state)
    }
    if (path === 'setup' && request.method === 'POST') {
      const name = typeof body.name === 'string' ? body.name : ''
      if (!/^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/.test(name)) {
        return failure(400, 'That device name is not valid.', 'Use lowercase letters, numbers and hyphens.')
      }
      if (name === 'taken') return failure(409, 'That name is already used on this network.', 'Pick another name.')
      state = { ...state, phase: 'ready', name }
      return json({ ok: true })
    }
    if (path === 'join' && request.method === 'POST') {
      const tailnet = typeof body.tailnet === 'string' ? body.tailnet : ''
      if (tailnet.startsWith('unknown.')) {
        return failure(404, `No network called ${tailnet} was found.`, 'Check the spelling with your admin.')
      }
      if (tailnet.startsWith('down.')) {
        return failure(
          502,
          'Bramble could not reach the approval service.',
          'Check your internet connection, then try again.'
        )
      }
      const id = `join-${nextId++}`
      joins.push({
        id,
        label: state.name,
        tailnet,
        status: 'pending',
        pubkey: 'Dv4Rq7Lm1Ws9Pe3Xk6Nz0Bf2Ty5Ho8Ca+JuGiMlEnSw=',
        createdAt: new Date().toISOString(),
      })
      state = { ...state, phase: 'pending', tailnet, joinId: id }
      return json({ id, status: 'pending' }, 201)
    }
    if (path === 'leave' && request.method === 'POST') {
      clearTimeout(connectTimer)
      state = { ...state, phase: 'ready', tailnet: undefined, joinId: undefined, meshIp: undefined, peers: [] }
      return json({ ok: true })
    }
    if (path === 'test' && request.method === 'POST') {
      await sleep(flags.testDelayMs)
      return json(flags.test)
    }
    return failure(404, 'Route not found.', 'Update Bramble.')
  }

  return {
    async handle(request: Request): Promise<Response | null> {
      const { pathname } = new URL(request.url)
      if (pathname.startsWith('/__test/') && request.method === 'POST') {
        const body = await request.json().catch(() => ({}))
        if (pathname === '/__test/reset') reset(body.scenario, body.admin === true)
        else if (pathname === '/__test/flags') flags = { ...flags, ...body }
        else if (pathname === '/__test/state') state = { ...state, ...body }
        else if (pathname === '/__test/joins') joins = body
        else return failure(404, 'Unknown test hook.', '')
        return json({ ok: true })
      }
      const admin_ = /^\/api\/admin\/(.+)$/.exec(pathname)
      if (admin_) return admin(admin_[1], request)
      const local_ = /^\/api\/([^/]+)$/.exec(pathname)
      if (local_) return local(local_[1], request)
      return null
    },
  }
}
