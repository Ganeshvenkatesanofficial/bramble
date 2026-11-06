import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import fixture from './fixtures/activity-status.json'
import payments from './fixtures/payments.json'
import { createApprovalApi } from '../src/lib/api'
import {
  buildActivity,
  createPaymentsSource,
  createStatusSource,
  formatCutoff,
  loadActivity,
  parseStatusEvents,
  type ActivityEntry,
  type ActivityKind,
  type StatusEvent,
} from '../src/lib/activity'
import type { RequestView } from '../src/lib/console-api'
import type { PaymentsFeed } from '../src/lib/payments'
import { ManualClock } from './clock'
import { MemoryChain } from './memory-chain'

const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`

function view(overrides: Partial<RequestView> = {}): RequestView {
  return {
    id: 'r1',
    agentLabel: 'agent-1',
    gatewayLabel: 'gateway-1',
    service: 'web',
    status: 'revoked',
    createdAt: '2026-11-06T00:00:00.000Z',
    decidedAt: '2026-11-06T00:00:10.000Z',
    grantTransaction: { transactionHash: hash(1) },
    revokeRequestedAt: '2026-11-06T00:01:00.000Z',
    revokedAt: '2026-11-06T00:01:02.000Z',
    revokeTransaction: { transactionHash: hash(2) },
    revokeReason: 'manual',
    expiryStatus: 'none',
    ...overrides,
  } as RequestView
}

const paymentFeed: PaymentsFeed = {
  observedAt: '2026-11-06T00:02:00.000Z',
  agents: [
    {
      agentLabel: 'agent-1',
      payerAccountId: '0.0.123',
      budgetAtomic: '1000000',
      since: '2023-01-01T00:00:00Z',
      perPaymentCapAtomic: '100000',
      spentAtomic: '10000',
      remainingAtomic: '990000',
      payments: [
        {
          transactionId: '0.0.123-1793923230-000000001',
          consensusTimestamp: '1793923230.000000001',
          amountAtomic: '10000',
          hashscanUrl: 'https://hashscan.io/testnet/transaction/1793923230.000000001',
        },
      ],
    },
  ],
}

const build = (input: Parameters<typeof buildActivity>[0]) => buildActivity({ ensParent: 'bramble.eth', ...input })
const kinds = (entries: ActivityEntry[]) => entries.map((entry) => entry.kind)

test('every feed kind appears from the statusapi fixture, the request record and the mirror', () => {
  const status = parseStatusEvents(fixture)
  const events = build({ requests: [view()], status, payments: paymentFeed })
  const seen = new Set<ActivityKind>(kinds(events))
  for (const kind of [
    'request-received',
    'access-granted',
    'access-revoked',
    'gateway-denied',
    'gateway-allowed',
    'payment-settled',
    'peer-admission',
    'peer-dropped',
    'cutoff-measured',
  ] as ActivityKind[]) {
    expect(seen.has(kind)).toBe(true)
  }
  const denied = build({
    requests: [view({ id: 'r2', status: 'denied', grantTransaction: undefined, revokedAt: undefined })],
    status: [],
    payments: null,
  })
  expect(kinds(denied)).toContain('request-denied')
})

test('entries are newest first and bounded', () => {
  const events = build({ requests: [view()], status: parseStatusEvents(fixture), payments: paymentFeed })
  const times = events.map((entry) => Date.parse(entry.time))
  expect([...times].sort((a, b) => b - a)).toEqual(times)
  const flood: StatusEvent[] = Array.from({ length: 150 }, (_, i) => ({
    time: new Date(Date.UTC(2026, 10, 6, 0, 0, i)).toISOString(),
    kind: 'gateway',
    label: 'agent-1',
    message: 'allowed "web": proxying to x (checked now)',
    outcome: 'allowed',
    service: 'web',
  }))
  expect(build({ requests: [], status: flood, payments: null })).toHaveLength(100)
})

test('entries with the same timestamp keep causal order, newest first', () => {
  const time = '2026-11-06T00:00:00.000Z'
  const events = build({
    requests: [],
    status: parseStatusEvents([
      { time, kind: 'admission', label: 'agent-1', message: 'authorized=false' },
      { time, kind: 'peer', label: 'agent-1', message: 'dropped', outcome: 'dropped' },
    ]),
    payments: null,
  })
  expect(kinds(events)).toEqual(['peer-dropped', 'peer-admission'])
})

test('cut-off is the first blocked call or peer drop after the revoke request, in milliseconds', () => {
  const events = build({ requests: [view()], status: parseStatusEvents(fixture), payments: null })
  const cutoff = events.find((entry) => entry.kind === 'cutoff-measured')
  expect(cutoff?.cutoffMs).toBe(3_400)
  expect(cutoff?.summary).toContain('3.4 s')
  expect(cutoff?.detail).toContain('clock')
  expect(cutoff?.time).toBe('2026-11-06T00:01:03.400Z')
})

test('a denial before the revoke request does not count, and a peer drop can be the first block', () => {
  const events = build({
    requests: [view()],
    status: parseStatusEvents(fixture).filter((event) => event.time !== '2026-11-06T00:01:03.400Z'),
    payments: null,
  })
  const cutoff = events.find((entry) => entry.kind === 'cutoff-measured')
  expect(cutoff?.cutoffMs).toBe(4_000)
  expect(cutoff?.detail).toContain('peer drop')
})

test('no cut-off is reported without a later block, for external revokes, or when a re-grant ends the window', () => {
  const status = parseStatusEvents(fixture)
  const none = (requests: RequestView[], events: StatusEvent[] = status) =>
    build({ requests, status: events, payments: null }).some((entry) => entry.kind === 'cutoff-measured')
  expect(none([view()], status.slice(0, 3))).toBe(false)
  expect(none([view({ revokeReason: 'external' })])).toBe(false)
  expect(none([view({ revokeRequestedAt: undefined })])).toBe(false)
  const regrant = view({
    id: 'r2',
    status: 'approved',
    decidedAt: '2026-11-06T00:01:01.000Z',
    revokedAt: undefined,
    revokeRequestedAt: undefined,
  })
  expect(none([view(), regrant])).toBe(false)
})

test('status labels match approval agents only under the configured ENS parent', () => {
  const cutoffOf = (label: string, ensParent?: string) =>
    buildActivity({
      requests: [view()],
      status: parseStatusEvents(fixture).map((event) => ({ ...event, label })),
      payments: null,
      ensParent,
    }).find((entry) => entry.kind === 'cutoff-measured')?.cutoffMs
  expect(cutoffOf('agent-1.bramble.eth', 'bramble.eth')).toBe(3_400)
  expect(cutoffOf('Agent-1.Bramble.eth', 'Bramble.eth.')).toBe(3_400)
  expect(cutoffOf('agent-1', 'bramble.eth')).toBe(3_400)
  expect(cutoffOf('agent-1')).toBe(3_400)
  expect(cutoffOf('agent-2.bramble.eth', 'bramble.eth')).toBeUndefined()
  expect(cutoffOf('agent-1.foreign.eth', 'bramble.eth')).toBeUndefined()
  expect(cutoffOf('agent-1.sub.bramble.eth', 'bramble.eth')).toBeUndefined()
  expect(cutoffOf('agent-1.bramble.eth')).toBeUndefined()
  const foreign = build({
    requests: [],
    status: parseStatusEvents(fixture).map((event) => ({ ...event, label: 'agent-1.foreign.eth' })),
    payments: null,
  })
  expect(foreign.find((entry) => entry.kind === 'gateway-denied')?.agentLabel).toBe('agent-1.foreign.eth')
  const own = build({ requests: [], status: parseStatusEvents(fixture), payments: null })
  expect(own.find((entry) => entry.kind === 'gateway-denied')?.agentLabel).toBe('agent-1')
})

test("a foreign agent's peer drop does not measure a cut-off for the console agent", () => {
  const events = build({
    requests: [view()],
    status: parseStatusEvents([
      {
        time: '2026-11-06T00:01:00.100Z',
        kind: 'peer',
        label: 'agent-1.foreign.eth',
        message: 'dropped',
        outcome: 'dropped',
      },
    ]),
    payments: null,
  })
  expect(events.some((entry) => entry.kind === 'cutoff-measured')).toBe(false)
})

test('only a missing-grant denial of the revoked service counts as the cut-off', () => {
  const at = (ms: number) => new Date(Date.parse('2026-11-06T00:01:00.000Z') + ms).toISOString()
  const denial = (ms: number, service: string, detail = 'no matching granted digest') => ({
    time: at(ms),
    kind: 'gateway',
    label: 'agent-1.bramble.eth',
    outcome: 'denied',
    service,
    message: `denied "${service}": ${detail} (agent-1.bramble.eth)`,
  })
  const events = build({
    requests: [view()],
    status: parseStatusEvents([
      denial(100, 'never-granted'),
      denial(200, 'web', 'unknown service'),
      denial(300, 'web', 'local service unreachable: dial tcp'),
      denial(400, 'web', 'ACL check failed: timeout'),
      {
        time: at(5_000),
        kind: 'gateway',
        label: 'agent-1.bramble.eth',
        outcome: 'allowed',
        service: 'web',
        message: 'allowed "web": proxying to 127.0.0.1:9100 (agent-1.bramble.eth)',
      },
      { time: at(12_000), kind: 'peer', label: 'agent-1.bramble.eth', message: 'dropped', outcome: 'dropped' },
    ]),
    payments: null,
  })
  const cutoff = events.find((entry) => entry.kind === 'cutoff-measured')
  expect(cutoff?.cutoffMs).toBe(12_000)
  expect(cutoff?.detail).toContain('peer drop')
  // An older node without the service field: the service is read from the message.
  const legacy = { ...denial(700, 'web'), service: undefined }
  const fromMessage = build({ requests: [view()], status: parseStatusEvents([legacy]), payments: null })
  expect(fromMessage.find((entry) => entry.kind === 'cutoff-measured')?.cutoffMs).toBe(700)
})

test('gateway text is mapped to fixed phrases and raw error text is withheld', () => {
  const secret = 'https://sepolia.example/v2/SECRET_KEY'
  const events = build({
    requests: [],
    status: parseStatusEvents([
      {
        time: '2026-11-06T00:00:01Z',
        kind: 'gateway',
        label: 'agent-1',
        outcome: 'denied',
        service: 'web',
        message: `denied "web": ACL check failed: Post "${secret}": dial tcp: lookup (checked 2026-11-06T00:00:01Z)`,
      },
      {
        time: '2026-11-06T00:00:02Z',
        kind: 'gateway',
        label: 'agent-1',
        outcome: 'denied',
        service: 'web',
        message: `denied "web": something new ${secret} (checked 2026-11-06T00:00:02Z)`,
      },
      {
        time: '2026-11-06T00:00:03Z',
        kind: 'admission',
        label: 'agent-1',
        message: `error: resolving ${secret}`,
      },
    ]),
    payments: null,
  })
  expect(JSON.stringify(events)).not.toContain('SECRET_KEY')
  expect(events.map((entry) => entry.detail)).toContain('The gateway could not read the access list.')
  expect(events.map((entry) => entry.detail)).toContain('Details withheld from this view.')
})

test('parseStatusEvents drops malformed entries and infers outcome for older nodes', () => {
  expect(parseStatusEvents({})).toEqual([])
  const parsed = parseStatusEvents([
    null,
    'x',
    { time: 'nope', kind: 'gateway', label: 'a', message: 'allowed "web": x (c)' },
    { time: '2026-11-06T00:00:00Z', kind: 'gateway', label: 'a b', message: 'allowed "web": x (c)' },
    { time: '2026-11-06T00:00:00Z', kind: 'mystery', label: 'a', message: 'm' },
    { time: '2026-11-06T00:00:00Z', kind: 'gateway', label: 'a', message: 'something else' },
    { time: '2026-11-06T00:00:00Z', kind: 'peer', label: 'a', message: 'dropped' },
    {
      time: '2026-11-06T00:00:00Z',
      kind: 'gateway',
      label: 'agent-1',
      message: 'denied "web": x (c)',
      service: 'bad service!',
    },
  ])
  expect(parsed).toHaveLength(1)
  expect(parsed[0]).toMatchObject({ kind: 'gateway', outcome: 'denied' })
  expect(parsed[0].service).toBeUndefined()
})

test('formatCutoff shows seconds with one decimal', () => {
  expect(formatCutoff(3_400)).toBe('3.4 s')
  expect(formatCutoff(0)).toBe('0.0 s')
})

test('payment entries use the mirror consensus time and link to HashScan', () => {
  const entry = build({ requests: [], status: [], payments: paymentFeed })[0]
  expect(entry.kind).toBe('payment-settled')
  expect(entry.summary).toContain('0.010000 USDC')
  expect(entry.time).toBe('2026-11-06T00:00:30.000Z')
  expect(entry.link?.href).toContain('hashscan.io')
})

test('the payments fixture shape from the mirror works as a feed source input', async () => {
  expect(payments.transactions.length).toBeGreaterThan(0)
  const source = createPaymentsSource({
    configured: () => true,
    handler: async () => Response.json(paymentFeed),
  })
  expect((await source()).state).toBe('ok')
})

test('status source stops reading and cancels a body larger than 1 MB', async () => {
  let reads = 0
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (++reads <= 10) controller.enqueue(new Uint8Array(400_000))
      else controller.close()
    },
    cancel() {
      cancelled = true
    },
  })
  const result = await createStatusSource({
    baseUrl: () => 'http://127.0.0.1:7899',
    fetchImpl: (async () => new Response(body)) as unknown as typeof fetch,
  })()
  expect(result).toEqual({ state: 'unavailable', events: [] })
  expect(reads).toBeLessThanOrEqual(4)
  expect(cancelled).toBe(true)
  let declaredCancelled = false
  const declared = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(1))
    },
    cancel() {
      declaredCancelled = true
    },
  })
  const tooLong = await createStatusSource({
    baseUrl: () => 'http://127.0.0.1:7899',
    fetchImpl: (async () =>
      new Response(declared, { headers: { 'content-length': '2000000' } })) as unknown as typeof fetch,
  })()
  expect(tooLong.state).toBe('unavailable')
  expect(declaredCancelled).toBe(true)
})

test('status source reports not_configured, unavailable and ok', async () => {
  const json = (body: unknown, init?: ResponseInit) => async () => Response.json(body, init)
  expect((await createStatusSource({ baseUrl: () => undefined })()).state).toBe('not_configured')
  const bad = (url: string) =>
    createStatusSource({ baseUrl: () => url, fetchImpl: json(fixture) as unknown as typeof fetch })()
  expect((await bad('file:///etc/passwd')).state).toBe('unavailable')
  expect((await bad('http://user:pass@127.0.0.1:1')).state).toBe('unavailable')
  const failing = createStatusSource({
    baseUrl: () => 'http://127.0.0.1:1',
    fetchImpl: json({}, { status: 500 }) as unknown as typeof fetch,
  })
  expect((await failing()).state).toBe('unavailable')
  const throwing = createStatusSource({
    baseUrl: () => 'http://127.0.0.1:1',
    fetchImpl: (async () => {
      throw new Error('connect https://rpc.example/KEY')
    }) as unknown as typeof fetch,
  })
  expect(await throwing()).toEqual({ state: 'unavailable', events: [] })
  let requested = ''
  const ok = await createStatusSource({
    baseUrl: () => 'http://127.0.0.1:8080',
    fetchImpl: (async (url: URL) => {
      requested = String(url)
      return Response.json(fixture)
    }) as unknown as typeof fetch,
  })()
  expect(requested).toBe('http://127.0.0.1:8080/activity')
  expect(ok.state).toBe('ok')
  expect(ok.events).toHaveLength(5)
})

test('payments source reports not_configured and unavailable', async () => {
  expect(
    (await createPaymentsSource({ configured: () => false, handler: async () => Response.json({}) })()).state
  ).toBe('not_configured')
  expect(
    (await createPaymentsSource({ configured: () => true, handler: async () => new Response('x', { status: 503 }) })())
      .state
  ).toBe('unavailable')
  expect(
    (
      await createPaymentsSource({
        configured: () => true,
        handler: async () => {
          throw new Error('boom')
        },
      })()
    ).state
  ).toBe('unavailable')
})

test('loadActivity works with no optional sources', async () => {
  const feed = await loadActivity({ requests: [view()], now: () => new Date('2026-11-06T00:05:00Z') })
  expect(feed.sources).toEqual({ approval: 'ok', gateway: 'not_configured', hedera: 'not_configured' })
  expect(feed.observedAt).toBe('2026-11-06T00:05:00.000Z')
  expect(kinds(feed.events)).toContain('request-received')
})

test('GET /api/activity records revokeRequestedAt and measures the cut-off end to end', async () => {
  const token = randomUUID()
  const chain = new MemoryChain()
  const clock = new ManualClock()
  let gateway: unknown[] = []
  const api = createApprovalApi({
    token: () => token,
    signer: chain,
    resolver: chain,
    clock,
    ensParent: 'bramble.eth',
    activity: {
      status: createStatusSource({
        baseUrl: () => 'http://127.0.0.1:8080',
        fetchImpl: (async () => Response.json(gateway)) as unknown as typeof fetch,
      }),
    },
  })
  const call = (path: string, method = 'GET', body?: unknown) =>
    api.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    )
  const created = await (
    await call('/requests', 'POST', { agentLabel: 'agent-1', gatewayLabel: 'gateway-1', service: 'web' })
  ).json()
  await clock.advance(1_000)
  await call(`/requests/${created.id}/approve`, 'POST')
  await clock.advance(30_000)
  await call('/grants/agent-1/revoke', 'POST')
  const revokeAt = clock.now()
  gateway = [
    {
      time: new Date(revokeAt + 2_500).toISOString(),
      kind: 'gateway',
      label: 'agent-1.bramble.eth',
      message: 'denied "web": no matching granted digest (checked now)',
      outcome: 'denied',
      service: 'web',
    },
  ]
  const feed = await (await call('/activity')).json()
  expect(feed.sources.gateway).toBe('ok')
  const cutoff = feed.events.find((entry: ActivityEntry) => entry.kind === 'cutoff-measured')
  expect(cutoff.cutoffMs).toBe(2_500)
  expect(feed.events.map((entry: ActivityEntry) => entry.kind)).toEqual(
    expect.arrayContaining(['request-received', 'access-granted', 'access-revoked', 'gateway-denied'])
  )
})

test('a failed revoke leaves no revokeRequestedAt behind', async () => {
  const token = randomUUID()
  const chain = new MemoryChain()
  const api = createApprovalApi({ token: () => token, signer: chain, resolver: chain, clock: new ManualClock() })
  const call = (path: string, method = 'GET', body?: unknown) =>
    api.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    )
  const created = await (
    await call('/requests', 'POST', { agentLabel: 'agent-1', gatewayLabel: 'gateway-1', service: 'web' })
  ).json()
  await call(`/requests/${created.id}/approve`, 'POST')
  chain.failRevoke = true
  const failed = await call('/grants/agent-1/revoke', 'POST')
  expect(failed.ok).toBe(false)
  const list = await (await call('/requests')).json()
  expect(list.requests[0].status).toBe('approved')
  expect(list.requests[0].revokeRequestedAt).toBeUndefined()
})
