// Read-only tailnet-registry check for sponsored sessions (docs/adr/0018).
// The relay operator reads ENS directly, not through Tor: a relay already
// sees every peer's source IP, so Tor would hide nothing here. The record
// rules match brambled/admission/loop.go's `authorized`: a non-empty pubkey,
// an expiry in the future, and no revoked=true record.
import { createPublicClient, getAddress, http, keccak256, toHex } from 'viem'
import { normalize } from 'viem/ens'
import { ensSepolia, registryAbi } from '../../sidecar/src/ens/config'

// The ENS deployment (and so the Universal Resolver) comes from the shared
// config module, selected by BRAMBLE_ENS_DEPLOYMENT, same as the node sidecar.

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
    chain: ensSepolia,
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
