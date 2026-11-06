import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { HcsAuditTrail, parseMessage, verifyOpening } from '@bramble/hedera-audit'
import { createApprovalApi } from '../src/lib/api'
import { UnresolvedWriteError, type GrantSigner, type SettleOutcome } from '../src/lib/contracts'
import { ManualClock } from './clock'
import { FakeTopic } from './fake-topic'
import { MemoryChain } from './memory-chain'

const token = randomUUID()
const input = { agentLabel: 'agent-1', gatewayLabel: 'gateway-1', service: 'web' }
const DIGEST = `0x${'ab'.repeat(32)}`
const payment = {
  payer: '0.0.1001',
  payee: '0.0.2002',
  asset: '0.0.429274',
  amountAtomic: '2500',
  txRef: '0.0.1001@1700000000.123456789',
}

/** Signer that reports the ADR 0005 digest the way the real signer will. */
class DigestChain extends MemoryChain implements GrantSigner {
  override async grant(grantInput: Parameters<MemoryChain['grant']>[0]) {
    const receipt = await super.grant(grantInput)
    return { ...receipt, serviceDigest: DIGEST }
  }
}

/** A signer whose next write is submitted but not yet confirmed; `outcome` is what its receipt later says. */
class UnresolvedChain extends DigestChain {
  unresolved?: 'grant' | 'revoke'
  outcome: SettleOutcome = 'unresolved'
  /** The digest the late grant reports, as the real signer does; none reproduces a signer without one. */
  lateDigest?: string
  override async grant(grantInput: Parameters<MemoryChain['grant']>[0]) {
    if (this.unresolved === 'grant') {
      throw new UnresolvedWriteError('grant', 'late-grant-1', async () => this.outcome, this.lateDigest)
    }
    return super.grant(grantInput)
  }
  override async revoke(label: string) {
    if (this.unresolved === 'revoke') {
      throw new UnresolvedWriteError('revoke', 'late-revoke-1', async () => this.outcome)
    }
    return super.revoke(label)
  }
}

function setup(options: { clock?: ManualClock; ensParent?: string; chain?: DigestChain } = {}) {
  const { chain = new DigestChain(), ...rest } = options

  const topic = new FakeTopic()
  const trail = new HcsAuditTrail({ client: topic, topicId: '0.0.9000' })
  const api = createApprovalApi({
    token: () => token,
    signer: chain,
    resolver: chain,
    auditTrail: trail,
    ...rest,
  })
  const call = (path: string, method = 'GET', body?: unknown) =>
    api.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    )
  const feed = async () => ((await (await call('/audit')).json()) as { entries: Record<string, unknown>[] }).entries
  return { chain, topic, api, call, feed }
}

test('approve posts exactly one grant commitment that opens to the grant and holds no plaintext', async () => {
  const { topic, api, call, feed } = setup({ ensParent: 'acme.eth' })
  const created = await (await call('/requests', 'POST', { ...input, requestedDuration: 60 })).json()
  expect(await feed()).toEqual([])
  const approved = await (await call(`/requests/${created.id}/approve`, 'POST')).json()
  await api.audit.idle()
  expect(topic.submitted).toHaveLength(1)
  const raw = new TextDecoder().decode(topic.submitted[0])
  for (const secret of ['agent-1', 'acme.eth', 'web', DIGEST, 'test-grant-1']) expect(raw).not.toContain(secret)
  const message = parseMessage(topic.submitted[0])!
  expect(message.kind).toBe('grant')
  const [entry] = await feed()
  expect(entry).toMatchObject({
    kind: 'grant',
    status: 'posted',
    requestId: created.id,
    commitment: message.c,
    topicId: '0.0.9000',
    sequenceNumber: '1',
  })
  expect(approved.grantAuditId).toBe(entry.id)
  const opening = api.audit.opening(entry.id as string)!
  expect(opening.event).toEqual({
    kind: 'grant',
    subject: 'agent-1.acme.eth',
    serviceDigest: DIGEST,
    expiresAt: String(Math.floor(Date.parse(approved.expiresAt) / 1000)),
    txRef: 'test-grant-1',
  })
  expect(verifyOpening(message, opening)).toBe(true)
  expect(JSON.stringify(await feed())).not.toMatch(/agent-1|acme\.eth|web|test-grant/)
})

