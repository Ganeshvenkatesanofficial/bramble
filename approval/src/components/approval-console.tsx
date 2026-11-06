'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRequests } from '../hooks/use-requests'
import { RequestCard } from './request-card'

export function ApprovalConsole() {
  const { requests, error, updatedAt } = useRequests()
  const [token, setToken] = useState('')
  const [draft, setDraft] = useState('')
  const pending = requests?.filter((item) => item.status === 'pending' || item.status === 'approving') ?? []
  const grants = requests?.filter((item) => item.status === 'approved' || item.status === 'revoking') ?? []
  const history = requests?.filter((item) => item.status === 'denied' || item.status === 'revoked') ?? []
  return (
    <>
      <header className="nav">
        <div className="nav-inner">
          <Link href="/" className="brand">
            <span className="brand-dot" />
            bramble
          </Link>
          <span className="nav-active">Approvals</span>
          <span className="network mono">Sepolia</span>
        </div>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <p className="eyebrow">Operator console</p>
            <h1>
              Private access.
              <br className="mobile-break" /> Your decision.
            </h1>
            <p className="muted">Review the identity. Grant a service. Revoke when you’re done.</p>
          </div>
          <span className={`connection ${error ? 'negative' : ''}`}>
            <span className="status-dot" />
            {error ? 'Disconnected' : updatedAt ? 'Live queue · 1s refresh' : 'Connecting…'}
          </span>
        </div>
        <div className="summary" aria-label="Access summary">
          <div>
            <span className="eyebrow">Awaiting decision</span>
            <strong>{requests ? pending.length : '—'}</strong>
          </div>
          <div>
            <span className="eyebrow">Active grants</span>
            <strong className="positive">{requests ? grants.length : '—'}</strong>
          </div>
          <div>
            <span className="eyebrow">Closed requests</span>
            <strong>{requests ? history.length : '—'}</strong>
          </div>
        </div>
        <section className="authorization" aria-label="Operator authorization">
          <div>
            <h2>Operator authorization</h2>
            <p className="muted">
              {token ? 'Write access enabled for this tab.' : 'Enter the shared demo token to enable decisions.'}
            </p>
          </div>
          {token ? (
            <button
              onClick={() => {
                setToken('')
                setDraft('')
              }}
            >
              Lock console
            </button>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                setToken(draft.trim())
                setDraft('')
              }}
            >
              <label className="sr-only" htmlFor="demo-token">
                Demo token
              </label>
              <input
                id="demo-token"
                type="password"
                autoComplete="off"
                placeholder="Demo token"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button type="submit" disabled={!draft.trim()}>
                Unlock
              </button>
            </form>
          )}
        </section>
        {error && (
          <p role="alert" className="notice negative">
            {error}
          </p>
        )}
        {!requests && !error && (
          <p role="status" className="empty">
            Loading access requests…
          </p>
        )}
        <section aria-labelledby="requests-title">
          <div className="section-heading">
            <h2 id="requests-title">Request queue</h2>
            <span className="muted">Human approval required</span>
          </div>
          {requests && pending.length === 0 && (
            <p className="empty">No pending requests. New agent requests appear here automatically.</p>
          )}
          {pending.map((request) => (
            <RequestCard key={request.id} request={request} token={token} offline={!!error} />
          ))}
        </section>
        <section aria-labelledby="grants-title">
          <div className="section-heading">
            <h2 id="grants-title">Granted access</h2>
            <span className="muted">Scoped to the requested service</span>
          </div>
          {requests && grants.length === 0 && <p className="empty">No active grants in this queue.</p>}
          {grants.map((request) => (
            <RequestCard key={request.id} request={request} token={token} offline={!!error} />
          ))}
        </section>
        {history.length > 0 && (
          <section aria-labelledby="history-title">
            <div className="section-heading">
              <h2 id="history-title">Decision history</h2>
            </div>
            {history.map((request) => (
              <RequestCard key={request.id} request={request} token={token} offline={!!error} />
            ))}
          </section>
        )}
        <footer className="page-footer">
          <span>Requests are suggestions. ENS identity is rechecked before every grant.</span>
          <span>{updatedAt ? `Last received ${updatedAt}` : 'Waiting for API'}</span>
        </footer>
      </main>
    </>
  )
}
