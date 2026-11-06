// Test-only stand-in for relay-sidecar/src/index.ts, spawned by the Go
// relay's -sidecar-dir in brambled/sponsored_relay_e2e_test.go. It mounts the
// REAL sponsor routes, token minter and internal-API allocator; only the
// registry read is a fixture (HARNESS_ENROLLED_LABELS), because the test has
// no chain. There is no x402 middleware, so no Hedera call can happen here.
import { Hono } from 'hono'
import { PORT, internalAPIURL, sponsorBytes, sponsorMaxPerHour, tokenSecret } from '../../../src/config'
import { allocateViaInternalAPI, createSponsorRoute } from '../../../src/sponsor'
import { mintToken } from '../../../src/token'

const enrolled = new Set((process.env.HARNESS_ENROLLED_LABELS ?? '').split(',').filter(Boolean))

const app = new Hono()
app.get('/health', (c) => c.json({ ok: true }))
app.get('/price', (c) => c.json({ asset: '0.0.429274', amount: '1' }))
app.route(
  '/',
  createSponsorRoute({
    readEnrollment: async (label) =>
      enrolled.has(label) ? { enrolled: true } : { enrolled: false, reason: 'no pubkey record' },
    mintToken: () => mintToken(tokenSecret()),
    allocate: allocateViaInternalAPI(internalAPIURL),
    bytes: sponsorBytes(),
    maxPerHour: sponsorMaxPerHour(),
  })
)

export default { port: PORT, fetch: app.fetch }
