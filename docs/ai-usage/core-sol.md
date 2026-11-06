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
