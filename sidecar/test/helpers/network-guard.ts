// Records and blocks every network primitive except the global fetch, which
// is replaced by a caller-supplied stub. Used to prove that code under test
// reaches the network only through the fetch it was handed (and so would
// reach it only through Tor once that fetch is torFetch).
import dgram from 'node:dgram'
import dns from 'node:dns'
import module from 'node:module'
import net from 'node:net'

export type GuardAttempt = { kind: string; detail: string }

type Restore = () => void

export type NetworkGuard = {
  attempts: GuardAttempt[]
  fetchCalls: Request[]
  restore: () => void
}

function describeArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a
      if (typeof a === 'number') return String(a)
      if (a && typeof a === 'object') {
        const o = a as { host?: unknown; hostname?: unknown; port?: unknown; path?: unknown; address?: unknown }
        const host = o.host ?? o.hostname ?? o.address ?? o.path
        return host !== undefined ? `${String(host)}${o.port !== undefined ? `:${String(o.port)}` : ''}` : ''
      }
      return ''
    })
    .filter(Boolean)
    .join(' ')
}

export function installNetworkGuard(fetchStub: (request: Request) => Promise<Response>): NetworkGuard {
  const attempts: GuardAttempt[] = []
  const fetchCalls: Request[] = []
  const restores: Restore[] = []

  const block = (kind: string, args: unknown[]): never => {
    attempts.push({ kind, detail: describeArgs(args) })
    throw new Error(`network-guard: blocked ${kind}`)
  }

  const patch = (target: object, key: string, kind: string) => {
    const holder = target as Record<string, unknown>
    const original = holder[key]
    if (typeof original !== 'function') return
    try {
      holder[key] = (...args: unknown[]) => block(`${kind}.${key}`, args)
    } catch {
      return // read-only on this runtime (Bun); the lower-level hooks still apply
    }
    restores.push(() => {
      holder[key] = original
    })
  }

  // Every TCP and TLS client (net.connect, tls.connect, http, http2, grpc-js, undici) ends in Socket#connect.
  const socketConnect = net.Socket.prototype.connect
  net.Socket.prototype.connect = function (...args: unknown[]) {
    return block('net.Socket.connect', args)
  } as typeof net.Socket.prototype.connect
  restores.push(() => {
    net.Socket.prototype.connect = socketConnect
  })

  for (const key of ['send', 'bind', 'connect']) patch(dgram.Socket.prototype, key, 'dgram.Socket')

  for (const key of Object.keys(dns)) {
    if (/^(lookup|resolve|reverse)/.test(key)) patch(dns, key, 'dns')
  }
  for (const key of Object.keys(dns.promises)) {
    if (/^(lookup|resolve|reverse)/.test(key)) patch(dns.promises, key, 'dns.promises')
  }
  for (const key of Object.getOwnPropertyNames(dns.Resolver.prototype)) {
    if (/^(resolve|reverse)/.test(key)) patch(dns.Resolver.prototype, key, 'dns.Resolver')
  }

  const originalFetch = globalThis.fetch
  globalThis.fetch = ((input: ConstructorParameters<typeof Request>[0], init?: RequestInit) => {
    const request = new Request(input, init) as unknown as Request
    fetchCalls.push(request.clone() as unknown as Request)
    return fetchStub(request)
  }) as typeof fetch
  restores.push(() => {
    globalThis.fetch = originalFetch
  })

  const originalWebSocket = globalThis.WebSocket
  if (originalWebSocket) {
    globalThis.WebSocket = function (...args: unknown[]) {
      return block('WebSocket', args)
    } as unknown as typeof WebSocket
    restores.push(() => {
      globalThis.WebSocket = originalWebSocket
    })
  }

  const bun = (globalThis as { Bun?: Record<string, unknown> }).Bun
  if (bun) {
    for (const key of ['connect', 'udpSocket']) patch(bun, key, 'Bun')
    if (bun.dns && typeof bun.dns === 'object') patch(bun.dns, 'lookup', 'Bun.dns')
    patch(bun, 'fetch', 'Bun')
  }

  module.syncBuiltinESMExports()

  return {
    attempts,
    fetchCalls,
    restore: () => {
      for (const restore of restores.reverse()) restore()
      module.syncBuiltinESMExports()
    },
  }
}

// A leftover Timeout is how the Hedera SDK's 24 h address-book refresh would show up (Client#close clears it).
const NETWORK_HANDLE_TYPES = new Set([
  'TCPSocketWrap',
  'TLSWRAP',
  'UDPWrap',
  'TCPConnectWrap',
  'GetAddrInfoReqWrap',
  'Timeout',
])

// Node only: network handles and timers still open on the event loop.
export function activeNetworkHandles(): string[] {
  const info = (process as { getActiveResourcesInfo?: () => string[] }).getActiveResourcesInfo
  return info ? info.call(process).filter((name) => NETWORK_HANDLE_TYPES.has(name)) : []
}
