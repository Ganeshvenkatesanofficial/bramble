#!/usr/bin/env bun
/**
 * Offline failure drills for the live demo (ETH-297). No cloud node, chain, Tor or Hedera call:
 * every drill runs the real approval API, agent MCP tools and preflight checks against loopback
 * servers and in-memory chains. Each drill injects one failure, checks that the operator CLI and
 * the console API show a clear message that leaks no secret, URL or address, then checks recovery.
 *
 *   bun deploy/drills/drills.ts                 # all drills
 *   bun deploy/drills/drills.ts relay-down      # one or more by name
 */
import { createServer, type Server as TcpServer } from 'node:net'
import { createApprovalApi } from '../../approval/src/lib/api'
import { createStatusSource } from '../../approval/src/lib/activity'
import { UnresolvedWriteError, type SettleOutcome } from '../../approval/src/lib/contracts'
import { MemoryChain } from '../../approval/test/memory-chain'
import { ManualClock } from '../../approval/test/clock'
import { createTools } from '../../agent-mcp/src/tools'
import { buildChecks, formatReport, runPreflight, type NodeProbe } from '../../scripts/demo/src/preflight'
import { httpGet, tcpConnect } from '../../scripts/demo/src/probe'

// Values a real deployment would hold. None may appear in anything an operator or agent sees.
const TOKEN = 'drill-operator-token-7f3a9c'
const RPC_URL = 'https://sepolia.rpc.drill.invalid/v3/drill-rpc-credential-51ab'
const PRIVATE_KEY = `0x${'5e'.repeat(32)}`
const TAILNET = 'mesh.eth'

let failures = 0
// Everything the operator, the agent or the service log showed during the current drill.
let outputs: string[] = []

/** Records `text` as shown to someone, so the drill's final non-leak check covers it. */
function shown<T extends string>(text: T): T {
  outputs.push(text)
  return text
}

function check(label: string, ok: boolean, shown?: string) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`)
  if (shown !== undefined) console.log(`        shows: ${shown.replace(/\n/g, '\n               ')}`)
  if (!ok) failures++
}

/** True when `text` carries none of the deployment secrets, nor any extra value named for this drill. */
function clean(text: string, extra: string[] = []): boolean {
  return [TOKEN, RPC_URL, 'drill-rpc-credential', PRIVATE_KEY, ...extra].every((value) => !text.includes(value))
}

function call(api: ReturnType<typeof createApprovalApi>, path: string, method = 'GET', body?: unknown) {
  return api.handle(
    new Request(`http://127.0.0.1/api${path}`, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  )
}

async function read(response: Response) {
  const text = shown(await response.text())
  return { status: response.status, text, body: JSON.parse(text) as Record<string, unknown> }
}

function errorLine(body: Record<string, unknown>) {
  const error = body.error as { code?: string; message?: string } | undefined
  return `${error?.code}: ${error?.message}`
}

/** Captures console.error while `action` runs, so a drill can check what reaches the service log. */
async function captureLog<T>(action: () => Promise<T>): Promise<{ value: T; log: string }> {
  const original = console.error
  const lines: string[] = []
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(' '))
  try {
    const value = await action()
    return { value, log: shown(lines.join('\n')) }
  } finally {
    console.error = original
  }
}

function listen(server: TcpServer): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port))
  )
}

function close(server: TcpServer): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

const agentConfig = (approvalUrl: string, decisionTimeoutMs: number) => ({
  approvalUrl,
  approvalToken: TOKEN,
  agentLabel: 'agent-1',
  gatewayLabel: 'gateway-1',
  forwardUrl: 'http://127.0.0.1:9',
  pollIntervalMs: 50,
  decisionTimeoutMs,
  forwardTimeoutMs: 1000,
})

