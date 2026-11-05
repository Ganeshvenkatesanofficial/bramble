# HCS audit trail spike evidence

Reference for ETH-66 / W10-0, demo beat 3. Recorded 6 November 2026 on Linux x64 against baseline `3bec957`. Design: [ADR 0014](../adr/0014-hcs-audit-trail.md), draft; human approval pending. This spike never connects to Hedera testnet, creates a topic, signs or submits a transaction.

| Finding | Evidence label |
| --- | --- |
| `@hiero-ledger/sdk` 2.90.1 imports, freezes a `TopicMessageSubmitTransaction` with an injected local-only client, and round-trips its topic/message through transaction bytes | **Verified:** Node 24.15.0 and Bun 1.3.14, offline |
| Compact version-1 envelope occupies 87 UTF-8 bytes, below one 1,024-byte HCS chunk | **Verified:** same runs; payload size only, not a network acceptance claim |
| Injected HTTP fixtures match message bytes and reject changed topic, sequence, payer, chunk count, content, malformed Base64 and unsafe sequence numbers; 404 stays pending and 503 fails | **Verified:** same runs; no real REST request |
| Submission uses `execute(client)` then `getReceipt(client)`; receipt exposes topic sequence and running hash | **Read from source:** [Hedera submit-message documentation](https://docs.hedera.com/native/consensus/submit-message); exported usage sketch is not invoked |
| Mirror query is `GET /api/v1/topics/{topicId}/messages/{sequenceNumber}`; message bytes are Base64 and sequence is int64 | **Read from source:** [mirror OpenAPI](https://github.com/hiero-ledger/hiero-mirror-node/blob/main/rest/api/v1/openapi.yml), `TopicMessage` and the topic/sequence operation |
| HashScan topic list is `/testnet/topic/{topicId}/messages`; individual message is `/testnet/transaction/{consensusTimestamp}/message` | **Read from source:** explorer commit `92a95cc85bf90dfbfaf9456aa2e9ede3ff7415ed`, [router](https://github.com/hiero-ledger/hiero-mirror-node-explorer/blob/92a95cc85bf90dfbfaf9456aa2e9ede3ff7415ed/_frontend/src/router.ts), [topic table](https://github.com/hiero-ledger/hiero-mirror-node-explorer/blob/92a95cc85bf90dfbfaf9456aa2e9ede3ff7415ed/_frontend/src/components/topic/TopicMessageTable.vue), and [route manager](https://github.com/hiero-ledger/hiero-mirror-node-explorer/blob/92a95cc85bf90dfbfaf9456aa2e9ede3ff7415ed/_frontend/src/utils/RouteManager.ts) |
| Actual submission, receipt status, topic permissions, mirror ingestion delay, explorer rendering and payment hook | **Open:** deferred to H3-authorized implementation and live verification |

## Reproduction inputs

The repo already uses `@hiero-ledger/sdk` in its payment spike. This experiment pins that package separately and changes no workspace dependency or lockfile. Its client targets loopback with synthetic account/topic IDs and no operator. The script freezes and serializes only; `submitCommitment` is an unexecuted usage sketch accepting a caller-supplied client and fee cap. Its single-chunk example does not implement production validation, custom-fee policy, retry or signer setup.

```sh
npm install --prefix /tmp/eth-66-hcs-tools --no-package-lock --ignore-scripts @hiero-ledger/sdk@2.90.1 bun@1.3.14
node scripts/spikes/hcs-audit.mjs /tmp/eth-66-hcs-tools/node_modules/@hiero-ledger/sdk/lib/index.js
/tmp/eth-66-hcs-tools/node_modules/@oven/bun-linux-x64/bin/bun scripts/spikes/hcs-audit.mjs /tmp/eth-66-hcs-tools/node_modules/@hiero-ledger/sdk/lib/index.js
```

Both runtime commands exit 0 and print `Verified offline: SDK freeze/round-trip; 87-byte envelope; mirror match, lag and rejection fixtures. No execute/getReceipt/network calls.` The first attempt passed strings to `setNodeAccountIds` and failed during freezing on both runtimes; using SDK `AccountId` objects fixes that API misuse.

The fixtures do not prove consensus or a real mirror response. A future console must recompute the expected message from an authenticated private opening before comparing bytes. Matching a mirror response trusts that mirror; it does not prove completeness or truth of the source event. Salt leakage enables guessing for that event; public payer metadata and timing still permit correlation. See ADR 0014 for the proposed privacy boundary.

**Verified baseline limitation:** `pnpm install --frozen-lockfile` passes. Baseline `pnpm verify` fails in `format:check` on 50 existing skill files before code checks. ETH-75 owns that repair; ETH-76 owns missing runtime provisioning. Do not interpret the successful offline spike as a green repository verification gate.
