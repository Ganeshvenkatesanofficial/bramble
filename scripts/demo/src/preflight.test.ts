import { describe, expect, it } from 'bun:test'
import {
  buildChecks,
  exitCode,
  formatReport,
  formatUsdc,
  missingEnvNames,
  runPreflight,
  type CheckResult,
  type CheckUnit,
  type Env,
  type HttpResponse,
  type NodeProbe,
  type PreflightContext,
} from './preflight'
import { NODE_ROLES } from './topology'

const USDC = '0.0.429274'
const SECRET = 'sk-live-0123456789abcdef'

const GOOD_NODE_ENV: Env = {
  BRAMBLE_NODE_LABEL: 'gateway',
  BRAMBLE_TAILNET_NAME: 'mesh.eth',
  BRAMBLE_TAILNET_REGISTRY: '0x1',
  BRAMBLE_TAILNET_REGISTRY_DEPLOY_BLOCK: '1',
  BRAMBLE_RELAY_REGISTRY: '0x2',
  BRAMBLE_RELAY_REGISTRY_DEPLOY_BLOCK: '1',
  BRAMBLE_PRIVATE_KEY: SECRET,
  HEDERA_CLIENT_ACCOUNT_ID: '0.0.1001',
  HEDERA_CLIENT_PRIVATE_KEY: SECRET,
  BRAMBLE_SERVICE_NAME: 'web',
  BRAMBLE_GATEWAY_LABEL: 'gateway',
}

type Routes = Record<string, HttpResponse | (() => HttpResponse) | Error>

function probe(routes: Routes, describe = 'node'): NodeProbe {
  return {
    describe,
    async getJson(port, path) {
      const hit = routes[`${port}${path}`]
      if (hit === undefined) return { status: 404, body: {} }
      if (hit instanceof Error) throw hit
      return typeof hit === 'function' ? hit() : hit
    },
  }
}

const HEALTHY: Routes = {
  '7890/health': { status: 200, body: { ok: true, tailnetName: 'mesh.eth' } },
  '7890/tor/status': { status: 200, body: { state: 'ready' } },
  '7899/endpoint': {
    status: 200,
    body: { state: 'discovered', endpoint: '198.51.100.4:54321', server: 'stun.example.org:3478' },
  },
  '7890/devices': { status: 200, body: { labels: ['gateway', 'worker', 'agent'] } },
  '7890/relays': {
    status: 200,
    body: {
      rendezvous: [{ label: 'relay1', address: 'relay.example.org:3478', sidecarUrl: 'https://pay.example.org' }],
      dataRelays: [],
    },
  },
}

function context(over: Partial<PreflightContext> = {}): PreflightContext {
  return {
    env: {
      BRAMBLE_TAILNET_NAME: 'mesh.eth',
      DEMO_AGENT_LABEL: 'agent',
      HEDERA_CLIENT_ACCOUNT_ID: '0.0.1001',
      ...GOOD_NODE_ENV,
    },
    localRoles: ['gateway'],
    roleEnv: {},
    nodes: { gateway: probe(HEALTHY, 'this machine'), worker: probe(HEALTHY, 'worker') },
    async http(url) {
      if (url.includes('/api/v1/accounts/')) {
        return { status: 200, body: { tokens: [{ token_id: USDC, balance: 2_000_000 }] } }
      }
      return { status: 200, body: {} }
    },
    async tcp() {},
    granterRingPresent: true,
    ...over,
  }
}

async function run(ctx: PreflightContext, waitMs = 0): Promise<CheckResult[]> {
  return runPreflight(buildChecks(ctx), { waitMs, intervalMs: 10, sleep: async () => {} })
}

function byId(results: CheckResult[], id: string): CheckResult {
  const found = results.find((r) => r.id === id)
  if (!found) throw new Error(`no result ${id}; have ${results.map((r) => r.id).join(', ')}`)
  return found
}

