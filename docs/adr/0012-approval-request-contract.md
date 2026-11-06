# ADR 0012 — Approval request contract

**Status:** Draft, 6 November 2026. **Human approver:** Mumbai project human operator, pending; record their name and approval before accepting this ADR. **Task:** ETH-55 (W1-1). **Demo beats:** 2 (request and approve) and 5 (revoke).

An agent asks for access with one HTTP request. A human decides. The agent polls one URL for the outcome. A request is an unauthenticated suggestion; only the approver's explicit action authorizes a grant.

## Context

The agent (W2, `agent-mcp/`) needs a stable contract to submit a request and read its status. The console UI (ETH-56) needs the same contract to list requests and call approve, deny and revoke. Handoff section 4 requires that a request appears in the console within 2 s of the POST. ADR 0005 requires that on-chain access records hold digests only; this contract keeps plaintext service names in memory and never writes them to ENS.

## Decision

Use one HTTP contract with six endpoints: create, list and read a request, then approve, deny and revoke. The agent submits a request and polls `GET /api/requests/:id`. The console lists requests and calls approve, deny and revoke. The exact paths, fields, status values and error codes are in [the approval API reference](../reference/approval-api.md).

- **Writes.** Every `POST` needs a shared demo token in `Authorization: Bearer`. The token gates the write surface. It does not prove the agent's identity or authorize a grant.
- **Reads.** Request status reads are open, as the handoff requires.
- **Human decision.** The service never auto-approves. Before approving, it re-reads the agent's and the gateway's ENS identity and requires an active identity with a published public key.
- **No chain write on a bad action.** A second approve for an agent that already has a grant, and a revoke for an agent with no grant, return `409` before any signer call.
- **Status evidence.** A request in `approved` has a confirmed `grantTransaction`. A request in `revoked` has no grant. It carries a `revokeTransaction` only when the signer confirmed a revoke. When the service finds an empty ACL, `revoked` has no transaction and the console must not link one. The reference lists each path.
- **Duration.** The merged service treats `requestedDuration` as seconds after a confirmed grant and runs a server-side revoke timer. The timer lives in process memory, retries a failed revoke every 5 seconds, and does not survive a restart. A duration never approves anything. ADR 0016 is still a draft, so the human approver has not accepted this timer as the demo design.

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

- **Verified:** on 6 November 2026, at the merge of `origin/hackathon` (`2403c62`) into this branch, `pnpm --filter @bramble/approval test` passes 21 tests with 177 assertions (Bun 1.4.0). The tests use the in-memory signer and resolver and make no network writes.
- **Read from source:** the reference page matches `approval/src/lib/{contracts,validation,api,service}.ts` on `hackathon`, including the revoke paths that set no `revokeTransaction`.
- **Open:** the 2 s visibility target against a running service, a real signer, and the public tunnel.
- **Open:** human acceptance of this ADR and of ADR 0016.
