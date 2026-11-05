import { describe, expect, it } from 'bun:test'
import { errorText, scrub } from './redact'

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
})