// Beat 3 and 4: a rendezvous relay or its payment sidecar stops answering.
async function relayDown() {
  const relays = [createServer((socket) => socket.end()), createServer((socket) => socket.end())]
  const ports = await Promise.all(relays.map(listen))
  const sidecar = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ ok: true }) })
  const addresses = ports.map((port) => `127.0.0.1:${port}`)
  // Read the port once: a stopped Bun server no longer reports it.
  const sidecarPort = sidecar.port
  const sidecarUrl = `http://127.0.0.1:${sidecarPort}`
  const node: NodeProbe = {
    describe: 'gateway (local)',
    async getJson(_port, path) {
      if (path !== '/relays') return { status: 404, body: {} }
      return {
        status: 200,
        body: {
          rendezvous: [
            { label: 'relay1', address: addresses[0], sidecarUrl },
            { label: 'relay2', address: addresses[1] },
          ],
          dataRelays: [],
        },
      }
    },
  }
  const ctx = {
    env: { BRAMBLE_TAILNET_NAME: TAILNET, SEPOLIA_RPC_URL: RPC_URL, BRAMBLE_PRIVATE_KEY: PRIVATE_KEY },
    localRoles: [],
    roleEnv: {},
    nodes: { gateway: node },
    http: httpGet,
    tcp: tcpConnect,
    granterRingPresent: false,
  }
  const relayCheck = async () => {
    const unit = buildChecks(ctx).find((u) => u.id === 'relay')!
    return shown(formatReport(await runPreflight([unit], { waitMs: 0, intervalMs: 0 })))
  }

  // The console reads gateway status from the gateway's own statusapi (BRAMBLED_STATUS_URL), not
  // from a relay. It runs as its own server here, so a relay outage and a status outage stay apart.
  const gatewayEvent = {
    time: new Date().toISOString(),
    kind: 'gateway',
    label: 'agent-1',
    service: 'web',
    outcome: 'allowed',
    message: 'allowed "web": proxying to 127.0.0.1:8080 (agent-1)',
  }
  const statusApp = { hostname: '127.0.0.1', fetch: () => Response.json([gatewayEvent]) }
  let statusServer = Bun.serve({ ...statusApp, port: 0 })
  const statusPort = statusServer.port
  const statusUrl = `http://127.0.0.1:${statusPort}`
  const status = createStatusSource({ baseUrl: () => statusUrl, timeoutMs: 1000 })
  const api = createApprovalApi({ token: () => TOKEN, activity: { status } })
  const consoleView = async () => {
    const activity = await read(await call(api, '/activity'))
    const sources = activity.body.sources as Record<string, string>
    return {
      ...activity,
      gateway: sources?.gateway,
      line: `HTTP ${activity.status} sources=${JSON.stringify(sources)}`,
    }
  }
  const noAddress = (text: string) => clean(text, [...addresses, sidecarUrl, statusUrl, '127.0.0.1'])

  try {
    let report = await relayCheck()
    check('baseline: both relays up, preflight passes', report.startsWith('PASS'), report.split('\n')[0])
    let view = await consoleView()
    check(
      'baseline: console reads gateway status as ok, with its allowed call',
      view.status === 200 && view.gateway === 'ok' && view.text.includes('Gateway allowed a call to'),
      view.line
    )
    check('console activity leaks no address or URL', noAddress(view.text))

    await close(relays[1])
    report = await relayCheck()
    check(
      'one relay down: preflight warns and names only the label',
      report.startsWith('WARN') && report.includes('relay2'),
      report.split('\n')[0]
    )
    check('warning leaks no address, URL or secret', noAddress(report))

    await close(relays[0])
    report = await relayCheck()
    check(
      'all relays down: preflight fails with a clear reason',
      report.startsWith('FAIL') && report.includes('no rendezvous relay reachable'),
      report.split('\n')[0]
    )
    check('failure leaks no address, URL or secret', noAddress(report))

    sidecar.stop(true)
    report = await relayCheck()
    check('relays and payment sidecar down: preflight still fails', report.startsWith('FAIL'), report.split('\n')[0])
    // The console has no relay view. It must keep working and not blame the gateway status source.
    view = await consoleView()
    check(
      'relay outage: console keeps answering and still reads gateway status as ok',
      view.status === 200 && view.gateway === 'ok',
      view.line
    )
    check('console activity during the relay outage leaks no address or URL', noAddress(view.text))

    // A separate failure: the gateway's statusapi itself stops answering.
    statusServer.stop(true)
    view = await consoleView()
    check(
      'gateway status outage: console marks only the gateway source unavailable, not an error page',
      view.status === 200 &&
        view.gateway === 'unavailable' &&
        (view.body.sources as Record<string, string>).approval === 'ok',
      view.line
    )
    check('console activity during the status outage leaks no address or URL', noAddress(view.text))

    for (const [index, port] of ports.entries()) {
      relays[index] = createServer((socket) => socket.end())
      await new Promise<void>((resolve) => relays[index].listen(port, '127.0.0.1', () => resolve()))
    }
    const restored = Bun.serve({ hostname: '127.0.0.1', port: sidecarPort, fetch: () => Response.json({ ok: true }) })
    statusServer = Bun.serve({ ...statusApp, port: statusPort })
    report = await relayCheck()
    check(
      'recovery: relays back on the same ports, preflight passes again',
      report.startsWith('PASS'),
      report.split('\n')[0]
    )
    view = await consoleView()
    check(
      'recovery: statusapi back on the same port, console reads gateway status as ok again',
      view.status === 200 && view.gateway === 'ok' && view.text.includes('Gateway allowed a call to'),
      view.line
    )
    restored.stop(true)
  } finally {
    await Promise.all(relays.map((relay) => (relay.listening ? close(relay) : Promise.resolve())))
    sidecar.stop(true)
    statusServer.stop(true)
  }
}

