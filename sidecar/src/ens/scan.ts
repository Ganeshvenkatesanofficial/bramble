import type { AbiEvent, Log, PublicClient } from 'viem'

// MAX_BLOCK_RANGE bounds every getLogs window this repo issues. Different
// RPC providers cap eth_getLogs ranges differently and don't advertise the
// limit up front — this repo has now hit two of them for real: publicnode's
// pool enforces something in the ~50,000 range (found live, Sept 12 2026,
// while allocating mesh-ip), and Infura's free tier enforces exactly 10,000
// (found live the same day, immediately after switching to it for
// reliability — both listDeviceLabels and resolveRelays' single
// fromBlock-to-latest getLogs call started failing outright with "range N
// exceeds limit of 10000" the moment the tailnet's own registration history
// grew past that). 9,000 stays under both with margin, and under any other
// common free-tier cap (Alchemy, Ankr, etc. also commonly cap at 10,000) —
// chunking is strictly safer than any single-call range, never slower by
// more than a handful of extra round trips at this project's scale.
const MAX_BLOCK_RANGE = 9_000n

// scanLogsChunked pages a getLogs call in MAX_BLOCK_RANGE windows from
// fromBlock to the chain's current head, concatenating every window's
// results. Exists because a single fromBlock-to-'latest' call — the
// natural way to write "give me everything since this contract was
// deployed" — silently assumes the RPC has no range cap, which no free-tier
// provider this project has tried actually holds true once enough blocks
// have passed. Used by both listDeviceLabels (./devices.ts) and
// resolveRelays (./relays.ts), which had the identical bug independently.
//
// Deliberately loosely typed (decoded args as Record<string, unknown>, not
// viem's fully inferred per-event log shape) — the precise generic
// signature getLogs itself uses doesn't thread cleanly through a wrapper,
// and both callers only ever read `log.args.label`, present on every event
// this project scans regardless.
type ScannedLog = Log & { args: Record<string, unknown> }

// RETRY_DELAYS_MS spaces the retries of one failed getLogs window. The
// public Sepolia endpoint is a load-balanced pool: getBlockNumber can reach a
// backend that already has the newest block, and the getLogs that follows can
// reach a backend that does not, which rejects the window with -32602
// "Invalid parameters" (found live on the cloud nodes, 6 Nov 2026: the worker
// and the gateway each hit it on their first scan after start-up). Repeating
// the identical request fails again about as often, because the lag is shared
// across the pool, so a retry asks for "latest" instead of the head number.
// The delays total about 10 s, well inside brambled's 8 minute budget.
const RETRY_DELAYS_MS = [1_500, 3_000, 6_000]

// PRUNED_HISTORY is the error code public nodes use when they no longer serve
// old logs. Retrying cannot fix it, and callers (admincli's mesh-ip
// allocation) need the error at once rather than a partial list.
const PRUNED_HISTORY = 4444

// viem wraps an unrecognised RPC code (4444 among them) in UnknownRpcError
// with code -1 and keeps the node's code on `cause`, so walk the chain.
function isRetryable(err: unknown): boolean {
  for (
    let e = err as { code?: unknown; cause?: unknown } | null | undefined, i = 0;
    e && i < 5;
    e = e.cause as typeof e, i++
  ) {
    if (e.code === PRUNED_HISTORY) return false
  }
  return true
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function scanLogsChunked(
  client: PublicClient,
  params: { address: `0x${string}`; event: AbiEvent; fromBlock: bigint },
  retryDelaysMs: readonly number[] = RETRY_DELAYS_MS
): Promise<ScannedLog[]> {
  const head = await client.getBlockNumber()
  const logs: ScannedLog[] = []
  for (let start = params.fromBlock; start <= head; start += MAX_BLOCK_RANGE) {
    const end = start + MAX_BLOCK_RANGE - 1n > head ? head : start + MAX_BLOCK_RANGE - 1n
    for (let attempt = 0; ; attempt++) {
      try {
        // After a failure, the window that ends at head asks for "latest": each backend then resolves the
        // bound against its own head, so a lagging backend cannot reject it (see RETRY_DELAYS_MS).
        const toBlock = attempt > 0 && end === head ? 'latest' : end
        const chunk = await client.getLogs({
          address: params.address,
          event: params.event,
          fromBlock: start,
          toBlock,
        })
        logs.push(...(chunk as ScannedLog[]))
        break
      } catch (err) {
        if (attempt >= retryDelaysMs.length || !isRetryable(err)) throw err
        await sleep(retryDelaysMs[attempt])
      }
    }
  }
  return logs
}
