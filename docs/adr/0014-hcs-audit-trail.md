# ADR 0014 — HCS audit trail reconciliation

**Kind:** Explanation. **Status:** Draft, 6 November 2026; format decision pending. **Human approver:** Mumbai project human operator, pending; record their name before accepting this ADR. **Task:** ETH-66, workstream W10 (new Hedera service). **Demo beat:** 3.

## Context

The [handoff, section 5.2](../15_MUMBAI_HANDOFF.md#52-w10-a-new-hedera-service-hedera-continuity) makes a Hedera Consensus Service (HCS) audit trail the default new service. The approval service posts salted commitments after confirmed grant, revoke and payment events. Nodes enforce access independently from Ethereum Name Service (ENS) state. The audit trail must not become an enforcement dependency.

**Read from source:** PR #3 merged `hedera-audit/`, [the record format](../16_HCS_AUDIT_RECORD_FORMAT.md) and [ADR 0011's service options](0011-w10-hedera-service-options.md) into `hackathon`. ADR 0011 remains a draft. The original version of this ADR proposed a different format without accounting for that module. PR #18's review identified the incompatibility. A merged implementation is evidence of current behavior; it is not human approval of either draft.

## Decision pending

**Open:** choose one format before changing the writer, reader or console contract. Neither option is accepted by this ADR. Retain the merged implementation while this decision is pending; the offline alternative is an experiment, not a second supported format.

| Aspect          | Retain merged format (recommended)                                    | Replace with the original alternate                                          |
| --------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Public message  | `v`, `kind`, `c`                                                      | `v`, `commitment`; hides kind                                                |
| Commitment      | HMAC-SHA256 keyed by a fresh salt; sorted fields with length prefixes | SHA-256 over domain, salt and positional event array                         |
| Private event   | Named fields per kind, including ENS subject or payment parties       | Random event identifier, subject digest, source reference and payment fields |
| Existing parser | Retained                                                              | Rejects alternate messages; migration required                               |
| Topic           | Existing memo, payer submit key, no admin key                         | Policy must be settled before topic creation                                 |
| Mirror reader   | Existing ordered list reader                                          | Exact topic/sequence lookup experiment                                       |

HMAC means hash-based message authentication code; SHA-256 means Secure Hash Algorithm with a 256-bit output. The byte-level alternate is preserved in [a separate reference](../reference/hcs-audit-alternative.md). The merged byte format remains documented in `docs/16_HCS_AUDIT_RECORD_FORMAT.md`.

### Retain: amend the merged format

Recommend retaining the merged format because it keeps the existing writer, reader and event contract compatible. Rewrite this ADR as an amendment explaining approval-service posting, authenticated opening delivery, salt leakage, audit failure status and retry limitations. Rework the SDK (software development kit) experiment to use the merged message. It must not define a second version-1 format.

The trade-off is public event kind. Timing, counts, topic and payer metadata already allow correlation; publishing kind adds information. The original alternate was intended to hide that field. Human approval must explicitly consider that privacy difference.

### Replace: supersede the merged format

The alternate hides event kind in the public message. It requires an approved replacement specification, an explicit supersession note in `docs/16` and ADR 0011, and changes to `hedera-audit/` plus its consumers and tests. Use a distinct version or a separately configured topic so two incompatible version-1 messages cannot be confused. The human decision must settle that migration choice before implementation.

The private event schema also changes. Payment parties and grant expiry cannot silently disappear from a consumer contract. Reconcile each field, topic policy and opening format before migrating. No live topic or deployment inventory has been checked in this task; do not assume there are no records to preserve.

## Consequences shared by both options

The approval service posts only after a confirmed source transaction. A payment attempt or a successful service response is insufficient settlement evidence. The payment hook remains Open. Audit failure never undoes a grant, delays revocation or blocks peer enforcement.

A private opening contains the event and salt. Only the authenticated operator console receives it. Never post plaintext service names, hosts, ports or openings, including in memos or public responses. Losing an in-memory opening makes its entry unavailable for verification after restart. Durable retention remains a human decision.

A mirror match means that the configured mirror reports matching commitment bytes. It does not prove consensus independently, source-event truth or log completeness. Verify the source transaction separately. The merged reader lists entries; the alternative experiment looks up a receipt sequence. Those are different read strategies and have not been integrated.

Salt leakage permits checking candidate events when every other field is known or guessable. In the alternate, the random event identifier must also be known or guessed; it is not an additional security key. A full opening reveals its event and links it to the public entry. Topic activity, payer metadata and timing remain public under either format.

**Read from source:** `HcsAuditTrail.record()` creates a new salt on each call. Calling it again does not resubmit the same commitment. An interface for resubmitting existing bytes and resolving ambiguous submissions by transaction identifier remains Open. Neither design guarantees exactly-once delivery.

The HashScan transaction link differs between the merged reader and the experiment's cited explorer source. Keep both interpretations labelled Read from source; a browser check of a real submitted entry remains Open. Do not call either route verified from these offline results.

## Approval and verification gates

**Open:** human format selection and named ADR approval; H1 (judge preference); H3 (payer, topic and signing setup); payment settlement hook; live submission, receipt, mirror ingestion and HashScan rendering. This offline task does not require a payer. Selecting a format does not approve testnet writes or accept the final ADR.

The [spike evidence](../spikes/0014-hcs-audit-trail.md) records what ran. Merge of the draft and spike note remains gated on cross-family re-review after reconciliation. All changes serve demo beat 3 and preserve the handoff's section 3 invariants.
