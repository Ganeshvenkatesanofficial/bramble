import type { StubApproval, StubForward } from '../../agent-mcp/test/stubs'

/** Offline adapter only: decisions change the existing in-memory MCP fixtures. */
export function startOperatorRoute(approval: StubApproval, forward: StubForward, token: string) {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const json = (body: unknown, status = 200) => Response.json(body, { status })
      const error = (code: string, status: number) => json({ error: { code } }, status)
      if (request.method !== 'POST') return error('route_not_found', 404)
      // Match approval/src/lib/api.ts: authenticate POST before looking up its route.
      if (request.headers.get('authorization') !== `Bearer ${token}`) return error('unauthorized', 401)
      const path = new URL(request.url).pathname
      const approve = /^\/api\/requests\/([^/]+)\/approve$/.exec(path)
      if (approve) {
        const found = approval.requests.get(approve[1])
        if (!found) return error('request_not_found', 404)
        if (found.status !== 'pending') return error('invalid_status', 409)
        approval.setStatus(found.id, 'approved')
        forward.mode = 'allow'
        return json({ status: 'approved' })
      }
      const revoke = /^\/api\/grants\/([^/]+)\/revoke$/.exec(path)
      if (revoke) {
        const grants = [...approval.requests.values()].filter(
          (entry) => entry.body.agentLabel === revoke[1] && entry.status === 'approved'
        )
        if (grants.length === 0) return error('grant_not_found', 404)
        for (const grant of grants) approval.setStatus(grant.id, 'revoked')
        forward.mode = 'deny-403'
        return json({ status: 'revoked' })
      }
      return error('route_not_found', 404)
    },
  })
  return { url: server.url.origin, stop: (force: boolean) => server.stop(force) }
}
