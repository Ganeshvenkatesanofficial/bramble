# Agent payment feed reference

## Evidence and human verification

- **Verified:** rootless Go tests for rendezvous, data-relay selection/stall, and
  main-package relay/payment paths pass on this branch. They use local fixtures;
  they do not settle a funded transaction.
- **Verified:** `approval/test/payments.test.ts` exercises the HTTP mirror adapter
  against a local fixture. It covers pagination, duplicates, successful outgoing
  USDC only, the reporting window, exact atomic totals, budget overrun, a newly
  appearing settlement, configuration errors and incomplete-feed failures.
- **Read from source:** `sidecar/src/payments/client.ts`, `datarelay.ts`,
  `brambled/rendezvous/client.go`, `brambled/datarelay/`, and `brambled/main.go`
  establish the trigger sequence above. Each relay attempt buys a fresh token;
  approvals do not initiate payments. No production node files change here.
- **Open — needs human verification:** funded testnet x402 settlement, dedicated
  payer attribution in the deployed topology, mirror indexing latency within a
  few seconds, matching displayed and enforced sidecar cap, and HashScan links
  for a real rehearsal transaction. Run two resets and record both latencies.
- **Open — UI gate H4:** a different Sol tester must capture the public console
  at 1280 px and 390 px; the human approves those screenshots. Fixture tests and
  local screenshots do not satisfy that public UI gate.

The adapter fetches all pages in a fixed reporting window (maximum 100 pages,
8-second request deadline). It fails the entire response on an incomplete feed.
A failure retains the previous display with a stale warning; it never reports
zero spend as a substitute. Spend includes every net outgoing transfer of testnet
USDC (`0.0.429274`) by the configured payer, including non-relay transfers if the
account is reused. Mirror data alone cannot prove which process signed a payment.
