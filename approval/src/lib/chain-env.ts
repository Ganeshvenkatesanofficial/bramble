import { readFile } from 'node:fs/promises'
import { createWalletClient, http, toHex, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { packetToBytes } from 'viem/ens'
import { resolverWriteAbi } from '../../../admincli/src/roles'
import { ringDecrypt } from '../../../admincli/src/ledger-ring'
import type { LoadGranterKey, Signer } from '../../../admincli/src/lib'
import { publicClient, resolveDevice } from '../../../sidecar/src/ens/client'
import { RPC_URL, tailnetName, tailnetRegistry } from '../../../sidecar/src/ens/config'
import { createChainAdapters, type ChainAdapters } from './chain'

type Env = Record<string, string | undefined>

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function required(env: Env, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required for the real signer`)
  return value
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

function viemSigner(privateKey: Hex): Signer {
  const account = privateKeyToAccount(privateKey)
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
 * (the service then answers 503 signer_not_configured). Throws, naming the variable only, when
 * the configuration is partial. The granter key is never read from the environment.
 */
export function realAdaptersFromEnv(env: Env = process.env): ChainAdapters | undefined {
  const granterLabel = env.APPROVAL_GRANTER_LABEL?.trim()
  if (!granterLabel) return undefined

  const rawKey = required(env, 'SEPOLIA_PRIVATE_KEY')
  const signerKey = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(signerKey)) throw new Error('SEPOLIA_PRIVATE_KEY must be 32 bytes of hex')
  const ringPath = required(env, 'BRAMBLE_GRANTER_KEY_RING_PATH')
  tailnetRegistry()

  return createChainAdapters({
    resolver: { getText: (name, key) => publicClient.getEnsText({ name, key }) },
    signer: viemSigner(signerKey as Hex),
    readDevice: resolveDevice,
    tailnetName: tailnetName(),
    granterLabel,
    loadGranterKey: ringKeyLoader(ringPath),
  })
}
