# Approval API reference

The approval service supports demo beats 2 (request and approve) and 5 (revoke).
It runs in one long-lived Node.js process on the admin machine. Run
`pnpm --filter @bramble/approval dev` from the repository root. The default bind
address is loopback, port 3001. The production commands are `build` and `start`
in the same package. Expose it only through the approved tunnel topology.

This package contains the API only. ETH-30 supplies the real signer and ENS
resolver; ETH-31 supplies the UI. The default runtime accepts requests and deny
decisions, and rejects grant/revoke operations with `503 signer_not_configured`.
Test-only in-memory adapters never enter the runtime path.

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
| POST   | `/api/requests/:id/approve`      | Confirm a grant through the signer                   |
| POST   | `/api/requests/:id/deny`         | Record denial without signing                        |
| POST   | `/api/grants/:agentLabel/revoke` | Clear that agent's ACL through the signer            |
| POST   | `/api/payments`                  | Report a settled payment; posts one commitment (202) |
| GET    | `/api/audit`                     | `{ entries: [...] }`, the audit feed                 |

The request body is `{ agentLabel, gatewayLabel, service, note?, requestedDuration? }`.
Duration is integer seconds after grant confirmation. See ADRs 0011, 0012 and 0016 for the
contract, limits, error handling and timer limitations. Errors have the shape
`{ error: { code, message } }`. A failed or duplicate action never reports success.

`pnpm --filter @bramble/approval test` exercises the API using an in-memory
signer/resolver. These tests perform no network writes.

## Audit trail (W10, demo beat 3)

The service posts one salted commitment to a Hedera Consensus Service (HCS) topic
for each confirmed grant, each confirmed revoke (manual or duration expiry) and
each settled payment reported to `POST /api/payments`. The commitment format is in
`docs/16_HCS_AUDIT_RECORD_FORMAT.md`. The topic never holds plaintext.

The post starts after the signer confirms and runs outside the per-agent write
lock. A slow or failed post never delays or reverses the access decision. Each
post has one feed row in `GET /api/audit`:

| Field                                                      | Meaning                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `id`, `kind`, `createdAt`, `requestId?`                    | Row ID, `grant`, `revoke` or `payment`, UTC time, the access request it belongs to         |
| `status`                                                   | `pending`, `posted` or `failed`                                                            |
| `commitment`, `topicId`, `sequenceNumber`, `transactionId` | The public receipt of a `posted` row. Build the HashScan link from them                    |
| `error`                                                    | For a `failed` row: `hcs_post_failed`, `audit_event_unavailable` or `audit_not_configured` |

A request also carries `grantAuditId` and `revokeAuditId`. The feed holds no event
field, no error text from Hedera, and no secret. A `failed` row is not retried.

- `audit_event_unavailable`: the signer returned no `serviceDigest` (ADR 0005), or the revoke
  has no matching request. The service never posts a plaintext service name instead.
- `audit_not_configured`: no HCS trail is set. Decisions still succeed.
- A repeated payment report with the same `txRef` returns the first row and posts nothing.
- The grant event's `expiresAt` is `0` when the request has no duration.

`POST /api/payments` takes `{ payer, payee, asset, amountAtomic, txRef }` with
Hedera IDs and a decimal amount. It needs the bearer token. The service trusts the
reporter that the payment settled; it does not read the mirror node.

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
