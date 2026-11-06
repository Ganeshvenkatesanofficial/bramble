import { ApiError } from './contracts'
import { readLimited, type SourceState } from './activity'
import type { ApprovalService } from './service'
import type { JoinRecord } from './contracts'
import { Resolver } from 'node:dns/promises'
import { isIP } from 'node:net'

type RequestView = ReturnType<ApprovalService['get']>

type Path = 'direct' | 'relayed' | 'unknown' | 'none' | 'unavailable'
export interface NetworkNode {
  id: string
  label: string
  kind: 'gateway' | 'device' | 'relay'
  admission: 'authorized' | 'not_authorized' | 'unknown' | 'unavailable'
  membership?: JoinRecord['status']
  grants: { id: string; service: string; gateway: string; state: RequestView['status'] }[]
  lastHandshake: string | null
  path: Path
  pingable: boolean
  probeReason?: string
}
export interface NetworkView {
  state: SourceState
  relayState: SourceState
  membershipState?: SourceState
  observedAt: string
  nodes: NetworkNode[]
  links: { from: string; to: string; path: Exclude<Path, 'none'> }[]
}
export interface NetworkPing {
  reachable: boolean
  rttMs: number | null
  measuredAt: string
  method: 'icmp' | 'http'
  detail: string
}
export interface NetworkSource {
  read(): Promise<NetworkView>
  ping(id: string): Promise<NetworkPing>
}

const validLabel = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(value)
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
function httpUrl(raw: string): URL {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Invalid status origin')
  return url
}
function endpointHost(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined
  try {
    return new URL(`http://${raw}`).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return undefined
  }
}
function handshake(raw: unknown): string | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null
  const ms = Math.floor(raw / 1_000_000)
  return ms > 0 && ms <= Date.now() + 60_000 ? new Date(ms).toISOString() : null
}

