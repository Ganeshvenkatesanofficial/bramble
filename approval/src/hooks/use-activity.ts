'use client'

import { useEffect, useState } from 'react'
import type { ActivityFeed } from '../lib/activity'
import { readJson } from '../lib/console-api'

export function useActivity() {
  const [feed, setFeed] = useState<ActivityFeed | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    async function refresh() {
      try {
        const body = await readJson<ActivityFeed>('/api/activity', {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        })
        if (active) {
          setFeed(body)
          setError(null)
        }
      } catch {
        if (active) setError('Activity feed unavailable. Showing the last received events.')
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
  return { feed, error }
}
