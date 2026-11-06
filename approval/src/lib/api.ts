import { timingSafeEqual } from 'node:crypto'
import { ApiError, type GrantSigner, type IdentityResolver, type Clock } from './contracts'
import { ApprovalService, systemClock } from './service'
import { AuditRecorder, type AuditTrail } from './audit'
import { readInput, readPayment, label } from './validation'

interface ApiOptions {
  signer?: GrantSigner
  resolver?: IdentityResolver
  clock?: Clock
  /** Posts salted commitments to HCS. Without it, audit feed rows report `audit_not_configured`. */
  auditTrail?: AuditTrail
  /** Parent ENS name of agent labels, for example `acme.eth`. */
  ensParent?: string
  token: () => string | undefined
}

export function createApprovalApi(options: ApiOptions) {
  const clock = options.clock ?? systemClock
  const audit = new AuditRecorder(options.auditTrail, clock)
  const service = new ApprovalService(options.signer, options.resolver, clock, audit, options.ensParent)
  const json = (value: unknown, status = 200) =>
    Response.json(value, { status, headers: { 'cache-control': 'no-store' } })

  // 202 while a submitted transaction is unconfirmed: the write may still land.
  const jsonWrite = (value: { status?: string } | undefined) =>
    json(value, value?.status === 'approving' || value?.status === 'revoking' ? 202 : 200)

  return {
    audit,
    async handle(request: Request): Promise<Response> {
      try {
        if (request.method === 'POST') {
          const token = options.token()
          if (!token) throw new ApiError(503, 'token_not_configured', 'APPROVAL_DEMO_TOKEN is required for writes.')
          const provided = Buffer.from(request.headers.get('authorization') ?? '')
          const expected = Buffer.from(`Bearer ${token}`)
          if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
            throw new ApiError(401, 'unauthorized', 'A valid demo bearer token is required.')
          }
        }
        const path = new URL(request.url).pathname.replace(/\/$/, '')
        if (path === '/api/requests' && request.method === 'POST') {
          return json(service.create(await readInput(request)), 201)
        }
        if (path === '/api/requests' && request.method === 'GET') return json({ requests: service.list() })
        if (path === '/api/audit' && request.method === 'GET') return json({ entries: service.auditFeed() })
        if (path === '/api/payments/settled' && request.method === 'POST') {
          return json(service.recordPayment(await readPayment(request)), 202)
        }
        const identity = /^\/api\/identities\/([^/]+)$/.exec(path)
        if (identity && request.method === 'GET') {
          const name = label(identity[1], 'agentLabel')
          if (!options.resolver) {
            throw new ApiError(503, 'resolver_not_configured', 'Identity resolution is not configured.')
          }
          try {
            const facts = await options.resolver.resolveIdentity(name)
            return json({
              identity: facts
                ? {
                    label: facts.label,
                    pubkeyPublished: facts.pubkeyPublished,
                    revoked: facts.revoked,
                    expiry: facts.expiry,
                  }
                : null,
            })
          } catch {
            throw new ApiError(502, 'identity_unavailable', 'ENS identity facts are temporarily unavailable.')
          }
        }
        const decision = /^\/api\/requests\/([^/]+)\/(approve|deny)$/.exec(path)
        if (decision && request.method === 'POST') {
          if (decision[2] === 'deny') return json(service.deny(decision[1]))
          return jsonWrite(await service.approve(decision[1]))
        }
        const revoke = /^\/api\/grants\/([^/]+)\/revoke$/.exec(path)
        if (revoke && request.method === 'POST') return jsonWrite(await service.revoke(label(revoke[1], 'agentLabel')))
        const detail = /^\/api\/requests\/([^/]+)$/.exec(path)
        if (detail && request.method === 'GET') return json(service.get(detail[1]))
        throw new ApiError(404, 'route_not_found', 'Route not found.')
      } catch (error) {
        if (error instanceof ApiError)
          return json({ error: { code: error.code, message: error.message } }, error.status)
        return json({ error: { code: 'internal_error', message: 'The operation failed.' } }, 500)
      }
    },
  }
}
