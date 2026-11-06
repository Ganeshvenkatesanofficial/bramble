'use client'

import { useEffect, useState } from 'react'
import { readJson, type RequestView } from '../lib/console-api'

export function useRequests() {
  const [requests, setRequests] = useState<RequestView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    async function refresh() {
      try {
        const body = await readJson<{ requests: RequestView[] }>('/api/requests', {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        })
        if (active) {
          setRequests(body.requests.slice().reverse())
          setError(null)
          setUpdatedAt(new Date().toLocaleTimeString())
        }
      } catch {
        if (active) setError('Connection lost. Displaying the last received state; decisions are paused.')
      } finally {
        if (active) timer = setTimeout(refresh, 1000)
      }
    }
    void refresh()
    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [])
  return { requests, error, updatedAt }
}
