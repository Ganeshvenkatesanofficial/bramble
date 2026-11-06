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

## 2026-11-06 — ETH-184 documentation closeout

Demo beats: 1–5. Reconciled recorded installer, enrollment, cloud access and
rehearsal evidence from ETH-179, ETH-250, ETH-244 and ETH-287 under the
operator's docs-only direction and cross-family review waiver. No live test,
cloud mutation, approval, payment or browser walkthrough ran for this change.
The acceptance log attributes reported observations and preserves the fresh-device
connectivity failure and other Open outcomes.

Verified: `pnpm verify` exits 0 (Turbo tasks cached), `git diff --check` is clean,
and relative file links in all three deliverables resolve. These repository checks
do not add live acceptance evidence.

Paths written:

- `README.md`
- `docs/DEMO_SCRIPT.md`
- `docs/measurements/2026-11-06-onboarding-acceptance.md`
- `docs/ai-usage/hedera-sol.md`
