// Importable grant / revoke operations behind admincli's set-acl, revoke-acl
// and revoke commands. This module has no top-level side effects and does not
// import setup.ts, the Ledger Key Ring or the sidecar's env config, so callers
// (the approval service, the agent tools, tests) can import it directly.
//
// It does not implement any cryptography. The ECDH digest stays in roles.ts
// (aclDigestECDH, docs/adr/0005-acl-record-schema.md). Chain access goes
// through two small interfaces, so a caller supplies the real viem
// implementation (lib-viem.ts) or an in-memory one:
//
//   - Resolver reads text records.
//   - Signer submits a setText write and reports confirmation.
//
// The granter's X25519 private key comes from a `loadGranterKey` callback. The
// CLIs pass the Key Ring decrypt; this module never reads a key from disk.
import { normalize } from 'viem/ens'
import { x25519 } from '@noble/curves/ed25519'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { aclDigestECDH } from './roles'
import { allocateMeshIP } from './mesh-ip'

/** Reads ENS text records. Returns `null` or `''` for an unset record. */
export interface Resolver {
  getText(name: string, key: string): Promise<string | null>
}

/** A submitted write. `wait()` rejects if the transaction reverts. */
export interface PendingTx {
  hash: string
  wait(): Promise<void>
}

/** Submits ENS text-record writes for a normalized full name. */
export interface Signer {
  setText(name: string, key: string, value: string): Promise<PendingTx>
}

/** Returns the granter's WireGuard (X25519) private key as bare or `0x` hex. */
export type LoadGranterKey = () => Promise<string>

export interface LibDeps {
  resolver: Resolver
  signer: Signer
  /** The tailnet's base ENS name, for example `mesh.eth`. */
  tailnetName: string
  /** Receives progress lines. The CLIs pass `console.log`. Defaults to silent. */
  log?: (line: string) => void
}

export interface GrantParams {
  deviceLabel: string
  gatewayLabel: string
  granterLabel: string
  serviceNames: string[]
  loadGranterKey: LoadGranterKey
}

export interface GrantDigests {
  granterFullname: string
  gatewayFullname: string
  deviceFullname: string
  digests: string[]
}

export interface AclChange {
  deviceFullname: string
  granterFullname: string
  gatewayFullname: string
  digests: string[]
  /** The device's `acl` record before the call. */
  before: string
  /** The device's `acl` record after the call. Equals `before` when nothing changed. */
  after: string
  /** `undefined` when no transaction was needed (revoke of an absent grant). */
  txHash: string | undefined
}

export interface SetRevokedResult {
  deviceFullname: string
  txHash: string
  /** Milliseconds from submit to confirmation. */
  confirmedMs: number
  after: string
}

const noop = () => {}

