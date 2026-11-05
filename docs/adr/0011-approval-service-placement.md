# ADR 0011 — Approval service placement

**Kind:** Explanation  
**Status:** Draft, 6 November 2026  
**Human approver:** Project owner — pending; record the person's name and decision here.  
**Evidence:** Read from source: Mumbai handoff section 3; build brief W1; ETH-29.  
**Demo beats:** 2 (request and approve), 5 (revoke).

## Context

The dashboard guarantees read-only access. The approval flow introduces a write
surface that needs an operator signer. Combining these surfaces would change the
dashboard's security boundary. ETH-29 requests a separate API package; ETH-30
supplies the real signer and ENS identity resolver.

## Draft decision

Place the approval API in the separate `approval/` workspace. Match the existing
Next.js 16, React 19 and Tailwind 4 stack. Run one long-lived Node.js process on
the human-controlled admin machine, bound to loopback. Use the approved tunnel
for public access. Every POST requires the shared `APPROVAL_DEMO_TOKEN` bearer
token. GET responses are public and uncached, so operators must treat request
labels and notes as visible demo data. No credentials belong in notes.

The service owns an in-memory request queue and revoke timers. It holds no
persistent local state. Neither the gateway nor any peer calls this service to
decide access: peers independently read ENS state. This preserves the existing
claim of no trusted coordinator for enforcement.

The `GrantSigner` interface accepts symbolic grant inputs and returns a confirmed
transaction receipt. The `IdentityResolver` interface supplies identity facts and
a fresh ACL presence check. Production has no fallback fake signer. Until ETH-30
wires both adapters, grant and revoke fail with `503 signer_not_configured`.
The in-memory signer/resolver exists only under `approval/test/`.

## Consequences

The dashboard stays unchanged. The UI and MCP client can share this API without
receiving the backend service credential or the operator signing key. Possession
of the demo token protects the HTTP write boundary; it does not establish agent
identity. A human must explicitly approve each request.

Do not run multiple replicas, serverless instances, or a cluster of independent
workers: their queues, locks and timers would diverge. A process restart loses
all requests and timers while chain grants remain. The operator must inspect
and revoke outstanding grants through the real admin tooling after a restart.
No persistent queue or lease system is introduced by this ticket.

## Alternatives

Adding writes to `dashboard/` violates the handoff's read-only invariant. Keeping
only CLI commands does not supply the request and decision API needed for beat
2. A durable external database adds a deployment dependency beyond this demo's
in-memory contract.

## Verification boundary

ETH-29 tests the HTTP API with in-memory chain adapters and builds the production
Next.js route. Live Sepolia transactions, deployment and the UI require their
own tickets and verification. This draft does not authorize those operations.
