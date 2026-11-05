import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = { title: 'Bramble approval console', description: 'Scoped access and agent payments' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <a href="/payments">bramble / approval</a>
        </header>
        <main>{children}</main>
      </body>
    </html>
  )
}
