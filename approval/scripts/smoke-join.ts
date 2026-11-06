// Opt-in Sepolia lifecycle smoke. Requires the admin machine's existing signer configuration.
import { createApprovalApi } from '../src/lib/api'
import { ConfigError, realJoinChainFromEnv } from '../src/lib/chain-env'
import { randomBytes } from 'node:crypto'
import { x25519 } from '@noble/curves/ed25519'
import { bytesToHex } from '@noble/hashes/utils'

try {
  const tailnet = process.env.APPROVAL_ENS_PARENT
  if (!tailnet) throw new ConfigError('APPROVAL_ENS_PARENT is required for the Sepolia smoke')
  const joinChain = realJoinChainFromEnv()
  if (!joinChain) throw new ConfigError('The enrollment signer is not configured')
  // This token belongs only to the temporary loopback API instance.
  const token = randomBytes(32).toString('hex')
  const api = createApprovalApi({ token: () => token, ensParent: tailnet, joinChain })
  const label = `eth181-${Date.now().toString(36)}`
  const pubkey = bytesToHex(x25519.getPublicKey(randomBytes(32)))
  async function call(path: string, method = 'GET', body?: unknown) {
    const response = await api.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    )
    const result = await response.json()
    if (!response.ok) throw new ConfigError(`${response.status} ${result.error.code}: ${result.error.message}`)
    return result
  }
  const created = await call('/joins', 'POST', { label, pubkey, tailnet })
  const approved = await call(`/joins/${created.id}/approve`, 'POST')
  if (approved.status !== 'approved' || !approved.meshIp || !approved.enrollTransactions?.meshIp)
    throw new Error('enrollment evidence missing')
  console.log(
    JSON.stringify({
      label,
      status: approved.status,
      meshIp: approved.meshIp,
      transactions: approved.enrollTransactions,
    })
  )
  const revoked = await call(`/joins/${created.id}/revoke`, 'POST')
  if (revoked.status !== 'revoked' || !revoked.revokeTransaction) throw new Error('revocation evidence missing')
  console.log(JSON.stringify({ label, status: revoked.status, transaction: revoked.revokeTransaction.transactionHash }))
} catch (error) {
  console.error(
    error instanceof ConfigError ? error.message : 'Sepolia join smoke failed; no adapter diagnostics logged.'
  )
  process.exitCode = 1
}
