import { expect, test } from 'bun:test'
import { createPublicClient, http, type ReplacementReason, type TransactionReceipt } from 'viem'
import { sepolia } from 'viem/chains'
import { createViemEnrollChain } from './enroll-chain-viem'

const hashA = `0x${'1'.repeat(64)}` as const
const hashB = `0x${'b'.repeat(64)}` as const

type WaitForReceipt = (args: {
  hash: `0x${string}`
  onReplaced?: (replacement: { reason: ReplacementReason }) => void
}) => Promise<TransactionReceipt>

/** A loopback wallet RPC that answers every send with `hashA`. The test supplies the receipt boundary. */
async function withFixtureChain(
  waitForTransactionReceipt: WaitForReceipt,
  run: (write: () => Promise<string>, sends: () => number) => Promise<void>
) {
  let sends = 0
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const { id, method } = (await request.json()) as { id: number; method: string }
      if (method === 'eth_sendTransaction') sends++
      return Response.json({ jsonrpc: '2.0', id, result: method === 'eth_chainId' ? '0xaa36a7' : hashA })
    },
  })
  try {
    const publicClient = {
      ...createPublicClient({ chain: sepolia, transport: http(server.url.href) }),
      waitForTransactionReceipt,
    }
    const chain = createViemEnrollChain({
      account: { address: `0x${'1'.repeat(40)}`, type: 'json-rpc' },
      publicClient: publicClient as never,
      chain: sepolia,
      rpcUrl: server.url.href,
    })
    const write = () => chain.setTextAt(`0x${'2'.repeat(40)}`, 'laptop.mesh.eth', 'revoked', 'true')
    await run(write, () => sends)
  } finally {
    server.stop(true)
  }
}

const receipt = (transactionHash: `0x${string}`) =>
  ({ status: 'success', logs: [], transactionHash }) as unknown as TransactionReceipt

test('a receipt timeout retries the same submitted transaction without another send', async () => {
  let checks = 0
  await withFixtureChain(
    async ({ hash }) => {
      if (++checks === 1) throw new Error('fixture receipt timeout')
      return receipt(hash)
    },
    async (write, sends) => {
      await expect(write()).rejects.toThrow('fixture receipt timeout')
      expect(await write()).toBe(hashA)
      expect(sends()).toBe(1)
    }
  )
})

test('a successful cancellation is not a confirmation, and a retry submits the write again', async () => {
  let checks = 0
  await withFixtureChain(
    async ({ hash, onReplaced }) => {
      if (++checks > 1) return receipt(hash)
      onReplaced?.({ reason: 'cancelled' })
      return receipt(hashB)
    },
    async (write, sends) => {
      await expect(write()).rejects.toThrow('was cancelled before it confirmed')
      expect(await write()).toBe(hashA)
      expect(sends()).toBe(2)
    }
  )
})

test('a different transaction on the same nonce is not a confirmation', async () => {
  await withFixtureChain(
    async ({ onReplaced }) => {
      onReplaced?.({ reason: 'replaced' })
      return receipt(hashB)
    },
    async (write) => {
      await expect(write()).rejects.toThrow('was replaced before it confirmed')
    }
  )
})

test('an equivalent repriced write confirms with the hash that was mined', async () => {
  await withFixtureChain(
    async ({ onReplaced }) => {
      onReplaced?.({ reason: 'repriced' })
      return receipt(hashB)
    },
    async (write, sends) => {
      expect(await write()).toBe(hashB)
      expect(sends()).toBe(1)
    }
  )
})
