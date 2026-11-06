'use client'

import { useRef, useState } from 'react'
import { readJson, type RequestView } from '../lib/console-api'
import { transactionUrl } from '../lib/explorer'
import { IdentityFacts } from './identity-facts'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardFooter, CardHeader } from './ui/card'

const statusVariant = {
  pending: 'warning',
  approving: 'warning',
  approved: 'success',
  denied: 'destructive',
  revoking: 'warning',
  revoked: 'default',
} as const

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
  return (
    <Card asChild className="mb-4 gap-5">
      <article data-state={request.status} aria-label={`Request from ${request.agentLabel}`}>
        <CardHeader>
          <div className="min-w-0">
            <p className="eyebrow">Access request</p>
            <h3 className="mono wrap !mt-1.5 !text-lg">{request.agentLabel}</h3>
          </div>
          <Badge variant={statusVariant[request.status]}>
            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            {statusLabels[request.status]}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="request-details !m-0">
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
          <div className="identities !m-0 !py-4">
            <IdentityFacts label={request.agentLabel} kind="Agent" />
            <IdentityFacts label={request.gatewayLabel} kind="Gateway" />
          </div>
          {request.requestedDuration !== undefined && (
            <p className="timer-note !m-0">
              Duration uses a server-side revoke timer; it requires this service to stay running.
            </p>
          )}
          {request.status === 'approved' && request.remainingSeconds !== null && (
            <p className="countdown mono !m-0" role="status">
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
        </CardContent>
        <CardFooter>
          <span className="text-xs text-muted-foreground">
            Received <time dateTime={request.createdAt}>{new Date(request.createdAt).toLocaleTimeString()}</time>
          </span>
          <div className="flex flex-wrap gap-2">
            {request.status === 'pending' && (
              <>
                <Button variant="outline" size="lg" disabled={disabled} onClick={() => void decide('deny')}>
                  Deny
                </Button>
                <Button size="lg" disabled={disabled} onClick={() => void decide('approve')}>
                  Approve
                </Button>
              </>
            )}
            {request.status === 'approved' && (
              <Button variant="destructive" size="lg" disabled={disabled} onClick={() => void decide('revoke')}>
                Revoke access
              </Button>
            )}
          </div>
        </CardFooter>
        {(busy || isPending) && (
          <p role="status" className="pending-message px-5 text-sm text-muted-foreground">
            {busy === 'deny' ? 'Recording denial…' : 'Waiting for transaction confirmation…'}
          </p>
        )}
        {message && !busy && (
          <p role="status" className="px-5 text-sm">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" aria-label="Request decision error" className="negative px-5 text-sm">
            {error}
          </p>
        )}
      </article>
    </Card>
  )
}
