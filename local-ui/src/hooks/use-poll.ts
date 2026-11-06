'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiFailure } from '../lib/api'

/** Calls `load` now and then one second after each answer. `load` must be a stable function. */
export function usePoll<T>(load: (signal: AbortSignal) => Promise<T>, enabled = true) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiFailure | null>(null)
  const tickRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    if (!enabled) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let current: AbortController | undefined
    const tick = async () => {
      clearTimeout(timer)
      current?.abort()
      const mine = new AbortController()
      current = mine
      try {
        const next = await load(mine.signal)
        if (active && current === mine) {
          setData(next)
          setError(null)
        }
      } catch (failure) {
        if (active && current === mine && !mine.signal.aborted) {
          setError(
            failure instanceof ApiFailure ? failure : new ApiFailure('Bramble is not answering.', 'Reload this page.')
          )
        }
      } finally {
        if (active && current === mine) timer = setTimeout(tick, 1000)
      }
    }
    tickRef.current = tick
    void tick()
    return () => {
      active = false
      clearTimeout(timer)
      current?.abort()
    }
  }, [enabled, load])

  const refresh = useCallback(() => tickRef.current(), [])
  return { data, error, refresh }
}
