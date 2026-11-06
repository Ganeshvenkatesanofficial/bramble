// Unified activity feed for demo beats 1, 3 and 5. Read-only: it merges what
// the approval service recorded, what the gateway node's statusapi reports and
// what the Hedera mirror shows. It never writes and never forwards raw
// gateway or resolver error text, which can carry RPC URLs.
import { transactionUrl, type RequestView } from './console-api'
import type { PaymentsFeed } from './payments'

export type ActivityKind =
  | 'request-received'
  | 'request-denied'
  | 'access-granted'
  | 'access-revoked'
  | 'gateway-denied'
  | 'gateway-allowed'
  | 'payment-settled'
  | 'peer-admission'
  | 'peer-dropped'
  | 'cutoff-measured'

export type ActivitySource = 'approval' | 'gateway' | 'hedera'
export type SourceState = 'ok' | 'not_configured' | 'unavailable'

export interface ActivityEntry {
  id: string
  /** ISO 8601. */
  time: string
  kind: ActivityKind
  source: ActivitySource
  agentLabel: string
  summary: string
  detail?: string
  link?: { href: string; text: string }
  /** Set only on `cutoff-measured`. */
  cutoffMs?: number
}

export interface ActivityFeed {
  events: ActivityEntry[]
  sources: Record<ActivitySource, SourceState>
  observedAt: string
}

/** One entry of brambled/statusapi `GET /activity`, after validation. */
export interface StatusEvent {
  time: string
  kind: 'admission' | 'gateway' | 'peer'
  label: string
  message: string
  outcome?: 'allowed' | 'denied' | 'dropped'
  service?: string
}

const MAX_ENTRIES = 100
const SERVICE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/

// statusapi labels may be full ENS names; approval labels are single labels.
const shortLabel = (label: string) => label.toLowerCase().split('.')[0]
const sameAgent = (statusLabel: string, agentLabel: string) => shortLabel(statusLabel) === agentLabel

export function parseStatusEvents(raw: unknown): StatusEvent[] {
  if (!Array.isArray(raw)) return []
  const events: StatusEvent[] = []
  for (const item of raw.slice(-200)) {
    if (!item || typeof item !== 'object') continue
    const value = item as Record<string, unknown>
    if (
      typeof value.time !== 'string' ||
      Number.isNaN(Date.parse(value.time)) ||
      (value.kind !== 'admission' && value.kind !== 'gateway' && value.kind !== 'peer') ||
      typeof value.label !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(value.label) ||
      typeof value.message !== 'string' ||
      value.message.length > 2000
    )
      continue
    const message = value.message
    // Nodes without the outcome field report it only inside the message.
    let outcome: StatusEvent['outcome']
    if (value.outcome === 'allowed' || value.outcome === 'denied' || value.outcome === 'dropped') {
      outcome = value.outcome
    } else if (value.kind === 'gateway') {
      outcome = message.startsWith('allowed ') ? 'allowed' : message.startsWith('denied ') ? 'denied' : undefined
    }
    if (value.kind === 'gateway' && outcome !== 'allowed' && outcome !== 'denied') continue
    if (value.kind === 'peer' && outcome !== 'dropped') continue
    const service = typeof value.service === 'string' && SERVICE_PATTERN.test(value.service) ? value.service : undefined
    events.push({
      time: new Date(value.time).toISOString(),
      kind: value.kind,
      label: value.label,
      message,
      ...(outcome ? { outcome } : {}),
      ...(service ? { service } : {}),
    })
  }
  return events
}

// Gateway detail text is free-form and can embed resolver errors. Map known
// prefixes to fixed phrases and withhold the rest.
function gatewayReason(message: string): string {
  const detail = /^(?:allowed|denied) "(?:[^"\\]|\\.)*": ([\s\S]*) \([^()]*\)$/.exec(message)?.[1] ?? ''
  if (detail.startsWith('no matching granted digest')) return 'No grant covers this service.'
  if (detail.startsWith('unknown service')) return 'The service is not configured on this gateway.'
  if (detail.startsWith('local service unreachable')) return 'The gateway could not reach the private service.'
  if (detail.startsWith('ACL check failed')) return 'The gateway could not read the access list.'
  if (detail.startsWith('proxying')) return 'The gateway forwarded the call to the private service.'
  return 'Details withheld from this view.'
}

// Entry ids must not embed the raw message: ids reach the browser.
function fingerprint(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0
  return hash.toString(16).padStart(8, '0')
}

function consensusTime(timestamp: string): string {
  const [seconds, nanos = '0'] = timestamp.split('.')
  return new Date(Number(seconds) * 1000 + Number(nanos.padEnd(9, '0').slice(0, 3))).toISOString()
}

