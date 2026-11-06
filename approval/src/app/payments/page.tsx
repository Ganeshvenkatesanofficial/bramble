import Link from 'next/link'
import Image from 'next/image'
import { PaymentsPanel } from '../../components/payments-panel'

export default function PaymentsPage() {
  return (
    <div className="payments-page">
      <header>
        <Link href="/" className="brand">
          <Image className="brand-mark" src="/bramble-logo.png" alt="" width={28} height={28} unoptimized />
          bramble / approval
        </Link>
      </header>
      <main id="main-content">
        <PaymentsPanel />
      </main>
    </div>
  )
}
