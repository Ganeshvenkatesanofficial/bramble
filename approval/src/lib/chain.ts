import {
  clearAcl,
  deviceName,
  grantAcl,
  parseAclRecord,
  type LoadGranterKey,
  type PendingTx,
  type Resolver,
  type Signer,
} from '../../../admincli/src/lib'
import {
  UnresolvedWriteError,
  type GrantSigner,
  type IdentityFacts,
  type IdentityResolver,
  type RequestInput,
  type SettleOutcome,
  type TransactionReceipt,
} from './contracts'

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
  /** Receipt of a submitted transaction; `'pending'` while it is not yet mined. */
  getReceiptStatus(hash: string): Promise<'success' | 'reverted' | 'pending'>
  /** Receipt checks after a failure following submission, before reporting it unresolved. Defaults to 3. */
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

  // Records the last submitted hash so a failure after submission can be settled from its receipt.
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

  // The submitted transaction's own receipt is the only evidence of its outcome. A text-record
  // read can come from an older block, so ACL state never confirms or refutes a write.
  async function settleOnce(hash: string): Promise<SettleOutcome> {
    try {
      const status = await config.getReceiptStatus(hash)
      return status === 'success' ? 'confirmed' : status === 'reverted' ? 'reverted' : 'unresolved'
    } catch {
      return 'unresolved'
    }
  }

  // A definitive revert is a failure. Anything else leaves the submission unresolved: the
  // transaction may still land, so surface it with the hash rather than as a clean failure.
  async function settleAfterFailure(
    operation: 'grant' | 'revoke',
    hash: string,
    original: unknown
  ): Promise<TransactionReceipt> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(delayMs)
      const outcome = await settleOnce(hash)
      if (outcome === 'confirmed') return { transactionHash: hash }
      if (outcome === 'reverted') throw original
    }
    throw new UnresolvedWriteError(operation, hash, () => settleOnce(hash))
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
          if (!hash) throw error
          return settleAfterFailure('grant', hash, error)
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
          if (!hash) throw error
          return settleAfterFailure('revoke', hash, error)
        }
      },
    },
  }
}
