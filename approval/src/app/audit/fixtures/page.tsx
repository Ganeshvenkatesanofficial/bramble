import Link from 'next/link'
import { HcsPanel } from '../../../components/hcs-panel'
import { fixtureAuditFeed } from '../../../lib/audit-fixture'

export default async function AuditFixturesPage() {
  const feed = await fixtureAuditFeed()
  return (
    <>
      <header className="nav">
        <div className="nav-inner">
          <Link href="/" className="brand">
            <span className="brand-dot" />
            bramble
          </Link>
          <span className="nav-active">HCS audit</span>
          <span className="network mono">Fixture preview</span>
        </div>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <p className="eyebrow">Approval console · Offline review</p>
            <h1>Every action leaves a commitment.</h1>
            <p className="muted">Inspect the audit trail before connecting Hedera testnet.</p>
          </div>
        </div>
        <HcsPanel fixtureFeed={feed} />
        <footer className="page-footer">
          <Link href="/">Back to approvals</Link>
          <span>Live HashScan verification and H4 approval remain open.</span>
        </footer>
      </main>
    </>
  )
}
