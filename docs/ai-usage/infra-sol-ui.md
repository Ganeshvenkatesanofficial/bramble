# Infra-Sol-UI assistance

## ETH-47: HCS mirror verification panel (beat 3)

Infra-Sol-UI implemented `approval/src/lib/audit-verification.ts`, `approval/src/lib/audit-fixture.ts`, `approval/src/fixtures/hcs-audit.json`, `approval/src/components/hcs-panel.tsx`, `approval/src/app/audit/fixtures/page.tsx`, `approval/test/audit-verification.test.ts`, and `approval/e2e/audit.spec.ts`. It changed `approval/src/lib/api.ts`, `approval/src/components/approval-console.tsx`, `approval/src/app/globals.css`, `approval/tsconfig.json`, `agent-mcp/tsconfig.json`, and `approval/README.md`.

The agent used the merged HCS record format and verifier. A Python standard-library script independently calculated the synthetic HMAC fixtures. No signing, keys, mainnet activity or live Hedera submission was involved. Humans retain the H4 screenshot approval and design checkpoints.

## ETH-251: demo scripts and rehearsal (beats 1, 2, 3 and 5)

- Wrote `docs/DEMO_SCRIPT.md`: three- and six-minute scripts, sponsor narration, rehearsal, recovery and conditional installer acceptance. Read repository sources and ETH-205/ETH-244 timing comments; did not run cloud lifecycle actions or inspect secrets.
- Appended `docs/ai-usage/infra-sol-ui.md` to record these paths.

- Addressed round-1 findings in `docs/DEMO_SCRIPT.md`: full-lifecycle warmup evidence, more operating time with a pre-created pending request, action-relative stall deadlines, Tor attribution, preflight probes, installer link and rehearsal/startup cost. Appended this usage record. No live rehearsal or cloud changes.
