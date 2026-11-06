import { afterEach, describe, expect, test } from 'bun:test'
import { ConfigError, realAdaptersFromEnv } from '../src/lib/chain-env'

const SENTINEL = 'sentinel-value-that-must-not-be-logged'
const validKey = `0x${'11'.repeat(32)}`
const base = {
  APPROVAL_GRANTER_LABEL: 'granter',
  SEPOLIA_PRIVATE_KEY: validKey,
  BRAMBLE_GRANTER_KEY_RING_PATH: '/nonexistent/ring',
}

const saved = { name: process.env.BRAMBLE_TAILNET_NAME, registry: process.env.BRAMBLE_TAILNET_REGISTRY }
afterEach(() => {
  for (const [key, value] of [
    ['BRAMBLE_TAILNET_NAME', saved.name],
    ['BRAMBLE_TAILNET_REGISTRY', saved.registry],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function failure(env: Record<string, string | undefined>): Error {
  try {
    realAdaptersFromEnv(env)
  } catch (error) {
    return error as Error
  }
  throw new Error('expected a configuration failure')
}

describe('real signer configuration', () => {
  test('is off, without error, when no granter label is set', () => {
    expect(realAdaptersFromEnv({})).toBeUndefined()
  })

  test('missing variables are reported by name', () => {
    expect(failure({ APPROVAL_GRANTER_LABEL: 'granter' }).message).toBe(
      'SEPOLIA_PRIVATE_KEY is required for the real signer'
    )
    expect(failure({ ...base, BRAMBLE_GRANTER_KEY_RING_PATH: undefined }).message).toBe(
      'BRAMBLE_GRANTER_KEY_RING_PATH is required for the real signer'
    )
  })

  test('a malformed signer key is reported without its value', () => {
    for (const bad of [`${SENTINEL}`, '0x1234', `0x${'00'.repeat(32)}`, `0x${'ff'.repeat(32)}`]) {
      const error = failure({ ...base, SEPOLIA_PRIVATE_KEY: bad })
      expect(error).toBeInstanceOf(ConfigError)
      expect(error.message).not.toContain(bad)
      expect(error.message).toContain('SEPOLIA_PRIVATE_KEY')
    }
  })

  test('a malformed registry address is reported without its value', () => {
    process.env.BRAMBLE_TAILNET_NAME = 'mesh.eth'
    process.env.BRAMBLE_TAILNET_REGISTRY = SENTINEL
    const error = failure(base)
    expect(error).toBeInstanceOf(ConfigError)
    expect(error.message).toBe('BRAMBLE_TAILNET_REGISTRY is not a valid address')
    expect(error.message).not.toContain(SENTINEL)
  })

  test('a missing registry falls back to a named-variable diagnostic', () => {
    delete process.env.BRAMBLE_TAILNET_REGISTRY
    expect(failure(base).message).toBe('BRAMBLE_TAILNET_REGISTRY is not a valid address')
  })
})
