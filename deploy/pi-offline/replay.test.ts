import { expect, test } from 'bun:test'
import { createTools } from '../../agent-mcp/src/tools'
import { startApprovalStub, startForwardStub } from '../../agent-mcp/test/stubs'
import { startOperatorRoute } from './operator-route'

test('offline operator route replays denied/request/approve/success/revoke/denied', async () => {
  const approval = await startApprovalStub('synthetic-agent-request-only')
  const forward = await startForwardStub('deny-403')
  const operatorToken = 'synthetic-operator-only'
  const operator = startOperatorRoute(approval, forward, operatorToken)
  const agentPayloads: unknown[] = []
  const agentHttp: unknown[] = []
  const tools = createTools(
    {
      approvalUrl: approval.url,
      approvalToken: approval.token,
      agentLabel: 'offline-agent',
      gatewayLabel: 'offline-gateway',
      forwardUrl: forward.url,
      pollIntervalMs: 10,
      decisionTimeoutMs: 2000,
      forwardTimeoutMs: 1000,
    },
    {
      fetch: async (url, init) => {
        agentHttp.push({ url, headers: init?.headers, body: init?.body })
        return fetch(url, init)
      },
    }
  )
  const call = async () => {
    const input = { path: '/task' }
    const result = await tools.callPrivateService(input)
    agentPayloads.push({ name: 'call_private_service', input, result })
    return result
  }
  const post = async (path: string, token?: string) => {
    const response = await fetch(`${operator.url}${path}`, {
      method: 'POST',
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1000),
      redirect: 'error',
    })
    return { status: response.status, body: await response.json() }
  }
  try {
    expect([approval.url, forward.url, operator.url].every((url) => new URL(url).hostname === '127.0.0.1')).toBe(true)
    expect(await call()).toStartWith('denied: no grant')
    console.log('PASS 1 denied: call_private_service /task')

    const input = { service: 'task', reason: 'offline synthetic rehearsal' }
    const pending = tools.requestPrivateAccess(input).then((result) => {
      agentPayloads.push({ name: 'request_private_access', input, result })
      return result
    })
    // Observe failures immediately, including when an earlier assertion stops the replay.
    void pending.catch(() => {})
    const deadline = Date.now() + 1000
    while (approval.requests.size === 0 && Date.now() < deadline) await Bun.sleep(5)
    expect(approval.requests.size).toBe(1)
    const [request] = approval.requests.values()
    expect(request.status).toBe('pending')
    expect(request.body).toEqual({
      agentLabel: 'offline-agent',
      gatewayLabel: 'offline-gateway',
      service: 'task',
      note: 'offline synthetic rehearsal',
    })
    expect(await call()).toStartWith('denied: no grant')
    console.log('PASS 2 request: pending; service still denied')

    const probe = '/api/offline-auth-probe-not-a-route'
    for (const token of [undefined, 'synthetic-wrong-operator']) {
      expect(await post(probe, token)).toEqual({
        status: 401,
        body: { error: { code: 'unauthorized' } },
      })
    }
    expect(await post(probe, operatorToken)).toEqual({
      status: 404,
      body: { error: { code: 'route_not_found' } },
    })
    expect(request.status).toBe('pending')
    expect(forward.mode).toBe('deny-403')
    console.log('PASS diagnostic: missing/wrong auth = 401; authenticated unknown POST = 404; no state change')

    const approve = `/api/requests/${request.id}/approve`
    expect((await post(approve, 'synthetic-wrong-operator')).status).toBe(401)
    expect(request.status).toBe('pending')
    expect(await call()).toStartWith('denied: no grant')
    expect(await post(approve, operatorToken)).toEqual({ status: 200, body: { status: 'approved' } })
    expect(await pending).toStartWith('granted:')
    console.log('PASS 3 approve: operator route approves; agent observes granted')

    expect(await call()).toBe(
      'task result: {"task":"report-private-service-health","host":"private-1","status":"healthy"}'
    )
    console.log('PASS 4 success: call_private_service returns fixture task')

    const revoke = '/api/grants/offline-agent/revoke'
    expect((await post(revoke, 'synthetic-wrong-operator')).status).toBe(401)
    expect(forward.mode).toBe('allow')
    expect(await post(revoke, operatorToken)).toEqual({ status: 200, body: { status: 'revoked' } })
    expect(request.status).toBe('revoked')
    console.log('PASS 5 revoke: operator route revokes fixture grant')
    expect(await call()).toStartWith('denied: no grant')
    console.log('PASS 6 denied: next call_private_service is denied')

    // Inspect the actual tool inputs/results and request HTTP observations, not a separate sample payload.
    expect(agentPayloads).toHaveLength(6)
    expect(agentHttp.length).toBeGreaterThan(0)
    expect(JSON.stringify({ agentPayloads, agentHttp, requests: [...approval.requests.values()] })).not.toContain(
      operatorToken
    )
    expect(approval.token).not.toBe(operatorToken)
    console.log('PASS boundary: operator auth absent from agent inputs/results and request HTTP payloads')
    console.log('PASS offline replay; cloud Pi/payment/HCS/Tor acceptance remains OPEN')
  } finally {
    operator.stop(true)
    await Promise.all([approval.close(), forward.close()])
  }
}, 5000)
