'use client'

import { useActivity } from '../hooks/use-activity'
import { Badge } from './ui/badge'
import { Card } from './ui/card'
import { formatCutoff, type ActivityKind, type ActivitySource, type SourceState } from '../lib/activity'

const kindLabels: Record<ActivityKind, string> = {
  'request-received': 'Request received',
  'request-denied': 'Request denied',
  'access-granted': 'Granted',
  'access-revoked': 'Revoked',
  'gateway-denied': 'Denied by gateway',
  'gateway-allowed': 'Allowed by gateway',
  'payment-settled': 'Payment settled',
  'peer-admission': 'Peer admission',
  'peer-dropped': 'Peer dropped',
  'cutoff-measured': 'Cut-off',
}

const tone: Partial<Record<ActivityKind, 'success' | 'destructive'>> = {
  'access-granted': 'success',
  'gateway-allowed': 'success',
  'payment-settled': 'success',
  'gateway-denied': 'destructive',
  'access-revoked': 'destructive',
  'peer-dropped': 'destructive',
  'request-denied': 'destructive',
  'cutoff-measured': 'destructive',
}

const sourceNames: Record<ActivitySource, string> = {
  approval: 'Approvals',
  gateway: 'Gateway',
  hedera: 'Payments',
}

function sourceNote(state: SourceState) {
  return state === 'ok' ? 'live' : state === 'not_configured' ? 'not configured' : 'unreachable'
}

export function ActivityFeed() {
  const { feed, error } = useActivity()
  return (
    <aside className="activity" aria-labelledby="activity-title">
      <div className="section-heading">
        <h2 id="activity-title">Live activity</h2>
        <span className="muted">1s refresh</span>
      </div>
      {feed && (
        <ul className="activity-sources" aria-label="Feed sources">
          {(Object.keys(sourceNames) as ActivitySource[]).map((source) => (
            <li key={source} className={feed.sources[source] === 'unavailable' ? 'negative' : 'muted'}>
              <span className="status-dot" aria-hidden="true" />
              {sourceNames[source]}: {sourceNote(feed.sources[source])}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="notice negative">
          {error}
        </p>
      )}
      {!feed && !error && (
        <p role="status" className="empty">
          Loading activity…
        </p>
      )}
      {feed && feed.events.length === 0 && (
        <p className="empty">No activity yet. Requests, gateway decisions and payments appear here.</p>
      )}
      {feed && feed.events.length > 0 && (
        <Card asChild className="gap-0 overflow-hidden py-0">
          <ol className="activity-list" aria-label="Activity events">
            {feed.events.map((event) => (
              <li key={event.id} className="activity-item" data-kind={event.kind}>
                <div className="activity-meta">
                  <Badge variant={tone[event.kind] ?? 'default'}>{kindLabels[event.kind]}</Badge>
                  <time dateTime={event.time} className="mono muted">
                    {new Date(event.time).toLocaleTimeString()}
                  </time>
                </div>
                {event.cutoffMs !== undefined ? (
                  <p className="activity-cutoff mono">{formatCutoff(event.cutoffMs)}</p>
                ) : null}
                <p className="activity-summary">
                  <span className="mono wrap">{event.agentLabel}</span> · {event.summary}
                </p>
                {event.detail && <small className="wrap">{event.detail}</small>}
                {event.link && (
                  <a href={event.link.href} target="_blank" rel="noreferrer">
                    {event.link.text} ↗
                  </a>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </aside>
  )
}
