# Core-Sol

## ETH-181: device onboarding (demo beats 2 and 5)

Recovered Core-Claude commit `37862fc` in branch `core-sol/eth-181-join-api`.

Paths written:

- `admincli/src/{lib.ts,lib.test.ts,enroll-chain-viem.ts,enroll-memory.ts}`
- `approval/src/lib/{api.ts,chain-env.ts,contracts.ts,validation.ts,joins.ts,join-chain.ts}`
- `approval/src/app/api/[...path]/route.ts`
- `approval/test/joins.test.ts`
- `docs/ai-usage/core-sol.md`

Verified: HTTP lifecycle tests use the admincli library and in-memory chain; no testnet writes in these tests.

Additional paths written:

- `approval/src/components/{approval-console.tsx,join-console.tsx}`
- `approval/e2e/{console.spec.ts,memory-server.ts}`
- `approval/{package.json,tsconfig.json,next.config.ts,playwright.config.ts,.env.example}`
- `approval/test/node-config.test.ts`
- `approval/scripts/smoke-join.ts`
- `admincli/src/enroll-chain-viem.test.ts`
- `join-ui/{package.json,tsconfig.json,src/index.tsx}`
- `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- `deploy/scripts/gen-node-config.mjs` (reused unchanged from install-hosting work)
- `scripts/print-node-config.mjs`
- `docs/reference/approval-api.md`
- `README.md`

Open: real Sepolia smoke requires administrator configuration; this run lacks `APPROVAL_ENS_PARENT`.
