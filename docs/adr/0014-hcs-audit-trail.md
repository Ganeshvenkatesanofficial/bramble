# ADR 0014 — HCS audit trail: approval-service integration

**Kind:** Explanation. **Status:** Draft, 6 November 2026. **Human approver:** Mumbai project human operator, pending; record their name before accepting this ADR. **Task:** ETH-66 (workstream W10, demo beat 3). **Amends:** [ADR 0011, option A](0011-w10-hedera-service-options.md).

Evidence labels: **Verified** (ran it), **Read from source** (read code or docs, did not run it), **Open** (not tested).

## Context

[Handoff section 5.2](../15_MUMBAI_HANDOFF.md#52-w10-a-new-hedera-service-hedera-continuity) makes a Hedera Consensus Service (HCS) audit trail the default new service. Each grant, revoke and payment posts a salted hash commitment to an HCS topic, and the console verifies entries through the mirror node.

The record format is already merged. **Read from source:** `hedera-audit/` (writer, reader and tests), [the record format reference](../16_HCS_AUDIT_RECORD_FORMAT.md) and ADR 0011 landed on `hackathon` in PR #3. The format is `{"v":1,"kind":…,"c":…}`, where `c` is an HMAC-SHA256 (hash-based message authentication code) keyed by a fresh per-entry salt. The message publishes the event kind on purpose.

The first version of this ADR (commit `90db05d`) proposed a second, incompatible format without citing that work. The review in ETH-122 found the collision, and Atlas decided on 6 November 2026 that the merged format stands. This ADR is now an amendment. It adds no envelope, commitment or event-field format.

## Decision

1. **Keep the merged format unchanged.** Version 1 stays `{"v":1,"kind":…,"c":…}` with the topic policy in `docs/16`: memo `bramble audit trail v1`, payer submit key, no admin key.
2. **The approval service posts.** It posts after it confirms the source transaction, using `HcsAuditTrail.record()` or the build-then-submit sequence in "Retry and delivery". Nodes never post and never read the topic. Peers keep enforcing access from Ethereum Name Service (ENS) state (handoff invariant 1).
3. **The approval service holds the openings.** It delivers an opening only to the authenticated operator console. Never post an opening, a plaintext service name, a host or a port, including in a topic memo or a public response.
4. **The console verifies through the mirror node.** It lists entries with `MirrorTopicReader`, matches them to openings with `verifyEntries`, and shows the HashScan link. Each entry is `verified`, `unopened` or `malformed`.
5. **Audit failure is non-blocking.** A failed post never undoes a grant, delays a revoke or blocks peer enforcement. The approval service reports the audit status and leaves the grant or revoke result unchanged.

## What this adds beyond ADR 0011

- **Post trigger.** Post only after a confirmed source transaction: the Sepolia transaction for a grant or revoke, the Hedera settlement for a payment. A payment attempt or a successful service response is not settlement evidence. **Open:** the payment settlement hook does not exist yet.
- **Opening retention.** An opening held only in memory is lost on restart, and its entry then stays `unopened` forever. Durable retention is a human decision. **Open.**
- **Trust limits of a mirror match.** A match means the configured mirror node returned bytes whose commitment the opening reproduces. It does not prove consensus on its own, that the source event happened (check `txRef` on its own chain), or that the log is complete (the submit-key holder can omit events).

## Salt leakage

The salt is the HMAC key. A leaked salt does not decrypt anything, because the message holds no ciphertext. It lets the holder test candidate events: the holder recomputes `c` for a guessed event and compares it with the posted value.

**Read from source:** the preimage contains only the event fields (`hedera-audit/src/commitment.ts`). There is no extra random identifier, so the attacker needs no second secret. Some fields can be read from public data: the ENS subject and the `txRef` come from the source chain, and the service digest can be tested against a list of known services. A grant carries no on-chain expiry (the Mumbai brief W1 Duration; the approval service computes `expiresAt` locally from its revoke timer), so the attacker must know or guess that timer value before a leaked salt reconstructs a full grant event. Each entry has its own salt, so one leak affects one entry.

A full opening reveals its event and ties it to the public entry. Kind, timing, counts and payer account stay public regardless of the salt.

## Retry and delivery

**Read from source:** `HcsAuditTrail.record()` draws a new salt on every call, so calling it again after an ambiguous failure posts a different commitment. If the first post did land but the call threw, the caller never received its opening, and that entry stays `unopened`.

`buildAudit()` and `encodeMessage()` are exported. A caller can build the message and opening, persist the opening, and then submit the same bytes through the `TopicClient`. **Open:** `HcsAuditTrail` does not offer this as one operation, and no code resolves an ambiguous submission by looking up its transaction identifier on the mirror node. Neither is implemented or tested. The design promises no exactly-once delivery.

## Rejected alternative: hide the event kind

The first version of this ADR hid the kind inside the commitment. It was rejected because handoff section 5.2, `docs/16` and ADR 0011 publish the kind deliberately, and replacing the format would break the merged writer and reader and require a migration. The privacy difference is real but small: topic activity, payer account and timing already allow correlation. If a human wants to hide the kind, that needs a new ADR that supersedes `docs/16` and ADR 0011, a distinct version or topic, and changes to `hedera-audit/` and its tests.

The first version's byte-level draft, its single-message mirror lookup (`/messages/{sequenceNumber}`) and its offline script remain in git history at `90db05d`. They are not a supported format.

## What the spike newly proves

[The spike note](../spikes/0014-hcs-audit-trail.md) records the evidence. **Verified:** the Hedera SDK (software development kit) `TopicMessageSubmitTransaction` freezes and round-trips a merged-format message under Node and Bun with no network. **Open:** live submission, the receipt, mirror ingestion delay, and how HashScan renders the entry.

## Open items and gates

- Named human acceptance of this ADR.
- H1: the Hedera judge's preference among the section 5.2 options.
- H3: payer account, topic creation and signing setup. This offline task needs none of them.
- The payment settlement hook, durable opening retention, the retry operation, and the HashScan message route (see the spike note).

Merging this draft into `hackathon` does not accept it. Every change here serves demo beat 3 and keeps the handoff section 3 invariants.
