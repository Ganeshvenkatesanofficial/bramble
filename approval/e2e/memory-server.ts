/** Browser-only harness. Never imported by the Next runtime. No chain writes. */
import { createApprovalApi } from '../src/lib/api'
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
let api = createApprovalApi({ token: () => 'browser-test-only', signer: chain, resolver: chain })
Bun.serve({
  hostname: '127.0.0.1',
  port: 3101,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/__test/reset' && request.method === 'POST') {
      chain.grants.clear()
      chain.failGrant = false
      api = createApprovalApi({ token: () => 'browser-test-only', signer: chain, resolver: chain })
      return Response.json({ reset: true })
    }
    if (url.pathname === '/__test/fail-grant' && request.method === 'POST') {
      chain.failGrant = true
      return Response.json({ failureEnabled: true })
    }
    if (url.pathname.startsWith('/api/')) return api.handle(request)
    url.port = '3001'
    return fetch(new Request(url, request))
  },
})
