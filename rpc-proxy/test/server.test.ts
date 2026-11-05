import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, type Config } from '../src/config.ts'
import { MemoryLog } from '../src/log.ts'
import { createProxyServer } from '../src/server.ts'

const SECRET_PATH = '/v3/SECRET-API-KEY-123'

interface Upstream {
  server: Server
  url: string
  received: { path: string; headers: Record<string, unknown>; body: string }[]
}

function startUpstream(): Promise<Upstream> {
  return new Promise((resolve) => {
    const received: Upstream['received'] = []
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8')
        received.push({ path: req.url ?? '', headers: req.headers, body })
        const parsed = JSON.parse(body)
        const answer = (c: { id: unknown; method: string }) => ({ jsonrpc: '2.0', id: c.id, result: `ok:${c.method}` })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(Array.isArray(parsed) ? parsed.map(answer) : answer(parsed)))
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, url: `http://127.0.0.1:${port}${SECRET_PATH}`, received })
    })
  })
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`))
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections()
    server.close(() => resolve())
  })
}

function post(base: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(base + '/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('rpc-proxy', () => {
  let upstream: Upstream
  let base: string
  let proxy: ReturnType<typeof createProxyServer>

  async function boot(overrides: Partial<Config> = {}) {
    const config = { ...loadConfig({ UPSTREAM_RPC_URL: upstream.url }), ...overrides }
    proxy = createProxyServer(config)
    base = await listen(proxy.server)
  }

  beforeEach(async () => {
    upstream = await startUpstream()
  })

  afterEach(async () => {
    await close(proxy.server)
    await close(upstream.server)
  })

  it('forwards a call, returns the upstream answer and logs ip, method and params', async () => {
    await boot()
    const call = { jsonrpc: '2.0', id: 7, method: 'eth_call', params: [{ to: '0xabc', data: '0x01' }, 'latest'] }
    const res = await post(base, call)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ jsonrpc: '2.0', id: 7, result: 'ok:eth_call' })

    expect(upstream.received).toHaveLength(1)
    expect(upstream.received[0]!.path).toBe(SECRET_PATH)
    expect(JSON.parse(upstream.received[0]!.body)).toEqual(call)

    const view = (await (await fetch(base + '/log')).json()) as { entries: Record<string, unknown>[]; lastSeq: number }
    expect(view.entries).toHaveLength(1)
    expect(view.entries[0]).toMatchObject({
      seq: 1,
      sourceIp: '127.0.0.1',
      method: 'eth_call',
      params: JSON.stringify(call.params),
    })
    expect(view.lastSeq).toBe(1)
  })

  it('does not forward client headers to the upstream', async () => {
    await boot()
    await post(base, { jsonrpc: '2.0', id: 1, method: 'eth_chainId' }, { authorization: 'Bearer x', cookie: 'a=b' })
    expect(upstream.received[0]!.headers.authorization).toBeUndefined()
    expect(upstream.received[0]!.headers.cookie).toBeUndefined()
  })

  it('logs one entry per call in a batch and returns the batch response', async () => {
    await boot()
    const res = await post(base, [
      { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] },
      { jsonrpc: '2.0', id: 2, method: 'eth_getBalance', params: ['0x1', 'latest'] },
    ])
    expect(await res.json()).toHaveLength(2)
    const view = proxy.log.view()
    expect(view.entries.map((e) => e.method)).toEqual(['eth_blockNumber', 'eth_getBalance'])
  })

  it('logs but does not forward methods outside eth_, net_, web3_', async () => {
    await boot()
    const res = await post(base, { jsonrpc: '2.0', id: 1, method: 'debug_traceTransaction', params: ['0x1'] })
    expect(res.status).toBe(403)
    expect(upstream.received).toHaveLength(0)
    expect(proxy.log.view().entries[0]!.method).toBe('debug_traceTransaction')
  })

  it('rejects unparseable bodies without forwarding', async () => {
    await boot()
    const res = await post(base, '{not json')
    expect(res.status).toBe(400)
    expect(upstream.received).toHaveLength(0)
    expect(proxy.log.view().entries[0]!.method).toBe('(invalid)')
  })

  it('rejects oversized batches and bodies', async () => {
    await boot({ maxBatchSize: 2, maxBodyBytes: 200 })
    const call = { jsonrpc: '2.0', id: 1, method: 'eth_chainId' }
    expect((await post(base, [call, call, call])).status).toBe(400)
    expect((await post(base, { ...call, params: ['x'.repeat(500)] })).status).toBe(413)
    expect(upstream.received).toHaveLength(0)
  })

  it('truncates logged params', async () => {
    await boot({ maxLoggedParamsChars: 20 })
    await post(base, { jsonrpc: '2.0', id: 1, method: 'eth_call', params: ['x'.repeat(100)] })
    const params = proxy.log.view().entries[0]!.params
    expect(params.startsWith('["xxxxxxxxxxxxxxxxxx')).toBe(true)
    expect(params).toContain('[truncated')
    expect(params.length).toBeLessThan(80)
  })

  it('returns 502 without leaking the upstream URL when the upstream is down', async () => {
    await boot()
    await close(upstream.server)
    const res = await post(base, { jsonrpc: '2.0', id: 1, method: 'eth_chainId' })
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).not.toContain('SECRET')
    expect(text).not.toContain('127.0.0.1')
    expect(proxy.log.view().entries).toHaveLength(1)
    upstream = await startUpstream()
  })

  it('never exposes the upstream URL in any response or log entry', async () => {
    await boot()
    await post(base, { jsonrpc: '2.0', id: 1, method: 'eth_chainId' })
    const logText = await (await fetch(base + '/log')).text()
    expect(logText).not.toContain('SECRET')
    expect(JSON.stringify(proxy.log.view())).not.toContain(upstream.url)
  })

  it('serves only the log view, read-only, with CORS for the console', async () => {
    await boot()
    const get = await fetch(base + '/log')
    expect(get.headers.get('access-control-allow-origin')).toBe('*')
    expect((await fetch(base + '/log', { method: 'POST', body: '{}' })).status).toBe(404)
    expect((await fetch(base + '/log', { method: 'DELETE' })).status).toBe(404)
    expect((await fetch(base + '/healthz')).status).toBe(200)
    expect((await fetch(base + '/nope')).status).toBe(404)
  })

  it('returns only newer entries for `since` and honours `limit`', async () => {
    await boot()
    for (let i = 0; i < 3; i++) await post(base, { jsonrpc: '2.0', id: i, method: 'eth_blockNumber' })
    const after1 = (await (await fetch(base + '/log?since=1')).json()) as { entries: { seq: number }[] }
    expect(after1.entries.map((e) => e.seq)).toEqual([2, 3])
    const last = (await (await fetch(base + '/log?limit=1')).json()) as { entries: { seq: number }[] }
    expect(last.entries.map((e) => e.seq)).toEqual([3])
  })

  it('uses X-Forwarded-For only when trusted proxy hops are configured, taking the entry the proxy appended', async () => {
    await boot()
    await post(base, { jsonrpc: '2.0', id: 1, method: 'eth_chainId' }, { 'x-forwarded-for': '9.9.9.9' })
    expect(proxy.log.view().entries[0]!.sourceIp).toBe('127.0.0.1')

    await close(proxy.server)
    await boot({ trustedProxyHops: 1 })
    await post(base, { jsonrpc: '2.0', id: 1, method: 'eth_chainId' }, { 'x-forwarded-for': '6.6.6.6, 203.0.113.5' })
    expect(proxy.log.view().entries[0]!.sourceIp).toBe('203.0.113.5')
  })

  it('rate limits per source IP', async () => {
    await boot({ rateLimitPerMinute: 2 })
    const call = { jsonrpc: '2.0', id: 1, method: 'eth_chainId' }
    expect((await post(base, call)).status).toBe(200)
    expect((await post(base, call)).status).toBe(200)
    expect((await post(base, call)).status).toBe(429)
    expect(proxy.log.view().entries).toHaveLength(2)
  })
})

describe('MemoryLog', () => {
  it('evicts the oldest entries beyond capacity and reports drops', () => {
    const log = new MemoryLog(2)
    for (const m of ['a', 'b', 'c']) log.add({ time: 't', sourceIp: 'ip', method: m, params: '' })
    const view = log.view()
    expect(view.entries.map((e) => e.method)).toEqual(['b', 'c'])
    expect(view.dropped).toBe(1)
    expect(view.lastSeq).toBe(3)
  })
})

describe('loadConfig', () => {
  it('requires UPSTREAM_RPC_URL and does not echo an invalid value', () => {
    expect(() => loadConfig({})).toThrow('UPSTREAM_RPC_URL is required')
    expect(() => loadConfig({ UPSTREAM_RPC_URL: 'not a url?key=SECRET' })).toThrow(/not a valid URL$/)
  })
})

describe('source', () => {
  it('has no filesystem or process-spawn imports, so the log cannot reach disk', () => {
    const dir = new URL('../src/', import.meta.url)
    for (const file of readdirSync(dir)) {
      const text = readFileSync(new URL(file, dir), 'utf-8')
      expect(text, file).not.toMatch(/node:fs|from 'fs'|child_process|node:worker_threads/)
    }
  })
})
