'use client'

import { Badge } from '../ui/badge'
import { Card } from '../ui/card'
import { transactionUrl } from '../../lib/explorer'
import type { RequestView } from '../../lib/console-api'
import { ActivityFeed } from '../activity-feed'
import { HcsPanel } from '../hcs-panel'
import { JoinConsole } from '../join-console'
import { NetworkPanel } from '../network-panel'
import { RequestCard } from '../request-card'
import { useConsole } from './console-context'
import { PageHeader } from './page-header'

function QueueStatus() {
  const { requests, error } = useConsole()
  return (
    <>
      {error && (
        <p role="alert" aria-label="Request queue error" className="notice negative mb-4">
          {error}
        </p>
      )}
      {!requests && !error && (
        <p role="status" className="empty mb-4">
          Loading access requests…
        </p>
      )}
    </>
  )
}

function Section({
  id,
  title,
  hint,
  children,
}: {
  id: string
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={id} className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id={id}>{title}</h2>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

export function RequestsView() {
  const { requests, error, token, pending, grants, history } = useConsole()
  return (
    <>
      <PageHeader title="Requests" description="Agents and devices waiting on your decision." />
      <section className="mb-8 grid grid-cols-3 gap-2 sm:gap-4" aria-label="Access summary">
        {[
          ['Awaiting decision', pending.length],
          ['Active grants', grants.length],
          ['Closed requests', history.length],
        ].map(([label, count]) => (
          <Card key={label} className="gap-1 px-3 sm:gap-2 sm:px-5">
            <span className="eyebrow !text-[10px] sm:!text-xs">{label}</span>
            <strong className="text-2xl font-semibold tabular-nums sm:text-3xl">{requests ? count : '—'}</strong>
          </Card>
        ))}
      </section>
      <QueueStatus />
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <Section id="requests-title" title="Awaiting your decision" hint="Human approval required">
            {requests && pending.length === 0 && (
              <p className="empty">No pending requests. New agent requests appear here automatically.</p>
            )}
            {pending.map((request) => (
              <RequestCard key={request.id} request={request} token={token} offline={!!error} />
            ))}
          </Section>
          <JoinConsole key={`joins:${token}`} token={token} view="pending" />
        </div>
        <div className="lg:sticky lg:top-0">
          <ActivityFeed />
        </div>
      </div>
    </>
  )
}

function outcome(request: RequestView) {
  return request.status === 'denied' ? (
    <Badge variant="destructive">Request denied</Badge>
  ) : (
    <Badge variant="default">Access revoked</Badge>
  )
}

function History({ rows }: { rows: RequestView[] }) {
  if (rows.length === 0) return <p className="empty">No closed requests yet.</p>
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead className="sticky top-0 bg-card text-left">
            <tr className="border-b border-divider">
              {['Agent', 'Service', 'Outcome', 'Received', 'Receipts'].map((head) => (
                <th key={head} scope="col" className="eyebrow px-4 py-3 font-medium">
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((request) => (
              <tr key={request.id} className="border-b border-divider last:border-0" data-state={request.status}>
                <td className="mono wrap px-4 py-3">{request.agentLabel}</td>
                <td className="mono wrap px-4 py-3">{request.service}</td>
                <td className="px-4 py-3">{outcome(request)}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  <time dateTime={request.createdAt}>{new Date(request.createdAt).toLocaleString()}</time>
                </td>
                <td className="px-4 py-3">
                  <span className="flex flex-wrap gap-x-3">
                    {[
                      ['Grant', request.grantTransaction?.transactionHash],
                      ['Revoke', request.revokeTransaction?.transactionHash],
                    ].map(([label, hash]) => {
                      const url = hash ? transactionUrl(hash) : null
                      return url ? (
                        <a key={label} href={url} target="_blank" rel="noreferrer" className="underline">
                          {label} ↗
                        </a>
                      ) : null
                    })}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export function AccessView() {
  const { requests, error, token, grants, history } = useConsole()
  return (
    <>
      <PageHeader title="Access" description="Who can reach which private service right now, and what has ended." />
      <QueueStatus />
      <Section id="grants-title" title="Active grants" hint="Scoped to the requested service">
        {requests && grants.length === 0 && <p className="empty">No active grants in this queue.</p>}
        {grants.map((request) => (
          <RequestCard key={request.id} request={request} token={token} offline={!!error} />
        ))}
      </Section>
      <Section id="history-title" title="Decision history">
        {requests && <History rows={history} />}
      </Section>
    </>
  )
}

export function DevicesView() {
  const { token } = useConsole()
  return (
    <>
      <PageHeader title="Devices" description="Machines enrolled in this tailnet, read from ENS." />
      <JoinConsole key={`members:${token}`} token={token} view="members" />
    </>
  )
}

export function NetworkView() {
  const { token } = useConsole()
  return (
    <>
      <PageHeader title="Network" description="How enrolled devices and relays connect." />
      <NetworkPanel key={token} token={token} />
    </>
  )
}

export function ActivityView() {
  return (
    <>
      <PageHeader title="Activity" description="Requests, gateway decisions and payments as they happen." />
      <div className="[&_.activity-list]:max-h-[calc(100dvh-16rem)]">
        <ActivityFeed />
      </div>
    </>
  )
}

export function AuditView() {
  const { token } = useConsole()
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Salted commitments for each grant, payment and revoke, checked against Hedera."
      />
      <HcsPanel key={token} token={token} />
    </>
  )
}
