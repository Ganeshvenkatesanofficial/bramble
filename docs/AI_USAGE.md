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
- **`admincli/src/lib.ts`, `admincli/src/lib-viem.ts`, `admincli/src/lib.test.ts`** — written by the Core-Claude agent (ETH-28) during the Mumbai build: importable grant/revoke functions extracted from `set-acl.ts`, `revoke-acl.ts` and `revoke.ts`, the viem-backed `Resolver`/`Signer`, and in-memory unit tests. The same change rewrote `admincli/src/set-acl.ts`, `revoke-acl.ts` and `revoke.ts` as thin wrappers and removed `admincli/src/acl-grant.ts`.
- **`dashboard/`** — the read-only application UI and API routes.

The team directed the architecture and scope, operated the physical Ledger and live test infrastructure, submitted real testnet transactions, checked resulting chain state, and reviewed generated or AI-assisted changes. The commit history and linked gate/runbook evidence show the progression.

Per-track attribution and involvement narrative for the submission dashboard is written separately by the team, not duplicated here.

## Mumbai W8a: STUN endpoint discovery

Net-Astra (OpenAI Codex) implemented and tested `brambled/stun/message.go`,
`brambled/stun/bind.go`, `brambled/stun/bind_test.go`, `brambled/wgnode/node.go`,
`brambled/wgnode/stun.go`, `brambled/main.go`, `brambled/statusapi/server.go`, and
`brambled/statusapi/stun_test.go`. Documentation changes cover `README.md`,
`brambled/README.md`, `docs/AI_USAGE.md`, and `docs/eth-36-stun-spec.md`.
Commits use `Net-Astra (agent, Jay Kerkar)` with
`133675904+jaykerkar0405@users.noreply.github.com` and the Paperclip co-author.
The human-authored W8 task and Mumbai handoff set the scope and invariants.

Net-Claude (Anthropic Claude) took over W8a after Net-Astra reached a provider limit. It reviewed and committed the opt-in bind wrapper in `brambled/stun/bind.go`, `brambled/stun/bind_test.go`, `brambled/wgnode/node.go`, `brambled/wgnode/stun.go`, `brambled/main.go`, `brambled/statusapi/stun_test.go`, `brambled/README.md` and `docs/eth-36-stun-spec.md`, and ran the checks. After review (ETH-89) it replaced the shared-endpoint `ClearSrc` call with a fresh endpoint per send and wrote `docs/adr/0017-stun-bind-wrapper-source-selection.md`.
Net-Claude commits as `Net-Claude (agent, Chaitanya Kelkar)` with `chaitanyakelkar07@gmail.com` and the Paperclip co-author.

## Mumbai agent-written paths

Baseline: commit `28e2a8f`, tag `pre-mumbai`. Agents wrote the paths below after that commit. Each agent adds a row in the same pull request as the work. List paths, not prose. Humans approve every ADR and merge to `main`.

### Accounts

Each agent commits under the git identity shown here. Confirm yours with `git config user.name` before your first commit.

| Agent | Lane | Commit author name | Status |
| --- | --- | --- | --- |
| Core-Claude | Core and console | `Core-Claude (agent, Jay Kerkar)` | Verified from `GIT_AUTHOR_NAME` on 6 Nov 2026 |
| Core-Sol | Core and console (cross-family reviewer) | to be added by Core-Sol | Open |
| Net-Claude | Network (W8a STUN) | `Net-Claude (agent, Chaitanya Kelkar)` | Verified from commit authorship on `net-claude/eth-36-stun-binding` |
| Other lane agents | Network, Tor, Hedera, Demo and infra | to be added by each agent | Open |

### Paths

| Path | Ticket | Agent | Kind |
| --- | --- | --- | --- |
| `README.md` ("Pre-existing vs new", "CROPS" skeleton) | ETH-27 | Core-Claude | Documentation |
| `docs/AI_USAGE.md` (this section) | ETH-27 | Core-Claude | Documentation |
| `scripts/demo/src/*.ts`, `scripts/demo/package.json`, `scripts/demo/tsconfig.json` | ETH-50 | Core-Claude | Code and unit tests (launcher, preflight, probe, reset) |
| `scripts/demo/README.md` | ETH-50 | Core-Claude | Documentation |
| `package.json` (`demo`, `demo:preflight`, `demo:reset` scripts), `pnpm-workspace.yaml`, `pnpm-lock.yaml` | ETH-50 | Core-Claude | Configuration |
| `brambled/stun/`, `brambled/wgnode/stun.go`, `brambled/statusapi/stun_test.go`, `docs/eth-36-stun-spec.md`, `docs/adr/0017-stun-bind-wrapper-source-selection.md` | ETH-36 | Net-Astra, Net-Claude | Code, tests, documentation |
