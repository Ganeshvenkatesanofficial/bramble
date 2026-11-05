import type { AuditTrail } from './audit'

type Env = Record<string, string | undefined>

/**
 * The HCS trail for the running process, or undefined when `HEDERA_AUDIT_TOPIC_ID` or the payer
 * secrets are absent. The Hedera client loads on the first post, so a process without them never
 * imports the SDK. Secret values stay inside the client and are never logged.
 */
export function auditTrailFromEnv(env: Env): AuditTrail | undefined {
  const topicId = env.HEDERA_AUDIT_TOPIC_ID
  const accountId = env.HEDERA_CLIENT_ACCOUNT_ID
  const privateKey = env.HEDERA_CLIENT_PRIVATE_KEY
  if (!topicId || !accountId || !privateKey) return undefined
  const network = env.HEDERA_AUDIT_NETWORK === 'previewnet' ? 'previewnet' : 'testnet'
  let trail: Promise<AuditTrail> | undefined
  return {
    async record(event) {
      trail ??= Promise.all([import('@bramble/hedera-audit'), import('@bramble/hedera-audit/hiero')]).then(
        ([audit, hiero]) =>
          new audit.HcsAuditTrail({
            client: hiero.createHieroTopicClient({ accountId, privateKey, network }),
            topicId,
          })
      )
      return (await trail).record(event)
    },
  }
}
