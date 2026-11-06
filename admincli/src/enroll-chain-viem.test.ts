import { expect, test } from 'bun:test'
import { createPublicClient, http, type TransactionReceipt } from 'viem'
import { sepolia } from 'viem/chains'
import { createViemEnrollChain } from './enroll-chain-viem'

test('a receipt timeout retries the same submitted transaction without another send', async () => {
  let sends = 0
  const hash = `0x${'1'.repeat(64)}` as const
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const { id, method } = (await request.json()) as { id: number; method: string }
      if (method === 'eth_sendTransaction') sends++
      return Response.json({ jsonrpc: '2.0', id, result: method === 'eth_chainId' ? '0xaa36a7' : hash })
    },
  })
  try {
    let checks = 0
    const publicClient = {
      ...createPublicClient({ chain: sepolia, transport: http(server.url.href) }),
      async waitForTransactionReceipt() {
        if (++checks === 1) throw new Error('fixture receipt timeout')
        return { status: 'success', logs: [] } as unknown as TransactionReceipt
      },
    }
    const chain = createViemEnrollChain({
      account: { address: `0x${'1'.repeat(40)}`, type: 'json-rpc' },
      publicClient,
      chain: sepolia,
      rpcUrl: server.url.href,
    })
    const write = () => chain.setTextAt(`0x${'2'.repeat(40)}`, 'laptop.mesh.eth', 'pubkey', 'ab'.repeat(32))
    await expect(write()).rejects.toThrow('fixture receipt timeout')
    expect(await write()).toBe(hash)
    expect(sends).toBe(1)
  } finally {
    server.stop(true)
  }
})
