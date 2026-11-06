import Link from 'next/link'
import { PaymentsPanel } from '../../components/payments-panel'

export default function PaymentsPage() {
  return (
    <div className="payments-page">
      <header>
        <Link href="/">bramble / approval</Link>
      </header>
      <main id="main-content">
        <PaymentsPanel />
      </main>
    </div>
  )
}
