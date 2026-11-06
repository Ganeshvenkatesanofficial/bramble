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
      const result = await setDeviceRevoked(config, { deviceLabel: label, value: true })
      return { transactionHash: result.txHash }
    },
    members: config.members,
  }
}
