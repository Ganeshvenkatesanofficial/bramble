'use client'

import { useState } from 'react'
import { useAdmin } from '../hooks/use-admin'
import { useBrambleState } from '../hooks/use-bramble'
import { AdminView } from './admin-view'
import { Notice } from './bits'
import { ConnectedScreen } from './connected-screen'
import {
  ApprovedScreen,
  DeniedScreen,
  ErrorScreen,
  JoinScreen,
  PendingScreen,
  SetupScreen,
  UnreachableScreen,
} from './flow-screens'

type Tab = 'device' | 'admin'

export function LocalApp() {
  const { state, lost, refresh } = useBrambleState()
  const [tab, setTab] = useState<Tab>('device')
  const isAdmin = state?.isAdmin === true
  const admin = useAdmin(isAdmin)
  const showAdmin = isAdmin && tab === 'admin'
  const waiting = admin.joins?.filter((join) => join.status === 'pending').length ?? 0

  return (
    <>
      <header className="nav">
        <div className="nav-inner">
          <span className="brand">
            <span className="brand-dot" />
            bramble
          </span>
          {isAdmin && (
            <nav aria-label="Sections" className="tabs">
              <button type="button" aria-current={!showAdmin ? 'page' : undefined} onClick={() => setTab('device')}>
                This device
              </button>
              <button type="button" aria-current={showAdmin ? 'page' : undefined} onClick={() => setTab('admin')}>
                Admin
                {waiting > 0 && (
                  <span className="count" aria-label={`${waiting} waiting`}>
                    {waiting}
                  </span>
                )}
              </button>
            </nav>
          )}
          <span className={`connection ${lost ? 'negative' : state ? 'online' : ''}`}>
            <span className="status-dot" />
            {lost ? 'No signal from Bramble' : state ? 'Live' : 'Connecting…'}
          </span>
        </div>
      </header>
      <main>
        {lost && state && (
          <Notice
            title="Lost contact with Bramble on this device."
            nextStep={`${lost.nextStep} Showing the last state; changes are paused.`}
          />
        )}
        {state?.error && state.phase !== 'error' && (
          <Notice title={state.error.message} nextStep={state.error.nextStep} />
        )}
        {!state && !lost && (
          <p role="status" className="empty">
            Starting…
          </p>
        )}
        {!state && lost && <UnreachableScreen failure={lost} />}
        {state && showAdmin && <AdminView {...admin} />}
        {state && !showAdmin && <DeviceScreens state={state} refresh={refresh} />}
        <footer className="page-footer">
          <span>Each device checks the others against the network&apos;s public record, not a central server.</span>
          <span>{state?.name ? `This device: ${state.name}` : 'This page runs only on this device.'}</span>
        </footer>
      </main>
    </>
  )
}

function DeviceScreens({
  state,
  refresh,
}: {
  state: NonNullable<ReturnType<typeof useBrambleState>['state']>
  refresh: () => Promise<void>
}) {
  switch (state.phase) {
    case 'setup':
      return <SetupScreen state={state} refresh={refresh} />
    case 'ready':
      return <JoinScreen state={state} refresh={refresh} />
    case 'pending':
      return <PendingScreen state={state} refresh={refresh} />
    case 'approved':
      return <ApprovedScreen state={state} />
    case 'denied':
      return <DeniedScreen state={state} refresh={refresh} />
    case 'connected':
      return <ConnectedScreen state={state} refresh={refresh} />
    case 'error':
      return <ErrorScreen state={state} refresh={refresh} />
  }
}
