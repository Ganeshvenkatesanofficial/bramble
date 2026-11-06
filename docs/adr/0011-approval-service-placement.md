# ADR 0011 — Approval service placement

**Status:** Draft, 6 November 2026. **Human approver:** Mumbai project human operator, pending; record their name and approval before accepting this ADR. **Task:** ETH-55 (W1-1). **Demo beats:** 2 (request and approve) and 5 (revoke).

The approval service is a new workspace package, `approval/`, separate from `dashboard/`. It runs on the human-controlled admin machine, binds loopback by default, keeps pending requests in memory, and never enforces access.

## Context

Beats 2 and 5 need a write surface. A human must approve or revoke an agent's access, and the service must write the resulting access rule to ENS. `dashboard/` is the only web surface today, and `dashboard/README.md` guarantees that it is read-only and never signs or sends a transaction. Handoff invariant 4 keeps it that way.

The approval service needs three things the dashboard deliberately lacks: write endpoints, a signer, and a shared secret for writes. The signer reads the granter's key through the Ledger Key Ring file on the admin machine (ADR 0001) and signs with the operator key. That placement is fixed by where the key material lives.

## Decision

1. **Separate package.** `approval/` is a pnpm workspace package registered in `pnpm-workspace.yaml`. It matches the `dashboard/` stack (Next.js 16, React 19, Tailwind 4) so the two surfaces share a visual language. `dashboard/` is not extended and is not modified.
2. **Runs on the admin machine.** The process needs the signer and the Key Ring file, so it runs where they are. A tunnel or reverse proxy exposes the web UI at the public console URL; the signing material never leaves the admin machine.
3. **Loopback by default.** `pnpm --filter @bramble/approval dev` and `start` bind `127.0.0.1`. Exposing it beyond loopback is an explicit deployment step (tunnel), not a default.
4. **In-memory pending requests.** Requests live in process memory and are lost on restart. The approval service is an operator tool, not part of the node runtime path covered by `pnpm check:no-local-state` (`brambled/**/*.go`, `sidecar/src/**`). It adds no persistent local state to those paths.
5. **Signing behind interfaces.** The service depends on `GrantSigner`, `IdentityResolver` and `Clock` interfaces (and later a `PaymentFeed`). Tests use in-memory implementations. The real implementations call the functions extracted from `admincli` (ETH-54) and are wired in ETH-72. Until then the runtime fails closed with `503 signer_not_configured`; no fake signer ships in the runtime path.
6. **Not an enforcement point.** Invariant 1 holds. The service writes ENS state that every gateway reads independently on its own poll. A gateway never calls the approval service to decide an admission or an access check, and stopping the service does not change what any peer enforces.

## Alternatives rejected

| Alternative | Why rejected |
| --- | --- |
| Add write routes to `dashboard/` | Breaks the documented read-only guarantee and invariant 4. |
| Run the service on a cloud node beside the gateway | Puts the Key Ring file and operator key on a machine that also serves the agent path. Handoff section 5.3 places signing on the admin machine. |
| Persist pending requests on disk | Needs a storage design and a cleanup story for no demo benefit. A restart before approval means the agent re-requests. |
| Make the gateway query the service for decisions | Creates a central enforcement point (invariant 1). |

## Consequences

- A restart loses pending and recent requests. An agent that polls a lost request id gets `404 request_not_found` and must submit a new request.
- The public console URL exposes the write surface to the internet. The shared demo token (ADR 0012) is the only gate on writes. It does not identify an agent or an approver. The approver's explicit click is the authority.
- A new package adds a second Next.js build to `pnpm verify`.
- The README must state that the grant and the revoke are software-signed (handoff invariant 8).

## Verification status

- **Read from source:** `dashboard/README.md` states the read-only guarantee. `approval/package.json` on branch `core-sol/eth-29-approval-api` (commit `5b4f1a7`) binds `127.0.0.1:3001` in `dev` and `start`.
- **Open:** whether the tunnel preserves the loopback bind and the token check end to end. This is a W11 deployment check.
