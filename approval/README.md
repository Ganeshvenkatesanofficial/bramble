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

The agent payments UI is available at `/payments`. `GET /api/payments` is a
read-only testnet mirror feed attributed through `APPROVAL_PAYMENT_AGENTS`.
The panel refreshes every two seconds; the node's sidecar remains the payer.
See [`docs/16_AGENT_PAYMENTS_FLOW.md`](../docs/16_AGENT_PAYMENTS_FLOW.md) for
configuration, the automatic relay payment trigger, and verification limits.