// Beat 2: nobody decides in time, and a confirmed grant transaction is slow to land.
async function approvalTimeout() {
  const chain = new MemoryChain()
  const api = createApprovalApi({ token: () => TOKEN, signer: chain, resolver: chain })
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => api.handle(request) })
  try {
    const tools = createTools(agentConfig(server.url.origin, 1000))
    const first = shown(await tools.requestPrivateAccess({ service: 'web', reason: 'drill' }))
    check(
      'agent: no decision in time returns a clear pending message',
      first.startsWith('pending: no decision after 1s'),
      first
    )
    check('agent message leaks no token', clean(first))

    const pending = (await read(await call(api, '/requests'))).body.requests as Array<{ id: string; status: string }>
    check('console: exactly one pending card for the request', pending.length === 1 && pending[0].status === 'pending')
    await read(await call(api, `/requests/${pending[0].id}/approve`, 'POST'))
    const second = shown(await tools.requestPrivateAccess({ service: 'web', reason: 'drill' }))
    check(
      'recovery: asking again waits on the same request and reports the grant',
      second.startsWith('granted:'),
      second
    )
    const after = (await read(await call(api, '/requests'))).body.requests as unknown[]
    check('recovery created no duplicate request', after.length === 1)
  } finally {
    server.stop(true)
  }

  // The grant transaction is submitted but its receipt times out.
  const clock = new ManualClock()
  const slow = new MemoryChain()
  let outcome: SettleOutcome = 'unresolved'
  slow.grant = async (input) => {
    slow.grants.add(input.agentLabel)
    throw new UnresolvedWriteError('grant', `0x${'ab'.repeat(32)}`, async () => outcome)
  }
  const console2 = createApprovalApi({ token: () => TOKEN, signer: slow, resolver: slow, clock })
  const created = (
    await read(
      await call(console2, '/requests', 'POST', { agentLabel: 'agent-1', gatewayLabel: 'gateway-1', service: 'web' })
    )
  ).body
  const approving = await read(await call(console2, `/requests/${created.id}/approve`, 'POST'))
  check(
    'console: an unconfirmed grant shows as approving with its transaction, not approved',
    approving.status === 202 && approving.body.status === 'approving' && Boolean(approving.body.unresolvedWrite),
    `HTTP ${approving.status} status=${approving.body.status}`
  )
  const again = await read(
    await call(console2, '/requests', 'POST', { agentLabel: 'agent-1', gatewayLabel: 'gateway-1', service: 'web' })
  )
  const second = await read(await call(console2, `/requests/${again.body.id}/approve`, 'POST'))
  check(
    'console: a second approve is refused until the first settles',
    second.status === 409,
    `HTTP ${second.status} ${errorLine(second.body)}`
  )
  await clock.advance(5000)
  outcome = 'confirmed'
  await clock.advance(5000)
  const settled = (await read(await call(console2, `/requests/${created.id}`))).body
  check(
    'recovery: the late receipt settles the card to approved without a resubmit',
    settled.status === 'approved' && !settled.unresolvedWrite,
    `status=${settled.status}`
  )

  // The RPC call itself times out before anything is submitted.
  const flaky = new MemoryChain()
  const grant = flaky.grant.bind(flaky)
  let rpcDown = true
  flaky.grant = async (input) => {
    if (rpcDown) throw new Error(`request timed out after 10000ms: POST ${RPC_URL}`)
    return grant(input)
  }
  const console3 = createApprovalApi({ token: () => TOKEN, signer: flaky, resolver: flaky })
  const request = (
    await read(
      await call(console3, '/requests', 'POST', { agentLabel: 'agent-1', gatewayLabel: 'gateway-1', service: 'web' })
    )
  ).body
  const { value: failed, log } = await captureLog(async () =>
    read(await call(console3, `/requests/${request.id}/approve`, 'POST'))
  )
  check(
    'console: an RPC timeout fails the approve with a generic code',
    failed.status === 502 && errorLine(failed.body).startsWith('grant_failed'),
    `HTTP ${failed.status} ${errorLine(failed.body)}`
  )
  check('console answer leaks no RPC URL or key', clean(failed.text))
  // Since 0701e14 the service logs only the failed operation, never the cause.
  check(
    'service log names the failed grant and leaks no RPC URL',
    log.includes('signer grant failed') && clean(log),
    log
  )
  rpcDown = false
  const retried = await read(await call(console3, `/requests/${request.id}/approve`, 'POST'))
  check(
    'recovery: the card stays pending and a retry approves it',
    retried.status === 200 && retried.body.status === 'approved',
    `HTTP ${retried.status} status=${retried.body.status}`
  )
}

