'use client'

import { useEffect, useRef, useState } from 'react'
import type { NetworkNode, NetworkPing, NetworkView } from '../lib/network'
import { readJson } from '../lib/console-api'
import { Laptop, RefreshCw, Server, Waypoints } from 'lucide-react'
import { cn } from 'cn'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { NetworkGraph } from './network-graph'
import { admissionText, grantText, pathText } from './network-labels'

function NodeCard({ node, token, stale }: { node: NetworkNode; token: string; stale: boolean }) {
  const [result, setResult] = useState<NetworkPing | null>(null)
  const [busy, setBusy] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  async function ping() {
    if (controller.current) return
    const active = new AbortController()
    controller.current = active
    setBusy(true)
    setResult(null)
    try {
      const value = await readJson<NetworkPing>('/api/network/ping', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ id: node.id }),
        signal: AbortSignal.any([active.signal, AbortSignal.timeout(15_000)]),
      })
      if (!active.signal.aborted) setResult(value)
    } catch {
      if (!active.signal.aborted)
        setResult({
          reachable: false,
          rttMs: null,
          measuredAt: new Date().toISOString(),
          method: node.kind === 'relay' ? 'http' : 'icmp',
          detail: 'Probe unavailable. Refresh the network and retry.',
        })
    } finally {
      if (!active.signal.aborted) setBusy(false)
      controller.current = null
    }
  }
  return (
    <article className="network-node-card !border-0 !bg-transparent !p-0" aria-label={`Network node ${node.label}`}>
      <p className="eyebrow">{node.kind}</p>
      <h3 className="mono wrap">{node.label}</h3>
      {node.kind === 'device' && (
        <>
          <p className="node-state">
            {admissionText[node.admission]} · {pathText[node.path]}
          </p>
          <p className="muted">Membership: {node.membership ?? 'Not observed in ENS membership'}</p>
          <p className="muted">
            Last handshake:{' '}
            {node.lastHandshake ? (
              <time dateTime={node.lastHandshake}>{new Date(node.lastHandshake).toLocaleString()}</time>
            ) : (
              'Unavailable'
            )}
          </p>
          {node.grants.length ? (
            <ul className="grant-list">
              {node.grants.map((grant) => (
                <li key={grant.id}>
                  <span className="mono wrap">{grant.service}</span> via{' '}
                  <span className="mono wrap">{grant.gateway}</span> · {grantText[grant.state]}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No service grants recorded in this console.</p>
          )}
        </>
      )}
      {node.kind === 'gateway' && (
        <p className="muted">
          Gateway identified by the approval namespace or recorded grant. Live observations are optional.
        </p>
      )}
      {node.kind === 'relay' && (
        <p className="muted">
          Configured relay or rendezvous service. Check measures HTTP health RTT from the console host; it does not
          prove tunnel connectivity or forwarding.
        </p>
      )}
      <div className="node-probe">
        <Button
          variant="outline"
          disabled={stale || !node.pingable || busy}
          aria-describedby={!node.pingable ? `${node.id}-probe-reason` : undefined}
          onClick={() => void ping()}
        >
          {busy
            ? 'Checking…'
            : node.kind === 'relay'
              ? 'Check relay'
              : node.kind === 'gateway'
                ? 'Check gateway'
                : 'Ping device'}
        </Button>
        {!node.pingable && (
          <small id={`${node.id}-probe-reason`}>
            {node.probeReason ?? 'No supported probe target is known for this node.'}
          </small>
        )}
      </div>
      <div role="status" className={`probe-result ${result && !result.reachable ? 'negative' : ''}`}>
        {busy && 'Probe running…'}
        {result && (
          <>
            <p>
              {result.reachable
                ? `Reachable · ${result.rttMs === null ? 'RTT not reported' : `${result.rttMs} ms ${result.method === 'http' ? 'HTTP RTT' : 'tunnel RTT'}`}`
                : 'Probe failed'}
            </p>
            <p>{result.detail}</p>
            <time dateTime={result.measuredAt}>
              Checked {new Date(result.measuredAt).toLocaleString()}
              {stale ? ' · Network view is stale' : ''}
            </time>
          </>
        )}
      </div>
    </article>
  )
}

export function NetworkPanel({ token }: { token: string }) {
  const [view, setView] = useState<NetworkView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const next = await readJson<NetworkView>('/api/network', {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        })
        if (controller.signal.aborted) return
        if (next.state === 'unavailable') {
          setView((current) => current ?? next)
          throw new Error('unavailable')
        }
        setView(next)
        setError(null)
      } catch {
        if (!controller.signal.aborted)
          setError('Network status is unavailable. Last received data is stale; probes are paused.')
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
          timer = setTimeout(() => void poll(), 5000)
        }
      }
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [token, refresh])
  const selected =
    view?.nodes.find((node) => node.id === selectedId) ??
    view?.nodes.find((node) => node.kind === 'gateway') ??
    view?.nodes[0]
  const stale = !!error || loading || view?.state === 'unavailable'
  const counts = view && {
    devices: view.nodes.filter((n) => n.kind === 'device').length,
    admitted: view.nodes.filter((n) => n.kind === 'device' && n.admission === 'authorized').length,
    relays: view.nodes.filter((n) => n.kind === 'relay').length,
  }
  return (
    <section id="network" aria-labelledby="network-title">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="network-title" className="mr-2">
            Tailnet network
          </h2>
          {counts && (
            <>
              <Badge variant="outline">
                {counts.admitted}/{counts.devices} devices admitted
              </Badge>
              <Badge variant="outline">
                {counts.relays} {counts.relays === 1 ? 'relay' : 'relays'}
              </Badge>
            </>
          )}
        </div>
        {token && (
          <div className="flex items-center gap-3">
            {view && (
              <span className="network-updated muted !m-0 text-xs">
                {error ? 'Stale snapshot' : 'Last observed'}{' '}
                <time dateTime={view.observedAt}>{new Date(view.observedAt).toLocaleTimeString()}</time> · refreshes
                every 5 seconds
              </span>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setLoading(true)
                setRefresh((value) => value + 1)
              }}
              disabled={loading}
            >
              <RefreshCw className={cn(loading && 'animate-spin')} aria-hidden="true" />
              Refresh network
            </Button>
          </div>
        )}
      </div>
      {!token ? (
        <p className="empty">Unlock the console to view private network status and run latency checks.</p>
      ) : (
        <>
          {error && (
            <p role="alert" className="notice negative mb-4">
              {error}
            </p>
          )}
          {loading && !view && (
            <p role="status" className="empty">
              Loading network status…
            </p>
          )}
          {view?.state === 'not_configured' && (
            <p className="notice mb-4">
              Live peer admission, paths and handshakes are unavailable without the optional gateway feed. Approval
              records and configured console-host checks remain available.
            </p>
          )}
          {view?.relayState === 'unavailable' && (
            <p className="notice mb-4">Relay discovery is unavailable. Unmatched paths remain unknown.</p>
          )}
          {view?.membershipState === 'unavailable' && (
            <p className="notice mb-4">ENS membership is unavailable. Membership state is unknown.</p>
          )}
          {view && view.nodes.length === 0 && view.state === 'ok' && (
            <p className="empty">No network nodes observed yet.</p>
          )}
          {view && view.nodes.length > 0 && selected && (
            <div className={cn('grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]', error && 'opacity-80')}>
              <Card className="overflow-hidden py-0">
                <div className="h-[30rem] min-h-[22rem] lg:h-[calc(100dvh-16rem)]">
                  <NetworkGraph view={view} selectedId={selected.id} onSelect={setSelectedId} />
                </div>
              </Card>
              <div className="grid gap-4 lg:sticky lg:top-0">
                <Card className="gap-0 px-5">
                  <NodeCard key={selected.id} node={selected} token={token} stale={stale} />
                </Card>
                <Card className="gap-0 overflow-hidden py-0">
                  <p className="eyebrow border-b border-divider px-5 py-3">All nodes ({view.nodes.length})</p>
                  <ul className="m-0 max-h-64 list-none overflow-y-auto p-1">
                    {view.nodes.map((node) => {
                      const Icon = node.kind === 'gateway' ? Server : node.kind === 'relay' ? Waypoints : Laptop
                      return (
                        <li key={node.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedId(node.id)}
                            aria-pressed={node.id === selected.id}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-md border-0 bg-transparent px-3 py-2 text-left text-sm hover:bg-secondary',
                              node.id === selected.id && 'bg-secondary'
                            )}
                          >
                            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span className="mono min-w-0 flex-1 truncate">{node.label}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {node.kind === 'device' ? admissionText[node.admission] : node.kind}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </Card>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
