'use client'

import { useEffect, useState } from 'react'
import type { IdentityFacts as Facts } from '../lib/contracts'
import { readJson } from '../lib/console-api'

export function IdentityFacts({ label, kind }: { label: string; kind: string }) {
  const [identity, setIdentity] = useState<Facts | null>(null)
  const [observedAt, setObservedAt] = useState(0)
  const [state, setState] = useState('Resolving ENS identity…')
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    async function resolve() {
      try {
        const body = await readJson<{ identity: Facts | null }>(`/api/identities/${encodeURIComponent(label)}`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        })
        if (active) {
          setIdentity(body.identity)
          setObservedAt(Date.now())
          setState(body.identity ? '' : 'Identity not found in ENS')
        }
      } catch {
        if (active) {
          setIdentity(null)
          setState('ENS facts unavailable')
        }
      } finally {
        if (active) timer = setTimeout(resolve, 10_000)
      }
    }
    void resolve()
    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [label])
  const expired = identity && identity.expiry * 1000 <= observedAt
  return (
    <div className="identity">
      <span className="eyebrow">{kind} identity · ENS</span>
      <span className="mono wrap">{label}</span>
      {identity ? (
        <div className="identity-details">
          <span className={identity.pubkeyPublished ? 'positive' : 'negative'}>
            {identity.pubkeyPublished ? 'Public key published' : 'No public key'}
          </span>
          <span className={identity.revoked || expired ? 'negative' : ''}>
            {identity.revoked ? 'Revoked' : expired ? 'Expired' : 'Not revoked'}
          </span>
          <span>Expires {new Date(identity.expiry * 1000).toLocaleDateString()}</span>
        </div>
      ) : (
        <span className="muted">{state}</span>
      )}
    </div>
  )
}
