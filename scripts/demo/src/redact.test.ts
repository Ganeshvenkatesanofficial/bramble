import { describe, expect, it } from 'bun:test'
import { errorText, scrub, secretValues } from './redact'

describe('scrub', () => {
  it('replaces URLs that may carry an API key', () => {
    const text =
      'HTTP request failed. URL: https://sepolia.example.io/v3/0123456789abcdef0123456789abcdef\nDetails: 429'
    expect(scrub(text)).toBe('HTTP request failed. URL: <url>\nDetails: 429')
  })

  it('replaces exact secret values and ignores empty or short ones', () => {
    expect(scrub('key abcdefgh12345678 used', ['abcdefgh12345678', undefined, ''])).toBe('key <redacted> used')
    expect(scrub('ab is kept', ['ab'])).toBe('ab is kept')
  })

  it('handles non-Error values', () => {
    expect(errorText('plain failure at http://127.0.0.1:7890/x')).toBe('plain failure at <url>')
  })

  it('removes a credential after a ")" or "," inside a URL', () => {
    expect(scrub('see https://rpc.example/v3/first)SYNTHETIC_CREDENTIAL_SUFFIX here')).toBe('see <url> here')
    expect(scrub('at https://rpc.example/a,b-secret')).toBe('at <url>')
  })

  it('removes key-shaped hex without being told the value', () => {
    const key = 'ab'.repeat(32)
    expect(scrub(`bad key 0x${key} and ${key}`)).toBe('bad key <redacted> and <redacted>')
    expect(scrub('der 302e020100300506032b657004220420' + 'cd'.repeat(32))).toBe('der <redacted>')
  })

  it('removes a secret value that contains a URL, whole', () => {
    const rpc = 'https://rpc.example/v3/abc)tail'
    expect(scrub(`failed ${rpc}`, [rpc])).toBe('failed <redacted>')
  })
})

describe('secretValues', () => {
  it('collects values of secret-named entries only', () => {
    const values = secretValues(
      { SEPOLIA_RPC_URL: 'u1', BRAMBLE_PRIVATE_KEY: 'k1', BRAMBLE_NODE_LABEL: 'gateway' },
      undefined,
      {
        APPROVAL_DEMO_TOKEN: 't1',
        SEPOLIA_PK: 'p1',
      }
    )
    expect(values.sort()).toEqual(['k1', 'p1', 't1', 'u1'])
  })
})
