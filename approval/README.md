# Approval API reference

The approval service supports demo beats 2 (request and approve) and 5 (revoke).
It runs in one long-lived Node.js process on the admin machine. Run
`pnpm --filter @bramble/approval dev` from the repository root. The default bind
address is loopback, port 3001. The production commands are `build` and `start`
in the same package. Expose it only through the approved tunnel topology.

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

The console polls requests every second. Enter the operator token in the password
field to enable Approve, Deny and Revoke. The token stays in tab memory only and
is cleared by Lock console or reload. An invalid token fails at the API; entering
one does not prove authorization. Pending transactions stay pending until the
signer returns confirmation. Confirmed Sepolia hashes link to Etherscan.

Identity facts refresh every 10 seconds and are revalidated by the server before
a grant. “ENS facts unavailable” never means the identity is verified. The request
contract has no price quote; the card explicitly reports an unavailable estimate.
The countdown uses API remaining seconds and a server-side revoke timer, not
on-chain expiry. Keep the service running for timed revocation.

`pnpm --filter @bramble/approval build` followed by
`pnpm --filter @bramble/approval test:ui` runs browser checks at 1280 and 390 pixels.
Install Chromium once with `pnpm --filter @bramble/approval exec playwright install chromium`
if needed. The harness starts the production UI on loopback port 3001 and a
separate in-memory API proxy on 3101. Both ports must be free. No test adapter is
imported by the runtime. Screenshots live in ignored `test-results/` and use
simulated receipts. They do not verify a real Sepolia transaction or peer cutoff.
