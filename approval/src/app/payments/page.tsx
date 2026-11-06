import { PageHeader } from '../../components/console/page-header'
import { PaymentsPanel } from '../../components/payments-panel'

export default function PaymentsPage() {
  return (
    <>
      <PageHeader title="Payments" description="Settled x402 USDC payments on Hedera testnet, from the mirror node." />
      <div className="payments-page">
        <PaymentsPanel />
      </div>
    </>
  )
}
