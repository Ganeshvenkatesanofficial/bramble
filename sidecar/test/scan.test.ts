// scanLogsChunked retries a window the RPC pool rejects transiently. The
// suite is hermetic: it uses the fixture RPC and zero retry delays.
import { describe, expect, it } from 'vitest'
import { parseAbiItem } from 'viem'
import { scanLogsChunked } from '../src/ens/scan'
import { fixtureClient, labelRegisteredLog } from './fixtures/registry-logs'

const registry = '0x3276eA61D05001586d6eE450F982312B345746a6' as const
const FROM = 1_000n
const HEAD = FROM + 1_157n // one window, as the relay registry scan on the cloud nodes
const event = parseAbiItem(
  'event LabelRegistered(uint256 indexed tokenId, bytes32 indexed labelHash, string label, address owner, uint64 expiry, address indexed sender)'
)
const logs = [labelRegisteredLog(registry, 'relay1', FROM + 5n)]
const invalidParams = { code: -32602, message: 'Invalid parameters were provided to the RPC method.' }

describe('scanLogsChunked retry', () => {
  it('retries a window rejected with invalid params and returns its logs', async () => {
    const { client, calls } = fixtureClient({ head: HEAD, logs, failWith: invalidParams, failTimes: 2 })

    const out = await scanLogsChunked(client, { address: registry, event, fromBlock: FROM }, [0, 0, 0])

    expect(out.map((l) => l.args.label)).toEqual(['relay1'])
    expect(calls).toHaveLength(3) // two rejections, then the answer
  })

  it('gives up after the last retry and reports the RPC error', async () => {
    const { client, calls } = fixtureClient({ head: HEAD, logs, failWith: invalidParams })

    await expect(scanLogsChunked(client, { address: registry, event, fromBlock: FROM }, [0, 0])).rejects.toThrow(
      /Invalid parameters/
    )
    expect(calls).toHaveLength(3) // first try plus two retries
  })

  it('does not retry pruned history (4444)', async () => {
    // viem's own transport retries unknown RPC errors a few times, so compare
    // against a scan with no retry delays instead of asserting a fixed count.
    const pruned = { code: 4444, message: 'pruned history unavailable' }
    const baseline = fixtureClient({ head: HEAD, logs, failWith: pruned })
    await expect(scanLogsChunked(baseline.client, { address: registry, event, fromBlock: FROM }, [])).rejects.toThrow()

    const { client, calls } = fixtureClient({ head: HEAD, logs, failWith: pruned })
    await expect(scanLogsChunked(client, { address: registry, event, fromBlock: FROM }, [0, 0, 0])).rejects.toThrow(
      /pruned history unavailable/
    )
    expect(calls).toHaveLength(baseline.calls.length)
  })
})
