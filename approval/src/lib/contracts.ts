export interface RequestInput {
  agentLabel: string
  gatewayLabel: string
  service: string
  note?: string
  /** Seconds after confirmed approval; implemented by a server-side revoke timer. */
  requestedDuration?: number
}

export interface IdentityFacts {
  label: string
  pubkeyPublished: boolean
  revoked: boolean
  /** Unix seconds, from ENS. */
  expiry: number
}

export interface IdentityResolver {
  resolveIdentity(label: string): Promise<IdentityFacts | null>
  /** Fresh ACL read; true if the agent has any grant. */
  hasGrant(agentLabel: string): Promise<boolean>
}

export interface TransactionReceipt {
  transactionHash: string
}

export interface GrantReceipt extends TransactionReceipt {
  /** 0x-prefixed ADR 0005 ACL digest the grant wrote. The audit trail posts it; the API view omits it. */
  serviceDigest?: string
}

/**
 * Implementations return only after confirmation. A submitted write whose outcome stays unknown
 * throws UnresolvedWriteError; a definitively failed write throws any other error.
 */
export interface GrantSigner {
  grant(input: Pick<RequestInput, 'agentLabel' | 'gatewayLabel' | 'service'>): Promise<GrantReceipt>
  /** Clear this agent's ACL grants. Device enrollment remains unchanged. */
  revoke(agentLabel: string): Promise<TransactionReceipt>
}

/** A settled Hedera payment, as reported by the component that settled it. */
export interface PaymentInput {
  /** Hedera account ID, for example `0.0.1234`. */
  payer: string
  payee: string
  /** Hedera token ID. */
  asset: string
  /** Decimal string of atomic units. */
  amountAtomic: string
  /** Hedera transaction ID, for example `0.0.1234@1700000000.123456789`. */
  txRef: string
}

export type SettleOutcome = 'confirmed' | 'reverted' | 'unresolved'

/**
 * Thrown by a signer when a transaction was submitted but its outcome could not be established.
 * The write may still land, so callers must not resubmit or treat it as a clean failure;
 * `settle()` re-checks the submitted transaction's receipt.
 */
export class UnresolvedWriteError extends Error {
  constructor(
    readonly operation: 'grant' | 'revoke',
    readonly transactionHash: string,
    readonly settle: () => Promise<SettleOutcome>,
    /** For a grant, the 0x-prefixed ADR 0005 digest it wrote, so a late confirmation can still be audited. */
    readonly serviceDigest?: string
  ) {
    super(`${operation} transaction ${transactionHash} is not confirmed`)
  }
}

export interface Clock {
  now(): number
  schedule(action: () => Promise<void>, delayMs: number): () => void
}

export interface AccessRequest extends RequestInput {
  id: string
  status: 'pending' | 'approving' | 'approved' | 'denied' | 'revoking' | 'revoked'
  createdAt: string
  decidedAt?: string
  grantTransaction?: TransactionReceipt
  revokeTransaction?: TransactionReceipt
  expiresAt?: string
  revokedAt?: string
  revokeReason?: 'manual' | 'duration' | 'external'
  expiryStatus: 'none' | 'scheduled' | 'revoking' | 'failed' | 'revoked'
  /** Feed row ids of the commitments posted for this request's grant and revoke. */
  grantAuditId?: string
  revokeAuditId?: string
  /** A submitted transaction whose outcome is not yet known. Cleared when it settles. */
  unresolvedWrite?: { operation: 'grant' | 'revoke'; transactionHash: string }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}
