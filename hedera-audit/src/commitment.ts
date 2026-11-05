import { createHmac, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto'
import { AUDIT_VERSION, type AuditEvent, type AuditKind, type AuditMessage, type AuditOpening } from './types.ts'

export const SALT_BYTES = 32
export const MAX_MESSAGE_BYTES = 1024

const DOMAIN = 'bramble-audit-v1'
const KINDS: readonly AuditKind[] = ['grant', 'revoke', 'payment']
const REQUIRED_FIELDS: Record<AuditKind, readonly string[]> = {
  grant: ['subject', 'serviceDigest', 'expiresAt', 'txRef'],
  revoke: ['subject', 'serviceDigest', 'txRef'],
  payment: ['payer', 'payee', 'asset', 'amountAtomic', 'txRef'],
}
const HEX_64 = /^[0-9a-f]{64}$/

export type RandomBytes = (size: number) => Uint8Array

function assertEvent(event: AuditEvent): Record<string, string> {
  const required = REQUIRED_FIELDS[event.kind]
  if (!required) throw new Error(`unknown audit kind: ${String(event.kind)}`)
  const fields = event as unknown as Record<string, unknown>
  for (const name of Object.keys(fields)) {
    if (name !== 'kind' && !required.includes(name)) throw new Error(`unexpected field ${name} on ${event.kind} event`)
  }
  for (const name of required) {
    const value = fields[name]
    if (typeof value !== 'string' || value === '') throw new Error(`${event.kind} event needs a non-empty ${name}`)
  }
  return fields as Record<string, string>
}

function lengthPrefixed(text: string): Buffer {
  const body = Buffer.from(text, 'utf8')
  const prefix = Buffer.alloc(4)
  prefix.writeUInt32BE(body.length)
  return Buffer.concat([prefix, body])
}

/** Unambiguous encoding: domain tag, then every (name, value) pair sorted by name, each length-prefixed. */
export function encodeEvent(event: AuditEvent): Buffer {
  const fields = assertEvent(event)
  const parts = [lengthPrefixed(DOMAIN)]
  for (const name of Object.keys(fields).sort()) {
    parts.push(lengthPrefixed(name), lengthPrefixed(fields[name]))
  }
  return Buffer.concat(parts)
}

export function newSalt(randomBytes: RandomBytes = nodeRandomBytes): string {
  const salt = randomBytes(SALT_BYTES)
  if (salt.length !== SALT_BYTES) throw new Error(`salt must be ${SALT_BYTES} bytes`)
  return Buffer.from(salt).toString('hex')
}

export function commit(event: AuditEvent, saltHex: string): string {
  if (!/^[0-9a-f]{64}$/.test(saltHex)) throw new Error('salt must be 64 lowercase hex characters')
  return createHmac('sha256', Buffer.from(saltHex, 'hex')).update(encodeEvent(event)).digest('hex')
}

export function buildAudit(
  event: AuditEvent,
  randomBytes?: RandomBytes
): { message: AuditMessage; opening: AuditOpening } {
  const salt = newSalt(randomBytes)
  return {
    message: { v: AUDIT_VERSION, kind: event.kind, c: commit(event, salt) },
    opening: { v: AUDIT_VERSION, event, salt },
  }
}

export function encodeMessage(message: AuditMessage): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify({ v: message.v, kind: message.kind, c: message.c }))
  if (bytes.length > MAX_MESSAGE_BYTES) throw new Error('audit message exceeds the HCS single-message limit')
  return bytes
}

/** Returns the message, or null for anything that is not a well-formed v1 audit message. */
export function parseMessage(bytes: Uint8Array): AuditMessage | null {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const { v, kind, c, ...rest } = value as Record<string, unknown>
  if (Object.keys(rest).length > 0) return null
  if (v !== AUDIT_VERSION) return null
  if (typeof kind !== 'string' || !KINDS.includes(kind as AuditKind)) return null
  if (typeof c !== 'string' || !HEX_64.test(c)) return null
  return { v, kind: kind as AuditKind, c }
}

/** True when the opening reproduces the posted commitment. */
export function verifyOpening(message: AuditMessage, opening: AuditOpening): boolean {
  if (opening.v !== AUDIT_VERSION || message.v !== AUDIT_VERSION) return false
  if (opening.event.kind !== message.kind) return false
  let expected: string
  try {
    expected = commit(opening.event, opening.salt)
  } catch {
    return false
  }
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(message.c, 'hex'))
}
