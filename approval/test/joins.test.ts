import { expect, test } from 'bun:test'
import { createApprovalApi } from '../src/lib/api'
import { memoryEnrollChain } from '../../admincli/src/enroll-memory'
import { createJoinChain } from '../src/lib/join-chain'
import { createViemEnrollChain } from '../../admincli/src/enroll-chain-viem'
import type { EnrollChain } from '../../admincli/src/lib'
import { createPublicClient, http, type TransactionReceipt } from 'viem'
import { sepolia } from 'viem/chains'

const input = { label: 'laptop', pubkey: 'ab'.repeat(32), tailnet: 'mesh.eth' }
function setup(setTextAt?: EnrollChain['setTextAt']) {
  const memory = memoryEnrollChain({ tailnetName: 'mesh.eth' })
  const joinChain = createJoinChain({
    ...memory,
    readbackDelayMs: 0,
    signer: {
      async setText(name, key, value) {
        const hash = await (setTextAt ?? memory.chain.setTextAt)('', name, key, value)
        return { hash, async wait() {} }
      },
    },
    async members() {
      return Promise.all(
        [...memory.registered].map(async (label) => ({
          label,
          meshIp: await memory.resolver.getText(`${label}.mesh.eth`, 'mesh-ip'),
          pubkey: await memory.resolver.getText(`${label}.mesh.eth`, 'pubkey'),
          revoked: (await memory.resolver.getText(`${label}.mesh.eth`, 'revoked')) === 'true',
          expiry: 4102444800,
        }))
      )
    },
  })
  const newApi = () => createApprovalApi({ token: () => 'test-only', ensParent: 'mesh.eth', joinChain })
  const api = newApi()
  const call = (path: string, method = 'GET', body?: unknown, admin = true) =>
    api.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(admin ? { authorization: 'Bearer test-only' } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    )
  return { memory, api, call, newApi }
}

test('open join appears in the gated queue, approval enrolls with mesh IP, and revoke disables membership', async () => {
  const { call, memory } = setup()
  const response = await call('/joins', 'POST', input, false)
  expect(response.status).toBe(201)
  const created = await response.json()
  expect(created.status).toBe('pending')
  expect((await (await call('/joins')).json()).joins).toContainEqual(
    expect.objectContaining({ id: created.id, label: 'laptop', status: 'pending' })
  )
  expect((await call('/joins', 'GET', undefined, false)).status).toBe(401)
  expect((await call('/members', 'GET', undefined, false)).status).toBe(401)
  const approved = await (await call(`/joins/${created.id}/approve`, 'POST')).json()
  expect(approved).toMatchObject({ status: 'approved', meshIp: '10.77.0.2' })
  expect(memory.steps).toEqual(['deploy', 'register', 'setText:pubkey', 'setText:mesh-ip'])
  expect((await (await call(`/joins/${created.id}`, 'GET', undefined, false)).json()).meshIp).toBe('10.77.0.2')
  expect((await (await call('/members')).json()).members).toContainEqual(
    expect.objectContaining({ id: created.id, status: 'approved', meshIp: '10.77.0.2' })
  )
  expect((await call(`/joins/${created.id}/approve`, 'POST')).status).toBe(409)
  expect((await (await call(`/joins/${created.id}/revoke`, 'POST')).json()).status).toBe('revoked')
  expect(await memory.resolver.getText('laptop.mesh.eth', 'revoked')).toBe('true')
  expect((await (await call('/members')).json()).members[0].status).toBe('revoked')
})

test('join validation and bounded open submission reject invalid data without membership writes', async () => {
  const { call, memory } = setup()
  for (const body of [
    { ...input, label: 'Bad.Name' },
    { ...input, pubkey: '00' },
    { ...input, tailnet: 'other.eth' },
    { ...input, admin: true },
  ]) {
    expect((await call('/joins', 'POST', body, false)).status).toBe(400)
  }
  for (let i = 0; i < 26; i++) expect((await call('/joins', 'POST', input, false)).status).toBe(201)
  const limited = await call('/joins', 'POST', input, false)
  expect(limited.status).toBe(429)
  expect(limited.headers.get('retry-after')).toBe('60')
  expect(memory.steps).toEqual([])
})

test('all admin decisions require a token; denied joins never enroll', async () => {
  const { call, memory } = setup()
  const { id } = await (await call('/joins', 'POST', input, false)).json()
  for (const action of ['approve', 'deny', 'revoke'])
    expect((await call(`/joins/${id}/${action}`, 'POST', undefined, false)).status).toBe(401)
  expect((await (await call(`/joins/${id}/deny`, 'POST')).json()).status).toBe('denied')
  expect((await call(`/joins/${id}/approve`, 'POST')).status).toBe(409)
  expect((await call(`/joins/${id}/revoke`, 'POST')).status).toBe(409)
  expect(memory.steps).toEqual([])
})

test('partial enrollment resumes and signer failures do not report approval or expose diagnostics', async () => {
  const { call, memory } = setup()
  const { id } = await (await call('/joins', 'POST', input)).json()
  memory.failNext('setText:mesh-ip')
  expect((await call(`/joins/${id}/approve`, 'POST')).status).toBe(502)
  const pending = await (await call(`/joins/${id}`)).json()
  expect(pending.status).toBe('pending')
  expect(pending.meshIp).toBeUndefined()
  expect((await (await call('/members')).json()).members[0].status).toBe('pending')
  expect((await call(`/joins/${id}/deny`, 'POST')).status).toBe(409)
  expect((await call(`/joins/${id}/approve`, 'POST')).status).toBe(200)
  expect(memory.steps.filter((step) => step === 'deploy')).toHaveLength(1)
  memory.failNext('setText:revoked')
  const failed = await call(`/joins/${id}/revoke`, 'POST')
  expect(failed.status).toBe(502)
  expect(await failed.text()).not.toContain('injected')
  expect((await (await call(`/joins/${id}`)).json()).status).toBe('approved')
  expect((await call(`/joins/${id}/revoke`, 'POST')).status).toBe(200)
})

