'use client'

import Image from 'next/image'

import { useState } from 'react'
import Link from 'next/link'
import { useRequests } from '../hooks/use-requests'
import { ActivityFeed } from './activity-feed'
import { RequestCard } from './request-card'
import { HcsPanel } from './hcs-panel'
import { JoinConsole } from './join-console'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { NetworkPanel } from './network-panel'

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
            <Image className="brand-mark" src="/bramble-logo.png" alt="" width={28} height={28} unoptimized />
            bramble
          </Link>
          <span className="nav-active">Approvals</span>
          <a href="#network" className="nav-link">
            Network
          </a>
          <span className="network mono">Sepolia</span>
        </div>
      </header>
      <main id="main-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Operator console</p>
            <h1>
              Private access.
              <br className="mobile-break" /> Your decision.
            </h1>
            <p className="muted">Review the identity. Grant a service. Revoke when you’re done.</p>
          </div>
          <Badge variant={error ? 'destructive' : 'outline'} className="connection">
            <span
              className={`size-1.5 rounded-full ${error ? 'bg-destructive' : updatedAt ? 'bg-success' : 'bg-muted-foreground'}`}
              aria-hidden="true"
            />
            {error ? 'Disconnected' : updatedAt ? 'Live queue · 1s refresh' : 'Connecting…'}
          </Badge>
        </div>
        <section className="my-8 grid gap-4 sm:grid-cols-3" aria-label="Access summary">
          {[
            ['Awaiting decision', pending.length],
            ['Active grants', grants.length],
            ['Closed requests', history.length],
          ].map(([label, count]) => (
            <Card key={label} className="gap-2 px-5">
              <span className="eyebrow">{label}</span>
              <strong className="text-3xl font-semibold tabular-nums">{requests ? count : '—'}</strong>
            </Card>
          ))}
        </section>
        <div className="console-layout">
          <div className="console-main">
            <Card asChild className="authorization flex-row flex-wrap items-center justify-between gap-4 px-5">
              <section aria-label="Operator authorization">
                <div>
                  <h2>Operator authorization</h2>
                  <p className="muted">
                    {token
                      ? 'Decision controls unlocked. The API checks each action.'
                      : 'Enter the shared demo token to enable decisions.'}
                  </p>
                </div>
                {token ? (
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => {
                      setToken('')
                      setDraft('')
                    }}
                  >
                    Lock console
                  </Button>
                ) : (
                  <form
                    className="flex items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      setToken(draft.trim())
                      setDraft('')
                    }}
                  >
                    <div className="grid gap-1.5">
                      <Label htmlFor="demo-token" className="text-xs text-muted-foreground">
                        Demo token
                      </Label>
                      <Input
                        id="demo-token"
                        type="password"
                        autoComplete="off"
                        placeholder="Demo token"
                        className="w-48"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                      />
                    </div>
                    <Button variant="outline" size="lg" type="submit" disabled={!draft.trim()}>
                      Unlock
                    </Button>
                  </form>
                )}
              </section>
            </Card>
            {error && (
              <p role="alert" aria-label="Request queue error" className="notice negative">
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
            <JoinConsole key={`joins:${token}`} token={token} />
            <HcsPanel key={token} token={token} />
          </div>
          <ActivityFeed />
        </div>
        <NetworkPanel key={token} token={token} />
        <footer className="page-footer">
          <span>Requests are suggestions. ENS identity is rechecked before every grant.</span>
          <span>{updatedAt ? `Last received ${updatedAt}` : 'Waiting for API'}</span>
        </footer>
      </main>
    </>
  )
}
