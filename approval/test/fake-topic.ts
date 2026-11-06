import type { TopicClient } from '@bramble/hedera-audit'

export class FakeTopic implements TopicClient {
  readonly submitted: Uint8Array[] = []
  fail = false
  gate?: Promise<void>
  async createTopic() {
    return { topicId: '0.0.9000' }
  }
  async submitMessage({ message }: { topicId: string; message: Uint8Array }) {
    await this.gate
    if (this.fail) throw new Error('sensitive Hedera diagnostic must never reach the feed')
    this.submitted.push(message)
    return {
      transactionId: `0.0.1001@1700000000.${this.submitted.length}`,
      sequenceNumber: String(this.submitted.length),
    }
  }
}
