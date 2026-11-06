# Approval API reference

The approval service supports demo beats 2 (request and approve) and 5 (revoke).
It runs in one long-lived Node.js process on the admin machine. The development command is
`pnpm --filter @bramble/approval dev` from the repository root. The default bind
address is loopback, port 3001. The production commands are `build` and `start`
in the same package. External access is limited to the approved tunnel topology.

The root page is the approval console (ETH-31). The runtime accepts
requests and deny decisions. Grant and revoke operations answer
`503 signer_not_configured` until the real signer is configured on the admin
machine (see "Real signer runbook"). Test-only in-memory adapters never enter the
runtime path.

All POST requests require `Authorization: Bearer` with the shared token configured
in `APPROVAL_DEMO_TOKEN`. The API never returns the token. Reads are public and use
`Cache-Control: no-store`. The token protects this write surface; it does not
prove an agent's identity. A request is a suggestion, and only a human approver's
explicit action authorizes a grant.

| Method | Path                             | Result                                               |
| ------ | -------------------------------- | ---------------------------------------------------- |
| POST   | `/api/requests`                  | Create a pending request (201)                       |
| GET    | `/api/requests`                  | `{ requests: [...] }`                                |
| GET    | `/api/requests/:id`              | One request                                          |
| GET    | `/api/identities/:label`         | `{ identity: facts or null }`; 503 without resolver  |
| POST   | `/api/requests/:id/approve`      | Confirm a grant through the signer                   |
| POST   | `/api/requests/:id/deny`         | Record denial without signing                        |
| POST   | `/api/grants/:agentLabel/revoke` | Clear that agent's ACL through the signer            |
| POST   | `/api/payments/settled`          | Report a settled payment; posts one commitment (202) |
| GET    | `/api/audit`                     | `{ entries: [...] }`, the audit feed                 |

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

## Console reference

The console polls requests every second. The password field accepts the operator token to enable Approve, Deny and Revoke. The token stays in tab memory only and
is cleared by Lock console or reload. An invalid token fails at the API; entering
one does not prove authorization. Pending transactions stay pending until the
signer returns confirmation. Confirmed Sepolia hashes link to Etherscan.

Identity facts refresh every 10 seconds and are revalidated by the server before
a grant. “ENS facts unavailable” never means the identity is verified. The request
contract has no price quote; the card explicitly reports an unavailable estimate.
The countdown uses API remaining seconds and a server-side revoke timer, not
on-chain expiry. Timed revocation requires a running service.

Browser verification uses the production UI and a separate in-memory HTTP API.
The [browser verification how-to](../docs/how-to-test-approval-console.md) describes
setup and execution. Screenshots use simulated receipts and do not verify a
real Sepolia transaction or peer cutoff.

## Live activity feed reference

The console shows a unified feed beside the queue for beats 1, 3 and 5. `GET /api/activity`
returns `{ events, sources, observedAt }`, newest first, at most 100 entries. The console
polls it every second. The endpoint is read-only and public like the other reads.

| Kind               | Source                       | Meaning                                         |
| ------------------ | ---------------------------- | ----------------------------------------------- |
| `request-received` | approval service             | An agent asked for a service                    |
| `request-denied`   | approval service             | The operator denied the request                 |
| `access-granted`   | approval service             | The grant transaction confirmed                 |
| `access-revoked`   | approval service             | The revoke confirmed (or the grant vanished)    |
| `gateway-denied`   | gateway (`statusapi`)        | The gateway blocked a call                      |
| `gateway-allowed`  | gateway (`statusapi`)        | The gateway forwarded a call                    |
| `peer-admission`   | gateway (`statusapi`)        | An admission check changed state                |
| `peer-dropped`     | gateway (`statusapi`)        | The peer left the WireGuard peer table          |
| `payment-settled`  | Hedera mirror (`/payments`)  | A testnet payment settled                       |
| `cutoff-measured`  | approval service and gateway | Time from the revoke request to the first block |

`sources` reports `ok`, `not_configured` or `unavailable` for the gateway and the payments
feed, so a missing source is visible rather than silent. Set `BRAMBLED_STATUS_URL` to the
base URL of the gateway node's `brambled/statusapi` (for example `http://127.0.0.1:7899`, the default `-status-port`).
The server reads only `GET /activity`, rejects redirects and URLs with credentials, and
times out after three seconds. It stops reading and cancels any body over 1 MB. Without the
variable the gateway source is `not_configured`.
The payments source needs `APPROVAL_PAYMENT_AGENTS` (see below).

The feed never forwards raw gateway or resolver error text, because it can contain RPC
URLs. Known gateway detail prefixes map to fixed phrases and anything else reads
"Details withheld from this view."

**Cut-off.** The measured cut-off is the first call to the revoked service that the gateway
denied with "no matching granted digest", or the first peer drop, for that agent at or
after the approval server accepted the revoke, minus that
acceptance time (`revokeRequestedAt`). The window ends if the agent is granted again. The
two timestamps come from two machines' clocks, so the number is only as accurate as their
agreement. Keep both on NTP and treat a very small result as possible clock
error. No cut-off is shown until the gateway reports a block; a revoke removed outside the
console is not measured. Other denials, such as an unknown service or a failed ACL read,
do not count.

