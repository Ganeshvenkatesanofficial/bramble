import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { x25519 } from '@noble/curves/ed25519'
import { bytesToHex } from '@noble/hashes/utils'
import { aclDigestECDH } from '../../admincli/src/roles'
import type { PendingTx, Resolver, Signer } from '../../admincli/src/lib'
import { createApprovalApi } from '../src/lib/api'
import { createChainAdapters, type DeviceFacts } from '../src/lib/chain'
import { ManualClock } from './clock'

const TAILNET = 'mesh.eth'
const token = randomUUID()
const input = { agentLabel: 'agent-1', gatewayLabel: 'gateway-1', service: 'staging' }
const FAR_FUTURE = '4102444800'

function identity() {
  const priv = x25519.utils.randomPrivateKey()
  return { priv: bytesToHex(priv), pub: bytesToHex(x25519.getPublicKey(priv)) }
}

type WaitBehavior = 'ok' | 'revert' | 'fail-but-landed'

/** In-memory ENS: text records, device facts, and a signer whose confirmation can misbehave. */
function memoryEns() {
  const granter = identity()
  const gateway = identity()
  const agent = identity()
  const records = new Map<string, string>([
    [`granter.${TAILNET}|pubkey`, granter.pub],
    [`gateway-1.${TAILNET}|pubkey`, gateway.pub],
    [`agent-1.${TAILNET}|pubkey`, agent.pub],
  ])
  const devices = new Map<string, DeviceFacts>(
    ['agent-1', 'gateway-1'].map((label) => [
      label,
      { pubkey: records.get(`${label}.${TAILNET}|pubkey`) ?? null, revoked: false, expiry: FAR_FUTURE },
    ])
  )
  const writes: Array<{ name: string; key: string; value: string }> = []
  const state = { wait: 'ok' as WaitBehavior, staleReads: 0, keyLoads: 0, granterKey: granter.priv }

  const resolver: Resolver = {
    async getText(name, key) {
      if (key === 'acl' && state.staleReads > 0) {
        state.staleReads -= 1
        return null
      }
      const value = records.get(`${name}|${key}`)
      return value ? value : null
    },
  }
  const signer: Signer = {
    async setText(name, key, value): Promise<PendingTx> {
      writes.push({ name, key, value })
      const hash = `0x${writes.length.toString(16).padStart(64, '0')}`
      const behavior = state.wait
      if (behavior !== 'revert') records.set(`${name}|${key}`, value)
      return {
        hash,
        async wait() {
          if (behavior === 'revert') throw new Error('setText reverted on-chain')
          if (behavior === 'fail-but-landed') throw new Error('timed out waiting for the receipt')
        },
      }
    },
  }
  const adapters = createChainAdapters({
    resolver,
    signer,
    tailnetName: TAILNET,
    granterLabel: 'granter',
    readDevice: async (label) => devices.get(label) ?? { pubkey: null, revoked: false, expiry: '0' },
    loadGranterKey: async () => {
      state.keyLoads += 1
      return state.granterKey
    },
    sleep: async () => {},
  })
  const digest = aclDigestECDH(granter.priv, gateway.pub, agent.pub, input.service)
  return { granter, gateway, agent, records, devices, writes, state, adapters, digest }
}

