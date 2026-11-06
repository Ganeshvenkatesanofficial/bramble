import { createPublicClient, http, keccak256, toHex } from 'viem'
import { sepolia } from 'viem/chains'
import { normalize } from 'viem/ens'
import { RPC_URL, UNIVERSAL_RESOLVER, registryAbi, tailnetName, tailnetRegistry } from '../../../sidecar/src/ens/config'
import type { DeviceFacts } from './chain'

// The approval service runs on the admin machine, not on a mesh node, so it reads ENS directly. It must not
// import sidecar/src/ens/client.ts: that client routes every read through Tor, which is never started here.
// viem's built-in Sepolia Universal Resolver is the production deployment, so the hackathon one is set explicitly.
export const publicClient = createPublicClient({
  chain: {
    ...sepolia,
    contracts: { ...sepolia.contracts, ensUniversalResolver: { address: UNIVERSAL_RESOLVER } },
  },
  transport: http(RPC_URL, { timeout: 60_000 }),
  ccipRead: false,
})

export async function readDevice(label: string): Promise<DeviceFacts> {
  const name = normalize(`${label}.${tailnetName()}`)
  const pubkey = await publicClient.getEnsText({ name, key: 'pubkey' })
  const revoked = await publicClient.getEnsText({ name, key: 'revoked' })
  const [, expiry] = await publicClient.readContract({
    address: tailnetRegistry(),
    abi: registryAbi,
    functionName: 'getState',
    args: [BigInt(keccak256(toHex(label)))],
  })
  return { pubkey, revoked: revoked === 'true', expiry: expiry.toString() }
}
