// ETH-66: offline experiment only. No environment, signer, or network setup.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export function commitmentMessage(eventBytes, salt) {
  assert.equal(salt.length, 32)
  const commitment = createHash('sha256').update('bramble-hcs-audit-v1\0').update(salt).update(eventBytes).digest('hex')
  return JSON.stringify({ v: 1, commitment })
}

// Usage sketch for a future caller with H3 authorization. Not invoked here.
export async function submitCommitment(sdk, client, topicId, message, maxFee) {
  const response = await new sdk.TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(message)
    .setMaxChunks(1)
    .setMaxTransactionFee(maxFee)
    .execute(client)
  return response.getReceipt(client)
}

export async function verifyMirror(httpClient, locator, expectedMessage) {
  const path = `/api/v1/topics/${locator.topicId}/messages/${locator.sequence}`
  const response = await httpClient(path)
  if (response.status === 404) return 'pending'
  if (!response.ok) throw new Error('mirror unavailable')
  const entry = await response.json()
  assert.equal(entry.topic_id, locator.topicId)
  assert.ok(Number.isSafeInteger(entry.sequence_number))
  assert.equal(String(entry.sequence_number), locator.sequence)
  assert.equal(entry.payer_account_id, locator.payer)
  assert.ok(entry.chunk_info == null || entry.chunk_info.total === 1)
  const bytes = Buffer.from(entry.message, 'base64')
  assert.equal(bytes.toString('base64'), entry.message)
  assert.deepEqual(bytes, Buffer.from(expectedMessage))
  return 'matched'
}

// The only executable entry point loads an SDK, freezes bytes, and uses fixtures.
const sdk = await import(pathToFileURL(process.argv[2]).href)
const eventBytes = Buffer.from(
  JSON.stringify([
    1,
    '00000000-0000-4000-8000-000000000001',
    'payment',
    '2026-11-06T00:00:00.000Z',
    'a'.repeat(64),
    null,
    '0.0.1001@1.000000000',
    '1',
    '0.0.1002',
  ])
)
// Public synthetic fixture only. Production must generate a fresh random salt.
const message = commitmentMessage(eventBytes, Buffer.alloc(32, 7))
const client = sdk.Client.forNetwork({ '127.0.0.1:50211': '0.0.3' })
try {
  const transaction = new sdk.TopicMessageSubmitTransaction()
    .setTopicId('0.0.1003')
    .setMessage(message)
    .setMaxChunks(1)
    .setMaxTransactionFee(new sdk.Hbar(1))
    .setNodeAccountIds([sdk.AccountId.fromString('0.0.3')])
    .setTransactionId(sdk.TransactionId.fromString('0.0.1001@1.000000000'))
    .freezeWith(client)
  const decoded = sdk.Transaction.fromBytes(transaction.toBytes())
  assert.equal(decoded.topicId.toString(), '0.0.1003')
  assert.deepEqual(Buffer.from(decoded.message), Buffer.from(message))
  assert.ok(Buffer.byteLength(message) < 1024)

  const locator = { topicId: '0.0.1003', sequence: '1', payer: '0.0.1001' }
  const entry = {
    topic_id: locator.topicId,
    sequence_number: 1,
    payer_account_id: locator.payer,
    chunk_info: null,
    message: Buffer.from(message).toString('base64'),
  }
  const fixture = (body) => async (path) => {
    assert.equal(path, '/api/v1/topics/0.0.1003/messages/1')
    return { ok: true, status: 200, json: async () => body }
  }
  assert.equal(await verifyMirror(fixture(entry), locator, message), 'matched')
  assert.equal(await verifyMirror(async () => ({ status: 404 }), locator, message), 'pending')
  for (const mutation of [
    { topic_id: '0.0.9999' },
    { sequence_number: 2 },
    { sequence_number: Number.MAX_SAFE_INTEGER + 1 },
    { payer_account_id: '0.0.9999' },
    { chunk_info: { total: 2 } },
    { message: Buffer.from('{}').toString('base64') },
    { message: 'not-base64!' },
  ]) {
    await assert.rejects(verifyMirror(fixture({ ...entry, ...mutation }), locator, message))
  }
  await assert.rejects(verifyMirror(async () => ({ ok: false, status: 503 }), locator, message))
  console.log(
    `Verified offline: SDK freeze/round-trip; ${Buffer.byteLength(message)}-byte envelope; mirror match, lag and rejection fixtures. No execute/getReceipt/network calls.`
  )
} finally {
  client.close()
}
