import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEnv, buildConfig } from './gen-tailnet-config.mjs'

const ADDR_A = '0x' + 'a'.repeat(40)
const ADDR_B = '0x' + 'b'.repeat(40)
const base = `
BRAMBLE_CONSOLE_HOST=console.example.com
BRAMBLE_RPC_HOST=rpc.example.com
BRAMBLE_TAILNET_NAME=Demo-Net.eth
BRAMBLE_TAILNET_REGISTRY=${ADDR_A}
BRAMBLE_TAILNET_REGISTRY_DEPLOY_BLOCK=100
BRAMBLE_RELAY_REGISTRY=${ADDR_B}
BRAMBLE_RELAY_REGISTRY_DEPLOY_BLOCK=200
BRAMBLE_STUN_SERVERS=203.0.113.5:3478
BRAMBLE_RENDEZVOUS=203.0.113.5:9420
BRAMBLE_DATA_RELAYS=http://203.0.113.5:7891
`

test('builds the config with defaults derived from the host names', () => {
  const c = buildConfig(parseEnv(base))
  assert.equal(c.name, 'demo-net.eth')
  assert.equal(c.rpcUrl, 'https://rpc.example.com/')
  assert.equal(c.approvalUrl, 'https://console.example.com')
  assert.deepEqual(c.stunServers, ['203.0.113.5:3478'])
  assert.equal(c.registryDeployBlock, 100)
  assert.deepEqual(c.services, [])
})

test('never reads secrets from a node env file', () => {
  const secret = 'f'.repeat(64)
  const env = parseEnv(
    `${base}\nBRAMBLE_PRIVATE_KEY=${secret}\nSEPOLIA_RPC_URL=https://x.example/v3/abcdefabcdefabcdefabcdef12\nHEDERA_CLIENT_PRIVATE_KEY=302e0201\n`
  )
  assert.deepEqual(Object.keys(env).sort(), Object.keys(parseEnv(base)).sort())
  assert.ok(!JSON.stringify(buildConfig(env)).includes(secret))
})

test('rejects a credentialed RPC URL', () => {
  for (const url of [
    'https://user:pw@rpc.example.com/',
    'https://rpc.example.com/?apikey=1',
    'https://rpc.example.com/v3/abcdefabcdefabcdefabcdef12',
  ]) {
    assert.throws(() => buildConfig(parseEnv(`${base}\nBRAMBLE_PUBLIC_RPC_URL=${url}`)), /rpcUrl/)
  }
})

test('rejects missing and malformed values', () => {
  assert.throws(() => buildConfig(parseEnv(base.replace(/BRAMBLE_TAILNET_NAME=.*/, ''))), /BRAMBLE_TAILNET_NAME/)
  assert.throws(() => buildConfig(parseEnv(base.replace(ADDR_A, '0x12'))), /address/)
  assert.throws(() => buildConfig(parseEnv(base.replace('203.0.113.5:3478', 'nohost'))), /host:port/)
  assert.throws(() => buildConfig(parseEnv(base.replace('Demo-Net.eth', 'demo.com'))), /\.eth/)
})

test('rejects a 64-digit hex string anywhere in the output', () => {
  const key = '1'.repeat(64)
  assert.throws(() => buildConfig(parseEnv(`${base}\nBRAMBLE_PUBLIC_SERVICES=${key}`)), /looks like a key/)
})
