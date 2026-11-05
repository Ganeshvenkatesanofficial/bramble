# ADR 0012 — Approval request contract

**Status:** Draft, 6 November 2026. **Human approver:** Mumbai project human operator, pending; record their name and approval before accepting this ADR. **Task:** ETH-55 (W1-1). **Demo beats:** 2 (request and approve) and 5 (revoke).

An agent asks for access with one HTTP request. A human decides. The agent polls one URL for the outcome. A request is an unauthenticated suggestion; only the approver's explicit action authorizes a grant.

## Context

The agent (W2, `agent-mcp/`) needs a stable contract to submit a request and read its status. The console UI (ETH-56) needs the same contract to list requests and call approve, deny and revoke. Handoff section 4 requires that a request appears in the console within 2 s of the POST. ADR 0005 requires that on-chain access records hold digests only; this contract keeps plaintext service names in memory and never writes them to ENS.

## Decision

### Endpoints

| Method | Path | Auth | Result |
| --- | --- | --- | --- |
| `POST` | `/api/requests` | token | Create a pending request. Returns `201`. |
| `GET` | `/api/requests` | none | `{ "requests": [...] }`, all requests in memory. |
| `GET` | `/api/requests/:id` | none | One request. `404 request_not_found` if unknown. |
| `POST` | `/api/requests/:id/approve` | token | Grant through the signer. Returns the request with `grantTransaction`. |
| `POST` | `/api/requests/:id/deny` | token | Record the denial. No signing. |
| `POST` | `/api/grants/:agentLabel/revoke` | token | Clear that agent's ACL grants through the signer. |

Reads send `Cache-Control: no-store`.

### Request body

`POST /api/requests` takes `application/json`:

| Field | Type | Rule |
| --- | --- | --- |
| `agentLabel` | string | Required. Lowercase ENS label, 1–63 characters (`[a-z0-9-]`, no leading or trailing hyphen). |
| `gatewayLabel` | string | Required. Same rule. |
| `service` | string | Required. Symbolic name, `^[a-z][a-z0-9_-]{0,63}$`. Never a host or port. |
| `note` | string | Optional. At most 2000 characters. |
| `requestedDuration` | integer | Optional. Seconds, 1 to 86400. Advisory until the duration ADR (0016) is accepted. |

The service rejects unknown fields, a body over 16384 bytes, and any content type other than `application/json`.

### Request record

The response adds `id` (random UUID), `status`, `createdAt`, and, once known, `decidedAt`, `grantTransaction`, `revokeTransaction`, `revokedAt` and `revokeReason`. It also carries the duration fields (`expiresAt`, `remainingSeconds`, `expiryStatus`, `durationMode`) whose semantics belong to ADR 0016.

`status` takes one of these values:

| Status | Meaning |
| --- | --- |
| `pending` | Waiting for a human. |
| `approving` | The signer is writing the grant. Returns to `pending` if the write is not confirmed. |
| `approved` | The grant transaction is confirmed. |
| `denied` | A human denied the request. Terminal. |
| `revoking` | The signer is writing the revoke. Returns to `approved` if the write is not confirmed. |
| `revoked` | The revoke transaction is confirmed. Terminal. |

### Writes and authentication

Every `POST` requires `Authorization: Bearer <token>`, compared in constant time with the value of the `APPROVAL_DEMO_TOKEN` environment variable. If the variable is unset, writes fail with `503 token_not_configured`. A wrong or missing token returns `401 unauthorized`. The token is never returned or logged. Reads need no token.

The token gates the write surface. It does not prove who the agent is, and it does not authorize a grant by itself. The service never auto-approves. Before approving, it re-reads the agent's and the gateway's ENS identity through the resolver and requires an active identity with a published public key.

### Errors

Errors use `{ "error": { "code": "<snake_case>", "message": "<text>" } }`.

| Status | Code | When |
| --- | --- | --- |
| 400 | `invalid_request`, `invalid_json` | Body or field fails validation. |
| 401 | `unauthorized` | Wrong or missing token. |
| 404 | `request_not_found`, `route_not_found` | Unknown id or path. |
| 409 | `request_not_pending` | Approve or deny on a request that already left `pending`. |
| 409 | `already_granted` | The agent already has a grant, so a second approve is refused. |
| 409 | `identity_not_active` | Agent or gateway has no active ENS identity with a published key. |
| 409 | `not_granted` | Revoke for an agent with no grant. |
| 409 | `operation_in_progress` | Another write for the same agent is running. |
| 413, 415 | `request_too_large`, `unsupported_media_type` | Body size or content type. |
| 502 | `grant_failed`, `revoke_failed` | The signer did not confirm. |
| 503 | `signer_not_configured`, `token_not_configured` | Missing runtime configuration. |

A double approve, or a revoke of an ungranted agent, returns a 409 before any signer call. A failed or duplicate action never reports success.

## Alternatives rejected

| Alternative | Why rejected |
| --- | --- |
| Sign the request with the agent's key | The agent's identity is shown from ENS for the human to judge. A signature scheme adds an agent-side key flow with no demo beat. |
| Per-request tokens or OAuth | One shared demo token is enough for a single-operator tool and matches handoff section 5.3. |
| Push notification to the agent | The agent polls `GET /api/requests/:id`. Polling needs no listener on the agent side. |
| Hide the request list from readers | The handoff keeps request status reads open. See the first consequence. |

## Consequences

- **Reads are public.** Anyone who can reach the console URL can read agent labels, gateway labels, symbolic service names and notes. These are in memory only and are not written on-chain. Do not put secrets in `note`. If this is unacceptable for the demo, put reads behind the token and record the change here.
- **No de-duplication.** Two POSTs for the same agent and service create two pending requests. The second approve is refused with `already_granted`.
- **Ids are not secrets.** A UUID identifies a request. It is not a capability.
- **The contract is in memory.** A restart drops every request (ADR 0011).

## Verification status

- **Read from source:** the endpoint set, field rules, status values and error codes above come from `approval/src/lib/{contracts,validation,api,service}.ts` on branch `core-sol/eth-29-approval-api` (commit `5b4f1a7`, not pushed). The test titles in `approval/test/api.test.ts` on that branch name the same cases (2 s visibility, double write, token checks, validation). Nobody has run those tests for this ADR.
- **Open:** the 2 s visibility target. It needs a timed test after the ETH-29 PR merges.
- **Open:** if ETH-29 changes a name, code or status before merge, update this ADR in the same PR.
