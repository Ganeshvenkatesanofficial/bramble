import { createPaymentsApi } from './payments'

// One instance serves both /api/payments and /api/activity so they share the mirror-node cache.
export const paymentsHandler = createPaymentsApi({
  config: () => process.env.APPROVAL_PAYMENT_AGENTS,
  perPaymentCap: () => process.env.HEDERA_MAX_PAYMENT_ATOMIC,
})
