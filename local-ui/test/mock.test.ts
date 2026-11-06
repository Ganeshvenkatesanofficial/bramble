import { describe, expect, test } from 'bun:test'
import { createMock } from '../mock/model'
import { parseJoins, parseState } from '../src/lib/contract'

const mock = createMock()
const send = async (method: string, path: string, body?: object) => {
  const response = await mock.handle(
    new Request(`http://mock${path}`, {
      method,
      body: body ? JSON.stringify(body) : undefined,
      headers: { 'content-type': 'application/json' },
    })
  )
  if (!response) throw new Error(`unrouted ${path}`)
  return { status: response.status, body: await response.json() }
}

describe('mock implements the local API contract', () => {
  test('setup, join and leave move the phase', async () => {
    await send('POST', '/__test/reset', { scenario: 'fresh', admin: true })
    expect(parseState((await send('GET', '/api/state')).body).phase).toBe('setup')
    expect((await send('POST', '/api/setup', { name: 'Bad Name' })).status).toBe(400)
    await send('POST', '/api/setup', { name: 'laptop-ana' })
    expect(parseState((await send('GET', '/api/state')).body).phase).toBe('ready')
    const joined = await send('POST', '/api/join', { tailnet: 'acme.bramble.eth' })
    expect(joined.status).toBe(201)
    expect(joined.body.status).toBe('pending')
    expect(parseState((await send('GET', '/api/state')).body).joinId).toBe(joined.body.id)
    await send('POST', '/api/leave')
    expect(parseState((await send('GET', '/api/state')).body).phase).toBe('ready')
  })
  test('admin decisions reach the device and cannot be repeated', async () => {
    await send('POST', '/__test/reset', { scenario: 'ready', admin: true })
    const { body } = await send('POST', '/api/join', { tailnet: 'acme.bramble.eth' })
    const approved = await send('POST', `/api/admin/joins/${body.id}/approve`)
    expect(approved.body.status).toBe('approved')
    expect(parseState((await send('GET', '/api/state')).body).phase).toBe('approved')
    expect((await send('POST', `/api/admin/joins/${body.id}/approve`)).status).toBe(409)
    await send('POST', `/api/admin/joins/${body.id}/revoke`)
    expect(parseState((await send('GET', '/api/state')).body).phase).toBe('denied')
    const members = parseJoins((await send('GET', '/api/admin/members')).body, 'members')
    expect(members.every((member) => member.status === 'approved')).toBe(true)
  })
  test('admin routes refuse non-admins and rejected tokens', async () => {
    await send('POST', '/__test/reset', { scenario: 'connected' })
    expect((await send('GET', '/api/admin/joins')).status).toBe(403)
    await send('POST', '/__test/reset', { scenario: 'connected', admin: true })
    await send('POST', '/__test/flags', { admin: 'rejected' })
    expect((await send('GET', '/api/admin/joins')).status).toBe(401)
  })
})

describe('service links', () => {
  test('a connected device lists its loopback service links', async () => {
    await send('POST', '/__test/reset', { scenario: 'connected' })
    expect(parseState((await send('GET', '/api/state')).body).services).toEqual([
      { peer: 'gateway-1', service: 'task', url: 'http://127.0.0.1:41873/task' },
    ])
  })
  test('the parser drops links that do not point at this machine', () => {
    const state = parseState({
      phase: 'connected',
      services: [
        { peer: 'gw', service: 'task', url: 'http://127.0.0.1:5000/task' },
        { peer: 'gw', service: 'evil', url: 'https://example.com/' },
        { peer: 'gw', service: 'js', url: 'javascript:alert(1)' },
        { peer: 'gw', service: 'creds', url: 'http://user:pw@127.0.0.1:1/' },
        { peer: 'gw', service: 'lan', url: 'http://192.168.1.2:80/' },
        { service: 'nopeer', url: 'http://127.0.0.1:1/' },
      ],
    })
    expect(state.services).toEqual([{ peer: 'gw', service: 'task', url: 'http://127.0.0.1:5000/task' }])
    expect(parseState({ phase: 'ready' }).services).toEqual([])
  })
})
