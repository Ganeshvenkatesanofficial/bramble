'use client'

import type { ButtonHTMLAttributes, ComponentType } from 'react'

/** Shared row shape from the join API and the local daemon's admin proxy. */
export interface JoinRow {
  id: string
  label: string
  tailnet: string
  status: 'pending' | 'approved' | 'denied' | 'revoked'
  pubkey?: string
  meshIp?: string
  createdAt?: string
  decidedAt?: string
  inProgress?: 'approving' | 'revoking'
  failure?: string
  enrollTransactions?: { deploy?: string; register?: string; pubkey?: string; meshIp?: string }
  revokeTransaction?: { transactionHash: string }
}
export type JoinAction = 'approve' | 'deny' | 'revoke'
interface PanelProps {
  rows: JoinRow[]
  disabled: boolean
  busyId?: string | null
  onAction(id: string, action: JoinAction): void
  Button?: ComponentType<ButtonHTMLAttributes<HTMLButtonElement>> | 'button'
}

function Receipts({ row }: { row: JoinRow }) {
  const receipts = [
    ...Object.entries(row.enrollTransactions ?? {}),
    ...(row.revokeTransaction ? [['revoke', row.revokeTransaction.transactionHash]] : []),
  ]
  return (
    <>
      {receipts.map(([step, hash]) =>
        /^0x[0-9a-fA-F]{64}$/.test(hash) ? (
          <div key={step} className="transaction">
            <a href={`https://sepolia.etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">
              {step} transaction ↗
            </a>
          </div>
        ) : null
      )}
    </>
  )
}

function DeviceCard({
  row,
  disabled,
  busyId,
  onAction,
  Button = 'button',
}: Omit<PanelProps, 'rows'> & { row: JoinRow }) {
  const busy = busyId === row.id || !!row.inProgress
  return (
    <article className="request-card" data-state={row.status} aria-label={`Device ${row.label}`}>
      <header className="card-header">
        <div>
          <p className="eyebrow">Device membership</p>
          <h3 className="mono wrap">
            {row.label}.{row.tailnet}
          </h3>
        </div>
        <span className="status">{row.status}</span>
      </header>
      {row.pubkey && <p className="mono wrap">Public key: {row.pubkey}</p>}
      {row.meshIp && <p className="mono">Mesh IP: {row.meshIp}</p>}
      {row.failure && <p className="notice negative">{row.failure}</p>}
      {busy && <p role="status">Waiting for transaction confirmation…</p>}
      <div className="card-actions">
        {row.status === 'pending' && (
          <>
            <Button
              className="primary"
              disabled={disabled || !!busyId || busy}
              onClick={() => onAction(row.id, 'approve')}
            >
              Approve
            </Button>
            <Button disabled={disabled || !!busyId || busy} onClick={() => onAction(row.id, 'deny')}>
              Deny
            </Button>
          </>
        )}
        {row.status === 'approved' && (
          <Button className="danger" disabled={disabled || !!busyId || busy} onClick={() => onAction(row.id, 'revoke')}>
            Revoke
          </Button>
        )}
      </div>
      <Receipts row={row} />
    </article>
  )
}

export function PendingJoins(props: PanelProps) {
  const rows = props.rows.filter((row) => row.status === 'pending')
  return (
    <section aria-label="Pending device joins">
      <div className="section-heading">
        <h2>Pending device joins</h2>
        <span className="muted">Human approval required</span>
      </div>
      {rows.length ? (
        rows.map((row) => <DeviceCard key={row.id} {...props} row={row} />)
      ) : (
        <p className="empty">No pending device joins.</p>
      )}
    </section>
  )
}

export function Members(props: PanelProps) {
  return (
    <section aria-label="Tailnet members">
      <div className="section-heading">
        <h2>Tailnet members</h2>
        <span className="muted">Read from ENS</span>
      </div>
      {props.rows.length ? (
        props.rows.map((row) => <DeviceCard key={row.id} {...props} row={row} />)
      ) : (
        <p className="empty">No enrolled devices.</p>
      )}
    </section>
  )
}

/** Join decisions share the console's live, polled history; they do not assert peer enforcement. */
export function JoinActivity({ rows }: { rows: JoinRow[] }) {
  return (
    <section aria-label="Device activity">
      <div className="section-heading">
        <h2>Device activity</h2>
      </div>
      <ol>
        {[...rows]
          .sort((a, b) => (b.decidedAt ?? b.createdAt ?? '').localeCompare(a.decidedAt ?? a.createdAt ?? ''))
          .map((row) => (
            <li key={row.id}>
              <span className="mono">{row.label}</span> · {row.inProgress ?? row.status}
              {row.decidedAt && (
                <>
                  {' '}
                  · <time dateTime={row.decidedAt}>{row.decidedAt}</time>
                </>
              )}
            </li>
          ))}
      </ol>
    </section>
  )
}
