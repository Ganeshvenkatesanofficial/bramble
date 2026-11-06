import { describe, expect, it } from 'vitest'
import { freezeRoundTrip } from './freeze-round-trip.ts'

describe('Hedera SDK transaction freeze', () => {
  it('round-trips a merged-format audit message through transaction bytes without a network', () => {
    expect(freezeRoundTrip().messageBytes).toBeLessThanOrEqual(95)
  })
})
