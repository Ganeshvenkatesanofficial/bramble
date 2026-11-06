'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  Activity,
  Coins,
  Inbox,
  Laptop,
  Lock,
  LockOpen,
  Menu,
  Moon,
  Network,
  ScrollText,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react'
import { cn } from 'cn'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { useConsole } from './console-context'

type NavItem = { href: string; label: string; icon: typeof Inbox; count?: 'pending' | 'grants' }

const groups: { name: string; items: NavItem[] }[] = [
  {
    name: 'Operate',
    items: [
      { href: '/', label: 'Requests', icon: Inbox, count: 'pending' },
      { href: '/access', label: 'Access', icon: ShieldCheck, count: 'grants' },
      { href: '/devices', label: 'Devices', icon: Laptop },
    ],
  },
  {
    name: 'Observe',
    items: [
      { href: '/network', label: 'Network', icon: Network },
      { href: '/activity', label: 'Activity', icon: Activity },
      { href: '/audit', label: 'Audit log', icon: ScrollText },
      { href: '/payments', label: 'Payments', icon: Coins },
    ],
  },
]

const titles: Record<string, string> = Object.fromEntries(groups.flatMap((g) => g.items.map((i) => [i.href, i.label])))

function OperatorAccess() {
  const { token, setToken } = useConsole()
  const [draft, setDraft] = useState('')
  function submit(event: FormEvent) {
    event.preventDefault()
    setToken(draft.trim())
    setDraft('')
  }
  if (token)
    return (
      <div
        className="rounded-lg border border-divider bg-secondary/50 p-3"
        aria-label="Operator authorization"
        role="group"
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <LockOpen className="size-4 text-success" aria-hidden="true" />
          Console unlocked
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Decision controls are on. The API checks each action.</p>
        <Button
          variant="outline"
          className="mt-3 w-full"
          onClick={() => {
            setToken('')
            setDraft('')
          }}
        >
          Lock console
        </Button>
      </div>
    )
  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-divider bg-secondary/50 p-3"
      aria-label="Operator authorization"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <Lock className="size-4 text-muted-foreground" aria-hidden="true" />
        Operator access
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Enter the shared demo token to approve and revoke.</p>
      <Label htmlFor="demo-token" className="sr-only">
        Demo token
      </Label>
      <Input
        id="demo-token"
        type="password"
        autoComplete="off"
        placeholder="Demo token"
        className="mt-3 h-9"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <Button type="submit" variant="outline" className="mt-2 w-full" disabled={!draft.trim()}>
        Unlock
      </Button>
    </form>
  )
}

function SidebarNav({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname()
  const { pending, grants } = useConsole()
  const counts = { pending: pending.length, grants: grants.length }
  return (
    <nav aria-label="Console" className="flex-1 overflow-y-auto px-3 py-4">
      {groups.map((group) => (
        <div key={group.name} className="mb-5">
          <p className="eyebrow px-3 pb-2">{group.name}</p>
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {group.items.map(({ href, label, icon: Icon, count }) => {
              const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
              const n = count ? counts[count] : 0
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm no-underline outline-offset-2 hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring',
                      active
                        ? 'bg-secondary font-medium text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="flex-1">{label}</span>
                    {n > 0 && (
                      <Badge variant={count === 'pending' ? 'warning' : 'default'} className="px-2 py-0 tabular-nums">
                        {n}
                      </Badge>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

export function AppShell({ tailnet, children }: { tailnet: string; children: ReactNode }) {
  const pathname = usePathname()
  const { error, updatedAt } = useConsole()
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  const title = titles[pathname] ?? titles['/' + pathname.split('/')[1]] ?? 'Console'
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      {open && (
        <div className="fixed inset-0 z-20 bg-black/40 md:hidden" onClick={() => setOpen(false)} aria-hidden="true" />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-divider bg-card transition-transform md:static md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-divider px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold no-underline" onClick={() => setOpen(false)}>
            <Image src="/bramble-logo.png" alt="" width={26} height={26} unoptimized />
            bramble
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          >
            <X />
          </Button>
        </div>
        {tailnet && (
          <div className="border-b border-divider px-4 py-3">
            <p className="eyebrow">Tailnet</p>
            <p className="mono mt-1 truncate text-sm" title={tailnet}>
              {tailnet}
            </p>
          </div>
        )}
        <SidebarNav onNavigate={() => setOpen(false)} />
        <div className="shrink-0 border-t border-divider p-3">
          <OperatorAccess />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-divider bg-card px-4 md:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
          >
            <Menu />
          </Button>
          <span className="text-sm font-medium">{title}</span>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant={error ? 'destructive' : 'outline'} className="connection">
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  error ? 'bg-destructive' : updatedAt ? 'bg-success' : 'bg-muted-foreground'
                )}
                aria-hidden="true"
              />
              {error ? 'Disconnected' : updatedAt ? 'Live queue · 1s refresh' : 'Connecting…'}
            </Badge>
            <Badge variant="outline" className="mono hidden sm:inline-flex">
              Sepolia
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            >
              {theme === 'light' ? <Moon /> : <Sun />}
            </Button>
          </div>
        </header>
        <main id="main-content" className="m-0 max-w-none min-h-0 flex-1 overflow-y-auto p-0">
          <div className="mx-auto w-full max-w-6xl p-4 md:p-8">{children}</div>
          <footer className="mx-auto flex w-full max-w-6xl flex-wrap justify-between gap-2 px-4 pb-8 text-xs text-muted-foreground md:px-8">
            <span>Requests are suggestions. ENS identity is rechecked before every grant.</span>
            {updatedAt && <span>Last received {updatedAt}</span>}
          </footer>
        </main>
      </div>
    </div>
  )
}
