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

## Earlier entries from `hackathon`

- ETH-35 (live activity feed, beats 1, 3 and 5): `approval/src/lib/activity.ts`, `approval/src/lib/explorer.ts`, `approval/src/lib/payments-handler.ts`, `approval/src/hooks/use-activity.ts`, `approval/src/components/activity-feed.tsx`, `approval/src/components/approval-console.tsx`, `approval/src/components/request-card.tsx`, `approval/src/lib/{api,service,contracts,console-api}.ts`, `approval/src/app/api/{[...path],payments}/route.ts`, `approval/src/app/globals.css`, `approval/test/activity.test.ts`, `approval/test/fixtures/activity-status.json`, `approval/e2e/{console.spec.ts,memory-server.ts}`, `approval/README.md`, `brambled/statusapi/{server.go,server_test.go,activity_contract_test.go}`, `dashboard/README.md`, `docs/how-to-test-approval-console.md` and this file. AI-assisted (Core-Claude). The feed adds read-only HTTP reads and no write path. Human H4 screenshot approval and a live two-machine cut-off measurement are still required.
- ETH-223 (PR #24 review round 1 fixes): `approval/src/lib/activity.ts`, `approval/src/lib/api.ts`, `approval/test/activity.test.ts`, `approval/e2e/memory-server.ts`, `approval/README.md`, `docs/how-to-test-approval-console.md` and this file. AI-assisted (Core-Claude).