/** Reads configured probe targets and optional gateway observations. Private addresses stay server-side. */
export function createNetworkSource(options: {
  baseUrl: () => string | undefined
  dataRelays?: () => string | undefined
  rendezvousUrl?: () => string | undefined
  fetchImpl?: (input: URL, init?: RequestInit) => Promise<Response>
  resolveHost?: (host: string) => Promise<string[]>
  timeoutMs?: number
}): NetworkSource {
  const fetchImpl = options.fetchImpl ?? fetch
  const resolver = new Resolver({ timeout: 1000, tries: 1 })
  const resolveHost =
    options.resolveHost ??
    (async (host: string) => {
      const results = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)])
      return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    })
  async function get(url: URL, init?: RequestInit): Promise<unknown> {
    const response = await fetchImpl(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? 3000),
      ...init,
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error('Status unavailable')
    }
    const body = await readLimited(response, 1_000_000)
    if (body === undefined) throw new Error('Status too large')
    return JSON.parse(body)
  }
  function configuredRelays() {
    const relays: { label: string; url: URL; hosts: string[] }[] = []
    let state: SourceState = 'not_configured'
    const entries = (options.dataRelays?.() ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    const rendezvous = options.rendezvousUrl?.()
    if (rendezvous) entries.push(`rendezvous=${rendezvous}`)
    for (const entry of entries.slice(0, 50)) {
      try {
        const equal = entry.indexOf('=')
        const label = entry.slice(0, equal)
        if (equal < 1 || !validLabel(label) || relays.some((relay) => relay.label === label))
          throw new Error('Invalid relay')
        relays.push({ label, url: httpUrl(entry.slice(equal + 1)), hosts: [] })
        if (state !== 'unavailable') state = 'ok'
      } catch {
        state = 'unavailable'
      }
    }
    if (entries.length > 50) state = 'unavailable'
    return { relays, state }
  }
  const relayNode = (label: string): NetworkNode => ({
    id: `relay:${label}`,
    label,
    kind: 'relay',
    admission: 'unavailable',
    grants: [],
    lastHandshake: null,
    path: 'unavailable',
    pingable: true,
  })
  async function snapshot() {
    const raw = options.baseUrl()
    if (!raw) return null
    const base = httpUrl(raw)
    const [peersResult, relaysResult] = await Promise.allSettled([
      get(new URL('/peers', base)),
      get(new URL('/relays', base)),
    ])
    if (peersResult.status === 'rejected' || !Array.isArray(peersResult.value) || peersResult.value.length > 200)
      throw new Error('Peers unavailable')
    const peers = peersResult.value.filter(
      (row): row is Record<string, unknown> =>
        object(row) && validLabel(row.label) && typeof row.authorized === 'boolean'
    )
    const relays: { label: string; url: URL; hosts: string[] }[] = []
    let relayState: SourceState = 'unavailable'
    if (
      relaysResult.status === 'fulfilled' &&
      object(relaysResult.value) &&
      (relaysResult.value.dataRelays === null || object(relaysResult.value.dataRelays))
    ) {
      const entries = Object.entries(relaysResult.value.dataRelays ?? {})
      if (entries.length <= 50) {
        relayState = 'ok'
        await Promise.all(
          entries.map(async ([label, value]) => {
            try {
              if (!validLabel(label) || typeof value !== 'string') throw new Error('Invalid relay')
              const url = httpUrl(value)
              const hostname = url.hostname.replace(/^\[|\]$/g, '')
              const hosts = isIP(hostname) ? [hostname] : (await resolveHost(hostname)).filter((host) => isIP(host))
              if (!hosts.length) relayState = 'unavailable'
              relays.push({
                label,
                url,
                hosts: [hostname, ...hosts.map((host) => endpointHost(isIP(host) === 6 ? `[${host}]` : host)!)],
              })
            } catch {
              relayState = 'unavailable'
            }
          })
        )
        relays.sort((a, b) => a.label.localeCompare(b.label))
      }
    }
    return { base, peers, relays, relayState }
  }
  const empty = (state: SourceState): NetworkView => ({
    state,
    relayState: configuredRelays().state,
    observedAt: new Date().toISOString(),
    nodes: configuredRelays().relays.map((relay) => relayNode(relay.label)),
    links: [],
  })
  return {
    async read() {
      try {
        const data = await snapshot()
        if (!data) return empty('not_configured')
        const nodes: NetworkNode[] = [
          {
            id: 'gateway',
            label: 'Gateway (status node)',
            kind: 'gateway',
            admission: 'unavailable',
            grants: [],
            lastHandshake: null,
            path: 'unavailable',
            pingable: false,
            probeReason: 'No supported probe target is known for this gateway.',
          },
        ]
        const links: NetworkView['links'] = []
        for (const relay of [...data.relays, ...configuredRelays().relays])
          if (!nodes.some((node) => node.id === `relay:${relay.label}`)) nodes.push(relayNode(relay.label))
        const usedRelays = new Set<string>()
        for (const peer of data.peers) {
          const host = endpointHost(peer.endpoint)
          const relay = host ? data.relays.find((relay) => relay.hosts.includes(host)) : undefined
          const path: Path = !peer.authorized
            ? 'none'
            : relay
              ? 'relayed'
              : host && data.relayState === 'ok'
                ? 'direct'
                : 'unknown'
          const id = `peer:${peer.label}`
          nodes.push({
            id,
            label: peer.label as string,
            kind: 'device',
            admission: peer.authorized ? 'authorized' : 'not_authorized',
            grants: [],
            lastHandshake: handshake(peer.lastHandshakeUnixNs),
            path,
            pingable: peer.authorized === true,
          })
          if (path !== 'none') {
            links.push({ from: id, to: relay ? `relay:${relay.label}` : 'gateway', path })
            if (relay) usedRelays.add(relay.label)
          }
        }
        for (const label of usedRelays) links.push({ from: `relay:${label}`, to: 'gateway', path: 'relayed' })
        return { state: 'ok', relayState: data.relayState, observedAt: new Date().toISOString(), nodes, links }
      } catch {
        return empty('unavailable')
      }
    },
    async ping(id) {
      let relay = configuredRelays().relays.find((row) => `relay:${row.label}` === id)
      let data: Awaited<ReturnType<typeof snapshot>> = null
      if (!relay) {
        try {
          data = await snapshot()
        } catch {
          throw new ApiError(502, 'network_unavailable', 'The optional gateway status service is unavailable.')
        }
        relay = data?.relays.find((row) => `relay:${row.label}` === id)
      }
      const peer = data?.peers.find((row) => `peer:${row.label}` === id && row.authorized)
      if (!peer && !relay)
        throw new ApiError(
          404,
          'node_not_found',
          'No supported probe target is known for this node. Refresh the network view.'
        )
      const method = relay ? 'http' : 'icmp'
      let result: Pick<NetworkPing, 'reachable' | 'rttMs' | 'detail'>
      try {
        if (relay) {
          const start = performance.now()
          const health = await get(new URL('/health', relay.url))
          const reachable = object(health) && health.ok === true
          result = {
            reachable,
            rttMs: reachable ? Math.round((performance.now() - start) * 100) / 100 : null,
            detail: reachable
              ? 'HTTP health check from the console host succeeded. This does not prove tunnel connectivity or forwarding.'
              : 'HTTP health check from the console host failed.',
          }
        } else {
          const raw = await get(new URL('/ping', data!.base), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ label: peer!.label }),
          })
          const reachable = object(raw) && raw.reachable === true
          const match = object(raw) && typeof raw.rtt === 'string' ? /^([0-9]+(?:\.[0-9]+)?)ms$/.exec(raw.rtt) : null
          const rtt = match ? Number(match[1]) : NaN
          result = {
            reachable,
            rttMs: reachable && Number.isFinite(rtt) ? rtt : null,
            detail: reachable
              ? 'Device answered the gateway’s tunnel ping.'
              : 'No tunnel ping reply. The peer may be offline or ICMP may be blocked.',
          }
        }
      } catch {
        result = { reachable: false, rttMs: null, detail: 'Probe failed or timed out. Retry after checking the node.' }
      }
      return { ...result, method, measuredAt: new Date().toISOString() }
    },
  }
}