test('revoke posts one revoke commitment, and a duplicate or failed revoke posts none', async () => {
  const { topic, api, call, feed } = setup()
  const created = await (await call('/requests', 'POST', input)).json()
  await call(`/requests/${created.id}/approve`, 'POST')
  expect((await call('/grants/agent-1/revoke', 'POST')).status).toBe(200)
  expect((await call('/grants/agent-1/revoke', 'POST')).status).toBe(409)
  await api.audit.idle()
  expect(topic.submitted.map((bytes) => parseMessage(bytes)!.kind)).toEqual(['grant', 'revoke'])
  const entries = await feed()
  const revoke = entries[1]
  const opening = api.audit.opening(revoke.id as string)!
  expect(opening.event).toEqual({ kind: 'revoke', subject: 'agent-1', serviceDigest: DIGEST, txRef: 'test-revoke-2' })
  expect(verifyOpening(parseMessage(topic.submitted[1])!, opening)).toBe(true)
  expect((await (await call(`/requests/${created.id}`)).json()).revokeAuditId).toBe(revoke.id)
})

test('a duration expiry posts one revoke commitment and a failed signer revoke posts none', async () => {
  const clock = new ManualClock()
  const { chain, topic, api, call } = setup({ clock })
  const created = await (await call('/requests', 'POST', { ...input, requestedDuration: 2 })).json()
  await call(`/requests/${created.id}/approve`, 'POST')
  chain.failRevoke = true
  await clock.advance(2000)
  await api.audit.idle()
  expect(topic.submitted).toHaveLength(1)
  chain.failRevoke = false
  await clock.advance(5000)
  await api.audit.idle()
  expect(topic.submitted.map((bytes) => parseMessage(bytes)!.kind)).toEqual(['grant', 'revoke'])
})

test('a revoke that settles late posts its one commitment only once it is confirmed', async () => {
  const clock = new ManualClock()
  const chain = new UnresolvedChain()
  const { topic, api, call, feed } = setup({ clock, chain })
  const created = await (await call('/requests', 'POST', input)).json()
  await call(`/requests/${created.id}/approve`, 'POST')
  chain.unresolved = 'revoke'
  const revoking = await (await call('/grants/agent-1/revoke', 'POST')).json()
  expect(revoking.unresolvedWrite).toEqual({ operation: 'revoke', transactionHash: 'late-revoke-1' })
  await clock.advance(5000)
  await api.audit.idle()
  expect(topic.submitted.map((bytes) => parseMessage(bytes)!.kind)).toEqual(['grant'])
  chain.outcome = 'confirmed'
  await clock.advance(5000)
  await api.audit.idle()
  await clock.advance(5000)
  await api.audit.idle()
  expect(topic.submitted.map((bytes) => parseMessage(bytes)!.kind)).toEqual(['grant', 'revoke'])
  const entries = await feed()
  const opening = api.audit.opening(entries[1].id as string)!
  expect(opening.event).toEqual({ kind: 'revoke', subject: 'agent-1', serviceDigest: DIGEST, txRef: 'late-revoke-1' })
  expect((await (await call(`/requests/${created.id}`)).json()).revokeAuditId).toBe(entries[1].id)
})