describe('env names', () => {
  it('reports missing names and never a value', async () => {
    const env = { ...GOOD_NODE_ENV }
    delete env.HEDERA_CLIENT_PRIVATE_KEY
    const results = await run(context({ env }))
    const r = byId(results, 'env:gateway')
    expect(r.status).toBe('fail')
    expect(r.detail).toContain('HEDERA_CLIENT_PRIVATE_KEY')
    expect(JSON.stringify(results)).not.toContain(SECRET)
  })

  it('treats an empty value as missing', () => {
    const ctx = context({ env: { ...GOOD_NODE_ENV, BRAMBLE_PRIVATE_KEY: '  ' } })
    expect(missingEnvNames(ctx, 'gateway')).toEqual(['BRAMBLE_PRIVATE_KEY'])
  })

  it('checks a role against its own env file when one is given', () => {
    const ctx = context({ env: {}, roleEnv: { gateway: GOOD_NODE_ENV } })
    expect(missingEnvNames(ctx, 'gateway')).toEqual([])
  })

  it('admin needs the granter key (env or Key Ring) and a HEDERA_SERVER_ name', () => {
    const adminEnv: Env = {
      BRAMBLE_TAILNET_NAME: 'mesh.eth',
      BRAMBLE_TAILNET_REGISTRY: '0x1',
      BRAMBLE_TAILNET_REGISTRY_DEPLOY_BLOCK: '1',
      BRAMBLE_RELAY_REGISTRY: '0x2',
      BRAMBLE_RELAY_REGISTRY_DEPLOY_BLOCK: '1',
      SEPOLIA_PRIVATE_KEY: SECRET,
      APPROVAL_DEMO_TOKEN: SECRET,
    }
    const none = context({ env: adminEnv, localRoles: ['admin'], granterRingPresent: false })
    expect(missingEnvNames(none, 'admin')).toEqual(['BRAMBLE_GRANTER_PRIVATE_KEY', 'HEDERA_SERVER_*'])

    const ok = context({
      env: { ...adminEnv, HEDERA_SERVER_ACCOUNT_ID: '0.0.2', BRAMBLE_GRANTER_PRIVATE_KEY: SECRET },
      localRoles: ['admin'],
      granterRingPresent: false,
    })
    expect(missingEnvNames(ok, 'admin')).toEqual([])
  })

  it('SEPOLIA_PRIVATE_KEY missing on admin is reported by name only', async () => {
    const env: Env = { BRAMBLE_GRANTER_PRIVATE_KEY: SECRET, HEDERA_SERVER_KEY: SECRET }
    const results = await run(context({ env, localRoles: ['admin'] }))
    const r = byId(results, 'env:admin')
    expect(r.detail).toContain('SEPOLIA_PRIVATE_KEY')
    expect(JSON.stringify(results)).not.toContain(SECRET)
  })
})

describe('sepolia rpc', () => {
  it('passes with a warning when SEPOLIA_RPC_URL is unset', async () => {
    const r = byId(await run(context()), 'sepolia-rpc')
    expect(r.status).toBe('warn')
    expect(r.detail).toContain('stale')
  })

  it('passes and does not print the value when it is set', async () => {
    const url = 'https://eth-sepolia.example.org/v2/abcdef0123456789'
    const results = await run(context({ env: { ...context().env, SEPOLIA_RPC_URL: url } }))
    const r = byId(results, 'sepolia-rpc')
    expect(r.status).toBe('pass')
    expect(JSON.stringify(results)).not.toContain('abcdef0123456789')
  })

  it('a warning alone leaves the exit code at zero', async () => {
    const results = await run(context())
    expect(byId(results, 'sepolia-rpc').status).toBe('warn')
    expect(exitCode(results)).toBe(0)
  })
})

