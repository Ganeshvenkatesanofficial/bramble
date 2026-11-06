# Approval API reference

**Kind:** Reference
**Describes:** the `approval/` package as merged into `hackathon` (PR #11, ETH-29). Source: `approval/src/lib/{contracts,validation,api,service}.ts`.
**Status:** Describes the code, not an accepted design. ADR 0012 and ADR 0016 are drafts, and a human approver is pending for both.
**Demo beats:** 2 (request and approve) and 5 (revoke).

## Endpoints

| Method | Path                             | Auth  | Result                                                                      |
| ------ | -------------------------------- | ----- | --------------------------------------------------------------------------- |
| `POST` | `/api/requests`                  | token | Create a pending request. Returns `201`.                                    |
| `GET`  | `/api/requests`                  | none  | `{ "requests": [...] }`, all requests in memory.                            |
| `GET`  | `/api/requests/:id`              | none  | One request. `404 request_not_found` if unknown.                            |
| `POST` | `/api/requests/:id/approve`      | token | Grant through the signer. Returns the request with `grantTransaction`.      |
| `POST` | `/api/requests/:id/deny`         | token | Record the denial. No signing.                                              |
| `POST` | `/api/grants/:agentLabel/revoke` | token | Clear that agent's ACL grants through the signer. No request id is needed.  |

Reads send `Cache-Control: no-store`.

## Request body

`POST /api/requests` takes `application/json`.

| Field               | Type    | Rule                                                                                         |
| ------------------- | ------- | -------------------------------------------------------------------------------------------- |
| `agentLabel`        | string  | Required. Lowercase ENS label, 1–63 characters (`[a-z0-9-]`, no leading or trailing hyphen). |
| `gatewayLabel`      | string  | Required. Same rule.                                                                         |
| `service`           | string  | Required. Symbolic name, `^[a-z][a-z0-9_-]{0,63}$`. Never a host or port.                    |
| `note`              | string  | Optional. At most 2000 characters.                                                           |
| `requestedDuration` | integer | Optional. Seconds after the grant confirms, 1 to 86400. See [Duration](#duration).           |

The service rejects unknown fields, a body over 16384 bytes, and any content type other than `application/json`.

## Request record

Every response that carries a request has these fields.

| Field                 | Type   | Meaning                                                                                  |
| --------------------- | ------ | ---------------------------------------------------------------------------------------- |
| `id`                  | string | Random UUID.                                                                             |
| `status`              | string | See [Status values](#status-values).                                                     |
| `createdAt`           | string | UTC timestamp.                                                                           |
| `decidedAt`           | string | Set on approve or deny.                                                                  |
| `grantTransaction`    | object | `{ transactionHash }`. Set when the signer confirms the grant.                           |
| `revokeTransaction`   | object | `{ transactionHash }`. Set only when the signer confirms a revoke. Absent otherwise.     |
| `revokedAt`           | string | UTC timestamp. Set when the service marks the request `revoked`.                         |
| `revokeReason`        | string | `manual`, `duration` or `external`. See [Status values](#status-values).                 |
| `expiresAt`           | string | UTC timestamp. Set on approval when `requestedDuration` was given.                       |
| `serverTime`          | string | UTC timestamp of the response.                                                           |
| `remainingSeconds`    | number | Nonnegative seconds to `expiresAt`, or null without a duration.                          |
| `durationMode`        | string | `server-timer` when a duration was given, otherwise null.                                |
| `expiryStatus`        | string | `none`, `scheduled`, `revoking`, `failed` or `revoked`.                                  |

## Status values

| Status      | Meaning                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `pending`   | Waiting for a human.                                                                                                                            |
| `approving` | The signer is writing the grant. Returns to `pending` if the write is not confirmed.                                                            |
| `approved`  | The signer confirmed the grant transaction.                                                                                                     |
| `denied`    | A human denied the request. Terminal.                                                                                                           |
| `revoking`  | The signer is writing the revoke. Returns to `approved` if the write is not confirmed.                                                          |
| `revoked`   | The agent has no grant, by one of the paths in the next table. Terminal.                                                                        |

`revoked` does not always mean this service sent a revoke transaction. `revokeReason` and `revokeTransaction` tell the paths apart.

| `revokeReason` | How the request reaches `revoked`                                                                                       | `revokeTransaction` |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `manual`       | A human calls the revoke endpoint and the signer confirms.                                                              | Set                 |
| `duration`     | The expiry timer calls the same revoke path and the signer confirms.                                                    | Set                 |
| `duration`     | The expiry timer fires, a fresh ACL read shows no grant, and the service marks the request revoked without a signer call. | Absent              |
| `external`     | A later approve for the same agent reads an empty ACL, so the service retires the older `approved` request.             | Absent              |

A client shows a transaction link only when `revokeTransaction` is present.

## Duration

Duration is a server-side timer, not a chain feature. The ACL records in ADR 0005 hold no expiry.

- A pending request never starts a timer.
- On a confirmed approval with `requestedDuration`, the service sets `expiresAt` and schedules a revoke after that many seconds.
- When the timer fires, it runs the revoke path. If the signer fails, the request stays `approved`, `expiryStatus` becomes `failed`, and the service retries every 5 seconds while the process runs.
- A timer that meets an in-progress write for the same agent retries after 5 seconds.
- A manual revoke cancels the timer.
- The timer lives in process memory. A restart drops every request and every timer, and the grant stays on chain.
- Reaching zero means the service attempts a revoke. It does not mean chain access has ended. Check `expiryStatus` and `revokeTransaction`.

A human still approves every grant. A duration does not approve anything.

## Writes and authentication

Every `POST` requires `Authorization: Bearer <token>`, compared in constant time with the `APPROVAL_DEMO_TOKEN` environment variable. If the variable is unset, writes fail with `503 token_not_configured`. A wrong or missing token returns `401 unauthorized`. The service never returns or logs the token. Reads need no token.

The token gates the write surface. It does not prove who the agent is, and it does not authorize a grant. The service never auto-approves. Before approving, it re-reads the agent's and the gateway's ENS identity through the resolver and requires an active identity with a published public key.

## Errors

Errors use `{ "error": { "code": "<snake_case>", "message": "<text>" } }`.

| Status   | Code                                             | When                                                                  |
| -------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| 400      | `invalid_request`, `invalid_json`                | Body or field fails validation.                                       |
| 401      | `unauthorized`                                   | Wrong or missing token.                                               |
| 404      | `request_not_found`, `route_not_found`           | Unknown id or path.                                                   |
| 409      | `request_not_pending`                            | Approve or deny on a request that already left `pending`.             |
| 409      | `already_granted`                                | The agent already has a grant, so a second approve is refused.        |
| 409      | `identity_not_active`                            | Agent or gateway has no active ENS identity with a published key.     |
| 409      | `not_granted`                                    | Revoke for an agent with no grant.                                    |
| 409      | `operation_in_progress`                          | Another write for the same agent is running.                          |
| 413, 415 | `request_too_large`, `unsupported_media_type`    | Body size or content type.                                            |
| 502      | `grant_failed`, `revoke_failed`                  | The signer did not confirm.                                           |
| 503      | `signer_not_configured`, `token_not_configured`  | Missing runtime configuration.                                        |

A double approve, or a revoke of an ungranted agent, returns a 409 before any signer call. A failed or duplicate action never reports success.

## Verification status

- **Verified:** on 6 November 2026, at `origin/hackathon` `2403c62`, `pnpm --filter @bramble/approval test` passes 21 tests with 177 assertions (Bun 1.4.0). The tests use the in-memory signer and resolver.
- **Read from source:** every value above comes from `approval/src/lib` on `hackathon`.
- **Open:** the 2 s visibility target against a running service and a real signer.