test('a grant that settles late shows in the feed, failed while the digest is unknown, and a revert posts nothing', async () => {
  const clock = new ManualClock()
  const chain = new UnresolvedChain()
  chain.unresolved = 'grant'
  const { topic, api, call, feed } = setup({ clock, chain })
  const created = await (await call('/requests', 'POST', input)).json()
  const approved = await (await call(`/requests/${created.id}/approve`, 'POST')).json()
  expect(approved.unresolvedWrite).toMatchObject({ operation: 'grant' })
  expect(await feed()).toEqual([])
  chain.outcome = 'confirmed'
  await clock.advance(5000)
  await api.audit.idle()
  expect(topic.submitted).toEqual([])
  expect(await feed()).toMatchObject([{ kind: 'grant', status: 'failed', error: 'audit_event_unavailable' }])

  const reverted = new UnresolvedChain()
  reverted.unresolved = 'grant'
  const otherClock = new ManualClock()
  const other = setup({ clock: otherClock, chain: reverted })
  const request = await (await other.call('/requests', 'POST', input)).json()
  await other.call(`/requests/${request.id}/approve`, 'POST')
  reverted.outcome = 'reverted'
  await otherClock.advance(5000)
  await other.api.audit.idle()
  expect((await (await other.call(`/requests/${request.id}`)).json()).status).toBe('pending')
  expect(await other.feed()).toEqual([])
})

test('a grant that settles late keeps its digest, so its confirmation and its later revoke each post once', async () => {
  const clock = new ManualClock()
  const chain = new UnresolvedChain()
  chain.unresolved = 'grant'
  chain.lateDigest = DIGEST
  const { topic, api, call, feed } = setup({ clock, chain })
  const created = await (await call('/requests', 'POST', input)).json()
  await call(`/requests/${created.id}/approve`, 'POST')
  await clock.advance(5000)
  await api.audit.idle()
  expect(topic.submitted).toEqual([])
  chain.outcome = 'confirmed'
  await clock.advance(5000)
  await api.audit.idle()
  chain.unresolved = undefined
  chain.grants.add('agent-1')
  await call('/grants/agent-1/revoke', 'POST')
  await api.audit.idle()
  expect(topic.submitted.map((bytes) => parseMessage(bytes)!.kind)).toEqual(['grant', 'revoke'])
  const entries = await feed()
  expect(entries.map((entry) => entry.status)).toEqual(['posted', 'posted'])
  expect(api.audit.opening(entries[0].id as string)!.event).toMatchObject({
    kind: 'grant',
    serviceDigest: DIGEST,
    txRef: 'late-grant-1',
  })
  expect(api.audit.opening(entries[1].id as string)!.event).toMatchObject({ kind: 'revoke', serviceDigest: DIGEST })
})

test('settlements the process observes post one commitment each and are not posted again by later polls', async () => {
  const clock = new ManualClock()
  const sources = [payment, { ...payment, txRef: '0.0.1001@1700000001.000000001' }]
  let polls = 0
  const topic = new FakeTopic()
  const api = createApprovalApi({
    token: () => token,
    clock,
    auditTrail: new HcsAuditTrail({ client: topic, topicId: '0.0.9000' }),
    settlements: async () => {
      polls += 1
      // The mirror feed lists every settled payment in the window on each poll.
      return [...sources, { ...payment, payee: 'not-an-account', txRef: '0.0.1001@1700000002.000000002' }]
    },
    settlementPollMs: 10_000,
  })
  await clock.advance(0)
  await api.audit.idle()
  await clock.advance(10_000)
  await api.audit.idle()
  await clock.advance(10_000)
  await api.audit.idle()
  expect(polls).toBe(3)
  expect(topic.submitted.map((bytes) => parseMessage(bytes)!.kind)).toEqual(['payment', 'payment'])
  // A payment also reported through the endpoint is the same event.
  const reported = await api.handle(
    new Request('http://localhost/api/payments/settled', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payment),
    })
  )
  expect(reported.status).toBe(202)
  await api.audit.idle()
  expect(topic.submitted).toHaveLength(2)
})

test('an unavailable settlement source posts nothing and the next poll retries', async () => {
  const clock = new ManualClock()
  let up = false
  const topic = new FakeTopic()
  const api = createApprovalApi({
    token: () => token,
    clock,
    auditTrail: new HcsAuditTrail({ client: topic, topicId: '0.0.9000' }),
    settlements: async () => {
      if (!up) throw new Error('mirror down')
      return [payment]
    },
    settlementPollMs: 10_000,
  })
  await clock.advance(0)
  await api.audit.idle()
  expect(topic.submitted).toEqual([])
  up = true
  await clock.advance(10_000)
  await api.audit.idle()
  expect(topic.submitted).toHaveLength(1)
})

