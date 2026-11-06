/** Browser-only harness. Never imported by the Next runtime. No chain writes. */
import { createApprovalApi } from '../src/lib/api'
import { createPaymentsSource, createStatusSource } from '../src/lib/activity'
import { MemoryChain } from '../test/memory-chain'

const chain = new MemoryChain()
chain.beforeGrant = () => Bun.sleep(1500)
const grant = chain.grant.bind(chain)
chain.grant = async (input) => {
  await grant(input)
  return { transactionHash: `0x${'1'.repeat(64)}` }
}
const revoke = chain.revoke.bind(chain)
chain.revoke = async (label) => {
  await Bun.sleep(1500)
  await revoke(label)
  return { transactionHash: `0x${'2'.repeat(64)}` }
}
let offline = false
// Set BRAMBLED_STATUS_URL to read a real brambled statusapi instead of the in-memory events.
const gatewayEvents: unknown[] = []
const status = createStatusSource({
  baseUrl: () => process.env.BRAMBLED_STATUS_URL ?? 'http://gateway.test',
  fetchImpl: process.env.BRAMBLED_STATUS_URL
    ? undefined
    : ((async () => Response.json(gatewayEvents)) as unknown as typeof fetch),
})
const payments = createPaymentsSource({
  configured: () => true,
  handler: async () =>
    Response.json({
      observedAt: new Date().toISOString(),
      agents: [
        {
          agentLabel: 'agent-1',
          payerAccountId: '0.0.123',
          budgetAtomic: '1000000',
          since: '2026-01-01T00:00:00Z',
          perPaymentCapAtomic: '100000',
          spentAtomic: '10000',
          remainingAtomic: '990000',
          payments: [
            {
              transactionId: '0.0.123-1-1',
              consensusTimestamp: `${Math.floor(Date.now() / 1000)}.000000001`,
              amountAtomic: '10000',
              hashscanUrl: 'https://hashscan.io/testnet/transaction/1.000000001',
            },
          ],
        },
      ],
    }),
})
const makeApi = () =>
  createApprovalApi({
    token: () => 'browser-test-only',
    signer: chain,
    resolver: chain,
    activity: { status, payments },
  })
let api = makeApi()
Bun.serve({
  hostname: '127.0.0.1',
  port: 3101,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/__test/reset' && request.method === 'POST') {
      offline = false
      chain.grants.clear()
      chain.failGrant = false
      gatewayEvents.length = 0
      api = makeApi()
      return Response.json({ reset: true })
    }
    if (url.pathname === '/__test/gateway' && request.method === 'POST') {
      gatewayEvents.push({ time: new Date().toISOString(), ...(await request.json()) })
      return Response.json({ events: gatewayEvents.length })
    }
    if (url.pathname === '/__test/fail-grant' && request.method === 'POST') {
      chain.failGrant = true
      return Response.json({ failureEnabled: true })
    }
    if (url.pathname === '/__test/offline' && request.method === 'POST') {
      offline = true
      return Response.json({ offline: true })
    }
    if (offline && url.pathname === '/api/requests' && request.method === 'GET') {
      return Response.json({ error: { message: 'Test connection unavailable' } }, { status: 503 })
    }
    if (url.pathname.startsWith('/api/')) return api.handle(request)
    url.port = '3001'
    const upstream = await fetch(new Request(url, request))
    // Bun decompresses upstream bodies; remove wire encoding/length before proxying.
    const headers = new Headers(upstream.headers)
    headers.delete('content-encoding')
    headers.delete('content-length')
    return new Response(upstream.body, { status: upstream.status, headers })
  },
})
