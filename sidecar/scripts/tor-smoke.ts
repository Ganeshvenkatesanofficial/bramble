// Real-network smoke test for sidecar/src/tor: bootstraps the production
// tor-js client (wasm-file entry, MemoryStorage) under Bun, then sends one
// request per TorKey to the Tor Project's check service and prints the timings.
//
// Run from sidecar/:  bun run scripts/tor-smoke.ts
// Needs outbound TCP to Tor relays. Takes about a minute. Exits 1 on failure.
//
// Prints Tor exit addresses only: the check service reports the address the
// request arrived from, which is the exit relay, never this host.
import { getTorStatus, startTor, stopTor, torFetch, type TorKey } from '../src/tor'

const CHECK_URL = 'https://check.torproject.org/api/ip'
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

async function main(): Promise<void> {
  console.log(`bun ${Bun.version}, tor-js 0.4.4 (wasm-file, MemoryStorage, no snapshot)`)
  const t0 = performance.now()
  await startTor({ retryDelayMs: 0 })
  console.log(`ready after ${seconds(performance.now() - t0)}`, getTorStatus())

  let ok = true
  for (const key of ['ens', 'pay'] as TorKey[]) {
    const t = performance.now()
    const res = await torFetch(key)(CHECK_URL)
    const body = (await res.json()) as { IsTor?: boolean; IP?: string }
    console.log(`${key}: HTTP ${res.status} in ${seconds(performance.now() - t)}, IsTor=${body.IsTor}, exit ${body.IP}`)
    ok &&= res.ok && body.IsTor === true
  }
  stopTor()
  if (!ok) throw new Error('a request did not arrive through Tor')
  console.log('PASS')
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error('FAIL:', err instanceof Error ? err.message : err, getTorStatus())
    process.exit(1)
  }
)
