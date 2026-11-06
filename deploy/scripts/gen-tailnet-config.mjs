#!/usr/bin/env node
// Build the public tailnet config (`/tailnets/<name>.json`) from env files.
// Reads only the names in WANTED, so a node env file is safe to pass: its
// private keys are never read. Refuses to emit anything that looks like a
// credential. Usage: gen-tailnet-config.mjs --env FILE [--env FILE ...] [--out FILE]
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const WANTED = [
  'BRAMBLE_CONSOLE_HOST',
  'BRAMBLE_RPC_HOST',
  'BRAMBLE_TAILNET_NAME',
  'BRAMBLE_TAILNET_REGISTRY',
  'BRAMBLE_TAILNET_REGISTRY_DEPLOY_BLOCK',
  'BRAMBLE_RELAY_REGISTRY',
  'BRAMBLE_RELAY_REGISTRY_DEPLOY_BLOCK',
  'BRAMBLE_PUBLIC_RPC_URL',
  'BRAMBLE_STUN_SERVERS',
  'BRAMBLE_RENDEZVOUS',
  'BRAMBLE_DATA_RELAYS',
  'BRAMBLE_APPROVAL_URL',
  'BRAMBLE_PUBLIC_SERVICES',
]

export function parseEnv(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if (!m || !WANTED.includes(m[1])) continue
    let v = m[2].trim()
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1)
    if (v !== '') out[m[1]] = v
  }
  return out
}

const list = (v) => (v ? v.split(/[,\s]+/).filter(Boolean) : [])
const need = (env, name) => {
  if (!env[name]) throw new Error(`missing ${name}`)
  return env[name]
}
const address = (env, name) => {
  const v = need(env, name)
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error(`${name} is not a 20-byte hex address`)
  return v
}
const block = (env, name) => {
  const v = need(env, name)
  if (!/^\d+$/.test(v)) throw new Error(`${name} is not a block number`)
  return Number(v)
}
const hostPort = (v, what) => {
  if (!/^[A-Za-z0-9.-]+:\d{1,5}$/.test(v)) throw new Error(`${what} entry "${v}" is not host:port`)
  return v
}

// A public URL has no user info, no query and no long opaque path segment
// (the shape of an API key in a provider URL).
export function publicUrl(v, what) {
  let u
  try {
    u = new URL(v)
  } catch {
    throw new Error(`${what} is not a URL`)
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`${what} must be http(s)`)
  if (u.username || u.password) throw new Error(`${what} carries user info`)
  if (u.search || u.hash) throw new Error(`${what} carries a query or fragment`)
  if (u.pathname.split('/').some((s) => /^[A-Za-z0-9_-]{24,}$/.test(s)))
    throw new Error(`${what} has a path segment that looks like an API key`)
  return u.toString()
}

export function buildConfig(env) {
  const name = need(env, 'BRAMBLE_TAILNET_NAME').toLowerCase()
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/.test(name))
    throw new Error('BRAMBLE_TAILNET_NAME is not an ENS name ending in .eth')
  const rpc = env.BRAMBLE_PUBLIC_RPC_URL ?? `https://${need(env, 'BRAMBLE_RPC_HOST')}/`
  const approval = env.BRAMBLE_APPROVAL_URL ?? `https://${need(env, 'BRAMBLE_CONSOLE_HOST')}`
  const config = {
    name,
    registry: address(env, 'BRAMBLE_TAILNET_REGISTRY'),
    registryDeployBlock: block(env, 'BRAMBLE_TAILNET_REGISTRY_DEPLOY_BLOCK'),
    relayRegistry: address(env, 'BRAMBLE_RELAY_REGISTRY'),
    relayDeployBlock: block(env, 'BRAMBLE_RELAY_REGISTRY_DEPLOY_BLOCK'),
    rpcUrl: publicUrl(rpc, 'rpcUrl'),
    stunServers: list(env.BRAMBLE_STUN_SERVERS).map((v) => hostPort(v, 'stunServers')),
    rendezvous: list(env.BRAMBLE_RENDEZVOUS).map((v) => hostPort(v, 'rendezvous')),
    dataRelays: list(env.BRAMBLE_DATA_RELAYS).map((v) => publicUrl(v, 'dataRelays').replace(/\/$/, '')),
    approvalUrl: publicUrl(approval, 'approvalUrl').replace(/\/$/, ''),
    services: list(env.BRAMBLE_PUBLIC_SERVICES),
  }
  assertNoSecret(JSON.stringify(config))
  return config
}

export function assertNoSecret(text) {
  if (/(^|[^0-9a-fA-F])[0-9a-fA-F]{64}([^0-9a-fA-F]|$)/.test(text))
    throw new Error('output contains a 64-digit hex string (looks like a key)')
  if (/PRIVATE|BEGIN [A-Z ]*KEY|Bearer\s|api[_-]?key/i.test(text))
    throw new Error('output contains a credential-looking word')
}

function main(argv) {
  const files = []
  let out
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--env') files.push(argv[++i])
    else if (argv[i] === '--out') out = argv[++i]
    else throw new Error(`unknown argument ${argv[i]}`)
  }
  if (files.length === 0) throw new Error('usage: gen-tailnet-config.mjs --env FILE [--env FILE ...] [--out FILE]')
  const env = Object.assign({}, ...files.map((f) => parseEnv(readFileSync(f, 'utf8'))))
  const json = JSON.stringify(buildConfig(env), null, 2) + '\n'
  if (out) writeFileSync(out, json)
  else process.stdout.write(json)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main(process.argv.slice(2))
  } catch (e) {
    console.error(`gen-tailnet-config: ${e.message}`)
    process.exit(1)
  }
}
