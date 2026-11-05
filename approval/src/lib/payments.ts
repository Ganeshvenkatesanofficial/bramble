// Read-only mirror adapter, based on dashboard/src/app/api/hedera/payments/route.ts.
// Never import the sidecar signer or its configuration into this package.
const MIRROR_URL = 'https://testnet.mirrornode.hedera.com'
const USDC = '0.0.429274'
const accountPattern = /^0\.0\.\d+$/
const timestampPattern = /^\d{1,12}\.\d{1,9}$/
const positiveAtomic = /^[1-9]\d{0,29}$/
const timestamp = (value: string) =>
  BigInt(value.split('.')[0]) * BigInt(1_000_000_000) + BigInt(value.split('.')[1].padEnd(9, '0'))

interface AgentConfig {
  agentLabel: string
  payerAccountId: string
  budgetAtomic: string
  since: string
}
interface MirrorTransaction {
  transaction_id: string
  consensus_timestamp: string
  result: string
  token_transfers: { token_id: string; account: string; amount: number }[]
}
export interface Payment {
  transactionId: string
  consensusTimestamp: string
  amountAtomic: string
  hashscanUrl: string
}
export interface AgentPayments extends AgentConfig {
  perPaymentCapAtomic: string
  spentAtomic: string
  remainingAtomic: string
  payments: Payment[]
}
export interface PaymentsFeed {
  agents: AgentPayments[]
  observedAt: string
}

function parseConfig(raw: string | undefined): AgentConfig[] {
  if (!raw) throw new Error('configuration')
  const configs: AgentConfig[] = JSON.parse(raw)
  if (!Array.isArray(configs) || !configs.length || configs.length > 10) throw new Error('configuration')
  const payers = new Set<string>()
  const labels = new Set<string>()
  for (const item of configs) {
    if (
      !item ||
      typeof item.agentLabel !== 'string' ||
      !/^[a-z0-9][a-z0-9-]{0,62}$/.test(item.agentLabel) ||
      typeof item.payerAccountId !== 'string' ||
      !accountPattern.test(item.payerAccountId) ||
      typeof item.budgetAtomic !== 'string' ||
      !positiveAtomic.test(item.budgetAtomic) ||
      typeof item.since !== 'string' ||
      !timestampPattern.test(item.since) ||
      payers.has(item.payerAccountId) ||
      labels.has(item.agentLabel)
    )
      throw new Error('configuration')
    payers.add(item.payerAccountId)
    labels.add(item.agentLabel)
  }
  return configs
}

export function createPaymentsApi(options: {
  config: () => string | undefined
  perPaymentCap: () => string | undefined
  mirrorUrl?: string
}) {
  const mirror = new URL(options.mirrorUrl ?? MIRROR_URL)
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
  return async (): Promise<Response> => {
    let configs: AgentConfig[]
    let perPaymentCapAtomic: string
    try {
      configs = parseConfig(options.config())
      perPaymentCapAtomic = options.perPaymentCap() ?? '100000'
      if (!positiveAtomic.test(perPaymentCapAtomic)) throw new Error('configuration')
    } catch {
      return json(
        { error: 'Configure APPROVAL_PAYMENT_AGENTS and HEDERA_MAX_PAYMENT_ATOMIC on the approval server.' },
        503
      )
    }
    const observedAt = new Date().toISOString()
    const until = `${Math.floor(Date.now() / 1000)}.999999999`
    try {
      const agents = await Promise.all(
        configs.map(async (config) => {
          if (timestamp(config.since) > timestamp(until)) throw new Error('future window')
          let next: URL | null = new URL('/api/v1/transactions', mirror)
          next.searchParams.set('account.id', config.payerAccountId)
          next.searchParams.set('order', 'asc')
          next.searchParams.set('limit', '100')
          next.searchParams.append('timestamp', `gte:${config.since}`)
          next.searchParams.append('timestamp', `lte:${until}`)
          const seenPages = new Set<string>()
          const transactions = new Map<string, MirrorTransaction>()
          // One deadline for all pages. Partial totals must never look complete.
          const signal = AbortSignal.timeout(8_000)
          while (next) {
            if (
              next.origin !== mirror.origin ||
              next.pathname !== '/api/v1/transactions' ||
              seenPages.has(next.href) ||
              seenPages.size >= 100
            )
              throw new Error('invalid pagination')
            seenPages.add(next.href)
            const response = await fetch(next, { cache: 'no-store', signal, redirect: 'error' })
            if (!response.ok) throw new Error('mirror unavailable')
            const body = (await response.json()) as {
              transactions: MirrorTransaction[]
              links: { next: string | null }
            }
            if (
              !Array.isArray(body.transactions) ||
              !body.links ||
              !(body.links.next === null || typeof body.links.next === 'string')
            )
              throw new Error('invalid feed')
            for (const tx of body.transactions) {
              if (
                !/^0\.0\.\d+-\d+-\d{1,9}$/.test(tx.transaction_id) ||
                !timestampPattern.test(tx.consensus_timestamp) ||
                !Array.isArray(tx.token_transfers)
              )
                throw new Error('invalid transaction')
              if (
                timestamp(tx.consensus_timestamp) >= timestamp(config.since) &&
                timestamp(tx.consensus_timestamp) <= timestamp(until)
              )
                transactions.set(tx.transaction_id, tx)
            }
            next = body.links.next ? new URL(body.links.next, mirror) : null
          }
          let spent = BigInt(0)
          const payments: Payment[] = []
          for (const tx of transactions.values()) {
            if (tx.result !== 'SUCCESS') continue
            let amount = BigInt(0)
            for (const transfer of tx.token_transfers) {
              if (transfer.token_id !== USDC || transfer.account !== config.payerAccountId) continue
              if (!Number.isSafeInteger(transfer.amount)) throw new Error('unsafe amount')
              amount -= BigInt(transfer.amount)
            }
            if (amount <= BigInt(0)) continue
            spent += amount
            const [account, seconds, nanos] = tx.transaction_id.split('-')
            payments.push({
              transactionId: tx.transaction_id,
              consensusTimestamp: tx.consensus_timestamp,
              amountAtomic: amount.toString(),
              hashscanUrl: `https://hashscan.io/testnet/transaction/${account}@${seconds}.${nanos}`,
            })
          }
          payments.sort((a, b) => (timestamp(a.consensusTimestamp) > timestamp(b.consensusTimestamp) ? -1 : 1))
          const remaining = BigInt(config.budgetAtomic) - spent
          return {
            agentLabel: config.agentLabel,
            payerAccountId: config.payerAccountId,
            budgetAtomic: config.budgetAtomic,
            since: config.since,
            perPaymentCapAtomic,
            spentAtomic: spent.toString(),
            remainingAtomic: (remaining > BigInt(0) ? remaining : BigInt(0)).toString(),
            payments,
          }
        })
      )
      return json({ agents, observedAt } satisfies PaymentsFeed)
    } catch {
      return json(
        { error: 'Mirror feed unavailable or incomplete. Spend and remaining are unknown; retry shortly.' },
        502
      )
    }
  }
}
