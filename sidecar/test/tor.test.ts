import { afterEach, describe, expect, it } from 'vitest'
import {
  getTorStatus,
  isCircuitFailure,
  startTor,
  stopTor,
  torFetch,
  TorNotReadyError,
  type TorFetchInit,
  type TorTransport,
} from '../src/tor'

// A fake Tor transport: no WASM, no network. ready() settles when the test
// says so, and fetch() replays scripted outcomes while recording every call.
// Like tor-js 0.4.4, whose constructor starts bootstrap and caches that
// promise, a client whose bootstrap failed rejects every later ready().
type Outcome = Response | Error
class FakeTor implements TorTransport {
  calls: { url: string; init: TorFetchInit }[] = []
  outcomes: Outcome[] = []
  closed = false
  readyCalls = 0
  private settle: { resolve: () => void; reject: (e: Error) => void } | null = null
  private bootstrapError: Error | null = null

  ready(): Promise<void> {
    this.readyCalls++
    if (this.bootstrapError !== null) return Promise.reject(this.bootstrapError)
    return new Promise((resolve, reject) => {
      this.settle = { resolve, reject }
    })
  }
  becomeReady() {
    this.settle?.resolve()
  }
  failReady(message: string) {
    this.bootstrapError = new Error(message)
    this.settle?.reject(this.bootstrapError)
  }
  async fetch(url: string, init: TorFetchInit = {}): Promise<Response> {
    this.calls.push({ url, init })
    const next = this.outcomes.shift() ?? new Response('ok')
    if (next instanceof Error) throw next
    return next
  }
  close() {
    this.closed = true
  }
}

function torError(fields: { code: string; torKind?: string; retryable?: boolean }): Error {
  return Object.assign(new Error(`tor ${fields.code} ${fields.torKind ?? ''}`), fields)
}

async function readyFake(): Promise<FakeTor> {
  const fake = new FakeTor()
  const started = startTor({ transport: () => fake, retryDelayMs: 0 })
  await Promise.resolve()
  await Promise.resolve()
  fake.becomeReady()
  await started
  return fake
}

const keyOf = (call: { init: TorFetchInit }) => call.init.anonOptions?.isolationKey

afterEach(() => stopTor())