test('members survive an API restart and can be revoked through their discovered IDs', async () => {
  const { call, newApi } = setup()
  const { id } = await (await call('/joins', 'POST', input)).json()
  await call(`/joins/${id}/approve`, 'POST')
  const fresh = newApi()
  const admin = { authorization: 'Bearer test-only' }
  const members = await (await fresh.handle(new Request('http://localhost/api/members', { headers: admin }))).json()
  expect(members.members[0]).toMatchObject({ id: 'member:laptop', label: 'laptop', status: 'approved' })
  const revoked = await fresh.handle(
    new Request('http://localhost/api/joins/member%3Alaptop/revoke', { method: 'POST', headers: admin })
  )
  expect((await revoked.json()).status).toBe('revoked')
  expect((await fresh.handle(new Request('http://localhost/api/joins/missing'))).status).toBe(404)
})

test('an incomplete enrollment reserves allocation until its retry completes', async () => {
  const { call, memory } = setup()
  const first = await (await call('/joins', 'POST', input)).json()
  const second = await (await call('/joins', 'POST', { ...input, label: 'phone' })).json()
  memory.failNext('setText:mesh-ip')
  expect((await call(`/joins/${first.id}/approve`, 'POST')).status).toBe(502)
  expect((await call(`/joins/${second.id}/approve`, 'POST')).status).toBe(409)
  expect((await call(`/joins/${first.id}/approve`, 'POST')).status).toBe(200)
  expect((await (await call(`/joins/${second.id}/approve`, 'POST')).json()).meshIp).toBe('10.77.0.3')
})

test('ENS-invalid ASCII labels are rejected before they can reserve enrollment', async () => {
  const { call, memory } = setup()
  for (const label of ['ab--cd', 'xn--a']) {
    expect((await call('/joins', 'POST', { ...input, label }, false)).status).toBe(400)
  }
  const created = await (await call('/joins', 'POST', input)).json()
  expect((await call(`/joins/${created.id}/approve`, 'POST')).status).toBe(200)
  expect(memory.steps).toHaveLength(4)
})

test('confirmed device revocation survives a stale read-back without duplicate writes', async () => {
  const { call, memory } = setup()
  const { id } = await (await call('/joins', 'POST', input)).json()
  await call(`/joins/${id}/approve`, 'POST')
  const read = memory.resolver.getText
  memory.resolver.getText = async (name, key) => (key === 'revoked' ? 'false' : read(name, key))
  const revoked = await call(`/joins/${id}/revoke`, 'POST')
  expect(revoked.status).toBe(200)
  expect((await revoked.json()).status).toBe('revoked')
  expect((await (await call(`/joins/${id}`)).json()).status).toBe('revoked')
  expect((await call(`/joins/${id}/revoke`, 'POST')).status).toBe(409)
  expect((await (await call('/members')).json()).members[0].status).toBe('revoked')
  expect(memory.steps.filter((step) => step === 'setText:revoked')).toHaveLength(1)
})

test('a cancelled revoke transaction is not reported as revoked, even with a stale read-back', async () => {
  // The real viem enrollment chain behind a loopback wallet RPC; only the receipt boundary is faked.
  const sent = `0x${'1'.repeat(64)}` as const
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const { id, method } = (await request.json()) as { id: number; method: string }
      return Response.json({ jsonrpc: '2.0', id, result: method === 'eth_chainId' ? '0xaa36a7' : sent })
    },
  })
  try {
    const publicClient = {
      ...createPublicClient({ chain: sepolia, transport: http(server.url.href) }),
      async waitForTransactionReceipt({ onReplaced }: { onReplaced?: (r: { reason: 'cancelled' }) => void }) {
        onReplaced?.({ reason: 'cancelled' })
        return { status: 'success', logs: [], transactionHash: `0x${'b'.repeat(64)}` } as unknown as TransactionReceipt
      },
    }
    const viemChain = createViemEnrollChain({
      account: { address: `0x${'1'.repeat(40)}`, type: 'json-rpc' },
      publicClient: publicClient as never,
      chain: sepolia,
      rpcUrl: server.url.href,
    })
    let cancelRevoke = false
    const { call, memory } = setup((resolver, name, key, value) =>
      cancelRevoke
        ? viemChain.setTextAt(`0x${'2'.repeat(40)}`, name, key, value)
        : memory.chain.setTextAt(resolver, name, key, value)
    )
    const { id } = await (await call('/joins', 'POST', input)).json()
    expect((await call(`/joins/${id}/approve`, 'POST')).status).toBe(200)
    cancelRevoke = true
    const revoked = await call(`/joins/${id}/revoke`, 'POST')
    expect(revoked.status).toBe(502)
    expect((await (await call(`/joins/${id}`)).json()).status).toBe('approved')
    expect(await memory.resolver.getText('laptop.mesh.eth', 'revoked')).not.toBe('true')
  } finally {
    server.stop(true)
  }
})
