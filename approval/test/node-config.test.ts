import { expect, test } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../../scripts/print-node-config.mjs', import.meta.url))
const env = {
  NODE_ENV: 'test' as const,
  BRAMBLE_TAILNET_NAME: 'mesh.eth',
  BRAMBLE_CHAIN_ID: '11155111',
  BRAMBLE_PUBLIC_RPC_URL: 'https://rpc.example.org/',
  BRAMBLE_APPROVAL_URL: 'https://console.example.org/',
  BRAMBLE_TAILNET_REGISTRY: `0x${'1'.repeat(40)}`,
  BRAMBLE_RENDEZVOUS: 'relay.example.org:9090',
  BRAMBLE_STUN_SERVERS: 'stun.example.org:3478',
}
test('environment command prints the public onboarding configuration', () => {
  const output = execFileSync(process.execPath, [script, '0.1.0'], { env, encoding: 'utf8' })
  expect(JSON.parse(output)).toEqual({
    version: '0.1.0',
    tailnet: 'mesh.eth',
    chainId: 11155111,
    rpcUrl: 'https://rpc.example.org/',
    registry: `0x${'1'.repeat(40)}`,
    joinApi: 'https://console.example.org',
    rendezvous: 'relay.example.org:9090',
    stun: ['stun.example.org:3478'],
  })
})
test('invalid public URLs fail without emitting configuration or URL contents', () => {
  const result = spawnSync(process.execPath, [script, '0.1.0'], {
    env: { ...env, BRAMBLE_PUBLIC_RPC_URL: 'https://rpc.example.org/?api_key=fixture-only' },
    encoding: 'utf8',
  })
  expect(result.status).toBe(1)
  expect(result.stdout).toBe('')
  expect(result.stderr).not.toContain('fixture-only')
})