describe('startTor and getTorStatus', () => {
  it('reports starting until the transport is ready, then ready with readyAt', async () => {
    const fake = new FakeTor()
    const started = startTor({ transport: () => fake, now: () => 1234, retryDelayMs: 0 })
    expect(getTorStatus()).toEqual({ state: 'starting' })
    await Promise.resolve()
    await Promise.resolve()
    fake.becomeReady()
    await started
    expect(getTorStatus()).toEqual({ state: 'ready', readyAt: 1234 })
  })

  it('creates one client per sidecar even when called concurrently', async () => {
    let created = 0
    const fake = new FakeTor()
    const factory = () => {
      created++
      return fake
    }
    const a = startTor({ transport: factory, retryDelayMs: 0 })
    const b = startTor({ transport: factory, retryDelayMs: 0 })
    expect(b).toBe(a)
    await Promise.resolve()
    await Promise.resolve()
    fake.becomeReady()
    await Promise.all([a, b])
    await startTor()
    expect(created).toBe(1)
    expect(fake.readyCalls).toBe(1)
  })

  it('reports failed with lastError, then recovers on the next attempt with a new client', async () => {
    const fakes: FakeTor[] = []
    const factory = () => {
      const fake = new FakeTor()
      fakes.push(fake)
      return fake
    }
    const started = startTor({ transport: factory, retryDelayMs: 0 })
    await Promise.resolve()
    await Promise.resolve()
    fakes[0]!.failReady('guard unreachable')
    await expect(started).rejects.toThrow('guard unreachable')
    expect(getTorStatus()).toEqual({ state: 'failed', lastError: 'guard unreachable' })

    const again = startTor()
    // A new attempt reports starting and keeps the previous error visible.
    expect(getTorStatus()).toEqual({ state: 'starting', lastError: 'guard unreachable' })
    await Promise.resolve()
    await Promise.resolve()
    fakes[1]!.becomeReady()
    await again
    expect(getTorStatus().state).toBe('ready')
    expect(fakes).toHaveLength(2)
  })

  // Regression (ETH-83 review): tor-js caches a failed bootstrap, so a retry
  // on the same client failed forever and the sidecar stayed at 503.
  it('closes a client whose bootstrap failed and bootstraps a new one, never two at once', async () => {
    const fakes: FakeTor[] = []
    const factory = () => {
      // The previous client is closed before the next one exists.
      expect(fakes.every((f) => f.closed)).toBe(true)
      const fake = new FakeTor()
      fakes.push(fake)
      return fake
    }
    const first = startTor({ transport: factory, retryDelayMs: 0 })
    await Promise.resolve()
    await Promise.resolve()
    fakes[0]!.failReady('transient initial bootstrap failure')
    await expect(first).rejects.toThrow('transient initial bootstrap failure')
    expect(fakes[0]!.closed).toBe(true)

    const second = startTor()
    await Promise.resolve()
    await Promise.resolve()
    fakes[1]!.becomeReady()
    await second
    expect(getTorStatus().state).toBe('ready')
    expect(fakes).toHaveLength(2)
    expect(fakes[1]!.closed).toBe(false)
    const fetched = await torFetch('ens')('https://example.test/')
    expect(await fetched.text()).toBe('ok')
    expect(fakes[0]!.calls).toHaveLength(0)
    expect(fakes[1]!.calls).toHaveLength(1)
  })

  it('fails the attempt when bootstrap exceeds readyTimeoutMs, and closes that client', async () => {
    const fake = new FakeTor()
    await expect(startTor({ transport: () => fake, readyTimeoutMs: 10, retryDelayMs: 0 })).rejects.toThrow(
      'Tor not ready after'
    )
    expect(getTorStatus().state).toBe('failed')
    expect(fake.closed).toBe(true)
  })

  it('retries bootstrap in the background after retryDelayMs, with a new client', async () => {
    const fakes: FakeTor[] = []
    const factory = () => {
      const fake = new FakeTor()
      fakes.push(fake)
      return fake
    }
    const started = startTor({ transport: factory, retryDelayMs: 5 })
    await Promise.resolve()
    await Promise.resolve()
    fakes[0]!.failReady('no consensus')
    await expect(started).rejects.toThrow()
    await new Promise((r) => setTimeout(r, 20))
    expect(fakes).toHaveLength(2)
    fakes[1]!.becomeReady()
    await new Promise((r) => setTimeout(r, 0))
    expect(getTorStatus().state).toBe('ready')
  })

  it('keeps the options of the first startTor call after a failed attempt', async () => {
    const fakes: FakeTor[] = []
    const factory = () => {
      const fake = new FakeTor()
      fakes.push(fake)
      return fake
    }
    const first = startTor({ transport: factory, retryDelayMs: 0 })
    await Promise.resolve()
    await Promise.resolve()
    fakes[0]!.failReady('guard unreachable')
    await expect(first).rejects.toThrow()

    let ignored = 0
    const second = startTor({
      transport: () => {
        ignored++
        return new FakeTor()
      },
    })
    await Promise.resolve()
    await Promise.resolve()
    fakes[1]!.becomeReady()
    await second
    expect(ignored).toBe(0)
  })

  it('closes the client on stopTor and resets to starting', async () => {
    const fake = await readyFake()
    stopTor()
    expect(fake.closed).toBe(true)
    expect(getTorStatus()).toEqual({ state: 'starting' })
  })
})