// Beat 5: a timed grant reaches its end, including when the revoke write fails.
async function expiredGrant() {
  const clock = new ManualClock()
  const chain = new MemoryChain()
  const api = createApprovalApi({ token: () => TOKEN, signer: chain, resolver: chain, clock })
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => api.handle(request) })
  try {
    const body = { agentLabel: 'agent-1', gatewayLabel: 'gateway-1', service: 'web', requestedDuration: 60 }
    const created = (await read(await call(api, '/requests', 'POST', body))).body
    const approved = (await read(await call(api, `/requests/${created.id}/approve`, 'POST'))).body
    check(
      'console: a timed grant shows its server timer and countdown',
      approved.durationMode === 'server-timer' && approved.remainingSeconds === 60,
      `remainingSeconds=${approved.remainingSeconds}`
    )

    chain.failRevoke = true
    const { log } = await captureLog(() => clock.advance(60_000))
    let card = (await read(await call(api, `/requests/${created.id}`))).body
    check(
      'failed expiry revoke: card stays approved and says the expiry failed',
      card.status === 'approved' && card.expiryStatus === 'failed' && chain.grants.has('agent-1'),
      `status=${card.status} expiryStatus=${card.expiryStatus}`
    )
    check('service log for the failed revoke leaks no secret', clean(log), log || '(nothing logged)')
    check(
      'console card carries no secret and no signer diagnostic',
      clean(JSON.stringify(card), ['adapter diagnostic'])
    )

    chain.failRevoke = false
    await clock.advance(5000)
    card = (await read(await call(api, `/requests/${created.id}`))).body
    check(
      'recovery: the timer retries and the grant is revoked on chain',
      card.status === 'revoked' && card.revokeReason === 'duration' && !chain.grants.has('agent-1'),
      `status=${card.status} revokeReason=${card.revokeReason}`
    )

    const tools = createTools(agentConfig(server.url.origin, 1000))
    const agentView = shown(await tools.requestPrivateAccess({ service: 'web', reason: 'after expiry' }))
    check(
      'agent: a new request after expiry waits for a human instead of reusing the old grant',
      agentView.startsWith('pending:'),
      agentView
    )
    const next = (
      (await read(await call(api, '/requests'))).body.requests as Array<{ id: string; status: string }>
    ).find((r) => r.status === 'pending')!
    const renewed = (await read(await call(api, `/requests/${next.id}/approve`, 'POST'))).body
    check(
      'recovery: a fresh approval grants again',
      renewed.status === 'approved' && chain.grants.has('agent-1'),
      `status=${renewed.status}`
    )
  } finally {
    server.stop(true)
  }
}

