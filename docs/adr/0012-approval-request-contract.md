# ADR 0012 — Approval request contract

**Kind:** Explanation  
**Status:** Draft, 6 November 2026  
**Human approver:** Project owner — pending; record the person's name and decision here.  
**Evidence:** Read from source: ETH-29; build brief W1; ADR 0005.  
**Demo beats:** 2 (request and approve), 5 (revoke).

## Context

The MCP client needs to submit a suggestion and observe its decision. The
console needs a pending queue and explicit human actions. A submitted label is
untrusted input and cannot authorize its own grant.

## Draft decision

Use JSON over the separate approval API. All POST methods require the shared
demo bearer token, including request submission. Reads require no token and
return `Cache-Control: no-store`. The token is an HTTP boundary, not an identity
proof. The server never auto-approves.

| Method | Path | Success body |
| --- | --- | --- |
| POST | `/api/requests` | New request, status 201 |
| GET | `/api/requests` | `{ requests: [...] }` |
| GET | `/api/requests/:id` | Request |
| POST | `/api/requests/:id/approve` | Request with confirmed grant receipt |
| POST | `/api/requests/:id/deny` | Denied request |
| POST | `/api/grants/:agentLabel/revoke` | Revoked request or agent revoke result |

The POST request body contains `agentLabel`, `gatewayLabel`, `service`, and
optional `note` and `requestedDuration`. The server creates the UUID and records
UTC timestamps. Unknown fields are rejected, so client-supplied status cannot
skip the human decision.

- Labels contain 1–63 lowercase ASCII letters, digits or internal hyphens. They
  identify one ENS label, not a full name or destination address.
- Service names contain 1–64 characters, start with a lowercase ASCII letter,
  and otherwise contain lowercase letters, digits, underscores or hyphens.
  They are symbolic names; the API does not accept hosts, URLs or ports.
- Notes contain at most 2000 characters. The total JSON body is limited to 16384
  bytes. Note text is data; render it as text in the later console UI.
- `requestedDuration` is integer seconds from 1 through 86400. Omission requests
  a grant without an automatic revoke timer. ADR 0013 describes duration.

Requests begin `pending`. Only pending requests can become `approved` or
`denied`. The API exposes `approving` and `revoking` while the signer is pending,
then reports confirmation through `grantTransaction` or `revokeTransaction`,
each containing `transactionHash`. The UI must derive network-specific links
from its configured network; a test receipt is not evidence of a chain write.

Before signing, the resolver must confirm active agent and gateway identities,
published public keys, unexpired enrollment, and no existing ACL grant for the
agent. A per-agent lock rejects overlapping writes. A second approval fails
with `409 request_not_pending` or `409 operation_in_progress`. Revoking an agent
with no grant fails with `409 not_granted`. These failures make no signer write.
Deny records a decision without calling the signer.

One active grant per agent matches the agent-scoped revoke endpoint. Revoke
clears that agent's ACL grants, including grants created outside this queue;
it does not revoke enrollment. Adding several simultaneous scoped grants would
require a revised revoke contract and timer semantics.

The signer returns only confirmed writes. On failure the API restores the
previous decision state and returns a sanitized error. The real adapter must
reconcile an uncertain broadcast before reporting a retryable failure. It must
reuse the admin CLI's ACL implementation rather than copy its cryptography.
Resolved identity display is wired with the real adapter in ETH-30 and the
console in ETH-31; this API foundation provides the typed resolver boundary.

Errors use `{ error: { code, message } }`. Missing/invalid authorization returns
401; missing token configuration or signer returns 503; malformed contracts
return 400; missing requests return 404; identity and decision conflicts return
409; an unconfirmed signer action returns 502. Adapter diagnostic text never
appears in a response.

## Consequences

Clients can poll immediately after submission. Request creation and reads do not
wait on chain resolution. Identity checks happen at explicit approval time, so
an identity that was revoked since submission cannot obtain a grant using an
old queue entry. Queue loss does not alter the peer's enforcement authority.

## Alternatives

Client-generated decisions would confer authority on an untrusted suggestion.
Cookie authentication adds an ambient browser credential where the explicit
bearer contract suffices. A durable request log is outside this ticket's
in-memory requirement.