function usdc(atomic: string) {
  const amount = BigInt(atomic)
  return `${amount / BigInt(1_000_000)}.${(amount % BigInt(1_000_000)).toString().padStart(6, '0')} USDC`
}

export function formatCutoff(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

export function buildActivity(input: {
  requests: RequestView[]
  status: StatusEvent[]
  payments: PaymentsFeed | null
}): ActivityEntry[] {
  const entries: ActivityEntry[] = []

  for (const request of input.requests) {
    const base = { source: 'approval' as const, agentLabel: request.agentLabel }
    entries.push({
      ...base,
      id: `request:${request.id}:received`,
      time: request.createdAt,
      kind: 'request-received',
      summary: `Access request received for "${request.service}"`,
      detail:
        request.requestedDuration === undefined
          ? 'Requested until revoked.'
          : `Requested for ${request.requestedDuration} seconds.`,
    })
    if (request.status === 'denied' && request.decidedAt) {
      entries.push({
        ...base,
        id: `request:${request.id}:denied`,
        time: request.decidedAt,
        kind: 'request-denied',
        summary: `Operator denied the request for "${request.service}"`,
      })
    }
    if (request.grantTransaction && request.decidedAt) {
      const href = transactionUrl(request.grantTransaction.transactionHash)
      entries.push({
        ...base,
        id: `request:${request.id}:granted`,
        time: request.decidedAt,
        kind: 'access-granted',
        summary: `Access granted for "${request.service}"`,
        detail: 'Grant transaction confirmed.',
        ...(href ? { link: { href, text: 'View on Sepolia Etherscan' } } : {}),
      })
    }
    if (request.status === 'revoked' && request.revokedAt) {
      const href = request.revokeTransaction ? transactionUrl(request.revokeTransaction.transactionHash) : null
      const summary =
        request.revokeReason === 'duration'
          ? `Access revoked when the duration ended for "${request.service}"`
          : request.revokeReason === 'external'
            ? `Grant for "${request.service}" removed outside this console`
            : `Access revoked for "${request.service}"`
      entries.push({
        ...base,
        id: `request:${request.id}:revoked`,
        time: request.revokedAt,
        kind: 'access-revoked',
        summary,
        detail: request.revokeReason === 'external' ? undefined : 'Revoke transaction confirmed.',
        ...(href ? { link: { href, text: 'View on Sepolia Etherscan' } } : {}),
      })
    }
  }

  const seen = new Map<string, number>()
  const gateway: { entry: ActivityEntry; event: StatusEvent }[] = []
  for (const event of input.status) {
    const key = `${event.time}|${event.kind}|${event.label}|${event.message}`
    const occurrence = seen.get(key) ?? 0
    seen.set(key, occurrence + 1)
    const base = { source: 'gateway' as const, agentLabel: shortLabel(event.label), time: event.time }
    const id = `status:${event.time}|${event.kind}|${shortLabel(event.label)}|${fingerprint(key)}#${occurrence}`
    const service = event.service ? `"${event.service}"` : 'a service'
    let entry: ActivityEntry
    if (event.kind === 'gateway') {
      entry =
        event.outcome === 'denied'
          ? {
              ...base,
              id,
              kind: 'gateway-denied',
              summary: `Gateway denied a call to ${service}`,
              detail: gatewayReason(event.message),
            }
          : {
              ...base,
              id,
              kind: 'gateway-allowed',
              summary: `Gateway allowed a call to ${service}`,
              detail: gatewayReason(event.message),
            }
    } else if (event.kind === 'peer') {
      entry = {
        ...base,
        id,
        kind: 'peer-dropped',
        summary: 'Peer dropped from the WireGuard peer table',
        detail: 'The peer is no longer authorized by its ENS record.',
      }
    } else {
      entry = {
        ...base,
        id,
        kind: 'peer-admission',
        summary: event.message.startsWith('authorized=true')
          ? 'Peer admitted'
          : event.message.startsWith('authorized=false')
            ? 'Peer not authorized'
            : 'Peer lookup failed',
        detail: event.message.startsWith('authorized=') ? undefined : 'Details withheld from this view.',
      }
    }
    gateway.push({ entry, event })
    entries.push(entry)
  }

  // Cut-off: the first call the gateway blocks, or the first peer drop, after the
  // approval service accepted the revoke. The window ends when the same agent is
  // granted again. The two timestamps come from two machines' clocks.
  for (const request of input.requests) {
    if (request.status !== 'revoked' || !request.revokeRequestedAt || request.revokeReason === 'external') continue
    const start = Date.parse(request.revokeRequestedAt)
    const regrant = input.requests
      .filter((other) => other.agentLabel === request.agentLabel && other.decidedAt && other.grantTransaction)
      .map((other) => Date.parse(other.decidedAt as string))
      .filter((time) => time > start)
    const end = regrant.length ? Math.min(...regrant) : Infinity
    let first: { entry: ActivityEntry; event: StatusEvent } | undefined
    for (const candidate of gateway) {
      const time = Date.parse(candidate.event.time)
      const blocks = candidate.event.outcome === 'denied' || candidate.event.outcome === 'dropped'
      if (!blocks || !sameAgent(candidate.event.label, request.agentLabel) || time < start || time >= end) continue
      if (!first || time < Date.parse(first.event.time)) first = candidate
    }
    if (!first) continue
    const cutoffMs = Date.parse(first.event.time) - start
    entries.push({
      id: `request:${request.id}:cutoff`,
      source: 'approval',
      agentLabel: request.agentLabel,
      time: first.event.time,
      kind: 'cutoff-measured',
      summary: `Cut-off measured: ${formatCutoff(cutoffMs)} after the revoke request`,
      detail: `${
        first.event.outcome === 'dropped' ? 'First peer drop' : 'First call the gateway blocked'
      } on the gateway node's clock, minus the approval server's revoke-request time. Accuracy is limited by the clock difference between those machines.`,
      cutoffMs,
    })
  }

  for (const agent of input.payments?.agents ?? []) {
    for (const payment of agent.payments) {
      entries.push({
        id: `payment:${payment.consensusTimestamp}`,
        source: 'hedera',
        agentLabel: agent.agentLabel,
        time: consensusTime(payment.consensusTimestamp),
        kind: 'payment-settled',
        summary: `Payment settled: ${usdc(payment.amountAtomic)}`,
        detail: 'Hedera testnet, from the mirror node.',
        link: { href: payment.hashscanUrl, text: 'View settlement on HashScan' },
      })
    }
  }

  // Ties keep causal order: an entry added later (cut-off after its trigger, peer drop after admission) sorts first.
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => Date.parse(b.entry.time) - Date.parse(a.entry.time) || b.index - a.index)
    .slice(0, MAX_ENTRIES)
    .map(({ entry }) => entry)
}

