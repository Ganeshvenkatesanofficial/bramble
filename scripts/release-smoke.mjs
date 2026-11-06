#!/usr/bin/env node
// Host-side harness. Only the two extracted binaries run with the empty PATH.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = JSON.parse(await readFile(path.join(root, 'sidecar/test/fixtures/dev-tailnet.json'), 'utf8'))
const archive = path.resolve(process.argv[2] ?? path.join(root, 'release/bramble_linux_amd64.tar.gz'))
const sums = await readFile(path.join(path.dirname(archive), 'SHA256SUMS'), 'utf8')
const expected = sums
  .split('\n')
  .find((line) => line.endsWith(`  ${path.basename(archive)}`))
  ?.split(' ')[0]
assert.equal(
  createHash('sha256')
    .update(await readFile(archive))
    .digest('hex'),
  expected,
  'archive checksum'
)

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, ...options })
    let stdout = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => process.stderr.write(chunk))
    const timer = setTimeout(() => process.kill(-child.pid, 'SIGKILL'), 8 * 60_000)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(`${path.basename(command)} exited ${code ?? signal}`))
    })
  })
}

const dir = await mkdtemp(path.join(tmpdir(), 'bramble-release-smoke-'))
try {
  await run('tar', ['-xzf', archive, '-C', dir])
  assert.deepEqual((await readdir(dir)).sort(), ['bramble', 'bramble-sidecar', 'brambled'])
  const home = path.join(dir, 'home')
  await mkdir(home)
  const env = {
    PATH: '/nonexistent',
    HOME: home,
    BRAMBLE_TAILNET_NAME: fixture.tailnetName,
    BRAMBLE_TAILNET_REGISTRY: fixture.tailnetRegistry,
    SEPOLIA_RPC_URL: 'https://ethereum-sepolia-rpc.publicnode.com',
    BRAMBLE_SIDECAR_PORT: '17890',
  }
  console.log(`runtime: PATH=${env.PATH}; cwd contains only bundle binaries and empty home; no inherited credentials`)
  await run(path.join(dir, 'bramble-sidecar'), ['--self-test'], { cwd: dir, env })
  const output = await run(path.join(dir, 'brambled'), ['resolve', fixture.deviceLabel], { cwd: dir, env })
  assert.ok(output.includes(`fullname: ${fixture.deviceFullname}`), 'resolved expected ENS name')
  assert.ok(output.includes(`pubkey:   ${fixture.expectedPubkey}`), 'resolved expected public key')
  assert.match(output, /status: {3}[1-9]\d*/, 'active ENS device')
  assert.deepEqual(await readdir(home), [], 'no Tor assets or cache written to HOME')
  assert.deepEqual((await readdir(dir)).sort(), ['bramble', 'bramble-sidecar', 'brambled', 'home'])
  console.log('release smoke ok: compiled signing, sibling launch, Tor bootstrap, Sepolia ENS record, no local cache')
} finally {
  await rm(dir, { recursive: true, force: true })
}