describe('node checks', () => {
  it('everything healthy passes', async () => {
    const results = await run(context())
    expect(results.filter((r) => r.status === 'fail')).toEqual([])
    expect(byId(results, 'stun:gateway').detail).toContain('198.51.100.4:54321')
  })

  it('a node that cannot be reached is a failure, not a skip', async () => {
    const results = await run(context({ nodes: { gateway: probe(HEALTHY) } }))
    const r = byId(results, 'reach:worker')
    expect(r.status).toBe('fail')
    expect(r.detail).toContain('DEMO_WORKER_SSH')
  })

  it('a sidecar serving the wrong tailnet fails without retry', async () => {
    const wrong = probe({ ...HEALTHY, '7890/health': { status: 200, body: { ok: true, tailnetName: 'other.eth' } } })
    const r = byId(await run(context({ nodes: { gateway: wrong, worker: probe(HEALTHY) } })), 'sidecar:gateway')
    expect(r.status).toBe('fail')
    expect(r.retryable).toBeFalsy()
  })

  it('a connection error becomes a retryable failure with the URL scrubbed', async () => {
    const down = probe({
      ...HEALTHY,
      '7890/health': new Error('connect ECONNREFUSED https://user:pw@10.0.0.1:7890/health'),
    })
    const r = byId(await run(context({ nodes: { gateway: down, worker: probe(HEALTHY) } })), 'sidecar:gateway')
    expect(r.status).toBe('fail')
    expect(r.retryable).toBe(true)
    expect(r.detail).not.toContain('pw@')
  })

  it('reports Tor starting, then ready, when given time', async () => {
    let calls = 0
    const tor = probe({
      ...HEALTHY,
      '7890/tor/status': () => ({ status: 200, body: { state: ++calls < 3 ? 'starting' : 'ready' } }),
    })
    const ctx = context({ nodes: { gateway: tor, worker: probe(HEALTHY) } })

    const once = await run(ctx, 0)
    expect(byId(once, 'tor:gateway').detail).toContain('starting Tor')

    calls = 0
    const waited = await runPreflight(buildChecks(ctx), {
      waitMs: 1000,
      intervalMs: 10,
      now: clock(),
      sleep: async () => {},
    })
    expect(byId(waited, 'tor:gateway').status).toBe('pass')
  })

  it('a failed Tor start carries the sidecar error text, scrubbed', async () => {
    const tor = probe({
      ...HEALTHY,
      '7890/tor/status': {
        status: 200,
        body: { state: 'failed', lastError: 'bootstrap failed at https://x.example/y' },
      },
    })
    const r = byId(await run(context({ nodes: { gateway: tor, worker: probe(HEALTHY) } })), 'tor:gateway')
    expect(r.status).toBe('fail')
    expect(r.detail).toContain('<url>')
  })

  it('an old sidecar with no /tor/status fails with a clear reason', async () => {
    const old = probe({ ...HEALTHY, '7890/tor/status': { status: 404, body: {} } })
    const r = byId(await run(context({ nodes: { gateway: old, worker: probe(HEALTHY) } })), 'tor:gateway')
    expect(r.detail).toContain('predates the Tor client')
  })

  it('STUN discovery states map to results', async () => {
    const states: Array<[unknown, string]> = [
      [{ state: 'disabled' }, 'BRAMBLE_STUN_SERVERS'],
      [{ state: 'discovering' }, 'in progress'],
      [{ state: 'unavailable', error: 'no response' }, 'no response'],
    ]
    for (const [body, text] of states) {
      const node = probe({ ...HEALTHY, '7899/endpoint': { status: 200, body } })
      const r = byId(await run(context({ nodes: { gateway: node, worker: probe(HEALTHY) } })), 'stun:gateway')
      expect(r.status).toBe('fail')
      expect(r.detail).toContain(text)
    }
  })

  it('fails when the agent device is not in the registry', async () => {
    const node = probe({ ...HEALTHY, '7890/devices': { status: 200, body: { labels: ['gateway'] } } })
    const r = byId(await run(context({ nodes: { gateway: node, worker: probe(HEALTHY) } })), 'registry:gateway')
    expect(r.status).toBe('fail')
    expect(r.detail).toContain('agent')
  })
})

describe('relay', () => {
  it('passes when the rendezvous address and payment sidecar answer', async () => {
    const r = byId(await run(context()), 'relay')
    expect(r.status).toBe('pass')
  })

  it('fails when nothing answers', async () => {
    const ctx = context({
      async tcp() {
        throw new Error('timeout')
      },
      async http(url) {
        if (url.includes('/api/v1/accounts/'))
          return { status: 200, body: { tokens: [{ token_id: USDC, balance: 2_000_000 }] } }
        throw new Error('connect refused')
      },
    })
    const r = byId(await run(ctx), 'relay')
    expect(r.status).toBe('fail')
    expect(r.detail).toContain('relay1')
  })

  it('warns when only some relay endpoints answer', async () => {
    const ctx = context({
      async tcp() {
        throw new Error('timeout')
      },
    })
    expect(byId(await run(ctx), 'relay').status).toBe('warn')
  })

  it('does not fetch a rendezvous address that is not host:port', async () => {
    const bad = probe({
      ...HEALTHY,
      '7890/relays': { status: 200, body: { rendezvous: [{ label: 'r', address: 'http://evil/x' }], dataRelays: [] } },
    })
    const ctx = context({ nodes: { gateway: bad, worker: bad } })
    const r = byId(await run(ctx), 'relay')
    expect(r.status).toBe('fail')
  })
})

