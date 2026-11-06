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

export interface SettledPayment {
  payer: string
  payee: string
  asset: string
  amountAtomic: string
  /** Hedera transaction ID in `account@seconds.nanos` form. */
  txRef: string
}

export interface SettlementRead {
  settled: SettledPayment[]
  /** `txRef`s of payer transactions whose transfer shape is not a single-payee payment. */
  unsupported: string[]
}

/** What the mirror node shows for one transaction of a payer: a payment with one payee, or a shape this module will not assert. */
type Settlement = { payment: SettledPayment } | { unsupported: string }

/**
 * Nets every USDC transfer of the successful records that share one transaction ID. Only a plain
 * transfer is asserted: the payer is the only account that pays, one account receives, and the
 * received amount equals the payer's net debit. Anything else (split payees, other payers, fees
 * taken from the amount) is reported as unsupported, never as a single-payee payment.
 */
function settle(payer: string, txRef: string, records: MirrorTransaction[]): Settlement | null {
  const net = new Map<string, bigint>()
  for (const record of records)
    for (const transfer of record.token_transfers) {
      if (transfer.token_id !== USDC) continue
      if (!Number.isSafeInteger(transfer.amount)) throw new Error('unsafe amount')
      net.set(transfer.account, (net.get(transfer.account) ?? BigInt(0)) + BigInt(transfer.amount))
    }
  const spent = -(net.get(payer) ?? BigInt(0))
  if (spent <= BigInt(0)) return null
  const others = [...net].filter(([account, amount]) => account !== payer && amount !== BigInt(0))
  const received = others.filter(([, amount]) => amount > BigInt(0))
  const supported = received.length === 1 && received.length === others.length && received[0][1] === spent
  if (!supported) return { unsupported: txRef }
  return { payment: { payer, payee: received[0][0], asset: USDC, amountAtomic: spent.toString(), txRef } }
}

async function loadAgents(
  mirror: URL,
  configs: AgentConfig[],
  perPaymentCapAtomic: string,
  until: string
): Promise<{ agents: AgentPayments[]; settlements: SettlementRead }> {
  const settlements: SettlementRead = { settled: [], unsupported: [] }
  const agents = await Promise.all(
    configs.map(async (config) => {
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
            // Page overlap repeats the same consensus record. Retries and
            // child records can share a transaction ID at different times.
            transactions.set(timestamp(tx.consensus_timestamp).toString(), tx)
        }
        next = body.links.next ? new URL(body.links.next, mirror) : null
      }
      let spent = BigInt(0)
      const payments: Payment[] = []
      const byTransaction = new Map<string, MirrorTransaction[]>()
      for (const tx of transactions.values()) {
        if (tx.result !== 'SUCCESS') continue
        byTransaction.set(tx.transaction_id, [...(byTransaction.get(tx.transaction_id) ?? []), tx])
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
      for (const [transactionId, records] of byTransaction) {
        const [account, seconds, nanos] = transactionId.split('-')
        const result = settle(config.payerAccountId, `${account}@${seconds}.${nanos.padStart(9, '0')}`, records)
        if (!result) continue
        if ('payment' in result) settlements.settled.push(result.payment)
        else settlements.unsupported.push(result.unsupported)
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
  return { agents, settlements }
}

/**
 * Settled USDC payments of the configured payers, read from the mirror node. This is the trusted
 * observer of settlements: nothing the payer or relay reports is believed. Throws when the mirror
 * feed or the configuration is unusable, so a caller never mistakes a partial read for a complete one.
 */
export function createSettlementSource(options: {
  config: () => string | undefined
  mirrorUrl?: string
}): () => Promise<SettlementRead> {
  const mirror = new URL(options.mirrorUrl ?? MIRROR_URL)
  return async () => {
    const configs = parseConfig(options.config())
    const until = `${Math.floor(Date.now() / 1000)}.999999999`
    if (configs.some((config) => timestamp(config.since) > timestamp(until))) throw new Error('future window')
    return (await loadAgents(mirror, configs, '0', until)).settlements
  }
}

export function createPaymentsApi(options: {
  config: () => string | undefined
  perPaymentCap: () => string | undefined
  mirrorUrl?: string
}) {
  const mirror = new URL(options.mirrorUrl ?? MIRROR_URL)
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
  async function loadFeed(rawConfig: string | undefined, rawCap: string | undefined): Promise<Response> {
    const observedAt = new Date().toISOString()
    const until = `${Math.floor(Date.now() / 1000)}.999999999`
    let configs: AgentConfig[]
    let perPaymentCapAtomic: string
    try {
      configs = parseConfig(rawConfig)
      perPaymentCapAtomic = rawCap ?? '100000'
      // Match sidecar/src/payments/config.ts, including leading zeroes.
      if (!/^\d+$/.test(perPaymentCapAtomic) || BigInt(perPaymentCapAtomic) <= BigInt(0))
        throw new Error('configuration')
      if (configs.some((config) => timestamp(config.since) > timestamp(until))) throw new Error('future window')
    } catch {
      return json(
        {
          error: {
            code: 'payments_configuration',
            message:
              'Configure APPROVAL_PAYMENT_AGENTS with a window that has started. HEDERA_MAX_PAYMENT_ATOMIC is optional (default 100000) and must be a positive integer.',
          },
        },
        503
      )
    }
    try {
      const { agents } = await loadAgents(mirror, configs, perPaymentCapAtomic, until)
      return json({ agents, observedAt } satisfies PaymentsFeed)
    } catch {
      return json(
        {
          error: {
            code: 'payments_feed_unavailable',
            message: 'Mirror feed unavailable or incomplete. Spend and remaining are unknown; retry shortly.',
          },
        },
        502
      )
    }
  }

  // Coalesce tabs/polls and keep each result (including failures) for one
  // second. One entry bounds memory; a config change immediately invalidates it.
  let cached: { key: string; expiresAt: number; response: Promise<Response> } | undefined
  return async (): Promise<Response> => {
    const config = options.config()
    const cap = options.perPaymentCap()
    const key = JSON.stringify([config, cap])
    if (!cached || cached.key !== key || cached.expiresAt <= Date.now()) {
      const entry = { key, expiresAt: Infinity, response: loadFeed(config, cap) }
      cached = entry
      void entry.response.then(() => {
        entry.expiresAt = Date.now() + 1_000
      })
    }
    return (await cached.response).clone()
  }
}
