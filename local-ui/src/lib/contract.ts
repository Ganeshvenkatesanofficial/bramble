/** Local API contract v1 (ETH-177). The `bramble` binary serves these on 127.0.0.1:7777. */

export type Phase = 'setup' | 'ready' | 'pending' | 'approved' | 'denied' | 'connected' | 'error'
export type PeerPath = 'direct' | 'relay' | 'none'

export interface Peer {
  label: string
  meshIp: string
  path: PeerPath
  lastHandshake: string | number | null
  rttMs?: number
}

export interface BrambleState {
  phase: Phase
  name: string
  fingerprint: string
  tailnet?: string
  joinId?: string
  meshIp?: string
  isAdmin: boolean
  peers: Peer[]
  error?: { message: string; nextStep: string }
}

export interface TestResult {
  ok: boolean
  status: number
  ms: number
}

export type JoinStatus = 'pending' | 'approved' | 'denied' | 'revoked'

/** One row of `GET /api/admin/joins`; the join API returns these for every device that asked. */
export interface JoinRecord {
  id: string
  label: string
  tailnet: string
  status: JoinStatus
  pubkey?: string
  meshIp?: string
  createdAt?: string
  decidedAt?: string
}

const phases: readonly string[] = ['setup', 'ready', 'pending', 'approved', 'denied', 'connected', 'error']
const paths: readonly string[] = ['direct', 'relay', 'none']
const statuses: readonly string[] = ['pending', 'approved', 'denied', 'revoked']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown) => (typeof value === 'string' ? value : undefined)

export function parseState(value: unknown): BrambleState {
  if (!isRecord(value) || typeof value.phase !== 'string' || !phases.includes(value.phase)) {
    throw new Error('Unexpected reply from Bramble.')
  }
  const peers = Array.isArray(value.peers) ? value.peers : []
  const error = isRecord(value.error)
    ? { message: text(value.error.message) ?? 'Something went wrong.', nextStep: text(value.error.nextStep) ?? '' }
    : undefined
  return {
    phase: value.phase as Phase,
    name: text(value.name) ?? '',
    fingerprint: text(value.fingerprint) ?? '',
    tailnet: text(value.tailnet),
    joinId: text(value.joinId),
    meshIp: text(value.meshIp),
    isAdmin: value.isAdmin === true,
    peers: peers.filter(isRecord).map((peer) => ({
      label: text(peer.label) ?? 'unnamed device',
      meshIp: text(peer.meshIp) ?? '',
      path: paths.includes(String(peer.path)) ? (peer.path as PeerPath) : 'none',
      lastHandshake:
        typeof peer.lastHandshake === 'string' || typeof peer.lastHandshake === 'number' ? peer.lastHandshake : null,
      rttMs: typeof peer.rttMs === 'number' ? peer.rttMs : undefined,
    })),
    error,
  }
}

function parseJoin(value: unknown): JoinRecord | null {
  if (!isRecord(value)) return null
  const id = text(value.id)
  const label = text(value.label)
  const status = text(value.status)
  if (!id || !label || !status || !statuses.includes(status)) return null
  return {
    id,
    label,
    tailnet: text(value.tailnet) ?? '',
    status: status as JoinStatus,
    pubkey: text(value.pubkey),
    meshIp: text(value.meshIp),
    createdAt: text(value.createdAt),
    decidedAt: text(value.decidedAt),
  }
}

/** Accepts `{ joins: [...] }` or a bare array and drops rows that are not join records. */
export function parseJoins(value: unknown, key = 'joins'): JoinRecord[] {
  const rows = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value[key]) ? value[key] : []
  return rows.map(parseJoin).filter((row): row is JoinRecord => row !== null)
}

export function parseTestResult(value: unknown): TestResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean') throw new Error('Unexpected reply from Bramble.')
  return {
    ok: value.ok,
    status: typeof value.status === 'number' ? value.status : 0,
    ms: typeof value.ms === 'number' ? value.ms : 0,
  }
}
