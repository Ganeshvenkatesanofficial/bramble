# AI Usage

This project was built with AI assistance (Claude Code and OpenAI Codex) throughout research, design, review, and implementation. This file points to where that process is recorded, per the event's spec-driven-development transparency requirement — the goal is that a reader can see how the project was directed, not just the resulting code.

- **`docs/00_START_HERE.md` through `docs/11_SOURCE_NOTES.md`** — the working spec, written and iterated on with AI assistance from Day 0 onward, before most product code existed.
- **`docs/adr/`** — individual design decisions, with rationale, made during the build.
- **`docs/11_SOURCE_NOTES.md`** — a research log: partner-workshop findings reconciled against the spec, including contradictions found and how they were resolved, and implementation-time findings (e.g. a docs-vs-deployed-bytecode mismatch caught while validating Gate 0.3).
- **`docs/sources/`** — cleaned transcripts of the two partner workshops used as primary research input.
- **`scripts/gate0.3-eac-check/`** — a validation script (not production code) used to empirically verify a Day-0 feasibility gate against the live hackathon ENSv2 deployment; see its README.

AI assistance also covered implementation and tests, not only the planning documents. In particular, it was used to draft, revise, and review code in:

- **`brambled/` and `relay/`** — WireGuard admission, service gateway, rendezvous/data relay, payment selection, failover, and their Go tests (for example `brambled/admission/loop.go`, `brambled/gateway/acl.go`, `relay/datarelay.go`).
- **`sidecar/src/` and `relay-sidecar/src/`** — ENSv2 resolution/discovery, x402 Hedera client and resource-server flows, and their TypeScript tests (for example `sidecar/src/ens/client.ts`, `sidecar/src/payments/datarelay.ts`, `relay-sidecar/src/routes/datarelay.ts`).
- **`admincli/src/`** — EAC enrollment and role/ACL commands, Ledger signing and Key Ring integration, and their tests (for example `admincli/src/enroll.ts`, `admincli/src/ledger-eth-sign.ts`, `admincli/src/set-acl.ts`).
- **`dashboard/`** — the read-only application UI and API routes.

The team directed the architecture and scope, operated the physical Ledger and live test infrastructure, submitted real testnet transactions, checked resulting chain state, and reviewed generated or AI-assisted changes. The commit history and linked gate/runbook evidence show the progression.

Per-track attribution and involvement narrative for the submission dashboard is written separately by the team, not duplicated here.

## Mumbai approval API (ETH-29)

Core-Sol (OpenAI Codex), committing as Core-Sol (agent, Yash Kolekar) through
the `whyash-paperclip` commit account,
implemented `approval/` and its API tests from ETH-29. AI assistance also covered
`pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.prettierignore`, `eslint.config.js`,
this file, `approval/README.md`, and the duration draft
`docs/adr/0016-approval-duration.md`. Core-Sol removed its duplicate placement
and request-contract drafts; Hedera-Claude owns ADRs 0011 and 0012 in ETH-55.
Core-Sol integrated Astra's ETH-75 formatting correction without changing the
vendored skill trees.
The task defines the public HTTP test seam and separates real signing into ETH-30.
Human ADR approval and live testnet verification remain required.

## Mumbai formatting gate correction (ETH-75)

On 6 November 2026 IST, Astra (OpenAI Codex) updated exactly `.prettierignore` and `docs/AI_USAGE.md` on a branch from `hackathon` commit `3bec957e435283617d44499f13c83eaabf884edc`. The commit account is `Astra (agent, Yash Kolekar) <153986822+whyash-paperclip@users.noreply.github.com>`.

- **Read from source:** Atlas directed the narrow remedy: exclude the vendored `.agents/skills/` and `.claude/skills/` trees from Prettier. Their contents stay unchanged. This restores the baseline gate needed to validate demo beats 1–6.
- **Verified:** Before the correction, Prettier 3.9.6 rejected `code-review/agents/openai.yaml` in both trees. `pnpm install --frozen-lockfile` passed with pnpm 10.33.3.
- **Verified:** `pnpm format:check` passes, and `git diff --exit-code hackathon -- .agents/skills .claude/skills` confirms both skill trees are unchanged.
- **Verified:** With Node.js 24.15.0, Bun 1.4.0 and Go 1.27.3, `pnpm verify` passes formatting, endpoint and local-state checks, typechecking, linting and builds. Its test stage fails in `sidecar/test/devices.test.ts`: the public Sepolia RPC returns code 4444, `pruned history unavailable`, for `eth_getLogs`. The same test fails with the original `.prettierignore`, independently of this correction.
- **Open:** A complete `pnpm verify` pass requires a Sepolia RPC that serves the fixture registry's historical logs. Push and PR creation remain gated on that pass, followed by Core-Claude cross-family approval.

## ETH-29 continuation evidence

Read from source: Atlas permits ETH-29 to push with only the two demonstrated
baseline test failures (ETH-86), compared against `hackathon` at `3bec957`.
No dedicated archive RPC is requested; ETH-86 owns deterministic scan fixtures
and the relay failure investigation. This supersedes the historical endpoint
and push-blocking notes in the ETH-75 evidence above for ETH-29.

### ETH-34 — agent payments panel (Core-Sol)

- Agent: Core-Sol; commit identity follows the repository's configured git author.
- Task/spec: ETH-34 and `docs/14_MUMBAI_BUILD_BRIEF.md` W3, superseded where
  applicable by `docs/15_MUMBAI_HANDOFF.md`; demo beat 3.
- Prompt: inspect real rendezvous/data-relay purchase timing, reuse the read-only
  mirror feed server-side in approval, show payer/caps/spend/remaining/HashScan,
  verify fixtures and record live verification gaps. Preserve dashboard's boundary.
- Agent-written paths: `approval/src/lib/payments.ts`,
  `approval/src/app/api/payments/route.ts`, `approval/src/app/layout.tsx`,
  `approval/src/app/globals.css`, `approval/src/app/payments/page.tsx`,
  `approval/src/components/payments-panel.tsx`, `approval/test/payments.test.ts`,
  `approval/test/fixtures/payments.json`, `approval/README.md`,
  `docs/16_AGENT_PAYMENTS_FLOW.md`, `docs/AI_USAGE.md`.
- Human decisions remain the handoff's invariants and H4 approval of the public
  UI. Agent choices: dedicated payer attribution, fixed reporting window,
  advisory budget, separate per-payment cap and fail-closed incomplete totals.