export interface StatusSource {
  (): Promise<{ state: SourceState; events: StatusEvent[] }>
}

/** Reads one gateway node's statusapi `GET /activity`. The URL is server configuration, never request input. */
export function createStatusSource(options: {
  baseUrl: () => string | undefined
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): StatusSource {
  return async () => {
    const raw = options.baseUrl()
    if (!raw) return { state: 'not_configured', events: [] }
    try {
      const base = new URL(raw)
      if ((base.protocol !== 'http:' && base.protocol !== 'https:') || base.username || base.password) {
        return { state: 'unavailable', events: [] }
      }
      const response = await (options.fetchImpl ?? fetch)(new URL('/activity', base), {
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs ?? 3_000),
      })
      if (!response.ok) return { state: 'unavailable', events: [] }
      const text = await response.text()
      if (text.length > 1_000_000) return { state: 'unavailable', events: [] }
      return { state: 'ok', events: parseStatusEvents(JSON.parse(text)) }
    } catch {
      return { state: 'unavailable', events: [] }
    }
  }
}

export interface PaymentsSource {
  (): Promise<{ state: SourceState; feed: PaymentsFeed | null }>
}

/** Wraps the shared payments handler. `configured` reports whether APPROVAL_PAYMENT_AGENTS is set. */
export function createPaymentsSource(options: {
  handler: () => Promise<Response>
  configured: () => boolean
}): PaymentsSource {
  return async () => {
    if (!options.configured()) return { state: 'not_configured', feed: null }
    try {
      const response = await options.handler()
      if (!response.ok) return { state: 'unavailable', feed: null }
      return { state: 'ok', feed: (await response.json()) as PaymentsFeed }
    } catch {
      return { state: 'unavailable', feed: null }
    }
  }
}

export async function loadActivity(input: {
  requests: RequestView[]
  status?: StatusSource
  payments?: PaymentsSource
  now?: () => Date
}): Promise<ActivityFeed> {
  const [status, payments] = await Promise.all([
    input.status ? input.status() : { state: 'not_configured' as const, events: [] },
    input.payments ? input.payments() : { state: 'not_configured' as const, feed: null },
  ])
  return {
    events: buildActivity({ requests: input.requests, status: status.events, payments: payments.feed }),
    sources: { approval: 'ok', gateway: status.state, hedera: payments.state },
    observedAt: (input.now?.() ?? new Date()).toISOString(),
  }
}
