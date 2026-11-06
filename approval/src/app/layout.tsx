import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { AppShell } from '../components/console/app-shell'
import { ConsoleProvider } from '../components/console/console-context'

export const dynamic = 'force-dynamic'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  icons: { icon: { url: '/bramble-logo.png', type: 'image/png', sizes: '512x512' } },
  title: 'bramble · Approval console',
  description: 'Review agent identities and manage scoped access to private services.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <ConsoleProvider>
          <AppShell tailnet={process.env.BRAMBLE_TAILNET_NAME ?? ''}>{children}</AppShell>
        </ConsoleProvider>
      </body>
    </html>
  )
}
