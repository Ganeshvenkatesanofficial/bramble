#!/usr/bin/env node
// Public configuration only. Never use SEPOLIA_RPC_URL for the published rpcUrl.
import { buildConfig, WANTED } from '../deploy/scripts/gen-node-config.mjs'

try {
  const env = Object.fromEntries(WANTED.map((name) => [name, process.env[name]]))
  process.stdout.write(JSON.stringify(buildConfig(env, process.argv[2] ?? process.env.BRAMBLE_VERSION), null, 2) + '\n')
} catch (error) {
  console.error(`print-node-config: ${error.message}`)
  process.exitCode = 1
}
