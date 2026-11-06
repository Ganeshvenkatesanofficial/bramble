'use client'

import { fetchJoins, fetchMembers } from '../lib/api'
import { usePoll } from './use-poll'

async function loadAdmin(signal: AbortSignal) {
  const [joins, members] = await Promise.all([fetchJoins(signal), fetchMembers(signal)])
  return { joins, members }
}

export function useAdmin(enabled: boolean) {
  const { data, error, refresh } = usePoll(loadAdmin, enabled)
  return { joins: data?.joins ?? null, members: data?.members ?? null, error, refresh }
}