describe('hedera payer', () => {
  function withMirror(body: unknown, status = 200): PreflightContext {
    return context({
      async http(url) {
        if (url.includes('/api/v1/accounts/')) return { status, body }
        return { status: 200, body: {} }
      },
    })
  }

  it('passes with USDC associated and enough balance', async () => {
    const r = byId(await run(context()), 'hedera:0.0.1001')
    expect(r.status).toBe('pass')
    expect(r.detail).toContain('2.000000 USDC')
  })

  it('fails when USDC is not associated', async () => {
    const r = byId(await run(withMirror({ tokens: [] })), 'hedera:0.0.1001')
    expect(r.status).toBe('fail')
    expect(r.detail).toContain('not associated')
  })

  it('fails when the balance is below the minimum', async () => {
    const r = byId(await run(withMirror({ tokens: [{ token_id: USDC, balance: 100 }] })), 'hedera:0.0.1001')
    expect(r.status).toBe('fail')
    expect(r.detail).toContain('below')
  })

  it('honours DEMO_MIN_PAYER_USDC_ATOMIC', async () => {
    const ctx = withMirror({ tokens: [{ token_id: USDC, balance: 100 }] })
    ctx.env = { ...ctx.env, DEMO_MIN_PAYER_USDC_ATOMIC: '50' }
    expect(byId(await run(ctx), 'hedera:0.0.1001').status).toBe('pass')
  })

  it('fails on an unknown account', async () => {
    expect(byId(await run(withMirror({}, 404)), 'hedera:0.0.1001').status).toBe('fail')
  })

  it('checks every account in DEMO_PAYER_ACCOUNT_IDS', async () => {
    const ctx = context()
    ctx.env = { ...ctx.env, DEMO_PAYER_ACCOUNT_IDS: '0.0.1001, 0.0.1002' }
    const ids = (await run(ctx)).map((r) => r.id).filter((id) => id.startsWith('hedera:'))
    expect(ids).toEqual(['hedera:0.0.1001', 'hedera:0.0.1002'])
  })

  it('rejects a payer id that is not shaped like a Hedera account', async () => {
    const ctx = context()
    ctx.env = { ...ctx.env, DEMO_PAYER_ACCOUNT_IDS: '../../etc/passwd' }
    const r = byId(await run(ctx), 'hedera:../../etc/passwd')
    expect(r.status).toBe('fail')
  })
})

describe('runner', () => {
  it('a throwing check becomes a failure instead of aborting the run', async () => {
    const units: CheckUnit[] = [
      {
        id: 'a',
        run: async () => {
          throw new Error('boom')
        },
      },
      { id: 'b', run: async () => ({ id: 'b', status: 'pass', detail: 'ok' }) },
    ]
    const results = await runPreflight(units, { waitMs: 0, intervalMs: 1, sleep: async () => {} })
    expect(results.map((r) => r.status)).toEqual(['fail', 'pass'])
  })

  it('retries only failed retryable checks and stops at the deadline', async () => {
    const counts = { flaky: 0, stable: 0, hard: 0 }
    const units: CheckUnit[] = [
      {
        id: 'flaky',
        run: async () =>
          ++counts.flaky >= 3
            ? { id: 'flaky', status: 'pass', detail: '' }
            : { id: 'flaky', status: 'fail', detail: '', retryable: true },
      },
      {
        id: 'stable',
        run: async () => {
          counts.stable++
          return { id: 'stable', status: 'pass', detail: '' }
        },
      },
      {
        id: 'hard',
        run: async () => {
          counts.hard++
          return { id: 'hard', status: 'fail', detail: '' }
        },
      },
    ]
    const results = await runPreflight(units, { waitMs: 1000, intervalMs: 10, now: clock(), sleep: async () => {} })
    expect(results.map((r) => r.status)).toEqual(['pass', 'pass', 'fail'])
    expect(counts).toEqual({ flaky: 3, stable: 1, hard: 1 })
  })

  it('gives up retrying once the wait is spent', async () => {
    let n = 0
    const units: CheckUnit[] = [
      {
        id: 'x',
        run: async () => {
          n++
          return { id: 'x', status: 'fail', detail: 'down', retryable: true }
        },
      },
    ]
    const results = await runPreflight(units, { waitMs: 50, intervalMs: 10, now: clock(), sleep: async () => {} })
    expect(results[0].status).toBe('fail')
    expect(n).toBeGreaterThan(1)
    expect(n).toBeLessThan(10)
  })
})

describe('report', () => {
  it('lists each result and a summary, and exits 1 on a failure', () => {
    const results: CheckResult[] = [
      { id: 'a', status: 'pass', detail: 'fine' },
      { id: 'bb', status: 'warn', detail: 'hmm' },
      { id: 'c', status: 'fail', detail: 'bad' },
    ]
    const text = formatReport(results)
    expect(text).toContain('PASS  a ')
    expect(text).toContain('WARN  bb')
    expect(text).toContain('FAIL  c ')
    expect(text).toContain('1 passed, 1 warnings, 1 failed')
    expect(exitCode(results)).toBe(1)
  })

  it('formats atomic USDC', () => {
    expect(formatUsdc(500_000n)).toBe('0.500000')
    expect(formatUsdc(12_345_678n)).toBe('12.345678')
  })

  it('covers every node role', () => {
    expect(NODE_ROLES).toEqual(['gateway', 'worker'])
  })
})

/** A fake clock that advances 10 ms per read. */
function clock(): () => number {
  let t = 0
  return () => (t += 10)
}