function call(path: string, method = 'GET', body?: unknown) {
  return new Request(`http://localhost/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function service(chain = memoryEns(), clock = new ManualClock()) {
  const api = createApprovalApi({
    token: () => token,
    signer: chain.adapters.signer,
    resolver: chain.adapters.resolver,
    clock,
  })
  const suggest = async () => (await (await api.handle(call('/requests', 'POST', input))).json()) as { id: string }
  const approve = (id: string) => api.handle(call(`/requests/${id}/approve`, 'POST'))
  const revoke = () => api.handle(call('/grants/agent-1/revoke', 'POST'))
  return { api, chain, clock, suggest, approve, revoke }
}

describe('identity facts from ENS', () => {
  test('reports label, published pubkey, revoked flag and expiry', async () => {
    const { adapters, devices } = memoryEns()
    expect(await adapters.resolver.resolveIdentity('agent-1')).toEqual({
      label: 'agent-1',
      pubkeyPublished: true,
      revoked: false,
      expiry: 4_102_444_800,
    })
    devices.set('agent-1', { pubkey: null, revoked: true, expiry: FAR_FUTURE })
    expect(await adapters.resolver.resolveIdentity('agent-1')).toMatchObject({ pubkeyPublished: false, revoked: true })
  })

  test('a label that was never registered has no identity', async () => {
    expect(await memoryEns().adapters.resolver.resolveIdentity('ghost')).toBeNull()
  })

  test('hasGrant reads the acl record fresh', async () => {
    const { adapters, records } = memoryEns()
    expect(await adapters.resolver.hasGrant('agent-1')).toBe(false)
    records.set(`agent-1.${TAILNET}|acl`, 'abc123')
    expect(await adapters.resolver.hasGrant('agent-1')).toBe(true)
    records.set(`agent-1.${TAILNET}|acl`, '')
    expect(await adapters.resolver.hasGrant('agent-1')).toBe(false)
  })
})

describe('approval service over the admincli signer', () => {
  test('approve writes the ECDH digest, never the service name, and returns the transaction hash', async () => {
    const s = service()
    const { id } = await s.suggest()
    expect(s.chain.writes).toEqual([])
    const response = await s.approve(id)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('approved')
    expect(body.grantTransaction.transactionHash).toBe(`0x${'1'.padStart(64, '0')}`)
    expect(s.chain.writes).toEqual([{ name: `agent-1.${TAILNET}`, key: 'acl', value: s.chain.digest }])
    expect(JSON.stringify(s.chain.writes)).not.toContain(input.service)
    expect(s.chain.state.keyLoads).toBe(1)
  })

  test('the granter key never appears in a response or an ENS write', async () => {
    const s = service()
    const { id } = await s.suggest()
    const texts = [await (await s.approve(id)).text(), await (await s.revoke()).text(), JSON.stringify(s.chain.writes)]
    for (const text of texts) expect(text).not.toContain(s.chain.granter.priv)
  })

  test('revoke clears the whole acl record and a second revoke reports not_granted without a write', async () => {
    const s = service()
    s.chain.records.set(`agent-1.${TAILNET}|acl`, 'abc123')
    const early = await s.revoke()
    expect((await early.json()).status).toBe('revoked')
    expect(s.chain.records.get(`agent-1.${TAILNET}|acl`)).toBe('')
    const again = await s.revoke()
    expect(again.status).toBe(409)
    expect((await again.json()).error.code).toBe('not_granted')
    expect(s.chain.writes).toHaveLength(1)
  })

  test('grant then revoke round-trips the record', async () => {
    const s = service()
    const { id } = await s.suggest()
    await s.approve(id)
    expect(s.chain.records.get(`agent-1.${TAILNET}|acl`)).toBe(s.chain.digest)
    const revoked = await (await s.revoke()).json()
    expect(revoked.status).toBe('revoked')
    expect(s.chain.records.get(`agent-1.${TAILNET}|acl`)).toBe('')
  })

  test('a revoked, unpublished or expired ENS identity blocks approval before any write', async () => {
    for (const facts of [
      { pubkey: 'ab', revoked: true, expiry: FAR_FUTURE },
      { pubkey: null, revoked: false, expiry: FAR_FUTURE },
      { pubkey: 'ab', revoked: false, expiry: '1' },
    ]) {
      const s = service()
      s.chain.devices.set('gateway-1', facts)
      const { id } = await s.suggest()
      const response = await s.approve(id)
      expect(response.status).toBe(409)
      expect((await response.json()).error.code).toBe('identity_not_active')
      expect(s.chain.writes).toEqual([])
    }
  })

  test('an existing acl record blocks a second approval', async () => {
    const s = service()
    s.chain.records.set(`agent-1.${TAILNET}|acl`, 'abc123')
    const { id } = await s.suggest()
    const response = await s.approve(id)
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('already_granted')
    expect(s.chain.writes).toEqual([])
  })

  test('a granter key that does not match the granter pubkey fails closed without leaking either key', async () => {
    const s = service()
    s.chain.state.granterKey = identity().priv
    const { id } = await s.suggest()
    const response = await s.approve(id)
    const text = await response.text()
    expect(response.status).toBe(502)
    expect(JSON.parse(text).error.code).toBe('grant_failed')
    expect(text).not.toContain(s.chain.state.granterKey)
    expect(s.chain.writes).toEqual([])
    expect((await (await s.api.handle(call(`/requests/${id}`))).json()).status).toBe('pending')
  })

  test('a duration grant is revoked by the timer through the same signer', async () => {
    const s = service()
    const created = await (await s.api.handle(call('/requests', 'POST', { ...input, requestedDuration: 60 }))).json()
    await s.approve(created.id)
    expect(s.chain.records.get(`agent-1.${TAILNET}|acl`)).toBe(s.chain.digest)
    await s.clock.advance(61_000)
    expect(s.chain.records.get(`agent-1.${TAILNET}|acl`)).toBe('')
    expect((await (await s.api.handle(call(`/requests/${created.id}`))).json()).status).toBe('revoked')
  })
})

describe('ambiguous write failures are reconciled against chain state', () => {
  test('a confirmation error after the write landed is reported as the confirmed grant', async () => {
    const s = service()
    s.chain.state.wait = 'fail-but-landed'
    const { id } = await s.suggest()
    const response = await s.approve(id)
    expect(response.status).toBe(200)
    expect((await response.json()).grantTransaction.transactionHash).toBe(`0x${'1'.padStart(64, '0')}`)
  })

  test('a lagging read is retried before the grant is declared failed', async () => {
    const s = service()
    s.chain.state.wait = 'fail-but-landed'
    const { id } = await s.suggest()
    // Three stale reads: grantAcl's own round-trip does not run (wait threw), so the first
    // reconcile reads go stale and a later attempt sees the record.
    s.chain.state.staleReads = 2
    expect((await s.approve(id)).status).toBe(200)
  })

  test('a reverted grant is a failure and the request returns to pending', async () => {
    const s = service()
    s.chain.state.wait = 'revert'
    const { id } = await s.suggest()
    const response = await s.approve(id)
    expect(response.status).toBe(502)
    expect((await response.json()).error.code).toBe('grant_failed')
    expect((await (await s.api.handle(call(`/requests/${id}`))).json()).status).toBe('pending')
    expect(s.chain.records.has(`agent-1.${TAILNET}|acl`)).toBe(false)
  })

  test('a confirmation error after the revoke landed is reported as revoked', async () => {
    const s = service()
    const { id } = await s.suggest()
    await s.approve(id)
    s.chain.state.wait = 'fail-but-landed'
    const response = await s.revoke()
    expect(response.status).toBe(200)
    expect((await response.json()).status).toBe('revoked')
    expect(s.chain.records.get(`agent-1.${TAILNET}|acl`)).toBe('')
  })

  test('a reverted revoke is a failure and the grant stays approved', async () => {
    const s = service()
    const { id } = await s.suggest()
    await s.approve(id)
    s.chain.state.wait = 'revert'
    const response = await s.revoke()
    expect(response.status).toBe(502)
    expect((await response.json()).error.code).toBe('revoke_failed')
    expect((await (await s.api.handle(call(`/requests/${id}`))).json()).status).toBe('approved')
    expect(s.chain.records.get(`agent-1.${TAILNET}|acl`)).toBe(s.chain.digest)
  })
})
