// Device enumeration for the tailnet's own subregistry — the read half of
// docs/adr/0009's mesh-ip allocation scheme. Same LabelRegistered-log-scan
// pattern already proven for relay discovery (./relays.ts): PermissionedRegistry
// has no enumeration view function (no totalSupply/tokenByIndex), but it
// emits LabelRegistered(tokenId, labelHash, label, owner, expiry, sender)
// with the plaintext label on every registration.
//
// This lives in the sidecar's read-only surface (see config.ts's registryAbi
// comment: "resolution, not enrollment/revocation") — the only consumer of
// listDeviceLabels today is admincli's enroll.ts, deciding which mesh-ip
// addresses are already taken before writing a new one.
import { parseAbiItem, type PublicClient } from 'viem'
import { scanLogsChunked } from './scan'
import { tailnetRegistry, tailnetRegistryDeployBlock } from './config'

const labelRegisteredEvent = parseAbiItem(
  'event LabelRegistered(uint256 indexed tokenId, bytes32 indexed labelHash, string label, address owner, uint64 expiry, address indexed sender)'
)

// listDeviceLabels returns every label ever registered on the tailnet's
// device subregistry, deduplicated (a label can be re-registered after its
// prior registration expires — see resolveRelays()'s identical dedup for
// why a duplicate log entry doesn't mean a duplicate device). Chunked via
// scanLogsChunked, not a single fromBlock-to-latest call — found live,
// Sept 12 2026, the moment the registry's history grew past 10,000 blocks
// and Infura started rejecting the single-call form outright.
//
// client is required, with no default. The sidecar route passes its Tor-only
// client; admincli's enroll.ts passes the administrator's direct client,
// because the CLI never starts Tor. A default here would pull the sidecar's
// client into the CLI and break enrollment with "starting Tor". Tests inject
// a fixture-backed client (sidecar/test/devices.test.ts), because public
// Sepolia nodes prune old logs (RPC error 4444). An RPC error
// propagates rather than returning a partial list: enroll.ts allocates a
// mesh-ip from this list, so a missing label could hand out an address that
// is already taken.
export async function listDeviceLabels(client: PublicClient): Promise<string[]> {
  const logs = await scanLogsChunked(client, {
    address: tailnetRegistry(),
    event: labelRegisteredEvent,
    fromBlock: tailnetRegistryDeployBlock(),
  })
  return [...new Set(labelsOf(logs))]
}

function labelsOf(logs: { args: Record<string, unknown> }[]): string[] {
  return logs.map((log) => log.args.label).filter((label): label is string => typeof label === 'string' && !!label)
}

// RESCAN_MARGIN is how many blocks behind the last scanned head each
// incremental scan starts. It covers reorgs and, mainly, an RPC pool whose
// getLogs backend lags the backend that answered getBlockNumber
// (docs/adr/0010 saw a 17,000-block spread on publicnode): a registration
// such a backend missed is picked up on a later poll. 8,000 blocks plus a
// poll's new blocks still fits in one 9,000-block getLogs window, so the
// margin costs no extra calls.
const RESCAN_MARGIN = 8_000n

// incrementalDeviceLabels returns a lister for the sidecar's /devices route.
// brambled serve polls that route every 15 s to pick up devices enrolled
// after it started (docs/adr/0010, "Rediscovery"). A full scan from the
// deploy block is dozens of getLogs calls over Tor, so the lister keeps the
// labels it has seen and scans only from RESCAN_MARGIN blocks behind the
// last head it reached: one getLogs call per poll. The first call is a full scan. Labels are only ever added: a
// revoked or expired device is still listed, and admission.Loop refuses it.
// A failed scan rejects and leaves the scanned range unchanged, so the next
// call retries the same blocks. Concurrent calls share one scan.
// admincli's enroll.ts keeps using listDeviceLabels: it runs once and needs
// no cache.
export function incrementalDeviceLabels(
  client: PublicClient,
  retryDelaysMs?: readonly number[]
): () => Promise<string[]> {
  const seen = new Set<string>()
  let scannedThrough: bigint | undefined
  let pending: Promise<string[]> | undefined

  async function scan(): Promise<string[]> {
    const deployBlock = tailnetRegistryDeployBlock()
    // cacheTime 0: viem otherwise reuses a head up to 4 s old.
    const head = await client.getBlockNumber({ cacheTime: 0 })
    let fromBlock = deployBlock
    if (scannedThrough !== undefined && scannedThrough - RESCAN_MARGIN > deployBlock) {
      fromBlock = scannedThrough - RESCAN_MARGIN
    }
    if (fromBlock <= head) {
      const logs = await scanLogsChunked(
        client,
        {
          address: tailnetRegistry(),
          event: labelRegisteredEvent,
          fromBlock,
          toBlock: head,
        },
        retryDelaysMs
      )
      for (const label of labelsOf(logs)) seen.add(label)
    }
    // An RPC pool can answer from a node a block or two behind; never move
    // the scanned range backwards.
    if (scannedThrough === undefined || head > scannedThrough) scannedThrough = head
    return [...seen]
  }

  return () => {
    pending ??= scan().finally(() => {
      pending = undefined
    })
    return pending
  }
}
