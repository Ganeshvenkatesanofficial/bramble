# Core-Claude assistance

## ETH-47: HCS panel merge and stale-label fix (beat 3)

Core-Claude merged `hackathon` into the HCS panel branch, resolving `agent-mcp/tsconfig.json`, `approval/README.md` and `approval/src/lib/api.ts`. In `api.ts` the verification route now reads the service's own `AuditRecorder` unless `auditSource` overrides it. It changed `approval/src/components/hcs-panel.tsx` so a failed refresh no longer keeps the verified detail line, extended `approval/e2e/audit.spec.ts` and `approval/test/audit-verification.test.ts`, and updated `approval/README.md`. It ran `pnpm verify` and the browser tests; no signing, keys or live Hedera activity were involved.
