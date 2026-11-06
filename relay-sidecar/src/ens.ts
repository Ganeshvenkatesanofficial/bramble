// Read-only tailnet-registry check for sponsored sessions (docs/adr/0018).
// The relay operator reads ENS directly, not through Tor: a relay already
// sees every peer's source IP, so Tor would hide nothing here. The record
// rules match brambled/admission/loop.go's `authorized`: a non-empty pubkey,
// an expiry in the future, and no revoked=true record.
import { createPublicClient, getAddress, http, keccak256, parseAbi, toHex } from 'viem'
import { sepolia } from 'viem/chains'
import { normalize } from 'viem/ens'

// Same hackathon Universal Resolver override as sidecar/src/ens/client.ts;
// viem's built-in Sepolia address targets the wrong deployment.
const UNIVERSAL_RESOLVER = getAddress('0xd26f2040d083af1cd2962ba303f4bea0c4faf142')

const registryAbi = parseAbi([
  'function getState(uint256 anyId) view returns (uint8 status, uint64 expiry, address latestOwner, uint256 tokenId, uint256 resource)',
])

export type EnrollmentCheck = { enrolled: boolean; reason?: string }

export type EnrollmentReader = (label: string) => Promise<EnrollmentCheck>

export function createEnrollmentReader(opts: {
  rpcUrl: string
  tailnetName: string
  registry: string
  fetchFn?: typeof fetch
  nowSeconds?: () => number
}): EnrollmentReader {
  const client = createPublicClient({
    chain: {
      ...sepolia,
      contracts: { ...sepolia.contracts, ensUniversalResolver: { address: UNIVERSAL_RESOLVER } },
    },
    transport: http(opts.rpcUrl, { fetchFn: opts.fetchFn, timeout: 20_000 }),
    ccipRead: false,
  })
  const registry = getAddress(opts.registry)
  const now = opts.nowSeconds ?? (() => Math.floor(Date.now() / 1000))

  return async (label) => {
    const name = normalize(`${label}.${opts.tailnetName}`)
    const pubkey = await client.getEnsText({ name, key: 'pubkey' })
    if (!pubkey) return { enrolled: false, reason: 'no pubkey record' }
    const revoked = await client.getEnsText({ name, key: 'revoked' })
    if (revoked === 'true') return { enrolled: false, reason: 'revoked' }
    const [, expiry] = await client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: 'getState',
      args: [BigInt(keccak256(toHex(label)))],
    })
    if (Number(expiry) <= now()) return { enrolled: false, reason: 'expired' }
    return { enrolled: true }
  }
}