/** Splits a comma-separated service list, trimming blanks. */
export function parseServiceNames(arg: string): string[] {
  return arg
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Splits an `acl` record into its digests, trimming blanks. */
export function parseAclRecord(record: string | null | undefined): string[] {
  return parseServiceNames(record ?? '')
}

export function deviceName(label: string, tailnetName: string): string {
  return normalize(`${label}.${tailnetName}`)
}

/**
 * Computes the ECDH digest of each service name for a (device, gateway,
 * granter) triple, exactly as a grant would write it. Verifies that the
 * granter key matches the granter's published `pubkey` first.
 */
export async function computeGrantDigests(
  deps: Pick<LibDeps, 'resolver' | 'tailnetName'>,
  params: GrantParams
): Promise<GrantDigests> {
  const { resolver, tailnetName } = deps
  const { deviceLabel, gatewayLabel, granterLabel, serviceNames, loadGranterKey } = params

  const granterPrivKeyHex = (await loadGranterKey()).replace(/^0x/, '')
  const granterFullname = deviceName(granterLabel, tailnetName)
  const granterPubkeyOnChain = await resolver.getText(granterFullname, 'pubkey')
  const derivedGranterPubkey = bytesToHex(x25519.getPublicKey(hexToBytes(granterPrivKeyHex)))
  if (granterPubkeyOnChain !== derivedGranterPubkey) {
    throw new Error(
      `BRAMBLE_GRANTER_PRIVATE_KEY doesn't match ${granterFullname}'s published pubkey ` +
        `(on-chain: ${granterPubkeyOnChain ?? '(unset)'}, derived: ${derivedGranterPubkey}) — ` +
        `wrong key, or ${granterLabel} isn't the identity you meant to vouch as`
    )
  }

  const gatewayFullname = deviceName(gatewayLabel, tailnetName)
  const gatewayPubkey = await resolver.getText(gatewayFullname, 'pubkey')
  if (!gatewayPubkey) throw new Error(`no pubkey found for gateway ${gatewayFullname} — is it enrolled?`)

  // The digest binds to the requesting device's own pubkey, so a digest read
  // off another device's public acl record cannot be copied into this one
  // (docs/adr/0005).
  const deviceFullname = deviceName(deviceLabel, tailnetName)
  const devicePubkey = await resolver.getText(deviceFullname, 'pubkey')
  if (!devicePubkey) throw new Error(`no pubkey found for device ${deviceFullname} — is it enrolled?`)

  const digests = serviceNames.map((name) => aclDigestECDH(granterPrivKeyHex, gatewayPubkey, devicePubkey, name))
  return { granterFullname, gatewayFullname, deviceFullname, digests }
}

async function writeAcl(deps: LibDeps, deviceFullname: string, value: string): Promise<string> {
  const log = deps.log ?? noop
  const pending = await deps.signer.setText(deviceFullname, 'acl', value)
  log(`   tx: ${pending.hash}`)
  await pending.wait()
  const after = await deps.resolver.getText(deviceFullname, 'acl')
  if ((after ?? '') !== value) throw new Error(`acl did not round-trip: got ${JSON.stringify(after)}`)
  return pending.hash
}

/**
 * Adds the digests for `serviceNames` to the device's `acl` record, keeping
 * every digest already there (the record is a growing set, not an overwrite).
 */
export async function grantAcl(deps: LibDeps, params: GrantParams): Promise<AclChange> {
  const log = deps.log ?? noop
  const { granterFullname, gatewayFullname, deviceFullname, digests } = await computeGrantDigests(deps, params)
  log(`granter: ${granterFullname}`)
  log(`gateway: ${gatewayFullname}`)
  log(`device: ${deviceFullname}`)
  log(`services: ${params.serviceNames.join(', ') || '(none)'} -> digests: ${digests.join(',') || '(empty)'}`)

  const before = (await deps.resolver.getText(deviceFullname, 'acl')) ?? ''
  log(`current acl digests for ${deviceFullname}: ${before || '(unset)'}`)
  const value = Array.from(new Set([...parseAclRecord(before), ...digests])).join(',')

  const txHash = await writeAcl(deps, deviceFullname, value)
  log(`done. ${deviceFullname}'s acl digests are now ${value === '' ? '(empty)' : value}.`)
  return { deviceFullname, granterFullname, gatewayFullname, digests, before, after: value, txHash }
}

/**
 * Removes the digests for `serviceNames` from the device's `acl` record. It
 * computes the same digests a grant would, so it removes exactly that grant
 * and leaves every other digest alone. Sends no transaction when none of the
 * digests are present.
 */
export async function revokeAcl(deps: LibDeps, params: GrantParams): Promise<AclChange> {
  const log = deps.log ?? noop
  const { granterFullname, gatewayFullname, deviceFullname, digests } = await computeGrantDigests(deps, params)
  log(`granter: ${granterFullname}`)
  log(`gateway: ${gatewayFullname}`)
  log(`device: ${deviceFullname}`)
  log(`services: ${params.serviceNames.join(', ') || '(none)'} -> digests to remove: ${digests.join(',') || '(empty)'}`)

  const before = (await deps.resolver.getText(deviceFullname, 'acl')) ?? ''
  log(`current acl digests for ${deviceFullname}: ${before || '(unset)'}`)

  const existing = parseAclRecord(before)
  const toRemove = new Set(digests)
  const remaining = existing.filter((d) => !toRemove.has(d))
  if (remaining.length === existing.length) {
    log(`none of the computed digests were present in ${deviceFullname}'s acl — nothing to do.`)
    return { deviceFullname, granterFullname, gatewayFullname, digests, before, after: before, txHash: undefined }
  }
  const value = remaining.join(',')

  const txHash = await writeAcl(deps, deviceFullname, value)
  log(`done. ${deviceFullname}'s acl digests are now ${value === '' ? '(empty)' : value}.`)
  return { deviceFullname, granterFullname, gatewayFullname, digests, before, after: value, txHash }
}

export interface ClearAclResult {
  deviceFullname: string
  before: string
  /** Always `''`. */
  after: string
  /** `undefined` when the record was already empty and no transaction was needed. */
  txHash: string | undefined
}

/**
 * Empties the device's `acl` record, removing every digest whoever granted it.
 * Needs no granter key. Sends no transaction when the record is already empty.
 */
export async function clearAcl(deps: LibDeps, params: { deviceLabel: string }): Promise<ClearAclResult> {
  const log = deps.log ?? noop
  const deviceFullname = deviceName(params.deviceLabel, deps.tailnetName)
  const before = (await deps.resolver.getText(deviceFullname, 'acl')) ?? ''
  if (parseAclRecord(before).length === 0) {
    log(`${deviceFullname}'s acl is already empty — nothing to do.`)
    return { deviceFullname, before, after: '', txHash: undefined }
  }
  log(`clearing acl digests for ${deviceFullname}: ${before}`)
  const txHash = await writeAcl(deps, deviceFullname, '')
  log(`done. ${deviceFullname}'s acl is now empty.`)
  return { deviceFullname, before, after: '', txHash }
}

/**
 * Sets (`true`) or clears (`false`) a device's `revoked` record. Needs a signer
 * holding the revoked-scoped setText role (docs/adr/0004).
 */
export async function setDeviceRevoked(
  deps: LibDeps,
  params: { deviceLabel: string; value: boolean }
): Promise<SetRevokedResult> {
  const log = deps.log ?? noop
  const value = String(params.value)
  const deviceFullname = deviceName(params.deviceLabel, deps.tailnetName)

  log(`setting revoked=${value} for ${deviceFullname}...`)
  const startedAt = Date.now()
  const pending = await deps.signer.setText(deviceFullname, 'revoked', value)
  log(`   tx: ${pending.hash}`)
  await pending.wait()
  const confirmedMs = Date.now() - startedAt
  log(`   confirmed ${confirmedMs}ms after submit`)

  const after = (await deps.resolver.getText(deviceFullname, 'revoked')) ?? ''
  if (after !== value) throw new Error(`revoked did not round-trip: got ${JSON.stringify(after)}`)
  log(`done. ${deviceFullname} revoked=${after}.`)
  return { deviceFullname, txHash: pending.hash, confirmedMs, after }
}

/**
 * The chain writes enrollment needs beyond `setText`. A caller supplies the real viem
 * implementation (`enroll-chain-viem.ts`) or an in-memory one. Every method resolves only
 * after the transaction is confirmed, and returns its hash.
 */
export interface EnrollChain {
  /** Deploys a dedicated Permissioned Resolver owned by the signer. */
  deployResolver(): Promise<{ address: string; txHash: string }>
  /** True when `label` holds an unexpired registration on the tailnet registry. */
  isRegistered(label: string): Promise<boolean>
  register(params: { label: string; resolver: string; expirySeconds: number }): Promise<string>
  /** `setText` through a known resolver, so a lagging node cannot hide a resolver just set. */
  setTextAt(resolver: string, name: string, key: string, value: string): Promise<string>
  /** Mesh-ip records of every enrolled device except `excludeLabel`. */
  usedMeshIPs(excludeLabel: string): Promise<(string | null)[]>
}

export interface EnrollDeps {
  resolver: Resolver
  chain: EnrollChain
  tailnetName: string
  log?: (line: string) => void
  /** Read-back polling. Defaults: 10 attempts, 3000 ms apart (a load-balanced RPC lags). */
  readbackAttempts?: number
  readbackDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

/** What a failed enrollment already wrote, so a retry resumes instead of repeating a step. */
export interface EnrollProgress {
  resolverAddress?: string
  registered?: boolean
  pubkeyWritten?: boolean
  /** The mesh-ip record value, `10.77.0.<n>/24`. */
  meshCidr?: string
  meshIpWritten?: boolean
  txHashes: { deploy?: string; register?: string; pubkey?: string; meshIp?: string }
}

export interface EnrollParams {
  deviceLabel: string
  pubkey: string
  expiryYears?: number
  /** Mutated as each step confirms. Pass the same object to retry a failed enrollment. */
  progress?: EnrollProgress
  now?: () => number
}

export interface EnrollResult {
  deviceFullname: string
  resolverAddress: string
  meshCidr: string
  /** `meshCidr` without the prefix length. */
  meshIp: string
  txHashes: EnrollProgress['txHashes']
}

export class LabelRegisteredError extends Error {
  constructor(readonly deviceLabel: string) {
    super(`${deviceLabel} is already registered`)
  }
}

async function readBack(deps: EnrollDeps, name: string, key: string, expected: string) {
  const attempts = deps.readbackAttempts ?? 10
  const delayMs = deps.readbackDelayMs ?? 3000
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let value: string | null = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(delayMs)
    value = await deps.resolver.getText(name, key)
    if (value === expected) return
  }
  throw new Error(`${key} did not round-trip: got ${JSON.stringify(value)}`)
}

/**
 * Enrolls a device subname: deploys its own resolver, registers the label, writes the
 * pubkey, then allocates and writes the mesh-ip (docs/adr/0009). The operator writes the
 * mesh-ip, never the device. Each step is skipped when `progress` shows it already
 * confirmed, so a retry after a failure never deploys a second resolver.
 */
export async function enrollDevice(deps: EnrollDeps, params: EnrollParams): Promise<EnrollResult> {
  const log = deps.log ?? noop
  const { deviceLabel, pubkey } = params
  const progress = (params.progress ??= { txHashes: {} })
  const fullname = deviceName(deviceLabel, deps.tailnetName)

  if (!progress.resolverAddress && (await deps.chain.isRegistered(deviceLabel))) {
    throw new LabelRegisteredError(deviceLabel)
  }

  if (!progress.resolverAddress) {
    log(`[1/4] Deploying a dedicated resolver for ${deviceLabel}...`)
    const deployed = await deps.chain.deployResolver()
    progress.resolverAddress = deployed.address
    progress.txHashes.deploy = deployed.txHash
    log(`   resolver: ${deployed.address}`)
  }
  const resolverAddress = progress.resolverAddress

  if (!progress.registered) {
    log(`[2/4] Registering ${fullname} (requires ROLE_REGISTRAR)...`)
    const now = (params.now ?? Date.now)()
    const expirySeconds = Math.floor(now / 1000) + (params.expiryYears ?? 10) * 365 * 24 * 60 * 60
    // A retry after an unconfirmed register may find it landed; the registry then holds the label.
    if (await deps.chain.isRegistered(deviceLabel)) {
      log('   already registered; continuing')
    } else {
      progress.txHashes.register = await deps.chain.register({
        label: deviceLabel,
        resolver: resolverAddress,
        expirySeconds,
      })
    }
    progress.registered = true
  }

  if (!progress.pubkeyWritten) {
    log('[3/4] Writing initial pubkey...')
    progress.txHashes.pubkey = await deps.chain.setTextAt(resolverAddress, fullname, 'pubkey', pubkey)
    await readBack(deps, fullname, 'pubkey', pubkey)
    progress.pubkeyWritten = true
  }

  if (!progress.meshCidr) {
    log('[4/4] Allocating mesh-ip...')
    progress.meshCidr = allocateMeshIP(await deps.chain.usedMeshIPs(deviceLabel))
  }
  if (!progress.meshIpWritten) {
    progress.txHashes.meshIp = await deps.chain.setTextAt(resolverAddress, fullname, 'mesh-ip', progress.meshCidr)
    await readBack(deps, fullname, 'mesh-ip', progress.meshCidr)
    progress.meshIpWritten = true
  }

  log(`done. ${fullname} enrolled, resolver ${resolverAddress}, pubkey ${pubkey}, mesh-ip ${progress.meshCidr}.`)
  return {
    deviceFullname: fullname,
    resolverAddress,
    meshCidr: progress.meshCidr,
    meshIp: progress.meshCidr.split('/')[0],
    txHashes: progress.txHashes,
  }
}
