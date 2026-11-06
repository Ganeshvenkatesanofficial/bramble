import assert from 'node:assert/strict'
import { AccountId, Client, Hbar, TopicMessageSubmitTransaction, Transaction, TransactionId } from '@hiero-ledger/sdk'
import { buildAudit, encodeMessage, MAX_MESSAGE_BYTES, parseMessage, verifyOpening } from '../src/commitment.ts'

/**
 * Offline check: freeze the Hedera SDK transaction that `createHieroTopicClient` builds,
 * with a real merged-format message, and read it back from bytes. Never executes or signs.
 */
export function freezeRoundTrip(): { messageBytes: number } {
  const { message, opening } = buildAudit({
    kind: 'revoke',
    subject: 'agent-1.acme.eth',
    serviceDigest: `0x${'ab'.repeat(32)}`,
    txRef: `0x${'ef'.repeat(32)}`,
  })
  const bytes = encodeMessage(message)
  assert.ok(bytes.length <= MAX_MESSAGE_BYTES)

  const client = Client.forNetwork({ '127.0.0.1:50211': '0.0.3' })
  try {
    const frozen = new TopicMessageSubmitTransaction()
      .setTopicId('0.0.1003')
      .setMessage(bytes)
      .setMaxChunks(1)
      .setMaxTransactionFee(new Hbar(1))
      .setNodeAccountIds([AccountId.fromString('0.0.3')])
      .setTransactionId(TransactionId.fromString('0.0.1001@1.000000000'))
      .freezeWith(client)
    const decoded = Transaction.fromBytes(frozen.toBytes())
    assert.ok(decoded instanceof TopicMessageSubmitTransaction)
    assert.equal(decoded.topicId?.toString(), '0.0.1003')
    assert.deepEqual(Buffer.from(decoded.message as Uint8Array), Buffer.from(bytes))

    const parsed = parseMessage(decoded.message as Uint8Array)
    assert.ok(parsed)
    assert.equal(parsed.kind, 'revoke')
    assert.ok(verifyOpening(parsed, opening))
    return { messageBytes: bytes.length }
  } finally {
    client.close()
  }
}
