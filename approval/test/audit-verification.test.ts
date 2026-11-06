import { expect, test } from 'bun:test'
import fixture from '../src/fixtures/hcs-audit.json' with { type: 'json' }
import { verifyAuditFeed } from '../src/lib/audit-verification'
import type { AuditOpening } from '../../hedera-audit/src/types'
import { MirrorTopicReader } from '../../hedera-audit/src/mirror'

const source = {
  list: () => fixture.rows,
  opening: (id: string) => fixture.openings[id as keyof typeof fixture.openings] as AuditOpening,
}
const reader = new MirrorTopicReader({
  mirrorBaseUrl: 'https://mirror.invalid',
  fetch: async (url) => {
    const after = Number(new URL(url).searchParams.get('sequencenumber')?.split(':')[1] ?? 0)
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: fixture.messages.filter((m) => m.sequence_number > after).slice(0, 1) }),
    }
  },
})

test('grant, payment and revoke mirror fixtures reproduce independently calculated commitments', async () => {
  const feed = await verifyAuditFeed(source, reader)
  expect(feed.entries.map((entry) => entry.verification)).toEqual(['verified', 'verified', 'verified'])
  expect(feed.entries[0].hashscanUrl).toBe('https://hashscan.io/testnet/transaction/1793932201.000000001')
  expect(JSON.stringify(feed)).not.toContain('salt')
  expect(JSON.stringify(feed)).not.toContain('demo-agent.example.eth')
})

test('missing openings and changed event fields never report a verified match', async () => {
  const absent = await verifyAuditFeed({ ...source, opening: () => undefined }, reader)
  expect(absent.entries.map((entry) => entry.verification)).toEqual(['unopened', 'unopened', 'unopened'])
  const changed = await verifyAuditFeed(
    { ...source, opening: (id) => ({ ...source.opening(id), salt: '00'.repeat(32) }) },
    reader
  )
  expect(changed.entries.map((entry) => entry.verification)).toEqual(['mismatch', 'mismatch', 'mismatch'])
})

test('mirror delays, failures, malformed payloads and receipt mismatches remain distinct', async () => {
  const missing = await verifyAuditFeed(source, { listEntries: async () => [] })
  expect(missing.entries[0].verification).toBe('mirror_pending')
  const failed = await verifyAuditFeed(source, {
    listEntries: async () => {
      throw new Error('private upstream detail')
    },
  })
  expect(failed.entries[0].verification).toBe('unavailable')
  const [entry] = await reader.listEntries('0.0.900001', { limit: 1 })
  const malformed = await verifyAuditFeed(source, { listEntries: async () => [{ ...entry, message: null }] })
  expect(malformed.entries[0].verification).toBe('malformed')
  const mismatch = await verifyAuditFeed(source, {
    listEntries: async () => [{ ...entry, message: { v: 1, kind: 'grant', c: '00'.repeat(32) } }],
  })
  expect(mismatch.entries[0].verification).toBe('mismatch')
  const wrongSequence = await verifyAuditFeed(source, { listEntries: async () => [{ ...entry, sequenceNumber: 99 }] })
  expect(wrongSequence.entries[0].verification).toBe('mirror_pending')
})

test('pending posts, failed posts and invalid receipts never query the mirror', async () => {
  const feed = await verifyAuditFeed(
    {
      ...source,
      list: () => [
        { ...fixture.rows[0], status: 'pending' },
        { ...fixture.rows[1], status: 'failed' },
        { ...fixture.rows[2], topicId: '../../unexpected' },
      ],
    },
    {
      listEntries: async () => {
        throw new Error('must not query')
      },
    }
  )
  expect(feed.entries.map((entry) => entry.verification)).toEqual(['pending', 'failed', 'malformed'])
})

test('verification HTTP boundary requires authorization and never returns an opening or upstream error', async () => {
  const { createAuditVerificationApi } = await import('../src/lib/audit-verification')
  const api = createAuditVerificationApi({ token: () => 'test-only', source: () => source, reader })
  expect((await api(new Request('http://local/api/audit/verification'))).status).toBe(401)
  const request = new Request('http://local/api/audit/verification', { headers: { authorization: 'Bearer test-only' } })
  const response = await api(request)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const body = await response.text()
  expect(body).not.toContain('salt')
  expect(body).not.toContain('serviceDigest')
  const missing = createAuditVerificationApi({ token: () => 'test-only', source: () => undefined })
  expect((await missing(request)).status).toBe(503)
})

test('approval API exposes verification only to an authorized reader and reads its own recorder', async () => {
  const { createApprovalApi } = await import('../src/lib/api')
  const api = createApprovalApi({ token: () => 'test-only' })
  expect((await api.handle(new Request('http://local/api/audit/verification'))).status).toBe(401)
  const response = await api.handle(
    new Request('http://local/api/audit/verification', { headers: { authorization: 'Bearer test-only' } })
  )
  expect(response.status).toBe(200)
  expect((await response.json()).entries).toEqual([])
})
