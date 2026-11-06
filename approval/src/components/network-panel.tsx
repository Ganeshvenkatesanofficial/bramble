'use client'

import { useEffect, useRef, useState } from 'react'
import type { NetworkNode, NetworkPing, NetworkView } from '../lib/network'
import { readJson } from '../lib/console-api'
import { Button } from './ui/button'

const admissionText = {
  authorized: 'Admitted',
  not_authorized: 'Not admitted',
  unknown: 'Admission unknown',
  unavailable: 'Admission unavailable',
}
const pathText = {
  direct: 'Direct',
  relayed: 'Relayed',
  unknown: 'Path unknown',
  none: 'No observed link',
  unavailable: 'Path unavailable',
}
const grantText = {
  pending: 'Pending',
  approving: 'Grant pending',
  approved: 'Granted',
  revoking: 'Revoke pending',
  revoked: 'Revoked',
  denied: 'Denied',
}

function NetworkGraph({ view }: { view: NetworkView }) {
  // Keep the diagram legible on a phone. Every node remains in the detailed list.
  const visible = view.nodes.slice(0, 24)
  const gateway = visible.find((node) => node.kind === 'gateway')
  const relays = visible.filter((node) => node.kind === 'relay')
  const devices = visible.filter((node) => node.kind === 'device')
  const relayRows = Math.ceil(relays.length / 3)
  const points = new Map<string, { x: number; y: number }>()
  if (gateway) points.set(gateway.id, { x: 180, y: 40 })
  relays.forEach((node, i) => points.set(node.id, { x: 60 + (i % 3) * 120, y: 135 + Math.floor(i / 3) * 95 }))
  devices.forEach((node, i) =>
    points.set(node.id, { x: 60 + (i % 3) * 120, y: 140 + relayRows * 95 + Math.floor(i / 3) * 95 })
  )
  const height = 205 + relayRows * 95 + Math.max(0, Math.ceil(devices.length / 3) - 1) * 95
  return (
    <figure className="network-diagram">
      <svg viewBox={`0 0 360 ${height}`} role="img" aria-labelledby="network-svg-title network-svg-desc">
        <title id="network-svg-title">Observed tailnet connections</title>
        <desc id="network-svg-desc">
          Approval records with optional gateway observations. Solid lines indicate direct paths, dashed lines relayed
          paths and dotted lines unknown or unavailable paths. Node details, state and handshake times follow in the
          node list.
        </desc>
        {view.links.map((link) => {
          const a = points.get(link.from),
            b = points.get(link.to)
          return a && b ? (
            <line
              key={`${link.from}:${link.to}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={`graph-link ${link.path}`}
            />
          ) : null
        })}
        {visible.map((node) => {
          const p = points.get(node.id)!
          return (
            <g key={node.id} transform={`translate(${p.x} ${p.y})`}>
              <title>
                {node.label} · {admissionText[node.admission]} · {pathText[node.path]}
              </title>
              {node.kind === 'relay' ? (
                <rect x="-22" y="-22" width="44" height="44" rx="6" className="graph-node" />
              ) : (
                <circle r="22" className={`graph-node ${node.admission}`} />
              )}
              <text textAnchor="middle" dominantBaseline="central" className="graph-code">
                {node.kind === 'gateway'
                  ? 'G'
                  : node.kind === 'relay'
                    ? `R${relays.indexOf(node) + 1}`
                    : `D${devices.indexOf(node) + 1}`}
              </text>
              <text textAnchor="middle" y="43" className="graph-label">
                {node.kind === 'gateway' ? 'Gateway' : node.label.split('.')[0].slice(0, 13)}
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption>
        <ul className="graph-legend" aria-label="Connection legend">
          <li>
            <span className="legend-line direct" />
            Direct
          </li>
          <li>
            <span className="legend-line relayed" />
            Relayed
          </li>
          <li>
            <span className="legend-line unknown" />
            Unknown
          </li>
          <li>
            <span className="legend-line unavailable" />
            Unavailable (approval records)
          </li>
        </ul>
        <p className="muted">
          Approval records connect devices to the gateway. Unavailable links have no live path source. Optional gateway
          observations enrich paths; a line does not prove reachability.
        </p>
        {view.nodes.length > visible.length && (
          <p>
            Diagram shows {visible.length} of {view.nodes.length} nodes. All nodes appear below.
          </p>
        )}
      </figcaption>
    </figure>
  )
}

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
    <article className="network-node-card" aria-label={`Network node ${node.label}`}>
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
  return (
    <section className="network-panel" id="network" aria-labelledby="network-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Connectivity · approval records and observations</p>
          <h2 id="network-title">Tailnet network</h2>
        </div>
        {token && (
          <Button
            variant="outline"
            onClick={() => {
              setLoading(true)
              setRefresh((value) => value + 1)
            }}
            disabled={loading}
          >
            Refresh network
          </Button>
        )}
      </div>
      {!token ? (
        <p className="empty">Unlock the console to view private network status and run latency checks.</p>
      ) : (
        <>
          {error && (
            <p role="alert" className="notice negative">
              {error}
            </p>
          )}
          {loading && !view && (
            <p role="status" className="empty">
              Loading network status…
            </p>
          )}
          {view?.state === 'not_configured' && (
            <p className="notice">
              Live peer admission, paths and handshakes are unavailable without the optional gateway feed. Approval
              records and configured console-host checks remain available.
            </p>
          )}
          {view?.relayState === 'unavailable' && (
            <p className="notice">Relay discovery is unavailable. Unmatched paths remain unknown.</p>
          )}
          {view?.membershipState === 'unavailable' && (
            <p className="notice">ENS membership is unavailable. Membership state is unknown.</p>
          )}
          {view && view.nodes.length === 0 && view.state === 'ok' && (
            <p className="empty">No network nodes observed yet.</p>
          )}
          {view && view.nodes.length > 0 && (
            <div className={`network-layout ${error ? 'stale' : ''}`}>
              <NetworkGraph view={view} />
              <div className="network-node-list">
                {view.nodes.map((node) => (
                  <NodeCard
                    key={node.id}
                    node={node}
                    token={token}
                    stale={!!error || loading || view.state === 'unavailable'}
                  />
                ))}
              </div>
            </div>
          )}
          {view && (
            <p className="network-updated muted">
              {error ? 'Stale snapshot' : 'Last observed'}{' '}
              <time dateTime={view.observedAt}>{new Date(view.observedAt).toLocaleString()}</time> · refreshes every 5
              seconds
            </p>
          )}
        </>
      )}
    </section>
  )
}
