import { createApprovalApi } from '../../../lib/api'
import { createPaymentsSource, createStatusSource } from '../../../lib/activity'
import { paymentsHandler } from '../../../lib/payments-handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// One long-lived Node process owns the queue and timers. ETH-30 wires real adapters here.
const api = createApprovalApi({
  token: () => process.env.APPROVAL_DEMO_TOKEN,
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
