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