describe('torFetch', () => {
  it('rejects with TorNotReadyError "starting Tor" before startTor finishes, without touching the network', async () => {
    const fake = new FakeTor()
    void startTor({ transport: () => fake, retryDelayMs: 0 })
    const err = await torFetch('ens')('https://rpc.example/').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TorNotReadyError)
    expect((err as Error).message).toBe('starting Tor')
    expect(fake.calls).toHaveLength(0)
  })

  it('sends viem-style fetch(url, init) calls through Tor with headers, method and body', async () => {
    const fake = await readyFake()
    const res = await torFetch('ens')('https://rpc.example/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber"}',
    })
    expect(await res.text()).toBe('ok')
    expect(fake.calls).toHaveLength(1)
    const [call] = fake.calls
    expect(call.url).toBe('https://rpc.example/')
    expect(call.init.method).toBe('POST')
    expect(call.init.headers?.['content-type']).toBe('application/json')
    expect(new TextDecoder().decode(call.init.body as Uint8Array)).toContain('eth_blockNumber')
  })

  it('accepts a Request object, as @x402/fetch passes one', async () => {
    const fake = await readyFake()
    const request = new Request('https://relay.example/pay', {
      method: 'POST',
      headers: new Headers({ 'X-PAYMENT': 'abc' }),
      body: 'payload',
    })
    await torFetch('pay')(request)
    const [call] = fake.calls
    expect(call.url).toBe('https://relay.example/pay')
    expect(call.init.headers?.['x-payment']).toBe('abc')
    expect(new TextDecoder().decode(call.init.body as Uint8Array)).toBe('payload')
  })

  it('sends no body for GET', async () => {
    const fake = await readyFake()
    await torFetch('ens')(new URL('https://rpc.example/x'))
    expect(fake.calls[0].init.method).toBe('GET')
    expect(fake.calls[0].init.body).toBeUndefined()
  })

  it('uses a stable isolation key per TorKey and different keys for ens and pay', async () => {
    const fake = await readyFake()
    await torFetch('ens')('https://a.example/')
    await torFetch('ens')('https://a.example/')
    await torFetch('pay')('https://b.example/')
    const [ens1, ens2, pay] = fake.calls.map(keyOf)
    expect(ens1).toBeDefined()
    expect(ens1).toBe(ens2)
    expect(pay).toBeDefined()
    expect(pay).not.toBe(ens1)
    expect(ens1?.startsWith('ens:')).toBe(true)
    expect(pay?.startsWith('pay:')).toBe(true)
  })

  it('retries a circuit failure once under a fresh key and keeps the fresh key afterwards', async () => {
    const fake = await readyFake()
    fake.outcomes = [torError({ code: 'CONNECTION', torKind: 'RemoteNetworkTimeout' }), new Response('second')]
    const res = await torFetch('ens')('https://rpc.example/', { method: 'POST', body: 'x' })
    expect(await res.text()).toBe('second')
    expect(fake.calls).toHaveLength(2)
    const [first, retry] = fake.calls.map(keyOf)
    expect(retry).not.toBe(first)
    // The retry resends the same body.
    expect(new TextDecoder().decode(fake.calls[1].init.body as Uint8Array)).toBe('x')

    await torFetch('ens')('https://rpc.example/')
    expect(keyOf(fake.calls[2])).toBe(retry)
  })

  it('does not rotate the other TorKey when one key retries', async () => {
    const fake = await readyFake()
    await torFetch('pay')('https://b.example/')
    const payKey = keyOf(fake.calls[0])
    fake.outcomes = [torError({ code: 'CONNECTION' }), new Response('ok')]
    await torFetch('ens')('https://a.example/')
    await torFetch('pay')('https://b.example/')
    expect(keyOf(fake.calls[3])).toBe(payKey)
    // The fresh ens key is not the pay key either.
    expect(keyOf(fake.calls[2])).not.toBe(payKey)
  })

  it('retries only once: a second circuit failure reaches the caller', async () => {
    const fake = await readyFake()
    const second = torError({ code: 'CONNECTION', torKind: 'RemoteStreamError' })
    fake.outcomes = [torError({ code: 'CONNECTION' }), second]
    await expect(torFetch('ens')('https://rpc.example/')).rejects.toBe(second)
    expect(fake.calls).toHaveLength(2)
  })

  it('does not retry a refusal from the destination, an abort, or an HTTP error status', async () => {
    const fake = await readyFake()
    fake.outcomes = [torError({ code: 'CONNECTION', torKind: 'RemoteConnectionRefused' })]
    await expect(torFetch('ens')('https://rpc.example/')).rejects.toThrow()
    expect(fake.calls).toHaveLength(1)

    fake.outcomes = [torError({ code: 'ABORT' })]
    await expect(torFetch('ens')('https://rpc.example/')).rejects.toThrow()
    expect(fake.calls).toHaveLength(2)

    fake.outcomes = [new Response('bad gateway', { status: 502 })]
    const res = await torFetch('ens')('https://rpc.example/')
    expect(res.status).toBe(502)
    expect(fake.calls).toHaveLength(3)
  })

  it('does not retry when the caller has aborted', async () => {
    const fake = await readyFake()
    const controller = new AbortController()
    controller.abort()
    fake.outcomes = [torError({ code: 'CONNECTION' })]
    await expect(torFetch('ens')('https://rpc.example/', { signal: controller.signal })).rejects.toThrow()
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].init.signal).toBe(controller.signal)
  })

  it('rotates once when concurrent requests on the same key fail together', async () => {
    const fake = await readyFake()
    fake.outcomes = [torError({ code: 'CONNECTION' }), torError({ code: 'CONNECTION' })]
    const f = torFetch('ens')
    await Promise.all([f('https://a.example/'), f('https://a.example/')])
    const keys = fake.calls.map(keyOf)
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).toBe(keys[3])
    expect(keys[2]).not.toBe(keys[0])
  })
})

describe('isCircuitFailure', () => {
  it('classifies tor-js errors', () => {
    expect(isCircuitFailure(torError({ code: 'CONNECTION', torKind: 'RemoteNetworkTimeout' }))).toBe(true)
    expect(isCircuitFailure(torError({ code: 'OTHER', retryable: true }))).toBe(true)
    expect(isCircuitFailure(torError({ code: 'CONNECTION', torKind: 'RemoteConnectionRefused' }))).toBe(false)
    expect(isCircuitFailure(torError({ code: 'ABORT', retryable: true }))).toBe(false)
    expect(isCircuitFailure(new Error('plain'))).toBe(false)
    expect(isCircuitFailure('string')).toBe(false)
  })
})
