# How to rehearse demo failures offline

Run the failure drills before a rehearsal. Each one injects a single failure, checks what the operator CLI, the agent and the approval console show, checks that nothing secret leaks, then checks recovery. Everything runs on loopback with in-memory chains. Nothing touches cloud nodes, Sepolia, Tor or Hedera.

```sh
pnpm install                                     # once per worktree
bun deploy/drills/drills.ts                      # all four drills
bun deploy/drills/drills.ts relay-down           # one drill by name
```

The command exits `0` when every check passes, `1` when any check fails and `2` for an unknown drill name. Each check prints `ok` or `FAIL` and, where it applies, the exact text the operator or agent sees.

**Evidence.** Verified: all 34 checks pass on 6 November 2026, 16:10 UTC, base `f201fb0`. The drills run the real code (`approval/src/lib`, `agent-mcp/src/tools.ts`, `scripts/demo/src/preflight.ts`) with fake chains and servers. They do not prove the same behavior on the cloud nodes.

## What each drill shows

| Drill              | Beat      | Failure                                                        | What the operator sees                                                                                                                                                                                                          | How it recovers                                                                                                                               |
| ------------------ | --------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `relay-down`       | 3, 4      | One rendezvous relay stops, then all, then the payment sidecar | `pnpm demo:preflight`: `WARN relay … redundant relays down: relay2`, then `FAIL relay no rendezvous relay reachable (down: relay1, relay2)`. Console `/api/activity`: `"gateway":"unavailable"`. Labels only, no address or URL | Restart the relays on the same ports: the check passes again                                                                                  |
| `approval-timeout` | 2         | Nobody decides in time                                         | Agent: `pending: no decision after 1s. Call request_private_access again to keep waiting on the same request.`                                                                                                                  | Approve the card, ask again: `granted: …`. The agent reuses the same request, so no duplicate card appears                                    |
| `approval-timeout` | 2         | Grant transaction sent, receipt late                           | Console: HTTP 202, card `approving` with its transaction. A second approve gets `409 write_unresolved`                                                                                                                          | The late receipt settles the card to `approved` without resending                                                                             |
| `approval-timeout` | 2         | RPC call times out                                             | Console: `502 grant_failed: The signer did not confirm the grant.` The service log keeps the cause, with the RPC URL replaced by `<url>`                                                                                        | The card stays `pending`. Approve again once the RPC answers                                                                                  |
| `expired-grant`    | 5         | A timed grant ends but the revoke write fails                  | Console card stays `approved` with `expiryStatus: failed`. The grant is still on chain                                                                                                                                          | The server timer retries every 5 s and revokes (`revokeReason: duration`). A new request waits for a human, and a fresh approval grants again |
| `wrong-tailnet`    | 2 (join)  | A device asks to join another tailnet                          | Join API: `400 wrong_tailnet: This service manages another tailnet.` No queue card. The answer does not name the managed tailnet                                                                                                | The same device with the right tailnet is queued (`201 pending`)                                                                              |
| `wrong-tailnet`    | preflight | A sidecar serves another tailnet                               | `FAIL sidecar:gateway … sidecar serves tailnet other.eth, expected mesh.eth`                                                                                                                                                    | The corrected sidecar passes                                                                                                                  |

Every drill also checks that no output holds the operator token, the RPC URL, its credential or a private key.

## Limits

- **Read from source, not run:** the `bramble` launcher (`node-daemon`) shows a refused join as `The approval service refused the request: <message>` (`node-daemon/internal/daemon/daemon.go`). For a wrong tailnet that is the `wrong_tailnet` message above.
- **Open:** the gateway's own reaction to a relay outage (fallback to the data relay, beat 4) is a Go path in `brambled`. These drills cover only the preflight and console views of it.
- **Open:** the console UI rendering. The drills check the API answers the console displays, not the browser page.
- During a real expiry failure the grant stays live until the retry succeeds. Watch for `expiryStatus: failed` on the card and revoke by hand if the retry keeps failing.
