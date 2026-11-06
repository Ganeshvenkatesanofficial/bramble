/** Browser-only harness. Never imported by the Next runtime. No chain writes. */
import { createApprovalApi } from '../src/lib/api'
import { MemoryChain } from '../test/memory-chain'
import { memoryEnrollChain } from '../../admincli/src/enroll-memory'
import { createJoinChain } from '../src/lib/join-chain'

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
function freshApi() {
  const memory = memoryEnrollChain({ tailnetName: 'mesh.eth' })
  return createApprovalApi({
    token: () => 'browser-test-only',
    signer: chain,
    resolver: chain,
    ensParent: 'mesh.eth',
    joinChain: createJoinChain({
      ...memory,
      readbackDelayMs: 0,
      signer: {
        async setText(name, key, value) {
          const hash = await memory.chain.setTextAt('', name, key, value)
          return { hash, async wait() {} }
        },
      },
      async members() {
        return Promise.all(
          [...memory.registered].map(async (label) => ({
            label,
            pubkey: await memory.resolver.getText(`${label}.mesh.eth`, 'pubkey'),
            meshIp: await memory.resolver.getText(`${label}.mesh.eth`, 'mesh-ip'),
            revoked: (await memory.resolver.getText(`${label}.mesh.eth`, 'revoked')) === 'true',
            expiry: 4102444800,
          }))
        )
      },
    }),
  })
}
let api = freshApi()
Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.BRAMBLE_TEST_API_PORT ?? 3101),
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/__test/reset' && request.method === 'POST') {
      offline = false
      chain.grants.clear()
      chain.failGrant = false
      api = freshApi()
      return Response.json({ reset: true })
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
    url.port = process.env.BRAMBLE_TEST_UI_PORT ?? '3001'
    const upstream = await fetch(new Request(url, request))
    // Bun decompresses upstream bodies; remove wire encoding/length before proxying.
    const headers = new Headers(upstream.headers)
    headers.delete('content-encoding')
    headers.delete('content-length')
    return new Response(upstream.body, { status: upstream.status, headers })
  },
})
