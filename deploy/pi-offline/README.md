# Replay the offline Pi operator route

Run this rehearsal from the repository root with Bun 1.4 and pnpm 10.33.3:

```sh
pnpm install --frozen-lockfile --offline
bun test deploy/pi-offline/replay.test.ts
```

If the pnpm store is empty, run `pnpm install --frozen-lockfile` first. The replay
itself needs no network access beyond loopback. It binds three ephemeral ports to
`127.0.0.1` and closes them after the test. It accepts no provider URL, credential
file, cloud host, or operator environment configuration. All auth strings and
identities are synthetic fixture values.

Check the exit code. Exit 0 and `1 pass / 0 fail` indicate a passing replay. Any
failed assertion exits nonzero. Run the same command again to rehearse from fresh
in-memory state.

## Pass/fail transcript

Verified locally on 6 November 2026 with Bun 1.4.0:

```text
PASS 1 denied: call_private_service /task
PASS 2 request: pending; service still denied
PASS diagnostic: missing/wrong auth = 401; authenticated unknown POST = 404; no state change
PASS 3 approve: operator route approves; agent observes granted
PASS 4 success: call_private_service returns fixture task
PASS 5 revoke: operator route revokes fixture grant
PASS 6 denied: next call_private_service is denied
PASS boundary: operator auth absent from agent inputs/results and request HTTP payloads
PASS offline replay; cloud Pi/payment/HCS/Tor acceptance remains OPEN
1 pass
0 fail
```

The replay also asserts that wrong operator auth cannot approve a pending request
or revoke an approved request. The diagnostic uses POST, since an open GET cannot
establish write authentication. The unknown POST returns 401 before route lookup
with missing/wrong auth, and 404 after authentication with valid fixture auth.
Neither probe changes the pending request or forward state.

## Reuse and scope

The replay imports `createTools` from `agent-mcp/src/tools.ts` and reuses
`startApprovalStub` and `startForwardStub` from `agent-mcp/test/stubs.ts`. Only the
operator HTTP adapter is new. Its approve/revoke routes change those fixtures;
they do not call an approval provider or sign anything. The adapter models one
agent, one service, and immediate in-memory decisions. It follows the
authentication-before-POST-routing order in `approval/src/lib/api.ts`.

The request stub uses a different synthetic auth value from the operator route.
The replay checks actual tool inputs/results, agent request HTTP headers/bodies,
and stored request bodies for the operator value. This establishes the fixture
payload boundary. It does not establish production credential separation: the
real MCP configuration still has its own approval token. No Pi model, launcher,
MCP transport, backend credential, or production operator runtime runs here.

For existing enforcement coverage, run the read-only fixture command:

```sh
pnpm --filter @bramble/agent-mcp test:access-flow
```

That test covers the lifecycle over loopback userspace WireGuard with in-memory
chain adapters. This replay adds the operator-route diagnostic and payload
boundary; it does not duplicate the WireGuard fixture.

Read from source: the [ETH-243 attempt report](/ETH/issues/ETH-243#document-pi-isolated-w2)
records successful Pi denial/request and operator HTTP 401. Its latest handoff
uses a separate operator process after infrastructure explicitly releases the
running pair. This local replay does not probe that route or repair credentials.

Open: two isolated cloud Pi sequences, real payment/Hedera Consensus Service
evidence, Tor behavior, and measured gateway revocation remain live acceptance
work. [ETH-244](/ETH/issues/ETH-244) retains the cloud slot, then
[ETH-243](/ETH/issues/ETH-243), then [ETH-271](/ETH/issues/ETH-271).
Keep the cloud handoff gate in place. This rehearsal supports demo beats 1, 2,
3's task-result portion, and 5 only.
