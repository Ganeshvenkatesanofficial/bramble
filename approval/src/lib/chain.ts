import {
  clearAcl,
  computeGrantDigests,
  deviceName,
  grantAcl,
  parseAclRecord,
  type LoadGranterKey,
  type PendingTx,
  type Resolver,
  type Signer,
} from '../../../admincli/src/lib'
import type { GrantSigner, IdentityFacts, IdentityResolver, RequestInput } from './contracts'

/** What a device read must report; `resolveDevice` in sidecar/src/ens/client.ts satisfies it. */
export interface DeviceFacts {
  pubkey: string | null
  revoked: boolean
  /** Unix seconds as a decimal string. `'0'` for a label that was never registered. */
  expiry: string
}

export interface ChainConfig {
  resolver: Resolver
  signer: Signer
  readDevice(label: string): Promise<DeviceFacts>
  tailnetName: string
  /** Identity label whose published pubkey matches the granter key. */
  granterLabel: string
  /** Called per grant; the plaintext key is never stored or logged here. */
  loadGranterKey: LoadGranterKey
  /** Confirmation re-reads after an ambiguous write failure. Defaults to 3. */
  reconcileAttempts?: number
  reconcileDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

export interface ChainAdapters {
  signer: GrantSigner
  resolver: IdentityResolver
}

export function createChainAdapters(config: ChainConfig): ChainAdapters {
  const { resolver, tailnetName } = config
  const attempts = config.reconcileAttempts ?? 3
  const delayMs = config.reconcileDelayMs ?? 2000
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  const aclDigests = async (label: string) =>
    parseAclRecord(await resolver.getText(deviceName(label, tailnetName), 'acl'))

  // Records the last submitted hash so a failure after submission can be reconciled.
  function track() {
    let hash: string | undefined
    const signer: Signer = {
      async setText(name, key, value): Promise<PendingTx> {
        const pending = await config.signer.setText(name, key, value)
        hash = pending.hash
        return pending
      },
    }
    return { signer, submittedHash: () => hash }
  }

  // A failed wait or round-trip read can follow a transaction that did land (public RPCs lag).
  // Treat the write as confirmed only if chain state shows the intended result.
  async function landed(check: () => Promise<boolean>) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(delayMs)
      try {
        if (await check()) return true
      } catch {
        // keep trying; the original error is what the caller rethrows
      }
    }
    return false
  }

  return {
    resolver: {
      async resolveIdentity(label): Promise<IdentityFacts | null> {
        const device = await config.readDevice(label)
        const expiry = Number(device.expiry)
        if (!device.pubkey && !(expiry > 0)) return null
        return {
          label,
          pubkeyPublished: Boolean(device.pubkey),
          revoked: device.revoked,
          expiry: Number.isFinite(expiry) ? expiry : 0,
        }
      },
      async hasGrant(agentLabel) {
        return (await aclDigests(agentLabel)).length > 0
      },
    },

    signer: {
      async grant(input: Pick<RequestInput, 'agentLabel' | 'gatewayLabel' | 'service'>) {
        const tracked = track()
        const deps = { resolver, signer: tracked.signer, tailnetName }
        const params = {
          deviceLabel: input.agentLabel,
          gatewayLabel: input.gatewayLabel,
          granterLabel: config.granterLabel,
          serviceNames: [input.service],
          loadGranterKey: config.loadGranterKey,
        }
        try {
          const change = await grantAcl(deps, params)
          if (!change.txHash) throw new Error('grant produced no transaction')
          return { transactionHash: change.txHash }
        } catch (error) {
          const hash = tracked.submittedHash()
          if (
            hash &&
            (await landed(async () => {
              const { digests } = await computeGrantDigests(deps, params)
              const present = new Set(await aclDigests(input.agentLabel))
              return digests.every((digest) => present.has(digest))
            }))
          ) {
            return { transactionHash: hash }
          }
          throw error
        }
      },

      async revoke(agentLabel) {
        const tracked = track()
        const deps = { resolver, signer: tracked.signer, tailnetName }
        try {
          const cleared = await clearAcl(deps, { deviceLabel: agentLabel })
          if (!cleared.txHash) throw new Error('acl was already empty; no transaction to report')
          return { transactionHash: cleared.txHash }
        } catch (error) {
          const hash = tracked.submittedHash()
          if (hash && (await landed(async () => (await aclDigests(agentLabel)).length === 0))) {
            return { transactionHash: hash }
          }
          throw error
        }
      },
    },
  }
}