A gateway label matches a console agent when it is that agent's bare label or
`<label>.<APPROVAL_ENS_PARENT>`. A full name under another parent never matches, and is
shown in full in the feed. Without `APPROVAL_ENS_PARENT`, only bare labels match.

The statusapi records an admission event only when the result changes, and records a
`peer` event once when a peer goes from authorized to unauthorized and is removed.

The agent payments UI is available at `/payments`. `GET /api/payments` is a
read-only testnet mirror feed attributed through `APPROVAL_PAYMENT_AGENTS`.
The panel refreshes every two seconds; the node's sidecar remains the payer.
See [`docs/16_AGENT_PAYMENTS_FLOW.md`](../docs/16_AGENT_PAYMENTS_FLOW.md) for
configuration, the automatic relay payment trigger, and verification limits.

## Audit trail (W10, demo beat 3)

The service posts one salted commitment to a Hedera Consensus Service (HCS) topic
for each confirmed grant, each confirmed revoke (manual or duration expiry) and
each settled payment, whether the mirror-node observer or `POST /api/payments/settled` reports it. The commitment format is in
`docs/16_HCS_AUDIT_RECORD_FORMAT.md`. The topic never holds plaintext.

The service captures the event while it holds the per-agent write lock, then the
post starts only after the lock is released. A slow or failed post never delays or
reverses the access decision. Each post has one feed row in `GET /api/audit`:

| Field                                                      | Meaning                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `id`, `kind`, `createdAt`, `requestId?`                    | Row ID, `grant`, `revoke` or `payment`, UTC time, the access request it belongs to         |
| `status`                                                   | `pending`, `posted` or `failed`                                                            |
| `commitment`, `topicId`, `sequenceNumber`, `transactionId` | The public receipt of a `posted` row. Build the HashScan link from them                    |
| `error`                                                    | For a `failed` row: `hcs_post_failed`, `audit_event_unavailable` or `audit_not_configured` |

A request also carries `grantAuditId` and `revokeAuditId`. The feed holds no event
field, no error text from Hedera, and no secret. A `failed` row is not retried.

- `audit_event_unavailable`: the signer returned no `serviceDigest` (ADR 0005), or the revoke
  has no matching request. The service never posts a plaintext service name instead. The real
  signer (`chain.ts`) reads the public keys and the granter key once, pins them for that grant, and
  holds the `0x`-prefixed digest before it submits. It returns that same digest when the grant is
  confirmed after a reconciliation retry or a later poll, so unreadable ENS or a changed key after
  submission cannot change or lose it. A restart loses the request-to-digest
  link, so a revoke of a grant made before the restart has no request and posts nothing.
- `audit_not_configured`: no HCS trail is set. Decisions still succeed.
- A repeated payment report with the same `txRef` returns the first row and posts nothing.
- The grant event's `expiresAt` is `0` when the request has no duration.

Payments settle in the sidecar, which does not call this service. When
`APPROVAL_PAYMENT_AGENTS` is set, the service polls the Hedera testnet mirror node every 30 seconds
(the same configuration and window as `GET /api/payments`) and posts one commitment for each
successful outgoing USDC transaction of a configured payer. Records that share a transaction ID are
netted into one payment. Only a plain transfer is committed: the payer is the only account that
pays, exactly one account receives, and it receives the payer's whole net debit. A transaction
with split payees, another payer, or a received amount that differs from the debit is not
committed; it appears once as a `failed` payment row with `audit_event_unavailable`. The first poll starts with the first request to the API route and covers the whole
`since` window; a poll that finds the mirror unavailable or incomplete posts nothing and retries.
Replays are dropped by `txRef` in memory, so a restart posts the window's payments again. Set
`since` to the start of the demo.

`POST /api/payments/settled` takes `{ payer, payee, asset, amountAtomic, txRef }` with
Hedera IDs and a decimal amount. It needs the bearer token and shares the `txRef` check with the
observer. The service trusts that reporter's claim that the payment settled.

The service keeps each opening (the event and its salt) in memory, in
`audit.opening(entryId)`. No HTTP route returns it. A restart loses the openings,
and the topic entries then stay unverifiable.

| Variable                                                | Purpose                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| `HEDERA_AUDIT_TOPIC_ID`                                 | Topic from `createAuditTopic`; unset means `audit_not_configured` |
| `HEDERA_CLIENT_ACCOUNT_ID`, `HEDERA_CLIENT_PRIVATE_KEY` | The payer that holds the topic's submit key                       |
| `HEDERA_AUDIT_NETWORK`                                  | `testnet` (default) or `previewnet`. Mainnet is not accepted      |
| `APPROVAL_ENS_PARENT`                                   | Parent name of agent labels, for example `acme.eth`; optional     |

The tests use a fake topic client. They need no network and no secret:
`pnpm --filter @bramble/approval test`.