test('a settled payment posts one commitment; a replay of the same transaction posts none', async () => {
  const { topic, api, call, feed } = setup()
  const first = await call('/payments/settled', 'POST', payment)
  expect(first.status).toBe(202)
  const replay = await call('/payments/settled', 'POST', payment)
  expect((await replay.json()).id).toBe((await first.json()).id)
  await call('/payments/settled', 'POST', { ...payment, txRef: '0.0.1001@1700000001.000000001' })
  await api.audit.idle()
  expect(topic.submitted).toHaveLength(2)
  const [entry] = await feed()
  expect(entry).toMatchObject({ kind: 'payment', status: 'posted' })
  const raw = new TextDecoder().decode(topic.submitted[0])
  for (const secret of [payment.payer, payment.payee, payment.asset, payment.amountAtomic, payment.txRef])
    expect(raw).not.toContain(secret)
  const opening = api.audit.opening(entry.id as string)!
  expect(opening.event).toEqual({ kind: 'payment', ...payment })
  expect(verifyOpening(parseMessage(topic.submitted[0])!, opening)).toBe(true)
  expect(JSON.stringify(await feed())).not.toContain(payment.txRef)
})

test('payment reports need the token and a well-formed body, and post nothing otherwise', async () => {
  const { topic, api, call } = setup()
  const anonymous = await api.handle(
    new Request('http://localhost/api/payments/settled', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payment),
    })
  )
  expect(anonymous.status).toBe(401)
  for (const bad of [
    { ...payment, payer: 'alice' },
    { ...payment, asset: '0.0' },
    { ...payment, amountAtomic: '-1' },
    { ...payment, amountAtomic: '1.5' },
    { ...payment, txRef: '0.0.1001' },
    { ...payment, extra: 'field' },
    { payer: payment.payer },
  ])
    expect((await call('/payments/settled', 'POST', bad)).status).toBe(400)
  await api.audit.idle()
  expect(topic.submitted).toEqual([])
})

test('a failed HCS post never blocks the access decision and shows as failed in the feed', async () => {
  const { chain, topic, api, call, feed } = setup()
  topic.fail = true
  const created = await (await call('/requests', 'POST', input)).json()
  const approved = await call(`/requests/${created.id}/approve`, 'POST')
  expect(approved.status).toBe(200)
  expect(chain.grants.has('agent-1')).toBe(true)
  await api.audit.idle()
  const [grant] = await feed()
  expect(grant).toMatchObject({ kind: 'grant', status: 'failed', error: 'hcs_post_failed' })
  expect(grant.commitment).toBeUndefined()
  const revoked = await call('/grants/agent-1/revoke', 'POST')
  expect(revoked.status).toBe(200)
  expect(chain.grants.has('agent-1')).toBe(false)
  await api.audit.idle()
  expect((await feed()).map((entry) => [entry.kind, entry.status])).toEqual([
    ['grant', 'failed'],
    ['revoke', 'failed'],
  ])
  expect(JSON.stringify(await feed())).not.toContain('sensitive')
  expect(topic.submitted).toEqual([])
})

test('a slow HCS post does not delay the access decision', async () => {
  const { topic, api, call, feed } = setup()
  let release!: () => void
  topic.gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const created = await (await call('/requests', 'POST', input)).json()
  const approved = await call(`/requests/${created.id}/approve`, 'POST')
  expect(approved.status).toBe(200)
  expect((await feed())[0]).toMatchObject({ kind: 'grant', status: 'pending' })
  release()
  await api.audit.idle()
  expect((await feed())[0]).toMatchObject({ kind: 'grant', status: 'posted' })
})

