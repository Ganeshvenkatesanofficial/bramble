import { expect, test } from 'bun:test'
import { createApprovalApi } from '../src/lib/api'
import { createNetworkSource } from '../src/lib/network'
import { MemoryChain } from './memory-chain'

const headers = { authorization: 'Bearer network-test-only' }
const peer = {
  label: 'laptop.bramble.eth',
  authorized: true,
  handshaked: true,
  lastHandshakeUnixNs: 1793984400000000000,
  endpoint: '192.0.2.10:5000',
  allowedIPs: ['10.77.0.2/32'],
  publicKeyHex: 'ab'.repeat(32),
}
const apiRequest = (path: string, data?: unknown, authorized = true) =>
  new Request(`http://console.test/api${path}`, {
    method: data ? 'POST' : 'GET',
    headers: { ...(authorized ? headers : {}), ...(data ? { 'content-type': 'application/json' } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
  })

test('the operator sees observed paths and handshakes without endpoints, IPs or public keys', async () => {
  const source = createNetworkSource({
    baseUrl: () => 'http://status.test',
    fetchImpl: async (url) => {
      return Response.json(
        new URL(String(url)).pathname === '/peers'
          ? [peer, { ...peer, label: 'phone.bramble.eth', endpoint: '192.0.2.20:6000' }]
          : { dataRelays: { 'relay-eu': 'http://192.0.2.20:8080' } }
      )
    },
  })
  const api = createApprovalApi({ token: () => 'network-test-only', network: source, ensParent: 'bramble.eth' })
  const response = await api.handle(apiRequest('/network'))
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.nodes).toContainEqual(
    expect.objectContaining({
      id: 'peer:laptop.bramble.eth',
      kind: 'device',
      lastHandshake: '2026-11-06T17:00:00.000Z',
      path: 'direct',
      admission: 'authorized',
    })
  )
  expect(body.links).toContainEqual({ from: 'peer:phone.bramble.eth', to: 'relay:relay-eu', path: 'relayed' })
  expect(body.nodes).toContainEqual(expect.objectContaining({ id: 'relay:relay-eu', kind: 'relay' }))
  expect(JSON.stringify(body)).not.toMatch(/192\.0\.2\.|10\.77\.|publicKey|allowedIPs|endpoint/)
})

test('device and relay probes report their actual measurement, reject arbitrary targets and withhold diagnostics', async () => {
  let failed = false
  const source = createNetworkSource({
    baseUrl: () => 'http://status.test',
    resolveHost: async () => ['192.0.2.20'],
    fetchImpl: async (url) => {
      const path = new URL(String(url)).pathname
      if (path === '/peers') return Response.json([peer])
      if (path === '/relays') return Response.json({ dataRelays: { 'relay-eu': 'http://relay.test:8080' } })
      if (failed) throw new Error('private diagnostics must be withheld')
      return Response.json(
        path === '/ping'
          ? { reachable: true, rtt: '12.34ms', detail: 'private diagnostics must be withheld' }
          : { ok: true }
      )
    },
  })
  const api = createApprovalApi({ token: () => 'network-test-only', network: source })
  expect((await api.handle(apiRequest('/network/ping', { id: 'peer:laptop.bramble.eth' }, false))).status).toBe(401)
  const device = await (await api.handle(apiRequest('/network/ping', { id: 'peer:laptop.bramble.eth' }))).json()
  expect(device).toMatchObject({ reachable: true, rttMs: 12.34, method: 'icmp' })
  expect(Number.isNaN(Date.parse(device.measuredAt))).toBe(false)
  expect(JSON.stringify(device)).not.toContain('private diagnostics')
  const relay = await (await api.handle(apiRequest('/network/ping', { id: 'relay:relay-eu' }))).json()
  expect(relay).toMatchObject({ reachable: true, method: 'http' })
  expect(relay.rttMs).toBeGreaterThanOrEqual(0)
  expect((await api.handle(apiRequest('/network/ping', { id: 'peer:unknown' }))).status).toBe(404)
  expect((await api.handle(apiRequest('/network/ping', { id: 'http://arbitrary.test' }))).status).toBe(400)
  failed = true
  const failure = await (await api.handle(apiRequest('/network/ping', { id: 'peer:laptop.bramble.eth' }))).json()
  expect(failure).toMatchObject({ reachable: false, rttMs: null })
  expect(JSON.stringify(failure)).not.toContain('private diagnostics')
})

test('unavailable or malformed upstream data cannot invent a live path', async () => {
  let malformedPeers = false
  const api = createApprovalApi({
    token: () => 'network-test-only',
    network: createNetworkSource({
      baseUrl: () => 'http://status.test',
      fetchImpl: async (url) => {
        if (new URL(String(url)).pathname === '/relays') throw new Error('withheld')
        return Response.json(malformedPeers ? {} : [peer])
      },
    }),
  })
  const partial = await (await api.handle(apiRequest('/network'))).json()
  expect(partial).toMatchObject({ state: 'ok', relayState: 'unavailable' })
  expect(partial.nodes.find((node: { kind: string }) => node.kind === 'device').path).toBe('unknown')
  malformedPeers = true
  expect(await (await api.handle(apiRequest('/network'))).json()).toMatchObject({
    state: 'unavailable',
    nodes: [expect.objectContaining({ id: 'gateway', admission: 'unavailable', path: 'unavailable' })],
    links: [],
  })
})

test('a new pending request cannot hide an existing grant, and another namespace cannot inherit it', async () => {
  const chain = new MemoryChain()
  const api = createApprovalApi({
    token: () => 'network-test-only',
    signer: chain,
    resolver: chain,
    ensParent: 'bramble.eth',
    network: createNetworkSource({
      baseUrl: () => 'http://status.test',
      fetchImpl: async (url) =>
        Response.json(
          new URL(String(url)).pathname === '/peers'
            ? [
                { ...peer, label: 'agent-1.bramble.eth' },
                { ...peer, label: 'agent-1.other.eth' },
              ]
            : { dataRelays: {} }
        ),
    }),
  })
  const input = { agentLabel: 'agent-1', gatewayLabel: 'gateway-1', service: 'staging-tasks' }
  const first = await (await api.handle(apiRequest('/requests', input))).json()
  await api.handle(apiRequest(`/requests/${first.id}/approve`, {}))
  await api.handle(apiRequest('/requests', input))
  const view = await (await api.handle(apiRequest('/network'))).json()
  expect(
    view.nodes
      .find((node: { label: string }) => node.label === 'agent-1.bramble.eth')
      .grants.map((grant: { state: string }) => grant.state)
  ).toEqual(['approved', 'pending'])
  expect(view.nodes.find((node: { label: string }) => node.label === 'agent-1.other.eth').grants).toEqual([])
})

test('numeric WireGuard endpoints match DNS-named relays, and unresolved relays leave paths unknown', async () => {
  let resolved = true
  const api = createApprovalApi({
    token: () => 'network-test-only',
    network: createNetworkSource({
      baseUrl: () => 'http://status.test',
      resolveHost: async () => (resolved ? ['192.0.2.10'] : []),
      fetchImpl: async (url) =>
        Response.json(url.pathname === '/peers' ? [peer] : { dataRelays: { 'relay-eu': 'http://relay.test:8080' } }),
    }),
  })
  const view = await (await api.handle(apiRequest('/network'))).json()
  expect(view.links).toContainEqual({ from: 'peer:laptop.bramble.eth', to: 'relay:relay-eu', path: 'relayed' })
  resolved = false
  const uncertain = await (await api.handle(apiRequest('/network'))).json()
  expect(uncertain.nodes.find((node: { kind: string }) => node.kind === 'device').path).toBe('unknown')
})

test('without a status feed the approval API retains topology and probes only configured console-host targets', async () => {
  const previous = {
    status: process.env.BRAMBLED_STATUS_URL,
    relays: process.env.BRAMBLE_DATA_RELAYS,
    rendezvous: process.env.BRAMBLE_RENDEZVOUS_PAYMENT_URL,
  }
  let failed = false
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => (failed ? new Response('unavailable', { status: 503 }) : Response.json({ ok: true })),
  })
  delete process.env.BRAMBLED_STATUS_URL
  process.env.BRAMBLE_DATA_RELAYS = `relay-local=http://127.0.0.1:${server.port}`
  process.env.BRAMBLE_RENDEZVOUS_PAYMENT_URL = `http://127.0.0.1:${server.port}`
  try {
    const api = createApprovalApi({ token: () => 'network-test-only', ensParent: 'bramble.eth' })
    await api.handle(apiRequest('/requests', { agentLabel: 'agent-1', gatewayLabel: 'gateway-1', service: 'tasks' }))
    await api.handle(apiRequest('/joins', { label: 'laptop', tailnet: 'bramble.eth', pubkey: 'ab'.repeat(32) }))
    expect((await api.handle(apiRequest('/network', undefined, false))).status).toBe(401)
    const view = await (await api.handle(apiRequest('/network'))).json()
    expect(view.nodes).toContainEqual(expect.objectContaining({ id: 'gateway', label: 'bramble.eth', kind: 'gateway' }))
    for (const label of ['agent-1.bramble.eth', 'laptop.bramble.eth']) {
      const node = view.nodes.find((node: { label: string }) => node.label === label)
      expect(node).toMatchObject({
        admission: 'unavailable',
        path: 'unavailable',
        lastHandshake: null,
        pingable: false,
      })
      expect(node.probeReason).toContain('No supported probe target')
      expect(view.links).toContainEqual({ from: node.id, to: 'gateway', path: 'unavailable' })
    }
    expect(view.nodes).toContainEqual(expect.objectContaining({ id: 'relay:relay-local', pingable: true }))
    const probe = await (await api.handle(apiRequest('/network/ping', { id: 'relay:relay-local' }))).json()
    expect(probe).toMatchObject({ reachable: true, method: 'http' })
    expect(probe.rttMs).toBeGreaterThanOrEqual(0)
    expect(probe.detail).toContain('console host')
    expect((await api.handle(apiRequest('/network/ping', { id: 'relay:rendezvous' }))).status).toBe(200)
    expect((await api.handle(apiRequest('/network/ping', { id: 'relay:unknown' }))).status).toBe(404)
    expect((await api.handle(apiRequest('/network/ping', { id: 'http://arbitrary.test' }))).status).toBe(400)
    failed = true
    expect(await (await api.handle(apiRequest('/network/ping', { id: 'relay:relay-local' }))).json()).toMatchObject({
      reachable: false,
      rttMs: null,
    })
    expect(JSON.stringify(view)).not.toMatch(/127\.0\.0\.1|https?:|pubkey|meshIp|endpoint/)
  } finally {
    server.stop(true)
    for (const [key, value] of Object.entries({
      BRAMBLED_STATUS_URL: previous.status,
      BRAMBLE_DATA_RELAYS: previous.relays,
      BRAMBLE_RENDEZVOUS_PAYMENT_URL: previous.rendezvous,
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('no-feed topology preserves ENS membership and granted and revoked requests without inventing admission', async () => {
  const chain = new MemoryChain()
  const api = createApprovalApi({
    token: () => 'network-test-only',
    signer: chain,
    resolver: chain,
    network: createNetworkSource({ baseUrl: () => undefined }),
    joinChain: {
      async labelTaken() {
        return false
      },
      async enroll() {
        throw new Error('Not used by this read-only fixture')
      },
      async revokeDevice() {
        throw new Error('Not used by this read-only fixture')
      },
      async members() {
        return [{ label: 'laptop', meshIp: '10.77.0.2', revoked: true, expiry: 4102444800 }]
      },
    },
    ensParent: 'bramble.eth',
  })
  const created = await (
    await api.handle(apiRequest('/requests', { agentLabel: 'agent-1', gatewayLabel: 'gateway-1', service: 'tasks' }))
  ).json()
  await api.handle(apiRequest(`/requests/${created.id}/approve`, {}))
  let view = await (await api.handle(apiRequest('/network'))).json()
  expect(view.nodes.find((node: { label: string }) => node.label === 'laptop.bramble.eth')).toMatchObject({
    membership: 'revoked',
    admission: 'unavailable',
    path: 'unavailable',
    lastHandshake: null,
  })
  expect(view.nodes.find((node: { label: string }) => node.label === 'agent-1.bramble.eth').grants).toEqual([
    expect.objectContaining({ state: 'approved' }),
  ])
  await api.handle(apiRequest('/grants/agent-1/revoke', {}))
  view = await (await api.handle(apiRequest('/network'))).json()
  expect(view.nodes.find((node: { label: string }) => node.label === 'agent-1.bramble.eth').grants).toEqual([
    expect.objectContaining({ state: 'revoked' }),
  ])
  expect(JSON.stringify(view)).not.toContain('10.77.')
  const noParent = createApprovalApi({
    token: () => 'network-test-only',
    network: createNetworkSource({ baseUrl: () => undefined }),
  })
  await noParent.handle(apiRequest('/requests', { agentLabel: 'agent-1', gatewayLabel: 'gateway-1', service: 'tasks' }))
  expect((await (await noParent.handle(apiRequest('/network'))).json()).nodes).toContainEqual(
    expect.objectContaining({ id: 'gateway', label: 'gateway-1' })
  )
})
