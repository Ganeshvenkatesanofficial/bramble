import { createApprovalApi } from '../../../lib/api'
import { realAdaptersFromEnv } from '../../../lib/chain-env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function adapters() {
  try {
    return realAdaptersFromEnv()
  } catch (error) {
    // Messages from realAdaptersFromEnv name a variable, never a value.
    console.error(`approval: real signer disabled: ${error instanceof Error ? error.message : 'invalid configuration'}`)
    return undefined
  }
}

// One long-lived Node process owns the queue and timers; the real signer runs only on the admin machine.
const chain = adapters()
const api = createApprovalApi({
  token: () => process.env.APPROVAL_DEMO_TOKEN,
  signer: chain?.signer,
  resolver: chain?.resolver,
})

export const GET = (request: Request) => api.handle(request)
export const POST = (request: Request) => api.handle(request)
