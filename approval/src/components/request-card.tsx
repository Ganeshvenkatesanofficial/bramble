'use client'

import { useRef, useState } from 'react'
import { readJson, type RequestView } from '../lib/console-api'
import { transactionUrl } from '../lib/explorer'
import { IdentityFacts } from './identity-facts'
import { Button } from './ui/button'

const statusLabels = {
  pending: 'Awaiting decision',
  approving: 'Grant transaction pending',
  approved: 'Access granted',
  denied: 'Request denied',
  revoking: 'Revoke transaction pending',
  revoked: 'Access revoked',
}

function Transaction({ hash, label }: { hash: string; label: string }) {
  const url = transactionUrl(hash)
  return (
    <div className="transaction">
      <span>{label}</span>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          View on Sepolia Etherscan ↗
        </a>
      ) : (
        <span className="muted">Test receipt · no chain transaction</span>
      )}
      <code className="wrap">{hash}</code>
    </div>
  )
}

export function RequestCard({ request, token, offline }: { request: RequestView; token: string; offline: boolean }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const locked = useRef(false)
  const isPending = request.status === 'approving' || request.status === 'revoking'
  const disabled = offline || !token || busy !== null || isPending
  async function decide(action: 'approve' | 'deny' | 'revoke') {
    if (locked.current) return
    locked.current = true
    setBusy(action)
    setError(null)
    setMessage(null)
    try {
      const path =
        action === 'revoke'
          ? `/api/grants/${encodeURIComponent(request.agentLabel)}/revoke`
          : `/api/requests/${encodeURIComponent(request.id)}/${action}`
      const result = await readJson<RequestView>(path, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      setMessage(statusLabels[result.status])
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Decision failed. Refresh the queue before retrying.')
    } finally {
      setBusy(null)
      locked.current = false
    }
  }
  const positive = request.status === 'approved'
  return (
    <article className="request-card" data-state={request.status} aria-label={`Request from ${request.agentLabel}`}>
      <header className="card-header">
        <div>
          <p className="eyebrow">Access request</p>
          <h3 className="mono wrap">{request.agentLabel}</h3>
        </div>
        <span className={`status ${positive ? 'positive' : ''}`}>
          <span className="status-dot" />
          {statusLabels[request.status]}
        </span>
      </header>
      <div className="request-details">
        <div>
          <span className="eyebrow">Private service</span>
          <strong className="mono wrap">{request.service}</strong>
        </div>
        <div>
          <span className="eyebrow">Requested duration</span>
          <strong>
            {request.requestedDuration === undefined ? 'Until revoked' : `${request.requestedDuration} seconds`}
          </strong>
        </div>
        <div>
          <span className="eyebrow">Price estimate</span>
          <strong className="muted">Estimate unavailable</strong>
          <small>No quote supplied by the API</small>
        </div>
      </div>
      {request.note && <p className="request-note">{request.note}</p>}
      <div className="identities">
        <IdentityFacts label={request.agentLabel} kind="Agent" />
        <IdentityFacts label={request.gatewayLabel} kind="Gateway" />
      </div>
      {request.requestedDuration !== undefined && (
        <p className="timer-note">
          Duration uses a server-side revoke timer; it requires this service to stay running.
        </p>
      )}
      {request.status === 'approved' && request.remainingSeconds !== null && (
        <p className="countdown mono" role="status">
          {request.expiryStatus === 'failed'
            ? 'Automatic revoke failed · server retry scheduled. Access may still be active.'
            : request.remainingSeconds === 0
              ? 'Duration elapsed · awaiting confirmed revoke'
              : `${request.remainingSeconds}s until scheduled revoke`}
        </p>
      )}
      {request.grantTransaction && (
        <Transaction hash={request.grantTransaction.transactionHash} label="Grant confirmed" />
      )}
      {request.revokeTransaction && (
        <Transaction hash={request.revokeTransaction.transactionHash} label="Revoke confirmed" />
      )}
      {request.revokeReason === 'external' && <p className="muted">Grant removed outside this console.</p>}
      <footer className="card-footer">
        <span className="muted">
          Received <time dateTime={request.createdAt}>{new Date(request.createdAt).toLocaleTimeString()}</time>
        </span>
        <div className="actions">
          {request.status === 'pending' && (
            <>
              <Button variant="outline" disabled={disabled} onClick={() => void decide('deny')}>
                Deny
              </Button>
              <Button className="primary" disabled={disabled} onClick={() => void decide('approve')}>
                Approve
              </Button>
            </>
          )}
          {request.status === 'approved' && (
            <Button variant="destructive" className="danger" disabled={disabled} onClick={() => void decide('revoke')}>
              Revoke access
            </Button>
          )}
        </div>
      </footer>
      {(busy || isPending) && (
        <p role="status" className="pending-message">
          {busy === 'deny' ? 'Recording denial…' : 'Waiting for transaction confirmation…'}
        </p>
      )}
      {message && !busy && <p role="status">{message}</p>}
      {error && (
        <p role="alert" aria-label="Request decision error" className="negative">
          {error}
        </p>
      )}
    </article>
  )
}
