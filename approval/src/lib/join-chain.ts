import { enrollDevice, setDeviceRevoked, type EnrollDeps, type LibDeps } from '../../../admincli/src/lib'
import type { JoinChain, MemberFacts } from './contracts'

/** Uses the same admincli operations for HTTP enrollment and the enrollment CLI. */
export function createJoinChain(
  config: EnrollDeps & Pick<LibDeps, 'signer'> & { members(): Promise<MemberFacts[]> }
): JoinChain {
  return {
    labelTaken: (label) => config.chain.isRegistered(label),
    enroll: (input, progress) => enrollDevice(config, { deviceLabel: input.label, pubkey: input.pubkey, progress }),
    async revokeDevice(label) {
      const progress: { txHash?: string } = {}
      try {
        const result = await setDeviceRevoked(config, { deviceLabel: label, value: true, progress })
        return { transactionHash: result.txHash }
      } catch (error) {
        // setText's own confirmed receipt is evidence even when a load-balanced read lags.
        // Never turn a confirmed revoke into a failure that encourages another submission.
        if (progress.txHash) return { transactionHash: progress.txHash }
        throw error
      }
    },
    members: config.members,
  }
}
