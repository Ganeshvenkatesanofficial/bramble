import './env'
// Enrolls a new device subname: deploys a dedicated Permissioned Resolver
// for it (mirrors scripts/gate0.3-eac-check / scripts/provision-dev-tailnet's
// proven pattern — "a subname with its own Permissioned Resolver"), calls
// register() on the tailnet's subregistry, then writes the initial pubkey.
//
// register() requires the caller to hold ROLE_REGISTRAR on the subregistry
// (root-scoped — see docs/adr/0004 and sidecar/src/ens/config.ts's
// ROLE_REGISTRAR comment); the resolver deploy grants ALL_ROLES on the new
// resolver to the deployer (this same caller), so no separate rotate/revoke
// grant is needed just to write the initial pubkey or mesh-ip — an operator
// running this command already deployed the resolver they're writing to.
//
// Also allocates and writes this device's mesh-ip (docs/adr/0009) — the
// operator, not the device, since a self-writable address would let a
// device steal another device's route (the same label-hijack failure mode
// docs/adr/0005's requester-binding fix closed for ACL digests). This
// replaces having to pass -peer label=allowed-ip/prefix by hand for every
// device brambled tracks.
//
// Usage: bun run enroll.ts <device-label> <pubkey> [expiry-years=10]
import { RPC_URL, tailnetName } from '../../sidecar/src/ens/config'
import { accountFromEnv, ensSepolia, publicClient } from './setup'
import { connectLedgerAccount } from './ledger-eth-sign'
import { createViemEnrollChain } from './enroll-chain-viem'
import { enrollDevice } from './lib'
import { viemResolver } from './lib-viem'

async function main() {
  const [deviceLabel, pubkey, expiryYearsArg] = process.argv.slice(2)
  if (!deviceLabel || !pubkey) {
    throw new Error('usage: bun run enroll.ts <device-label> <pubkey> [expiry-years=10]')
  }
  const expiryYears = expiryYearsArg ? Number(expiryYearsArg) : 10

  // LEDGER_SIGN=1 signs all four writes below through a real Ledger,
  // via a from-scratch hw-app-eth signer (docs/adr/0001's Pivot section,
  // "Upgrade" note) -- wallet-cli's own `send` can't sign on Sepolia at
  // all (Gap 4, docs/12_LEDGER_DX_FEEDBACK.md). Defaults to the existing
  // SEPOLIA_PRIVATE_KEY/viem path so this is opt-in, not a behavior change
  // for every other caller (rotate.ts, revoke.ts, set-acl.ts) that still
  // needs software signing.
  const useLedger = process.env.LEDGER_SIGN === '1'
  const ledger = useLedger ? await connectLedgerAccount() : null
  const account = ledger ? ledger.account : accountFromEnv()
  if (useLedger) console.log(`signing as Ledger account ${account.address} -- confirm each transaction on-device`)

  try {
    await enrollDevice(
      {
        resolver: viemResolver,
        chain: createViemEnrollChain({
          account,
          publicClient,
          chain: ensSepolia,
          rpcUrl: RPC_URL,
          log: console.log,
        }),
        tailnetName: tailnetName(),
        log: console.log,
      },
      { deviceLabel, pubkey, expiryYears }
    )
  } finally {
    if (ledger) await ledger.close()
  }
}

main().catch((err) => {
  console.error('\nenroll failed:', err)
  process.exit(1)
})