/** Adds approval facts separately from tunnel admission; a grant never proves connectivity. */
export function addNetworkFacts(
  view: NetworkView,
  requests: RequestView[],
  members: JoinRecord[],
  parent?: string
): NetworkView {
  const nodes = view.nodes.map((node) => ({ ...node, grants: [...node.grants] }))
  const links = [...view.links]
  if (!nodes.some((node) => node.kind === 'gateway'))
    nodes.unshift({
      id: 'gateway',
      label: parent ?? requests[0]?.gatewayLabel ?? 'Gateway',
      kind: 'gateway',
      admission: 'unavailable',
      grants: [],
      lastHandshake: null,
      path: 'unavailable',
      pingable: false,
      probeReason: 'No supported probe target is known for this gateway.',
    })
  else if (parent || requests[0]?.gatewayLabel)
    nodes.find((node) => node.kind === 'gateway')!.label = parent ?? requests[0].gatewayLabel
  const name = (label: string) =>
    `${label}${parent ? `.${parent.replace(/^\.+|\.+$/g, '').toLowerCase()}` : ''}`.toLowerCase()
  for (const member of members) {
    const full = `${member.label}.${member.tailnet}`.toLowerCase()
    let node = nodes.find(
      (node) =>
        node.kind === 'device' &&
        (node.label.toLowerCase() === full ||
          (parent?.toLowerCase() === member.tailnet.toLowerCase() &&
            node.label.toLowerCase() === member.label.toLowerCase()))
    )
    if (!node) {
      node = {
        id: `member:${full}`,
        label: full,
        kind: 'device',
        admission: 'unavailable',
        membership: member.status,
        grants: [],
        lastHandshake: null,
        path: 'unavailable',
        pingable: false,
        probeReason:
          'No supported probe target is known for this device. Membership does not identify a probe protocol or port.',
      }
      nodes.push(node)
    }
    node.membership = member.status
  }
  for (const request of requests) {
    if (
      !nodes.some(
        (node) =>
          node.kind === 'device' &&
          [name(request.agentLabel), request.agentLabel.toLowerCase()].includes(node.label.toLowerCase())
      )
    ) {
      nodes.push({
        id: `member:${name(request.agentLabel)}`,
        label: name(request.agentLabel),
        kind: 'device',
        admission: 'unavailable',
        grants: [],
        lastHandshake: null,
        path: 'unavailable',
        pingable: false,
        probeReason:
          'No supported probe target is known for this device. Membership does not identify a probe protocol or port.',
      })
    }
  }
  for (const node of nodes.filter((node) => node.kind === 'device')) {
    if (node.path === 'unavailable') links.push({ from: node.id, to: 'gateway', path: 'unavailable' })
    node.grants = requests
      .filter(
        (request) =>
          node.label.toLowerCase() === name(request.agentLabel) ||
          node.label.toLowerCase() === request.agentLabel.toLowerCase()
      )
      .map((request) => ({
        id: request.id,
        service: request.service,
        gateway: request.gatewayLabel,
        state: request.status,
      }))
  }
  return { ...view, nodes, links }
}
