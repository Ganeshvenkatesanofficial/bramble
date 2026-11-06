import { timingSafeEqual } from 'node:crypto'
import {
  MirrorTopicReader,
  hashscanMessageUrl,
  hashscanTopicUrl,
  verifyEntries,
} from '../../../hedera-audit/src/mirror'
import type { AuditKind, AuditOpening } from '../../../hedera-audit/src/types'

/** Compatible with ETH-48's in-process AuditRecorder. Openings never cross HTTP. */
export interface AuditSource {
  list(): AuditRow[]
  opening(id: string): AuditOpening | undefined
}
export interface AuditRow {
  id: string
  kind: string
  status: string
  createdAt: string
  topicId?: string
  sequenceNumber?: string
  commitment?: string
}
export type Verification =
  'verified' | 'unopened' | 'malformed' | 'mismatch' | 'mirror_pending' | 'unavailable' | 'pending' | 'failed'
export interface AuditView {
  id: string
  kind: AuditKind
  verification: Verification
  topicId?: string
  sequenceNumber?: string
  commitment?: string
  consensusTimestamp?: string
  hashscanUrl?: string
  topicUrl?: string
}
export interface AuditFeed {
  entries: AuditView[]
  observedAt: string
  truncated: boolean
}

export async function verifyAuditFeed(
  source: AuditSource,
  reader: Pick<MirrorTopicReader, 'listEntries'>
): Promise<AuditFeed> {
  const rows = source.list()
  const entries = await Promise.all(
    rows.slice(-50).map(async (row): Promise<AuditView> => {
      if (!['grant', 'revoke', 'payment'].includes(row.kind)) throw new Error('invalid audit kind')
      const view: AuditView = { id: row.id, kind: row.kind as AuditKind, verification: 'pending' }
      if (row.status !== 'posted') return { ...view, verification: row.status === 'failed' ? 'failed' : 'pending' }
      const sequence = Number(row.sequenceNumber)
      if (
        !row.topicId ||
        !/^0\.0\.\d+$/.test(row.topicId) ||
        !Number.isSafeInteger(sequence) ||
        sequence < 1 ||
        !row.commitment ||
        !/^[0-9a-f]{64}$/.test(row.commitment)
      )
        return { ...view, verification: 'malformed' }
      Object.assign(view, {
        topicId: row.topicId,
        sequenceNumber: row.sequenceNumber,
        commitment: row.commitment,
        topicUrl: hashscanTopicUrl(row.topicId),
      })
      try {
        const entries = await reader.listEntries(row.topicId, { afterSequence: sequence - 1, limit: 1 })
        const entry = entries.find((entry) => entry.sequenceNumber === sequence)
        if (!entry) return { ...view, verification: 'mirror_pending' }
        if (!/^\d{1,12}\.\d{1,9}$/.test(entry.consensusTimestamp)) return { ...view, verification: 'malformed' }
        Object.assign(view, {
          consensusTimestamp: entry.consensusTimestamp,
          hashscanUrl: hashscanMessageUrl(entry.consensusTimestamp),
        })
        if (!entry.message) return { ...view, verification: 'malformed' }
        if (entry.message.kind !== row.kind || entry.message.c !== row.commitment)
          return { ...view, verification: 'mismatch' }
        const opening = source.opening(row.id)
        if (!opening) return { ...view, verification: 'unopened' }
        const [checked] = verifyEntries([entry], [opening])
        return { ...view, verification: checked.status === 'verified' ? 'verified' : 'mismatch' }
      } catch {
        return { ...view, verification: 'unavailable' }
      }
    })
  )
  return { entries, observedAt: new Date().toISOString(), truncated: rows.length > entries.length }
}

export function createAuditVerificationApi(options: {
  token: () => string | undefined
  source: () => AuditSource | undefined
  reader?: Pick<MirrorTopicReader, 'listEntries'>
}) {
  const reader = options.reader ?? new MirrorTopicReader({ mirrorBaseUrl: 'https://testnet.mirrornode.hedera.com' })
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'cache-control': 'no-store', vary: 'Authorization' } })
  return async (request: Request) => {
    const token = options.token()
    const provided = Buffer.from(request.headers.get('authorization') ?? '')
    const expected = Buffer.from(`Bearer ${token}`)
    if (!token || provided.length !== expected.length || !timingSafeEqual(provided, expected))
      return json({ error: { message: 'Unlock the console with a valid demo token to check HCS records.' } }, 401)
    const source = options.source()
    if (!source)
      return json({ error: { message: 'HCS recorder is not connected. Live verification is unavailable.' } }, 503)
    try {
      return json(await verifyAuditFeed(source, reader))
    } catch {
      return json({ error: { message: 'HCS verification is unavailable. Retry shortly.' } }, 502)
    }
  }
}
