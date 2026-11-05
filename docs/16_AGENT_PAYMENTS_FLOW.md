# How to show an agent payment in demo beat 3

Use the approval console's `/payments` page. The server reads Hedera testnet's
public mirror node. It never signs or forwards a payment. The standalone
`PaymentsPanel` component can also be mounted in the main approval screen.

## Configure the reporting window

1. Give the worker a dedicated Hedera testnet payer. Provision its sidecar with
   `HEDERA_CLIENT_ACCOUNT_ID` and `HEDERA_CLIENT_PRIVATE_KEY` through the existing
   secret injection path. Do not copy the private key into approval configuration.
2. Set `APPROVAL_PAYMENT_AGENTS` on the approval server to a JSON array. Each entry
   contains `agentLabel`, `payerAccountId`, `budgetAtomic`, and `since`. For example,
   the following uses a fixture account, not a deployed demo identity:

   ```json
   [{"agentLabel":"worker","payerAccountId":"0.0.123","budgetAtomic":"100000","since":"1700000000.000000000"}]
   ```

   Replace the account with the worker's public payer ID. Set `since` to the
   rehearsal's start time in Hedera consensus timestamp format (Unix seconds,
   period, nine nanosecond digits). Use a fresh window for each reset, before
   starting the worker's relay connection. An empty or duplicate payer mapping
   fails closed. ENS does not attest this mapping; the operator owns attribution.
3. Set `HEDERA_MAX_PAYMENT_ATOMIC` on approval to the same value used by the
   worker's sidecar. Its default is `100000` (0.100000 USDC per payment). This is
   displayed configuration, not an independent read of the worker's policy.
   `budgetAtomic` is an advisory cumulative reporting budget. It does not stop
   payments. Data-relay price/session limits remain separate node flags.
4. Start the approval server with `pnpm --filter @bramble/approval dev`. Open
   `/payments`. Production uses the approved public console topology; this ticket
   creates no deployment. The feed polls every two seconds after each response.

## Trigger the paid connection inside the flow

1. Before the rehearsal, configure the worker and gateway to use the existing
   metered rendezvous relay registry. Its entries must have `SidecarURL` set, and
   the relay-sidecar must actually challenge with HTTP 402. A bare `-rendezvous`
   TCP address without a payment-sidecar URL does not prove a paid connection.
2. Reset the reporting window, then start the worker's normal `brambled serve`
   connection during the demo. Each metered relay attempt automatically calls the
   local sidecar's `/payments/rendezvous-token`, buys a relay-specific token over
   x402, and presents it in the rendezvous hello. This can happen before ACL
   approval. Retrying the private service call alone does not buy another token.
3. Run the denied → request → human approve → successful private call flow with
   the same running worker. At beat 3 show `/payments`, including the payer,
   per-payment cap, spent, remaining advisory budget, and HashScan settlement.
   The settlement belongs to the relay connection made inside this demo window;
   it is not a fee charged by the gateway for the successful service call.
4. For the explicit data-relay variant, configure the existing `-data-relay
   <label>=<relay-sidecar-url>` and `-relay-peer <peer-label>` flags before starting
   the worker. The node quotes candidates and applies `-max-relay-price-per-byte`
   and `-max-relay-session-cost`, then buys a session before routing that peer.
   This may buy both a session and rendezvous tokens. Failover buys another
   session; an idle relay stall may also cause a purchase. Keep the demo finite.
5. Compare the worker's logged settlement ID with the panel's HashScan record.
   Measure settlement-to-panel latency; the two-second poll interval is not a
   guarantee of mirror indexing or Tor payment latency. If no new outgoing USDC
   appears, check whether the connection predates `since` or uses an unmetered
   relay. Do not manufacture a payment by clicking Approve repeatedly.

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
