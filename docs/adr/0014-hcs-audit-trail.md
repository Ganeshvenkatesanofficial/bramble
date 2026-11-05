# ADR 0014 — HCS audit trail

**Status:** Draft, 6 November 2026. **Human approver:** Mumbai project human operator, pending; record their name and approval before accepting this ADR. **Task:** ETH-66 / W10-0. **Demo beat:** 3, the new Hedera service record beside the payment.

The proposed option A uses Hedera Consensus Service (HCS) to timestamp salted commitments to completed grant, revoke and payment events. The approval service posts them. Nodes continue to enforce access independently from ENS; neither HCS nor the approval service becomes an admission authority. This draft follows handoff §5.2's default while H1 remains open. Scheduled Transactions and HCS-14 identity remain alternatives if the judge chooses them; this draft does not settle H1.

## Public message and private opening

**Proposed.** Each HCS message is compact UTF-8 JSON with exactly two fields, in this order:

```json
{"v":1,"commitment":"<64 lowercase SHA-256 hex characters, no 0x prefix>"}
```

The public message contains no event type, event ID, identity, access digest, payment amount, transaction reference or salt. Never post plaintext service names, ENS names, hosts, ports or endpoints, including in transaction/topic memos. A version identifies the decoding algorithm, not a mesh or service.

For each event, generate a fresh 32-byte salt with a cryptographically secure random generator. Keep it private and separate from signing keys. Define the private event as an array with fixed positions:

```text
[1, eventId, kind, occurredAt, subjectDigest, accessDigest, sourceTxId, amountAtomic, assetId]
```

| Position | Meaning |
| --- | --- |
| `eventId` | Fresh random UUID for this event; reused for retries only |
| `kind` | `grant`, `revoke` or `payment` |
| `occurredAt` | UTC ISO 8601 string with milliseconds, from the confirmed source event |
| `subjectDigest` | Lowercase 64-character SHA-256 hex of the normalized requesting identity's public key; never the key or ENS name |
| `accessDigest` | Existing ADR 0005 access digest for grant/revoke; `null` for payment |
| `sourceTxId` | Confirmed source transaction identifier: Sepolia hash for grant/revoke, Hedera settlement transaction ID for payment |
| `amountAtomic` | Unsigned decimal string for a settled payment; `null` for grant/revoke |
| `assetId` | Hedera token ID for payment; `null` for grant/revoke |

Normalize public-key text as in ADR 0005 (`trim().toLowerCase()`) before hashing its UTF-8 bytes. Preserve the existing access digest exactly in its canonical representation. Serialize the array using `JSON.stringify` with no whitespace. All values except the first integer are strings or explicit `null`; never use floating-point amounts, omitted positions, nested objects or arbitrary metadata. Generate the event once and retain these exact bytes for its opening.

```text
commitment = lowercaseHex(SHA256(
  UTF8("bramble-hcs-audit-v1\0") || saltBytes32 || eventBytes
))
```

Here `\0` is one zero byte, `||` means byte concatenation, and `eventBytes` is the serialized array in UTF-8. The salt is raw bytes, not its hexadecimal text. This format domain-separates audit commitments from ENS access digests. It does not replace or change ADR 0005's access algorithm.

## Posting and failure behavior

**Proposed.** The approval service submits after the grant/revoke write is confirmed, or after it has evidence of a successful Hedera payment settlement. A denied request, approval click, payment attempt or successful HTTP response alone is insufficient evidence. The payment integration must supply a settlement transaction ID; its exact event hook remains Open.

The service receives an injected, operator-configured Hedera client and topic ID. A testnet topic requires a submit key controlled by the approval service; read access remains public. H3 must supply the payer and authorized signing setup through the approved secret channel. The console and nodes receive neither signer nor payer credentials. The SDK transaction uses `setMaxChunks(1)` and an explicit fee cap approved during H3 setup; topic custom fees must also be checked. Do not create a topic or submit a message during this design spike.

Retain the private opening and eventual topic/sequence/receipt mapping in approval-service memory for the demo. Expose the opening only to the authorized operator console over an authenticated connection; a shared write token alone does not protect read access. Do not put openings in URLs, public responses, logs or HashScan links. A restart loses unrevealed openings and pending submissions; show them as unavailable, never reconstruct an opening from guessed data. Durable storage is a future human decision, not a new node-state write.

Submission failure does not undo an ENS change, hide a revocation or block peer enforcement. Show audit status separately: pending submission, consensus received, mirror pending, matched, mismatch or unavailable. Retry using the same event bytes and salt. Resolve an ambiguous submission by its transaction ID before resubmitting; duplicates may still occur and are grouped by the private event ID. Never claim exactly-once delivery. Audit lag must not become access revocation latency.

## Console verification

**Proposed.** The approval console, outside read-only `dashboard/`, receives the private opening and receipt locator from the approval service. It uses an injected read-only HTTP client for the mirror query:

1. Read the configured testnet topic and exact receipt sequence using `GET /api/v1/topics/{topicId}/messages/{sequenceNumber}`. Preserve sequence numbers as decimal strings; reject values a JSON parser cannot represent exactly.
2. Check the response topic, sequence, expected payer and single-chunk shape. Base64-decode `message`, require the exact version-1 envelope with no extra fields, and recompute the commitment from the private opening. Compare both the decoded bytes and commitment against the expected message. Reject malformed data or a mismatch.
3. Display “commitment matched via mirror node,” the consensus timestamp, sequence and a HashScan link. A 404 can mean mirror ingestion lag: show pending and retry with a bounded timeout. Distinguish transport failure, unavailable opening and mismatch. Never display a successful match before comparison.

The testnet topic's message list is `https://hashscan.io/testnet/topic/{topicId}/messages`. An individual message's transaction detail uses the mirror consensus timestamp: `https://hashscan.io/testnet/transaction/{seconds.nanoseconds}/message`. Do not invent a topic-message sequence path. Explorer rendering remains Open until H3 permits live validation; source evidence is in the [spike note](../spikes/0014-hcs-audit-trail.md).

An HTTPS mirror response is a trust boundary. Matching proves that the mirror reports these commitment bytes at this topic and sequence; it is not independent consensus-proof validation. HCS ordering does not prove that the original grant, revoke or payment was truthful or that the approval service logged every event. Verify the underlying ENS/payment transaction separately. The topic submit key restricts posting but does not make the log private.

## Privacy consequences and gates

**Proposed.** A fresh secret salt prevents observers from checking guesses against a small event dictionary. If an event's salt leaks, guesses about that event become checkable; known identities, public ENS transactions and payment references can help recover its fields. A leaked salt does not decrypt the digest, reveal other independent salts or permit spending or granting access. A leaked full opening reveals its contents and links that event to its public HCS entry forever. Never reuse salts or put them on-chain.

HCS still exposes topic activity, message count, ordering, timestamps and payer metadata. These allow timing correlation with public ENS writes and payments. Sharing openings with a browser also trusts that browser and its operator. State these limitations when describing privacy; do not claim anonymity or hide existing on-chain disclosures.

**Open gates:** H1 judge preference; human approval of this draft; H3 payer, topic and signing setup; payment settlement hook; live Bun/Node submission, receipt and mirror latency; working HashScan rendering. ETH-66 needs no payer to complete offline design work. Later implementation must preserve all handoff §3 invariants and demonstrate a real testnet record at beat 3.
