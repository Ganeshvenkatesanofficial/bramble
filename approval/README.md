# Approval API reference

The approval service supports demo beats 2 (request and approve) and 5 (revoke).
It runs in one long-lived Node.js process on the admin machine. The development command is
`pnpm --filter @bramble/approval dev` from the repository root. The default bind
address is loopback, port 3001. The production commands are `build` and `start`
in the same package. External access is limited to the approved tunnel topology.

The root page is the approval console. ETH-30 supplies the real signer and ENS
resolver; ETH-31 supplies the UI. The default runtime accepts requests and deny
decisions, and rejects grant/revoke operations with `503 signer_not_configured`.
Test-only in-memory adapters never enter the runtime path.

All POST requests require `Authorization: Bearer` with the shared token configured
in `APPROVAL_DEMO_TOKEN`. The API never returns the token. Reads are public and use
`Cache-Control: no-store`. The token protects this write surface; it does not
prove an agent's identity. A request is a suggestion, and only a human approver's
explicit action authorizes a grant.

| Method | Path                             | Result                                              |
| ------ | -------------------------------- | --------------------------------------------------- |
| POST   | `/api/requests`                  | Create a pending request (201)                      |
| GET    | `/api/requests`                  | `{ requests: [...] }`                               |
| GET    | `/api/requests/:id`              | One request                                         |
| GET    | `/api/identities/:label`         | `{ identity: facts or null }`; 503 without resolver |
| POST   | `/api/requests/:id/approve`      | Confirm a grant through the signer                  |
| POST   | `/api/requests/:id/deny`         | Record denial without signing                       |
| POST   | `/api/grants/:agentLabel/revoke` | Clear that agent's ACL through the signer           |

The request body is `{ agentLabel, gatewayLabel, service, note?, requestedDuration? }`.
Duration is integer seconds after grant confirmation. See ADRs 0011, 0012 and 0016 for the
contract, limits, error handling and timer limitations. Errors have the shape
`{ error: { code, message } }`. A failed or duplicate action never reports success.

`pnpm --filter @bramble/approval test` exercises the API using an in-memory
signer/resolver. These tests perform no network writes.

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
times out after three seconds. Without the variable the gateway source is `not_configured`.
The payments source needs `APPROVAL_PAYMENT_AGENTS` (see below).

The feed never forwards raw gateway or resolver error text, because it can contain RPC
URLs. Known gateway detail prefixes map to fixed phrases and anything else reads
"Details withheld from this view."

**Cut-off.** The measured cut-off is the first call the gateway denied, or the first peer
drop, for that agent at or after the approval server accepted the revoke, minus that
acceptance time (`revokeRequestedAt`). The window ends if the agent is granted again. The
two timestamps come from two machines' clocks, so the number is only as accurate as their
agreement. Keep both on NTP and treat a very small result as possible clock
error. No cut-off is shown until the gateway reports a block; a revoke removed outside the
console is not measured.

The statusapi records an admission event only when the result changes, and records a
`peer` event once when a peer goes from authorized to unauthorized and is removed.

The agent payments UI is available at `/payments`. `GET /api/payments` is a
read-only testnet mirror feed attributed through `APPROVAL_PAYMENT_AGENTS`.
The panel refreshes every two seconds; the node's sidecar remains the payer.
See [`docs/16_AGENT_PAYMENTS_FLOW.md`](../docs/16_AGENT_PAYMENTS_FLOW.md) for
configuration, the automatic relay payment trigger, and verification limits.
