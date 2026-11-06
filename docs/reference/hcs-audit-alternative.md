# HCS audit trail: unselected alternate format

**Kind:** Reference. **Status:** Open alternate from [ADR 0014](../adr/0014-hcs-audit-trail.md); human format decision pending. **Scope:** demo beat 3. HCS means Hedera Consensus Service. ENS means Ethereum Name Service. H1 is the judge-choice checkpoint; H3 is the payer and infrastructure checkpoint in the [handoff](../15_MUMBAI_HANDOFF.md#8-human-checkpoints).

This page preserves the original draft format for comparison. It does not supersede [the merged record format](../16_HCS_AUDIT_RECORD_FORMAT.md). Its two-field message cannot be read by the merged `hedera-audit/` parser. Only the offline experiment behavior identified in the [spike note](../spikes/0014-hcs-audit-trail.md) has been run. Posting, console behavior and retry requirements below are Open.

## Public message and private opening

**Open alternate design.** Each HCS message is compact UTF-8 JSON with exactly two fields, in this order:

```json
{"v":1,"commitment":"<64 lowercase SHA-256 hex characters, no 0x prefix>"}
```

The public message contains no event type, event ID, identity, access digest, payment amount, transaction reference or salt. Never post plaintext service names, ENS names, hosts, ports or endpoints, including in transaction/topic memos. A version identifies the decoding algorithm, not a mesh or service.

For each event, generate a fresh 32-byte salt with a cryptographically secure random generator. Keep it private and separate from signing keys. Define the private event as an array with fixed positions:

```text
[1, eventId, kind, occurredAt, subjectDigest, accessDigest, sourceTxId, amountAtomic, assetId]
```

| Index | Field           | Meaning                                                                                                              |
| ----- | --------------- | -------------------------------------------------------------------------------------------------------------------- |
| 0     | `v`             | Private event format version; integer `1`                                                                            |
| 1     | `eventId`       | Fresh random universally unique identifier (UUID) for this event; private, but not an additional security key        |
| 2     | `kind`          | `grant`, `revoke` or `payment`                                                                                       |
| 3     | `occurredAt`    | UTC ISO 8601 string with milliseconds, from the confirmed source event                                               |
| 4     | `subjectDigest` | Lowercase 64-character SHA-256 hex of the normalized requesting identity's public key; never the key or ENS name     |
| 5     | `accessDigest`  | Existing ADR 0005 access digest for grant/revoke; `null` for payment                                                 |
| 6     | `sourceTxId`    | Confirmed source transaction identifier: Sepolia hash for grant/revoke, Hedera settlement transaction ID for payment |
| 7     | `amountAtomic`  | Unsigned decimal string for a settled payment; `null` for grant/revoke                                               |
| 8     | `assetId`       | Hedera token ID for payment; `null` for grant/revoke                                                                 |

Normalize public-key text as in ADR 0005 (`trim().toLowerCase()`) before hashing its UTF-8 bytes. Preserve the existing access digest exactly in its canonical representation. Serialize the array using `JSON.stringify` with no whitespace. All values except the first integer are strings or explicit `null`; never use floating-point amounts, omitted positions, nested objects or arbitrary metadata. Generate the event once and retain these exact bytes for its opening.

```text
commitment = lowercaseHex(SHA256(
  UTF8("bramble-hcs-audit-v1\0") || saltBytes32 || eventBytes
))
```

Here `\0` is one zero byte, `||` means byte concatenation, and `eventBytes` is the serialized array in UTF-8. The salt is raw bytes, not its hexadecimal text. This format domain-separates audit commitments from ENS access digests. It does not replace or change ADR 0005's access algorithm.

## Posting and failure behavior

**Open alternate design.** The approval service submits after the grant/revoke write is confirmed, or after it has evidence of a successful Hedera payment settlement. A denied request, approval click, payment attempt or successful Hypertext Transfer Protocol (HTTP) response alone is insufficient evidence. The payment integration must supply a settlement transaction ID; its exact event hook remains Open.

The service receives an injected, operator-configured Hedera client and topic ID. A testnet topic requires a submit key controlled by the approval service; read access remains public. H3 must supply the payer and authorized signing setup through the approved secret channel. The console and nodes receive neither signer nor payer credentials. The software development kit (SDK) transaction uses `setMaxChunks(1)` and an explicit fee cap approved during H3 setup; topic custom fees must also be checked. Do not create a topic or submit a message during this design spike.

Retain the private opening and eventual topic/sequence/receipt mapping in approval-service memory for the demo. Expose the opening only to the authorized operator console over an authenticated connection; a shared write token alone does not protect read access. Do not put openings in URLs, public responses, logs or HashScan links. A restart loses unrevealed openings and pending submissions; show them as unavailable, never reconstruct an opening from guessed data. Durable storage is a future human decision, not a new node-state write.

Submission failure does not undo an ENS change, hide a revocation or block peer enforcement. Show audit status separately: pending submission, consensus received, mirror pending, matched, mismatch or unavailable. The desired retry behavior would reuse the same event bytes and salt. **Read from source:** `hedera-audit/src/trail.ts` builds a new opening on every `record()` call, so calling it again does not preserve the commitment. Reusing bytes needs an explicit resubmission interface; that interface is Open. Resolving an ambiguous submission by transaction ID is also Open: this spike neither exposes that ID nor tests a transaction lookup. Duplicates remain possible. Never claim exactly-once delivery. Audit lag must not become access revocation latency.

## Console verification

**Open alternate design.** The approval console, outside read-only `dashboard/`, receives the private opening and receipt locator from the approval service. It uses an injected read-only HTTP client for the mirror query:

1. Read the configured testnet topic and exact receipt sequence using `GET /api/v1/topics/{topicId}/messages/{sequenceNumber}`. The locator uses a decimal string. The current experiment accepts only safe integer JSON sequence values and rejects larger ones; it does not implement lossless int64 parsing.
2. Check the response topic, sequence, expected payer and single-chunk shape. Recompute the expected message bytes from the private opening. Base64-decode `message` and compare the decoded bytes with those expected bytes. This is one byte comparison; the experiment has no independent envelope parser. A production parser and its malformed-envelope checks remain Open.
3. Display “commitment matched via mirror node,” the consensus timestamp, sequence and a HashScan link. A 404 can mean mirror ingestion lag: show pending and retry with a bounded timeout. Distinct console outcomes for transport failure, unavailable opening and mismatch remain Open; the experiment uses assertions for mismatches. Never display a successful match before comparison.

The testnet topic's message list is `https://hashscan.io/testnet/topic/{topicId}/messages`. An individual message's transaction detail uses the mirror consensus timestamp: `https://hashscan.io/testnet/transaction/{seconds.nanoseconds}/message`. Do not invent a topic-message sequence path. Explorer rendering remains Open until H3 permits live validation; source evidence is in the [spike note](../spikes/0014-hcs-audit-trail.md).

An HTTPS mirror response is a trust boundary. Matching proves that the mirror reports these commitment bytes at this topic and sequence; it is not independent consensus-proof validation. HCS ordering does not prove that the original grant, revoke or payment was truthful or that the approval service logged every event. Verify the underlying ENS/payment transaction separately. The topic submit key restricts posting but does not make the log private.

## Privacy consequences and gates

**Open alternate design.** A fresh secret salt prevents observers from checking guesses against a small event dictionary. A leaked salt permits checking candidate events only when the attacker also knows or guesses every other field, including the random `eventId`. If `eventId` remains unknown, its randomness adds a search barrier. Do not treat it as a second security key; assess salt leakage assuming it may be disclosed. Known identities, public ENS transactions and payment references then help check candidate fields. A commitment is not encryption. A leaked salt does not reveal other independent salts or permit spending or granting access. A leaked full opening reveals its contents and links that event to its public HCS entry forever. Never reuse salts or put them on-chain.

HCS still exposes topic activity, message count, ordering, timestamps and payer metadata. These allow timing correlation with public ENS writes and payments. Sharing openings with a browser also trusts that browser and its operator. State these limitations when describing privacy; do not claim anonymity or hide existing on-chain disclosures.

**Open gates:** H1 judge preference; human approval of this draft; H3 payer, topic and signing setup; payment settlement hook; live Bun/Node submission, receipt and mirror latency; working HashScan rendering. The offline design task needs no payer. Later implementation must preserve all handoff §3 invariants and demonstrate a real testnet record at beat 3.
