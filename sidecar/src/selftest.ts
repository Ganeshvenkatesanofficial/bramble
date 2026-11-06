// `bramble-sidecar --self-test`: checks that the parts a compiled executable
// can lose still work, without the network and without any configured key.
// It signs an x402 Hedera transfer with a throwaway key and verifies it.
import { decodePaymentSignatureHeader } from '@x402/core/http'
import { createClientHederaSigner, PrivateKey, Transaction, TransferTransaction } from '@x402/hedera'
import { ExactHederaScheme } from '@x402/hedera/exact/client'
import { HEDERA_USDC_ASSET_ID } from './payments/config'

const PAYER = '0.0.1001'
const PAY_TO = '0.0.3003'

export async function runSelfTest(): Promise<void> {
  const key = PrivateKey.generateECDSA()
  const signer = createClientHederaSigner(PAYER, key, { network: 'hedera:testnet' })
  const payload = await new ExactHederaScheme(signer).createPaymentPayload(2, {
    scheme: 'exact',
    network: 'hedera:testnet',
    amount: '1000',
    asset: HEDERA_USDC_ASSET_ID,
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: { feePayer: '0.0.2002' },
  })
  const header = Buffer.from(JSON.stringify({ x402Version: 2, payload: payload.payload })).toString('base64')
  const { transaction } = decodePaymentSignatureHeader(header).payload as { transaction: string }
  const tx = Transaction.fromBytes(Buffer.from(transaction, 'base64'))
  if (!(tx instanceof TransferTransaction) || !key.publicKey.verifyTransaction(tx)) {
    throw new Error('x402 payment signature did not verify')
  }
  const sent = tx.tokenTransfers.get(HEDERA_USDC_ASSET_ID)?.get(PAYER)?.toString()
  if (sent !== '-1000') throw new Error(`unexpected transfer amount ${sent}`)
}
