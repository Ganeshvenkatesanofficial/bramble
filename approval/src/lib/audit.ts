import { randomUUID } from 'node:crypto'
import type { AuditEvent, AuditKind, AuditOpening, AuditRecord } from '@bramble/hedera-audit'
import type { Clock } from './contracts'

/** The slice of `HcsAuditTrail` the approval service uses. Inject a fake in tests. */
export interface AuditTrail {
  record(event: AuditEvent): Promise<AuditRecord>
}

export type AuditFailure = 'audit_not_configured' | 'audit_event_unavailable' | 'hcs_post_failed'

/** One feed row. It holds the public receipt and the commitment, never an event field. */
export interface AuditEntry {
  id: string
  kind: AuditKind
  status: 'pending' | 'posted' | 'failed'
  createdAt: string
  requestId?: string
  commitment?: string
  topicId?: string
  sequenceNumber?: string
  transactionId?: string
  error?: AuditFailure
}

/** `null` means the facts needed for the event are missing; nothing is posted. */
export type EventBuilder = () => AuditEvent | null

/**
 * Posts one salted commitment per event key and keeps a public feed of the outcomes.
 * A post failure marks its feed row `failed`; it never throws into the caller's access decision.
 */
export class AuditRecorder {
  private readonly rows: AuditEntry[] = []

  private readonly byKey = new Map<string, AuditEntry>()

  private readonly kept = new Map<string, AuditOpening>()

  private readonly inflight = new Set<Promise<void>>()

  private readonly queued: (() => void)[] = []

  constructor(
    private readonly trail: AuditTrail | undefined,
    private readonly clock: Pick<Clock, 'now'>
  ) {}

  /**
   * Captures the event now and returns its feed row. Nothing is posted until `flush()`, so a
   * caller holding a lock can release it first. A repeated key returns the first row.
   */
  submit(key: string, kind: AuditKind, build: EventBuilder, requestId?: string): AuditEntry {
    const existing = this.byKey.get(key)
    if (existing) return existing
    const entry: AuditEntry = {
      id: randomUUID(),
      kind,
      status: 'pending',
      createdAt: new Date(this.clock.now()).toISOString(),
      ...(requestId === undefined ? {} : { requestId }),
    }
    this.rows.push(entry)
    this.byKey.set(key, entry)
    const event = this.capture(build)
    this.queued.push(() => {
      const work = this.post(entry, event).finally(() => this.inflight.delete(work))
      this.inflight.add(work)
    })
    return entry
  }

  /** Starts every post captured by `submit` so far. */
  flush() {
    for (const start of this.queued.splice(0)) start()
  }

  private capture(build: EventBuilder): AuditEvent | null {
    try {
      return build()
    } catch {
      return null
    }
  }

  private fail(entry: AuditEntry, error: AuditFailure) {
    entry.status = 'failed'
    entry.error = error
  }

  private async post(entry: AuditEntry, event: AuditEvent | null) {
    if (!this.trail) return this.fail(entry, 'audit_not_configured')
    if (!event) return this.fail(entry, 'audit_event_unavailable')
    try {
      const { message, opening, receipt } = await this.trail.record(event)
      this.kept.set(entry.id, opening)
      Object.assign(entry, {
        status: 'posted',
        commitment: message.c,
        topicId: receipt.topicId,
        sequenceNumber: receipt.sequenceNumber,
        transactionId: receipt.transactionId,
      })
    } catch {
      this.fail(entry, 'hcs_post_failed')
    }
  }

  list(): AuditEntry[] {
    return this.rows.map((entry) => ({ ...entry }))
  }

  /** The plaintext and salt a verifier needs. In process only: no HTTP route returns it. */
  opening(entryId: string): AuditOpening | undefined {
    return this.kept.get(entryId)
  }

  /** Resolves when every post started by `flush()` so far has finished. */
  async idle() {
    while (this.inflight.size > 0) await Promise.all([...this.inflight])
  }
}
