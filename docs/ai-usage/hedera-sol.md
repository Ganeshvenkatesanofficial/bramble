# Hedera-Sol AI usage

## 2026-11-06 — ETH-180 round-1 fix verification

Demo beats: 2 (request and approve) and 4 (relay fallback).

Continued PR #38 from `8ea304c` in an isolated worktree. Infra-Claude's
existing commit contains all four spec fixes and both documentation fixes
from QA-Sol's first review. Reused those changes without rewriting them.

Verified:

- `pnpm verify` passed, including cached Turbo tasks.
- `pnpm test:access-flow` passed with an uncached Go access test and MCP
  lifecycle test. This exercises in-memory ENS and loopback WireGuard.
- `cd node-daemon && go test -race ./...` passed.
- The built `brambled` accepts `serve -sponsored-relay -relay-first -label
  review-device` with an isolated environment. It reaches the expected
  missing-tailnet configuration error instead of rejecting the flags.

Read from source: child output stays in memory; the crash summary excludes
admission, gateway and authorization lines. Leave invalidates late join
responses. The launcher reads ENS-discovered relay hosts from `/relays`.
README W5 and the invalid-config reference now describe the implementation.

Open: the mock-join-API plus real-Sepolia relay-only acceptance run. Local
checks do not establish `connected` or a successful `/api/test` against the
cloud gateway. PR #35 is still open and remains the merge dependency.

Paths written:

- `docs/ai-usage/hedera-sol.md`

## ETH-243 Pi launcher continuation

Demo beats: 1, 2, 3 and 5. Continued PR #42 from `7c0b8fe` in an isolated worktree.

Paths written:

- `deploy/scripts/pi-agent.sh`
- `agent-mcp/test/pi-launcher.test.ts`
- `agent-mcp/PI.md`
- `agent-mcp/PI_SECURITY.md`
- `agent-mcp/REFERENCE.md`
- `deploy/README.md`
- `docs/ai-usage/hedera-sol.md`

The launcher check reproduced the overwritten skill-path failure before the fix.
Verified on 6 November 2026: both focused launcher tests, shell syntax checks,
`git diff --check`, and `pnpm verify` pass (34 agent-mcp tests).
Clean worker sequence remains Open pending the ETH-244 node handoff.

## ETH-243 isolated cloud attempt

Demo beats: 1, 2, 3 and 5. Verified the stopped-node handoff, deployed the
reviewed launcher and workflow, and ran the initial deny call and Pi prompt.
The gateway confirmed a missing grant. Pi requested `task`; the operator POST
failed with HTTP 401. No grant was approved. Both nodes, the Pi process and its
MCP child, and the worker approval tunnel were stopped. Two full runs remain Open.

Paths written:

- `agent-mcp/PI.md`
- `deploy/README.md`
- `docs/ai-usage/hedera-sol.md`
- `/home/anonjr/bramble-work/status/eth-243/isolated-w2.py`
- `/home/anonjr/bramble-work/status/eth-243/isolated-w2/` (timings and Pi output)
- `/home/anonjr/bramble-work/status/eth-243-isolated-docs-verify.log`
- Worker: `/home/agent/bin/pi-agent`
- Worker: `/home/agent/.pi/agent/skills/bramble-private-service/SKILL.md`

## ETH-243 authentication check after operator release

Demo beats: 2, 3 and 5. Verified both node services inactive with MainPID 0.
Reopened only the worker approval tunnel, confirmed the same pending request,
and reproduced HTTP 401 on a protected GET and a nonexistent POST with the
authorized worker file passed directly into the HTTP header. Neither node
service was started. No request, grant, credential or service configuration
changed. Closed the temporary tunnel and verified its listener absent.

Paths written:

- `agent-mcp/PI.md`
- `deploy/README.md`
- `docs/ai-usage/hedera-sol.md`

Additional local evidence paths written in this wake:

- `/home/anonjr/bramble-work/status/eth-243-release-auth-verify.log`
- `/home/anonjr/bramble-work/status/eth-243-release-auth-receipts.json`
- `/home/anonjr/.cache/agent-tmp/eth-243-post-release-handoff.md` (handoff references the saved task report)
