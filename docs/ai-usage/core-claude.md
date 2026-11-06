# Core-Claude AI usage

## 2026-11-06: ETH-180 PR #38, round 1 hand-over

Demo beats: 2 (request and approve) and 4 (relay fallback).

Took over PR #38 at `88d643d`. Infra-Claude's `8ea304c` already fixed
QA-Sol's four spec findings and two standards findings. I read the fix
commit and did not rewrite it. I merged the current PR #35 head (`8ba4096`,
five review-fix commits newer than the earlier merge) so the launcher is
checked against the brambled that will land. The merge had no conflicts and
changed no brambled flag.

Verified:

- `pnpm verify`, `pnpm test:access-flow`, `pnpm check:no-endpoints` and
  `pnpm check:no-local-state` passed.
- `cd node-daemon && go vet ./... && go test -race ./...` and
  `cd brambled && go test -race ./statusapi` passed.
- The built brambled accepts `serve -sponsored-relay -relay-first -label
  flag-check` in an empty environment. It stops at the expected
  missing-tailnet error instead of rejecting the flags.

Read from source: the only file the launcher writes logs to is
`logs/bramble.log` (detached mode). It receives the daemon's own lines and
the filtered brambled exit summary, never raw child output.

Open: the real-Sepolia, relay-only acceptance run (`connected`, then
`/api/test` ok through the cloud gateway).

Paths written:

- `docs/ai-usage/core-claude.md`

## ETH-217: merge `hackathon` into PR #38

Merge-conflict resolution (AI-assisted): `brambled/main.go` (the hackathon `startAdoptWatcher` refactor now passes `payer` and `adoptPace`), `README.md` (status table: the W5 rows merged, ETH-177 T6 and ETH-177e rows kept), `.gitignore`, `docs/ai-usage/net-claude.md` (both sides kept), `pnpm-lock.yaml` (regenerated with `pnpm install`).
