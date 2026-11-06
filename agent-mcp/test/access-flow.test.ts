import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { x25519 } from '@noble/curves/ed25519'
import { bytesToHex } from '@noble/hashes/utils'
import { createApprovalApi } from '../../approval/src/lib/api'
import { createChainAdapters } from '../../approval/src/lib/chain'

interface Fixture {
  forwardUrl: string
  controlUrl: string
  agentPub: string
  gatewayPub: string
}

interface Observation {
  decisions: { RequesterLabel: string; Service: string; Allowed: boolean; Detail: string }[]
  backendPaths: string[]
}

const toolText = (result: Awaited<ReturnType<Client['callTool']>>) => {
  expect(result.isError).not.toBe(true)
  const content = result.content as { type: string; text: string }[]
  expect(content[0].type).toBe('text')
  return content[0].text
}

test('deny -> request -> approve -> succeed -> revoke -> denied over userspace WireGuard', async () => {
  const tailnet = 'mesh.eth'
  const token = randomUUID()
  const granterKey = x25519.utils.randomPrivateKey()
  const records = new Map<string, string>([
    [`granter.${tailnet}|pubkey`, bytesToHex(x25519.getPublicKey(granterKey))],
    [`gateway-1.${tailnet}|acl-granters`, 'granter'],
  ])
  const adapters = createChainAdapters({
    tailnetName: tailnet,
    granterLabel: 'granter',
    loadGranterKey: async () => bytesToHex(granterKey),
    resolver: { getText: async (name, key) => records.get(`${name}|${key}`) ?? null },
    signer: {
      async setText(name, key, value) {
        const hash = `0x${randomUUID().replaceAll('-', '').padStart(64, '0')}`
        return {
          hash,
          async wait() {
            records.set(`${name}|${key}`, value)
          },
        }
      },
    },
    getReceiptStatus: async () => 'success',
    readDevice: async (label) => ({
      pubkey: records.get(`${label}.${tailnet}|pubkey`) ?? null,
      revoked: false,
      expiry: '4102444800',
    }),
  })
  const api = createApprovalApi({ ...adapters, token: () => token })
  const approval = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      if (!path.startsWith('/devices/')) return api.handle(request)
      const name = `${path.slice('/devices/'.length)}.${tailnet}`
      const pubkey = records.get(`${name}|pubkey`)
      if (!pubkey) return new Response('unknown fixture identity', { status: 404 })
      return Response.json({
        pubkey,
        revoked: false,
        expiry: '4102444800',
        acl: (records.get(`${name}|acl`) ?? '').split(',').filter(Boolean),
        aclGranters: (records.get(`${name}|acl-granters`) ?? '').split(',').filter(Boolean),
      })
    },
  })
  const fixtureProcess = Bun.spawn(
    ['go', 'test', './gateway', '-run', '^TestAccessFlowFixture$', '-count=1', '-v', '-timeout=50s'],
    {
      cwd: new URL('../../brambled', import.meta.url).pathname,
      env: { ...process.env, BRAMBLE_ACCESS_FLOW_RESOLVER_URL: approval.url.origin },
      stdout: 'pipe',
      stderr: 'pipe',
    }
  )
  const stderr = new Response(fixtureProcess.stderr).text()
  const client = new Client({ name: 'rootless-access-flow', version: '0.1.0' })
  let fixture: Fixture | undefined
  let output = ''
  let readyResolve!: (fixture: Fixture) => void
  let readyReject!: (error: Error) => void
  const ready = new Promise<Fixture>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  const drained = (async () => {
    const decoder = new TextDecoder()
    for await (const chunk of fixtureProcess.stdout) {
      output += decoder.decode(chunk, { stream: true })
      const match = /^ACCESS_FLOW_READY (.+)$/m.exec(output)
      if (match) readyResolve(JSON.parse(match[1]) as Fixture)
    }
    readyReject(new Error(`WireGuard fixture exited before ready: ${output}\n${await stderr}`))
  })()
  try {
    fixture = await Promise.race([
      ready,
      Bun.sleep(30_000).then(() => {
        throw new Error('WireGuard fixture startup timed out')
      }),
    ])
    records.set(`agent-1.${tailnet}|pubkey`, fixture.agentPub)
    records.set(`gateway-1.${tailnet}|pubkey`, fixture.gatewayPub)
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['run', 'src/index.ts'],
        cwd: new URL('..', import.meta.url).pathname,
        env: {
          PATH: process.env.PATH ?? '',
          BRAMBLE_APPROVAL_URL: approval.url.origin,
          APPROVAL_DEMO_TOKEN: token,
          BRAMBLE_AGENT_LABEL: 'agent-1',
          BRAMBLE_GATEWAY_LABEL: 'gateway-1',
          BRAMBLE_FORWARD_URL: fixture.forwardUrl,
          BRAMBLE_POLL_INTERVAL_MS: '20',
          BRAMBLE_DECISION_TIMEOUT_MS: '10000',
        },
      })
    )
    const callService = async () =>
      toolText(
        await client.callTool({
          name: 'call_private_service',
          arguments: { path: '/task' },
        })
      )
    const observe = async () => {
      const response = await fetch(fixture!.controlUrl)
      return (await response.json()) as Observation
    }
    const post = async (path: string) => {
      const response = await fetch(`${approval.url.origin}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(response.status).toBe(200)
      return (await response.json()) as { status: string }
    }
    expect(await callService()).toStartWith('denied: no grant')
    let observations = await observe()
    expect(observations.decisions).toEqual([
      expect.objectContaining({
        RequesterLabel: 'agent-1',
        Service: 'staging-api',
        Allowed: false,
        Detail: 'no matching granted digest',
      }),
    ])
    expect(observations.backendPaths).toEqual([])

    const pending = client.callTool({
      name: 'request_private_access',
      arguments: { service: 'staging-api', reason: 'fetch the private task' },
    })
    // Start observing the promise immediately, even if a queue assertion fails.
    void pending.catch(() => {})
    let requests: { id: string; status: string; agentLabel: string; gatewayLabel: string; service: string }[] = []
    const deadline = performance.now() + 5000
    while (requests.length === 0 && performance.now() < deadline) {
      const response = await fetch(`${approval.url.origin}/api/requests`)
      requests = ((await response.json()) as { requests: typeof requests }).requests
      if (requests.length === 0) await Bun.sleep(10)
    }
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      status: 'pending',
      agentLabel: 'agent-1',
      gatewayLabel: 'gateway-1',
      service: 'staging-api',
    })
    // Merely requesting access must leave enforcement unchanged.
    expect(await callService()).toStartWith('denied: no grant')
    expect((await observe()).backendPaths).toEqual([])
    expect((await post(`/api/requests/${requests[0].id}/approve`)).status).toBe('approved')
    expect(toolText(await pending)).toStartWith('granted:')
    expect(await callService()).toBe('task result: private task over WireGuard')
    observations = await observe()
    expect(observations.backendPaths).toEqual(['/task'])
    expect(observations.decisions.map((d) => d.Allowed)).toEqual([false, false, true])

    const started = performance.now()
    expect((await post('/api/grants/agent-1/revoke')).status).toBe('revoked')
    expect(await callService()).toStartWith('denied: no grant')
    const revocationMs = performance.now() - started
    observations = await observe()
    expect(observations.decisions.map((d) => d.Allowed)).toEqual([false, false, true, false])
    expect(observations.decisions.at(-1)?.Detail).toBe('no matching granted digest')
    expect(observations.backendPaths).toEqual(['/task'])
    expect(revocationMs).toBeLessThan(5000)
    console.log(
      `Verified rootless revocation: ${revocationMs.toFixed(2)} ms (revoke POST to MCP denial; in-memory ENS, loopback userspace WireGuard, no Tor)`
    )
  } finally {
    await client.close()
    if (fixture) await fetch(`${fixture.controlUrl}/stop`, { method: 'POST' }).catch(() => {})
    else fixtureProcess.kill()
    const code = await fixtureProcess.exited
    await drained
    approval.stop(true)
    expect(code, `WireGuard fixture failed: ${output}\n${await stderr}`).toBe(0)
  }
}, 60_000)
