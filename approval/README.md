# Approval API reference

The approval service supports demo beats 2 (request and approve) and 5 (revoke).
It runs in one long-lived Node.js process on the admin machine. Run
`pnpm --filter @bramble/approval dev` from the repository root. The default bind
address is loopback, port 3001. The production commands are `build` and `start`
in the same package. Expose it only through the approved tunnel topology.

This package contains the API only; ETH-31 supplies the UI. The runtime accepts
requests and deny decisions. Grant and revoke operations answer
`503 signer_not_configured` until the real signer is configured on the admin
machine (see "Real signer runbook"). Test-only in-memory adapters never enter the
runtime path.

All POST requests require `Authorization: Bearer` with the shared token configured
in `APPROVAL_DEMO_TOKEN`. The API never returns the token. Reads are public and use
`Cache-Control: no-store`. The token protects this write surface; it does not
prove an agent's identity. A request is a suggestion, and only a human approver's
explicit action authorizes a grant.

| Method | Path                             | Result                                    |
| ------ | -------------------------------- | ----------------------------------------- |
| POST   | `/api/requests`                  | Create a pending request (201)            |
| GET    | `/api/requests`                  | `{ requests: [...] }`                     |
| GET    | `/api/requests/:id`              | One request                               |
| POST   | `/api/requests/:id/approve`      | Confirm a grant through the signer        |
| POST   | `/api/requests/:id/deny`         | Record denial without signing             |
| POST   | `/api/grants/:agentLabel/revoke` | Clear that agent's ACL through the signer |

The request body is `{ agentLabel, gatewayLabel, service, note?, requestedDuration? }`.
Duration is integer seconds, counted from grant confirmation, or from the first answer
when the confirmation was still unresolved (see the runbook). See ADRs 0011, 0012 and 0016 for the
contract, limits, error handling and timer limitations. Errors have the shape
`{ error: { code, message } }`. A failed or duplicate action never reports success.

`pnpm --filter @bramble/approval test` exercises the API using an in-memory
signer/resolver. These tests perform no network writes.

## Real signer runbook (needs human verification)

Status: **Open.** The signer and ENS identity reads are covered by unit tests with
in-memory adapters only. Nothing here has been run against Sepolia or a Ledger
Key Ring by an agent. A human must complete the checklist below before beat 2 or 5
relies on it.

How it is wired: `src/lib/chain.ts` adapts the admincli functions (`grantAcl`,
`clearAcl`) and the sidecar's `resolveDevice` to the service's `GrantSigner` and
`IdentityResolver`. `src/lib/chain-env.ts` builds the real viem adapters from
environment variables. Approve writes the ECDH digest of the service to the agent's
`acl` record, never the service name. Revoke empties that record. A confirmation
error after a transaction was submitted is settled from that transaction's own
receipt (three checks, two seconds apart). A receipt that shows success confirms
the write and one that shows a revert fails it. ACL text records are never used as
proof, because a lagging node can serve an older block. If the receipt stays
unknown, the API answers `202` with `status: approving` (or `revoking`) and
`unresolvedWrite.transactionHash`; the service keeps checking that hash every five
seconds, never resubmits, and refuses a different approve for that agent, and any
revoke, with `409 write_unresolved` until it settles. Approving the same request
again returns `409 request_not_pending`; no second write happens. A grant that later
confirms gets its revoke timer then (the duration counts from the first answer, not
the confirmation); one found reverted returns to `pending`. While a submission is
unresolved, open the hash on Sepolia to check it.

A restart of this process drops the in-memory queue and timers (ADR 0016). An
empty `acl` record after a restart does not prove there is no grant, because a
pending transaction can still mine and its expiry timer is gone. Before a restart,
write down the transaction hash of every `approving` or `revoking` request. After
it, open each hash on Sepolia and wait for a definitive outcome (success, revert,
or replaced/cancelled by another transaction with the same nonce). Recovery is
complete only when every recorded hash is settled and any grant that succeeded has
been revoked by hand.

Where it runs: only on the human-controlled admin machine. The granter's X25519
key is decrypted per grant from a `wallet-cli` Key Ring file on that machine and
held in memory for that call. There is no plaintext key variable, so a copy of
this service on another host can read but cannot grant. `SEPOLIA_PRIVATE_KEY`
pays for the `setText` transaction and must hold the `acl` setter role on the
agent's resolver (ADR 0004), as for `set-acl`. Both stay on the admin machine; do
not put either in the public deployment or the repository.

Configure it in `approval/.env.local` (untracked) using `.env.example` as the
template, then run `pnpm --filter @bramble/approval build && pnpm --filter @bramble/approval start`:

1. Run `provision-granter-key` once on the admin machine so the ring file exists.
2. Set `APPROVAL_GRANTER_LABEL` to the identity label whose published `pubkey`
   matches that key, plus the other variables in `.env.example`.
3. Start the service. Startup logs `real signer disabled: <VARIABLE> is required`
   and keeps answering 503 if configuration is incomplete.
4. Create a request for an enrolled agent and gateway, approve it, and open the
   returned transaction hash on Sepolia. Confirm the agent's `acl` record holds a
   digest and no plaintext name, and that the agent's next call succeeds.
5. Revoke it. Confirm the `acl` record is empty and the agent's next call fails.
6. Check that a request for a revoked, expired or unpublished identity is refused
   with `identity_not_active` and sends no transaction.

Record the transaction hashes and the date on the ticket. Until then, do not state
that the live path passed.

The agent payments UI is available at `/payments`. `GET /api/payments` is a
read-only testnet mirror feed attributed through `APPROVAL_PAYMENT_AGENTS`.
The panel refreshes every two seconds; the node's sidecar remains the payer.
See [`docs/16_AGENT_PAYMENTS_FLOW.md`](../docs/16_AGENT_PAYMENTS_FLOW.md) for
configuration, the automatic relay payment trigger, and verification limits.
