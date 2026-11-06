import { readFile } from 'node:fs/promises'
import { createWalletClient, http, toHex, TransactionReceiptNotFoundError, type Hex } from 'viem'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { packetToBytes } from 'viem/ens'
import { resolverWriteAbi } from '../../../admincli/src/roles'
import { ringDecrypt } from '../../../admincli/src/ledger-ring'
import type { LoadGranterKey, Signer } from '../../../admincli/src/lib'
import { RPC_URL, tailnetName, tailnetRegistry } from '../../../sidecar/src/ens/config'
import { createChainAdapters, type ChainAdapters } from './chain'
import { publicClient, readDevice } from './ens-reader'

type Env = Record<string, string | undefined>

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** A configuration failure whose message is a fixed diagnostic naming a variable, never a value. */
export class ConfigError extends Error {}

function required(env: Env, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new ConfigError(`${name} is required for the real signer`)
  return value
}

// Third-party validators (viem) echo the offending value in their messages, so discard them.
function sanitized<T>(variable: string, problem: string, build: () => T): T {
  try {
    return build()
  } catch {
    throw new ConfigError(`${variable} ${problem}`)
  }
}

/** Decrypts the granter's X25519 key from the Key Ring file on this machine, per call. No plaintext env fallback. */
function ringKeyLoader(ringPath: string): LoadGranterKey {
  return async () => {
    let ciphertext: Buffer
    try {
      ciphertext = await readFile(ringPath)
    } catch {
      throw new Error(
        'the ring-encrypted granter key file could not be read; run provision-granter-key on this machine'
      )
    }
    return ringDecrypt(ciphertext)
  }
}

async function receiptStatus(hash: string): Promise<'success' | 'reverted' | 'pending'> {
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: hash as Hex })
    return receipt.status === 'success' ? 'success' : 'reverted'
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) return 'pending'
    throw error
  }
}

function viemSigner(account: PrivateKeyAccount): Signer {
  const wallet = createWalletClient({
    account,
    chain: sepolia,
    transport: http(RPC_URL),
  })
  return {
    async setText(name, key, value) {
      const resolverAddress = await publicClient.getEnsResolver({ name })
      if (!resolverAddress || resolverAddress === ZERO_ADDRESS) throw new Error(`no resolver found for ${name}`)
      const hash = await wallet.writeContract({
        chain: sepolia,
        account,
        address: resolverAddress,
        abi: resolverWriteAbi,
        functionName: 'setText',
        args: [toHex(packetToBytes(name)), key, value],
      })
      return {
        hash,
        async wait() {
          const receipt = await publicClient.waitForTransactionReceipt({ hash })
          if (receipt.status !== 'success') throw new Error('setText reverted on-chain')
        },
      }
    },
  }
}

/**
 * Real adapters for the admin machine, or `undefined` when `APPROVAL_GRANTER_LABEL` is unset
 * (the service then answers 503 signer_not_configured). Throws a ConfigError, naming the variable only, when
 * the configuration is partial or malformed. The granter key is never read from the environment.
 */
export function realAdaptersFromEnv(env: Env = process.env): ChainAdapters | undefined {
  const granterLabel = env.APPROVAL_GRANTER_LABEL?.trim()
  if (!granterLabel) return undefined

  const rawKey = required(env, 'SEPOLIA_PRIVATE_KEY')
  const signerKey = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(signerKey)) throw new ConfigError('SEPOLIA_PRIVATE_KEY must be 32 bytes of hex')
  const account = sanitized('SEPOLIA_PRIVATE_KEY', 'is not a valid secp256k1 private key', () =>
    privateKeyToAccount(signerKey as Hex)
  )
  const ringPath = required(env, 'BRAMBLE_GRANTER_KEY_RING_PATH')
  sanitized('BRAMBLE_TAILNET_REGISTRY', 'is not a valid address', () => tailnetRegistry())
  const tailnet = sanitized('BRAMBLE_TAILNET_NAME', 'is required for the real signer', () => tailnetName())

  return createChainAdapters({
    resolver: { getText: (name, key) => publicClient.getEnsText({ name, key }) },
    signer: viemSigner(account),
    readDevice,
    getReceiptStatus: receiptStatus,
    tailnetName: tailnet,
    granterLabel,
    loadGranterKey: ringKeyLoader(ringPath),
  })
}
