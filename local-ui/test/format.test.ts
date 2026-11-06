import { describe, expect, test } from 'bun:test'
import { parseJoins, parseState } from '../src/lib/contract'
import {
  checkDeviceName,
  checkNetworkName,
  describeTest,
  formatFingerprint,
  relativeTime,
  shortKey,
} from '../src/lib/format'

describe('names', () => {
  test('device names follow the label rule', () => {
    expect(checkDeviceName('laptop-ana')).toBeNull()
    expect(checkDeviceName('a')).toContain('at least 2')
    expect(checkDeviceName('Laptop')).toContain('lowercase')
    expect(checkDeviceName('-bad')).toContain('lowercase')
    expect(checkDeviceName('x'.repeat(33))).toContain('32')
  })
  test('network names need a dot', () => {
    expect(checkNetworkName(' Acme.Bramble.eth ')).toBeNull()
    expect(checkNetworkName('acme')).toContain('dots')
    expect(checkNetworkName('')).toContain('Enter')
  })
})

describe('display helpers', () => {
  test('fingerprints group in fours, other values pass through', () => {
    expect(formatFingerprint('9f3ac1d27b4e86a0')).toBe('9f3a c1d2 7b4e 86a0')
    expect(formatFingerprint('SHA256:abc')).toBe('SHA256:abc')
    expect(shortKey('kP3x0uQ1mV8sT2yNfR7aWc4dEhJ6bZgLoXi9UvYn5Bk=')).toBe('kP3x0uQ1…Yn5Bk=')
  })
  test('handshake times accept ISO strings, unix seconds and "never"', () => {
    const now = Date.parse('2026-11-06T12:00:00Z')
    expect(relativeTime('2026-11-06T11:59:30Z', now)).toBe('30 s ago')
    expect(relativeTime(Math.floor(now / 1000) - 120, now)).toBe('2 min ago')
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 h ago')
    expect(relativeTime(null, now)).toBe('Not yet')
    expect(relativeTime('0001-01-01T00:00:00Z', now)).toBe('Not yet')
    expect(relativeTime(0, now)).toBe('Not yet')
  })
  test('test results read as sentences', () => {
    expect(describeTest({ ok: true, status: 200, ms: 41.6 }, 'gateway-1').text).toBe('Reached gateway-1 in 42 ms.')
    expect(describeTest({ ok: false, status: 504, ms: 5000 }, 'gateway-1').text).toContain('status 504')
    expect(describeTest({ ok: false, status: 0, ms: 0 }, 'gateway-1').text).toContain('did not answer')
  })
})

describe('contract parsing', () => {
  test('rejects unknown phases and fills safe defaults', () => {
    expect(() => parseState({ phase: 'dancing' })).toThrow()
    expect(() => parseState(null)).toThrow()
    const state = parseState({ phase: 'connected', peers: [{ label: 'a', path: 'weird' }, 7] })
    expect(state.isAdmin).toBe(false)
    expect(state.peers).toEqual([{ label: 'a', meshIp: '', path: 'none', lastHandshake: null, rttMs: undefined }])
  })
  test('join lists accept a wrapped or bare array and drop bad rows', () => {
    const good = { id: 'j1', label: 'a', tailnet: 't.eth', status: 'pending' }
    expect(parseJoins({ joins: [good, { id: 'x' }] })).toHaveLength(1)
    expect(parseJoins([good])).toHaveLength(1)
    expect(parseJoins({ members: [good] }, 'members')).toHaveLength(1)
    expect(parseJoins('nope')).toEqual([])
  })
})
