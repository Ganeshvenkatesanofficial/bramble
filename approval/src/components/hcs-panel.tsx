'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { AuditFeed, Verification } from '../lib/audit-verification'

const states: Record<Verification, { label: string; detail: string; color: string }> = {
  verified: { label: 'Commitment matched', detail: 'The opening reproduces the mirror message.', color: 'positive' },
  unopened: {
    label: 'Opening unavailable',
    detail: 'The retained event and salt are missing. This entry cannot be verified.',
    color: 'muted',
  },
  malformed: {
    label: 'Malformed record',
    detail: 'The receipt or mirror message is not a supported audit record.',
    color: 'negative',
  },
  mismatch: {
    label: 'Commitment mismatch',
    detail: 'The mirror message differs from the retained record or opening.',
    color: 'negative',
  },
  mirror_pending: {
    label: 'Awaiting mirror',
    detail: 'The receipt exists, but the mirror has not returned this sequence yet.',
    color: 'muted',
  },
  unavailable: {
    label: 'Mirror unavailable',
    detail: 'This check failed. Retry when the mirror is available.',
    color: 'negative',
  },
  pending: { label: 'Post pending', detail: 'The HCS post has no receipt yet.', color: 'muted' },
  failed: {
    label: 'Post failed',
    detail: 'No HCS receipt was recorded. Access decisions remain independent.',
    color: 'negative',
  },
}

export function HcsPanel({ token = '', fixtureFeed }: { token?: string; fixtureFeed?: AuditFeed }) {
  const [result, setResult] = useState<{ token: string; feed: AuditFeed } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (fixtureFeed || !token) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    async function check() {
      setLoading(true)
      try {
        const response = await fetch('/api/audit/verification', {
          cache: 'no-store',
          signal: controller.signal,
          headers: { authorization: `Bearer ${token}` },
        })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error?.message ?? 'HCS verification unavailable.')
        if (active) {
          setResult({ token, feed: body })
          setError(null)
        }
      } catch {
        if (active)
          setError(
            'HCS verification unavailable. The recorder may not be connected, or the mirror could not be reached.'
          )
      } finally {
        if (active) {
          setLoading(false)
          timer = setTimeout(check, 10_000)
        }
      }
    }
    void check()
    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [token, fixtureFeed, refresh])
  const feed = fixtureFeed ?? (token && result?.token === token ? result.feed : null)
  const visibleError = token && !fixtureFeed ? error : null
  return (
    <section className="hcs-panel" aria-labelledby="hcs-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Beat 3 · Hedera Consensus Service</p>
          <h2 id="hcs-title">HCS audit trail</h2>
        </div>
        <span className="status muted">{fixtureFeed ? 'Offline fixtures' : 'Testnet · 10s refresh'}</span>
      </div>
      <p className="muted">
        Grant, payment and revoke commitments, checked against mirror-node messages. Only salted hashes are posted.
      </p>
      {fixtureFeed && (
        <p className="notice hcs-fixture" role="status">
          Fixture preview · Synthetic events and mirror responses. HashScan links demonstrate the URL format; these
          entries were not submitted.
        </p>
      )}
      {!fixtureFeed && !token && (
        <p className="empty">
          Unlock the console to check retained audit records.{' '}
          <Link href="/audit/fixtures">Preview offline fixtures</Link>
        </p>
      )}
      {visibleError && (
        <p className="notice negative" role="alert">
          {visibleError} {feed && 'Records below are from the last successful check and are stale.'}
        </p>
      )}
      {loading && !feed && (
        <p role="status" className="empty">
          Checking HCS commitments…
        </p>
      )}
      {feed && (
        <>
          <div className="hcs-check">
            <span className="muted">
              {fixtureFeed
                ? 'Fixture check complete'
                : `Last checked ${feed.observedAt.replace('T', ' ').replace('Z', ' UTC')}`}
              {visibleError && ' · Stale'}
            </span>
            {!fixtureFeed && (
              <button onClick={() => setRefresh((n) => n + 1)} disabled={loading}>
                Check again
              </button>
            )}
          </div>
          {feed.entries.length === 0 && <p className="empty">No audit events retained in this process.</p>}
          <div className="hcs-entries">
            {feed.entries.map((entry) => {
              const state = states[entry.verification]
              return (
                <article className="hcs-entry" key={entry.id} aria-label={`${entry.kind} audit record`}>
                  <div className="card-header">
                    <h3>
                      {entry.kind === 'grant'
                        ? 'Access granted'
                        : entry.kind === 'revoke'
                          ? 'Access revoked'
                          : 'Payment settled'}
                    </h3>
                    <span className={`status ${visibleError ? 'muted' : state.color}`}>
                      <span className="status-dot" />
                      {visibleError ? 'Stale · recheck needed' : state.label}
                    </span>
                  </div>
                  <p className="muted hcs-detail">
                    {visibleError ? 'Last successful check; recheck needed.' : state.detail}
                  </p>
                  <dl className="hcs-meta">
                    <div>
                      <dt>Topic</dt>
                      <dd>{entry.topicId ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Sequence</dt>
                      <dd>{entry.sequenceNumber ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Consensus time</dt>
                      <dd>{entry.consensusTimestamp ?? 'Pending'}</dd>
                    </div>
                  </dl>
                  {entry.commitment && (
                    <div className="hcs-commitment">
                      <span className="eyebrow">HMAC-SHA256 commitment</span>
                      <code>{entry.commitment}</code>
                    </div>
                  )}
                  <div className="hcs-links">
                    {entry.hashscanUrl && (
                      <a href={entry.hashscanUrl} target="_blank" rel="noreferrer">
                        View HCS entry on HashScan ↗
                      </a>
                    )}
                    {entry.topicUrl && (
                      <a href={entry.topicUrl} target="_blank" rel="noreferrer">
                        View topic ↗
                      </a>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
          {feed.truncated && (
            <p className="muted">Showing the latest 50 retained audit events. This view is not a complete log.</p>
          )}
        </>
      )}
      <p className="hcs-limit muted">
        A match confirms bytes returned by the configured mirror. It does not independently prove the source
        transaction, consensus, or log completeness. Openings stay on the server.
      </p>
    </section>
  )
}