test('posting starts only after the per-agent write lock is released', async () => {
  const chain = new DigestChain()
  const topic = new FakeTopic()
  const real = new HcsAuditTrail({ client: topic, topicId: '0.0.9000' })
  const probes: number[] = []
  const api = createApprovalApi({
    token: () => token,
    signer: chain,
    resolver: chain,
    auditTrail: {
      record: async (event) => {
        if (event.kind === 'grant') probes.push((await call('/grants/agent-1/revoke', 'POST')).status)
        return real.record(event)
      },
    },
  })
  function call(path: string, method = 'GET') {
    return api.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(path === '/requests' ? { body: JSON.stringify(input) } : {}),
      })
    )
  }
  const created = await (await call('/requests', 'POST')).json()
  expect((await call(`/requests/${created.id}/approve`, 'POST')).status).toBe(200)
  await api.audit.idle()
  expect(probes).toEqual([200])
})

test("one agent's lock release never starts another agent's post while that agent still holds its lock", async () => {
  const chain = new DigestChain()
  chain.identities.set('agent-2', { label: 'agent-2', pubkeyPublished: true, revoked: false, expiry: 4_102_444_800 })
  const topic = new FakeTopic()
  const real = new HcsAuditTrail({ client: topic, topicId: '0.0.9000' })
  const probes: Record<string, number> = {}
  const api = createApprovalApi({
    token: () => token,
    signer: chain,
    resolver: chain,
    auditTrail: {
      record: async (event) => {
        if (event.kind === 'grant') {
          const label = event.subject
          probes[label] = (await call(`/grants/${label}/revoke`, 'POST')).status
        }
        return real.record(event)
      },
    },
  })
  function call(path: string, method = 'GET', body?: unknown) {
    return api.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    )
  }
  const ids = await Promise.all(
    ['agent-1', 'agent-2'].map(async (agentLabel) => {
      const created = await (await call('/requests', 'POST', { ...input, agentLabel })).json()
      return created.id as string
    })
  )
  const statuses = await Promise.all(ids.map(async (id) => (await call(`/requests/${id}/approve`, 'POST')).status))
  await api.audit.idle()
  expect(statuses).toEqual([200, 200])
  expect(probes).toEqual({ 'agent-1': 200, 'agent-2': 200 })
})

test('without a trail the decision still succeeds and the feed reports the audit as not configured', async () => {
  const chain = new DigestChain()
  const api = createApprovalApi({ token: () => token, signer: chain, resolver: chain })
  const call = (path: string, method = 'GET', body?: unknown) =>
    api.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    )
  const created = await (await call('/requests', 'POST', input)).json()
  expect((await call(`/requests/${created.id}/approve`, 'POST')).status).toBe(200)
  await api.audit.idle()
  const { entries } = await (await call('/audit')).json()
  expect(entries).toMatchObject([{ kind: 'grant', status: 'failed', error: 'audit_not_configured' }])
})

test('a signer that reports no ACL digest posts nothing and the feed says why', async () => {
  const chain = new MemoryChain()
  const topic = new FakeTopic()
  const api = createApprovalApi({
    token: () => token,
    signer: chain,
    resolver: chain,
    auditTrail: new HcsAuditTrail({ client: topic, topicId: '0.0.9000' }),
  })
  const call = (path: string, method = 'GET') =>
    api.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(method === 'POST' && path === '/requests' ? { body: JSON.stringify(input) } : {}),
      })
    )
  const created = await (await call('/requests', 'POST')).json()
  expect((await call(`/requests/${created.id}/approve`, 'POST')).status).toBe(200)
  expect((await call('/grants/agent-1/revoke', 'POST')).status).toBe(200)
  await api.audit.idle()
  expect(topic.submitted).toEqual([])
  const { entries } = await (await call('/audit')).json()
  expect(entries).toMatchObject([
    { kind: 'grant', status: 'failed', error: 'audit_event_unavailable' },
    { kind: 'revoke', status: 'failed', error: 'audit_event_unavailable' },
  ])
})
