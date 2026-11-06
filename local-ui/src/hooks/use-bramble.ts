'use client'

import { fetchState } from '../lib/api'
import { usePoll } from './use-poll'

export function useBrambleState() {
  const { data, error, refresh } = usePoll(fetchState)
  return { state: data, lost: error, refresh }
}