// Beat 2 (join) and the preflight: a device or sidecar points at another tailnet.
async function wrongTailnet() {
  const api = createApprovalApi({ token: () => TOKEN, ensParent: TAILNET })
  const join = (tailnet: string) =>
    api.handle(
      new Request('http://127.0.0.1/api/joins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'laptop', pubkey: 'ab'.repeat(32), tailnet }),
      })
    )
  const wrong = await read(await join('other.eth'))
  check(
    'join API: a device for another tailnet is refused with wrong_tailnet',
    wrong.status === 400 && errorLine(wrong.body).startsWith('wrong_tailnet'),
    `HTTP ${wrong.status} ${errorLine(wrong.body)}`
  )
  check('refusal does not reveal which tailnet this service manages', clean(wrong.text, [TAILNET]))
  const queue = (await read(await call(api, '/joins'))).body.joins as unknown[]
  check('console: the refused join adds no card', queue.length === 0)
  const right = await read(await join(TAILNET))
  check(
    'recovery: the same device with the right tailnet is queued',
    right.status === 201 && right.body.status === 'pending',
    `HTTP ${right.status} status=${right.body.status}`
  )

  let served = 'other.eth'
  const node: NodeProbe = {
    describe: 'gateway (local)',
    async getJson(_port, path) {
      return path === '/health' ? { status: 200, body: { ok: true, tailnetName: served } } : { status: 404, body: {} }
    },
  }
  const ctx = {
    env: { BRAMBLE_TAILNET_NAME: TAILNET, SEPOLIA_RPC_URL: RPC_URL },
    localRoles: [],
    roleEnv: {},
    nodes: { gateway: node },
    http: httpGet,
    tcp: tcpConnect,
    granterRingPresent: false,
  }
  const sidecarCheck = async () =>
    shown(
      formatReport(
        await runPreflight([buildChecks(ctx).find((u) => u.id === 'sidecar:gateway')!], { waitMs: 0, intervalMs: 0 })
      )
    )
  let report = await sidecarCheck()
  check(
    'preflight: a sidecar on another tailnet fails and names both tailnets',
    report.startsWith('FAIL') && report.includes('other.eth') && report.includes(TAILNET),
    report.split('\n')[0]
  )
  check('preflight line leaks no RPC URL or token', clean(report))
  served = TAILNET
  report = await sidecarCheck()
  check('recovery: the corrected sidecar passes', report.startsWith('PASS'), report.split('\n')[0])
}

const DRILLS: Record<string, () => Promise<void>> = {
  'relay-down': relayDown,
  'approval-timeout': approvalTimeout,
  'expired-grant': expiredGrant,
  'wrong-tailnet': wrongTailnet,
}

const names = process.argv.slice(2)
const unknown = names.filter((name) => !Object.hasOwn(DRILLS, name))
if (unknown.length > 0) {
  console.error(`unknown drill: ${unknown.join(', ')}. Choose from: ${Object.keys(DRILLS).join(', ')}`)
  process.exit(2)
}
for (const name of names.length > 0 ? names : Object.keys(DRILLS)) {
  console.log(`\n== ${name}`)
  outputs = []
  await DRILLS[name]()
  const leaking = outputs.filter((text) => !clean(text)).length
  check(
    `every output shown in this drill (${outputs.length} API answers, agent messages, reports and logs) holds no token, RPC URL, credential or key`,
    leaking === 0,
    leaking === 0 ? undefined : `${leaking} output(s) leak`
  )
}
console.log(failures === 0 ? '\nall drills passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
