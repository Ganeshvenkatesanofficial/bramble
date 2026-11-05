import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createApprovalApi } from '../src/lib/api'

const token = randomUUID()
const input = { agentLabel: 'agent-1', gatewayLabel: 'gateway-1', service: 'web' }

function request(path = '/requests', method = 'GET', body?: unknown, authorized = true) {
  return new Request(`http://localhost/api${path}`, {
    method,
    headers: {
      ...(authorized ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

test('an authenticated suggestion is pending and visible through both GET APIs within two seconds', async () => {
  const api = createApprovalApi({ token: () => token })
  const start = performance.now()
  const response = await api.handle(request('/requests', 'POST', input))
  expect(response.status).toBe(201)
  const created = await response.json()
  expect(created.status).toBe('pending')
  const detail = await api.handle(request(`/requests/${created.id}`))
  expect((await detail.json()).id).toBe(created.id)
  const list = await api.handle(request())
  expect((await list.json()).requests.map((item: { id: string }) => item.id)).toContain(created.id)
  expect(performance.now() - start).toBeLessThan(2000)
})

import { MemoryChain } from './memory-chain'

test('approve, deny and revoke require a human action; duplicate writes fail clearly without a write', async () => {
  const chain = new MemoryChain()
  const api = createApprovalApi({ token: () => token, signer: chain, resolver: chain })
  const created = await (await api.handle(request('/requests', 'POST', input))).json()
  expect(chain.writes).toEqual([])
  const approved = await api.handle(request(`/requests/${created.id}/approve`, 'POST'))
  expect(approved.status).toBe(200)
  expect((await approved.json()).status).toBe('approved')
  const duplicate = await api.handle(request(`/requests/${created.id}/approve`, 'POST'))
  expect(duplicate.status).toBe(409)
  expect((await duplicate.json()).error.code).toBe('request_not_pending')
  expect(chain.writes).toEqual(['grant:agent-1'])
  const revoked = await api.handle(request('/grants/agent-1/revoke', 'POST'))
  expect((await revoked.json()).status).toBe('revoked')
  const again = await api.handle(request('/grants/agent-1/revoke', 'POST'))
  expect(again.status).toBe(409)
  expect((await again.json()).error.code).toBe('not_granted')
  expect(chain.writes).toEqual(['grant:agent-1', 'revoke:agent-1'])
  const second = await (await api.handle(request('/requests', 'POST', input))).json()
  const denied = await api.handle(request(`/requests/${second.id}/deny`, 'POST'))
  expect((await denied.json()).status).toBe('denied')
  expect((await api.handle(request(`/requests/${second.id}/approve`, 'POST'))).status).toBe(409)
  expect(chain.writes).toHaveLength(2)
})
