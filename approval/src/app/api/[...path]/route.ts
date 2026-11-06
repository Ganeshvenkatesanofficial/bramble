import { createApprovalApi } from '../../../lib/api'
import { createPaymentsSource, createStatusSource } from '../../../lib/activity'
import { paymentsHandler } from '../../../lib/payments-handler'
import { auditTrailFromEnv } from '../../../lib/audit-runtime'
import { ConfigError, realAdaptersFromEnv, realJoinChainFromEnv } from '../../../lib/chain-env'
import { createSettlementSource } from '../../../lib/payments'
import { createNetworkSource } from '../../../lib/network'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function adapters() {
  try {
    return realAdaptersFromEnv()
  } catch (error) {
    // Only ConfigError messages are safe to log: they name a variable, never a value.
    console.error(
      `approval: real signer disabled: ${error instanceof ConfigError ? error.message : 'invalid configuration'}`
    )
    return undefined
  }
}

// One long-lived Node process owns the queue and timers; the real signer runs only on the admin machine.
const chain = adapters()
function joinAdapter() {
  try {
    return realJoinChainFromEnv()
  } catch (error) {
    console.error(
      `approval: enrollment signer disabled: ${error instanceof ConfigError ? error.message : 'invalid configuration'}`
    )
    return undefined
  }
}
const api = createApprovalApi({
  network: createNetworkSource({ baseUrl: () => process.env.BRAMBLED_STATUS_URL }),
  joinChain: joinAdapter(),
  token: () => process.env.APPROVAL_DEMO_TOKEN,
  signer: chain?.signer,
  resolver: chain?.resolver,
  auditTrail: auditTrailFromEnv(process.env),
  ensParent: process.env.APPROVAL_ENS_PARENT,
  // Payments settle in the sidecar, which never calls this service. The mirror node is the observer.
  settlements: process.env.APPROVAL_PAYMENT_AGENTS
    ? createSettlementSource({ config: () => process.env.APPROVAL_PAYMENT_AGENTS })
    : undefined,
  activity: {
    status: createStatusSource({ baseUrl: () => process.env.BRAMBLED_STATUS_URL }),
    payments: createPaymentsSource({
      handler: paymentsHandler,
      configured: () => !!process.env.APPROVAL_PAYMENT_AGENTS,
    }),
  },
})

export const GET = (request: Request) => api.handle(request)
export const POST = (request: Request) => api.handle(request)
