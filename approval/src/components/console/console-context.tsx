'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useRequests } from '../../hooks/use-requests'
import type { RequestView } from '../../lib/console-api'

type ConsoleState = {
  token: string
  setToken: (token: string) => void
  requests: RequestView[] | null
  error: string | null
  updatedAt: string | null
  pending: RequestView[]
  grants: RequestView[]
  history: RequestView[]
}

const ConsoleContext = createContext<ConsoleState | null>(null)

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const { requests, error, updatedAt } = useRequests()
  const [token, setToken] = useState('')
  const value = useMemo<ConsoleState>(
    () => ({
      token,
      setToken,
      requests,
      error,
      updatedAt,
      pending: requests?.filter((item) => item.status === 'pending' || item.status === 'approving') ?? [],
      grants: requests?.filter((item) => item.status === 'approved' || item.status === 'revoking') ?? [],
      history: requests?.filter((item) => item.status === 'denied' || item.status === 'revoked') ?? [],
    }),
    [token, requests, error, updatedAt]
  )
  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>
}

export function useConsole() {
  const value = useContext(ConsoleContext)
  if (!value) throw new Error('useConsole must be used inside ConsoleProvider')
  return value
}
