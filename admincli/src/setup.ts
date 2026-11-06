import './env'
// Shared bootstrap for every admincli command: .env loading, the
// ENSv2 Sepolia chain override, and a public client. Mirrors the
// boilerplate already duplicated across scripts/gate0.3-eac-check and
// scripts/provision-dev-tailnet — kept here once since every file in this
// package needs exactly the same setup, unlike those cross-package scripts.
import { createPublicClient, http, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ensSepolia, RPC_URL } from '../../sidecar/src/ens/config'

// ensSepolia carries the Universal Resolver of the deployment that
// BRAMBLE_ENS_DEPLOYMENT selects (sidecar/src/ens/config.ts).
export { ensSepolia }

export const publicClient = createPublicClient({ chain: ensSepolia, transport: http(RPC_URL) })

// accountFromEnv resolves a private key from the named env var into a viem
// Account. Defaults to SEPOLIA_PRIVATE_KEY (the operator's own key, same var
// scripts/provision-dev-tailnet and scripts/gate0.3-eac-check use); Gate
// 2.1's test passes distinct env vars for its enroller/rotator/revoker/
// no-role test accounts.
export function accountFromEnv(envVar = 'SEPOLIA_PRIVATE_KEY') {
  const raw = process.env[envVar]
  if (!raw) throw new Error(`${envVar} not found in .env`)
  const privateKey = (raw.trim().startsWith('0x') ? raw.trim() : `0x${raw.trim()}`) as `0x${string}`
  return privateKeyToAccount(privateKey)
}

export type { Address }
