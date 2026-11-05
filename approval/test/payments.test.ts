import { afterEach, expect, test } from 'bun:test'
import fixture from './fixtures/payments.json'
import { createPaymentsApi } from '../src/lib/payments'

const agent = { agentLabel: 'worker', payerAccountId: '0.0.123', budgetAtomic: '20000', since: '1700000000.000000000' }
const servers: ReturnType<typeof Bun.serve>[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

function apiFor(handler: (request: Request) => Response, config = JSON.stringify([agent])) {
  const server = Bun.serve({ port: 0, fetch: handler })
  servers.push(server)
  return createPaymentsApi({ config: () => config, perPaymentCap: () => '100000', mirrorUrl: server.url.origin })
}

test('mirror feed attributes outgoing USDC, follows pages, deduplicates and reports remaining budget', async () => {
  const api = apiFor((request) => {
    const url = new URL(request.url)
    if (!url.searchParams.has('cursor')) {
      expect(url.searchParams.get('account.id')).toBe('0.0.123')
      expect(url.searchParams.get('order')).toBe('asc')
      expect(url.searchParams.getAll('timestamp')[0]).toBe('gte:1700000000.000000000')
      return Response.json(fixture)
    }
    return Response.json({
      transactions: [
        fixture.transactions[0],
        {
          transaction_id: '0.0.123-1700000005-000000001',
          consensus_timestamp: '1700000005.000000001',
          result: 'SUCCESS',
          token_transfers: [
            { token_id: '0.0.429274', account: '0.0.123', amount: -2500 },
            { token_id: '0.0.429274', account: '0.0.456', amount: 2500 },
          ],
        },
      ],
      links: { next: null },
    })
  })
  const response = await api()
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const body = await response.json()
  expect(body.agents[0]).toMatchObject({
    ...agent,
    spentAtomic: '12500',
    remainingAtomic: '7500',
    perPaymentCapAtomic: '100000',
  })
  expect(body.agents[0].payments).toHaveLength(2)
  expect(body.agents[0].payments[1].hashscanUrl).toBe(
    'https://hashscan.io/testnet/transaction/0.0.123@1700000001.000000001'
  )
})

test('a mirror failure or incomplete pagination cannot report a partial balance', async () => {
  for (const handler of [
    () => new Response('unavailable', { status: 503 }),
    () => Response.json({ ...fixture, links: { next: '/api/v1/transactions' } }),
    () => Response.json({ ...fixture, links: { next: 'https://untrusted.example/api/v1/transactions' } }),
    () => Response.json({ ...fixture, links: {} }),
    () =>
      Response.json({
        transactions: [
          {
            ...fixture.transactions[0],
            token_transfers: [{ token_id: '0.0.429274', account: '0.0.123', amount: -9007199254740992 }],
          },
        ],
        links: { next: null },
      }),
  ]) {
    const response = await apiFor(handler)()
    expect(response.status).toBe(502)
    expect(await response.json()).not.toHaveProperty('agents')
  }
})

test('missing, ambiguous or malformed payer configuration fails closed', async () => {
  for (const config of [
    '',
    '[]',
    '{}',
    'invalid',
    JSON.stringify([agent, agent]),
    JSON.stringify([{ ...agent, budgetAtomic: '-1' }]),
    JSON.stringify([{ ...agent, payerAccountId: 'not-an-account' }]),
  ]) {
    const response = await apiFor(() => {
      throw new Error('must not fetch')
    }, config)()
    expect(response.status).toBe(503)
  }
})

test('the reporting window excludes old payments and budget overrun floors remaining at zero', async () => {
  const response = await apiFor(() =>
    Response.json({
      transactions: [
        { ...fixture.transactions[0], consensus_timestamp: '1699999999.999999999' },
        {
          ...fixture.transactions[0],
          transaction_id: '0.0.123-1700000006-000000001',
          consensus_timestamp: '1700000006.000000001',
          token_transfers: [
            { token_id: '0.0.429274', account: '0.0.123', amount: -25000 },
            { token_id: '0.0.429274', account: '0.0.456', amount: 10000 },
            { token_id: '0.0.429274', account: '0.0.789', amount: 15000 },
          ],
        },
      ],
      links: { next: null },
    })
  )()
  const body = await response.json()
  expect(body.agents[0]).toMatchObject({ spentAtomic: '25000', remainingAtomic: '0' })
  expect(body.agents[0].payments).toHaveLength(1)
})

test('a later refresh sees a new settlement without restarting the service', async () => {
  let settled = false
  const api = apiFor(() =>
    Response.json({ transactions: settled ? [fixture.transactions[0]] : [], links: { next: null } })
  )
  expect((await (await api()).json()).agents[0].spentAtomic).toBe('0')
  settled = true
  expect((await (await api()).json()).agents[0].spentAtomic).toBe('10000')
})
