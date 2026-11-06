// Measures how long a revocation takes to reach the admission loop when the
// sidecar reads ENS over Tor, without a signing key.
//
// Method (trace replay). Run the same polling loop brambled runs: one
// resolveDevice() pass per peer, a ticker of period --ttl that buffers one tick
// (Go time.Ticker), the next pass starting when the previous one returns. Every
// RPC request inside each pass is timestamped. Then replay the trace: for each
// synthetic revocation instant t0, the revocation is seen by the first pass
// whose read of the changed record starts after t0, and the latency is that
// pass's end minus t0. The revoking transaction itself is not sent, so chain
// confirmation and RPC node lag are not included.
//
// Run from sidecar/:
//   BRAMBLE_TAILNET_NAME=... BRAMBLE_TAILNET_REGISTRY=0x... \
//     bun run scripts/revocation-poll.ts --mode tor --ttl 5 --duration 600 --out trace.json
// --mode direct sends the same reads without Tor, as the same-day baseline.
import { writeFileSync } from 'node:fs'
import { createEnsClient, resolveDevice } from '../src/ens/client'
import { startTor, stopTor, torFetch } from '../src/tor'

interface Call {
  method: string
  s: number
  e: number
  status: number | string
}
interface Pass {
  start: number
  end: number
  ok: boolean
  error?: string
  calls: Call[]
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback
}

const mode = arg('mode', 'tor')
const ttlMs = Number(arg('ttl', '5')) * 1000
const durationMs = Number(arg('duration', '600')) * 1000
const label = arg('label', 'laptop-demo')
const outPath = arg('out', '')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const now = () => performance.now()

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]!
}

function stats(values: number[]): string {
  const s = [...values].sort((a, b) => a - b)
  const f = (ms: number) => (ms / 1000).toFixed(2)
  return `n=${s.length} min ${f(s[0]!)} median ${f(percentile(s, 50))} p95 ${f(percentile(s, 95))} worst ${f(s[s.length - 1]!)} s`
}

async function main(): Promise<void> {
  console.log(
    `bun ${Bun.version}, mode ${mode}, ttl ${ttlMs / 1000} s, duration ${durationMs / 1000} s, label ${label}`
  )
  console.log(`date ${new Date().toISOString()}`)

  let baseFetch: typeof fetch
  if (mode === 'tor') {
    const t0 = now()
    await startTor({ retryDelayMs: 0 })
    console.log(`tor ready after ${((now() - t0) / 1000).toFixed(1)} s`)
    baseFetch = torFetch('ens')
  } else {
    baseFetch = fetch
  }

  let current: Call[] = []
  let origin = 0
  const timed = (async (input: string | URL | Request, init?: RequestInit) => {
    let method = 'unknown'
    try {
      if (typeof init?.body === 'string') method = (JSON.parse(init.body) as { method?: string }).method ?? method
    } catch {
      // Batched or non-JSON body: keep 'unknown'.
    }
    const call: Call = { method, s: now() - origin, e: 0, status: 'pending' }
    current.push(call)
    try {
      const res = await baseFetch(input, init)
      call.status = res.status
      return res
    } catch (err) {
      call.status = err instanceof Error ? err.message.slice(0, 60) : 'error'
      throw err
    } finally {
      call.e = now() - origin
    }
  }) as typeof fetch
  const client = createEnsClient(timed)

  origin = now()
  const passes: Pass[] = []
  let nextTick = ttlMs
  while (now() - origin < durationMs) {
    current = []
    const start = now()
    let ok = true
    let error: string | undefined
    try {
      await resolveDevice(label, client)
    } catch (err) {
      ok = false
      error = err instanceof Error ? err.message.slice(0, 120) : String(err)
    }
    const end = now()
    passes.push({ start: start - origin, end: end - origin, ok, ...(error !== undefined && { error }), calls: current })
    const rel = end - origin
    if (rel >= nextTick) {
      // A tick is already buffered: the next pass starts at once.
      nextTick = (Math.floor(rel / ttlMs) + 1) * ttlMs
    } else {
      await sleep(nextTick - rel)
      nextTick += ttlMs
    }
  }
  if (mode === 'tor') await stopTor()

  if (outPath) writeFileSync(outPath, JSON.stringify({ mode, ttlMs, label, passes }))

  const good = passes.filter((p) => p.ok)
  console.log(`\npasses: ${passes.length}, ok ${good.length}, failed ${passes.length - good.length}`)
  for (const p of passes.filter((x) => !x.ok))
    console.log(`  failed pass at ${(p.start / 1000).toFixed(0)} s: ${p.error}`)
  const perPassCalls = good.map((p) => p.calls.length)
  console.log(`http requests per ok pass: min ${Math.min(...perPassCalls)} max ${Math.max(...perPassCalls)}`)
  console.log(`pass duration:  ${stats(good.map((p) => p.end - p.start))}`)
  console.log(`request duration: ${stats(good.flatMap((p) => p.calls.map((c) => c.e - c.s)))}`)

  // Replay. The first request of a pass reads `pubkey` (cleared on revoke, the
  // 3.7 s baseline's method); the second reads `revoked`. The reads inside a
  // call happen between its start and end, so bound the instant three ways.
  const stepMs = 50
  const lastEnd = good.length > 0 ? good[good.length - 1]!.start : 0
  for (const [name, index] of [
    ['pubkey cleared (request 1)', 0],
    ['revoked=true (request 2)', 1],
  ] as const) {
    for (const bound of ['start', 'mid', 'end'] as const) {
      const lat: number[] = []
      for (let t0 = 0; t0 < lastEnd; t0 += stepMs) {
        const seen = good.find((p) => {
          const c = p.calls[index]
          if (c === undefined) return false
          const at = bound === 'start' ? c.s : bound === 'end' ? c.e : (c.s + c.e) / 2
          return at >= t0
        })
        if (seen !== undefined) lat.push(seen.end - t0)
      }
      console.log(`replay ${name}, read at ${bound}: ${stats(lat)} over ${lat.length} revocation instants`)
    }
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error('FAIL:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
)
