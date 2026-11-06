// ENSv2 Sepolia deployment addresses: the one place Bramble names an ENS
// contract. Every package (sidecar, admincli, approval, relay-sidecar,
// scripts) imports these exports; none hardcodes an address of its own.
//
// BRAMBLE_ENS_DEPLOYMENT selects the deployment:
//
// - `sepolia-v2` (opt-in during migration): the official ENSv2 deployment on Sepolia,
//   deployed 2026-10-01. Sources, cross-checked on 2026-11-07:
//   https://docs.ens.domains/learn/deployments/ ("Sepolia (ENSv2)"),
//   https://github.com/ensdomains/contracts-v2/blob/07e55a056f5b6a9c90119f501bdd05714e67dddd/contracts/docs/addresses/sepolia.md
//   (the immutable revision linked by the ENS docs). The Universal
//   Resolver is the canonical UpgradableUniversalResolverProxy, which the
//   docs say resolves through this deployment.
// - `hackathon-test` (default until the new lifecycle passes): the earlier test deployment Bramble was built on.
//   Source: https://feature-permres-inode-refact.docs-bao.pages.dev/learn/deployments#sepolia-ensv2-beta,
//   verified by scripts/gate0.3-eac-check/index.mjs on 2026-09-05. Kept so
//   a tailnet registered there keeps working until it is retired.
//
// The role constants and ABI fragments below are the same in both
// deployments (checked against the deployed ABIs in contracts-v2's
// contracts/deployments/sepolia/*.json and RegistryRolesLib.sol /
// PermissionedResolverLib.sol at the same immutable revision).
import { getAddress, parseAbi, type Address } from 'viem'
import { sepolia } from 'viem/chains'

export interface EnsDeployment {
  id: EnsDeploymentId
  ethRegistry: Address // Permissioned Registry for .eth
  ethRegistrar: Address
  mockUsdc: Address // payment token for ETHRegistrar.register on Sepolia
  verifiableFactory: Address
  permissionedResolverImpl: Address
  userRegistryImpl: Address
  universalResolver: Address // UpgradableUniversalResolverProxy
}

export type EnsDeploymentId = 'sepolia-v2' | 'hackathon-test'

export const ENS_DEPLOYMENTS: Record<EnsDeploymentId, EnsDeployment> = {
  'sepolia-v2': {
    id: 'sepolia-v2',
    ethRegistry: getAddress('0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4'),
    ethRegistrar: getAddress('0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3'),
    mockUsdc: getAddress('0x240b0316df57887dbbe58b586508b19e633a14aa'),
    verifiableFactory: getAddress('0xda70306c98e97ece36f997a21368e53298572991'),
    permissionedResolverImpl: getAddress('0x115eb53f0c60696633855f90b138178fb40b2b2c'),
    userRegistryImpl: getAddress('0x9bd8a88719068d09ecee662f36c0e3856708366a'),
    universalResolver: getAddress('0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe'),
  },
  'hackathon-test': {
    id: 'hackathon-test',
    ethRegistry: getAddress('0x1d78834d97c1d7b1a38c1dedbd1a287cfed3971e'),
    ethRegistrar: getAddress('0x7d1b7f586a62ac3f54b9a396849757814283270b'),
    mockUsdc: getAddress('0xcbfd80f74375c54e545af34788ff465f96f66f05'),
    verifiableFactory: getAddress('0x894bc9cc8ff1ad96b8a288c86a8c71d662c07780'),
    permissionedResolverImpl: getAddress('0xa9d3814ab151bf6e37a427432795371a8361614e'),
    userRegistryImpl: getAddress('0x47b442d0cf617c41cabaff5f02f44dd1e5f72546'),
    universalResolver: getAddress('0xd26f2040d083af1cd2962ba303f4bea0c4faf142'),
  },
}

export const DEFAULT_ENS_DEPLOYMENT: EnsDeploymentId = 'hackathon-test'

// selectEnsDeployment rejects an unknown id instead of falling back, so a
// typo cannot silently point a node at the wrong contracts.
export function selectEnsDeployment(value: string | undefined): EnsDeployment {
  const id = value?.trim() || DEFAULT_ENS_DEPLOYMENT
  if (!Object.hasOwn(ENS_DEPLOYMENTS, id)) {
    throw new Error(`BRAMBLE_ENS_DEPLOYMENT must be one of ${Object.keys(ENS_DEPLOYMENTS).join(', ')}; got "${id}"`)
  }
  return ENS_DEPLOYMENTS[id as EnsDeploymentId]
}

export const ENS_DEPLOYMENT = selectEnsDeployment(process.env.BRAMBLE_ENS_DEPLOYMENT)

export const ETH_REGISTRY = ENS_DEPLOYMENT.ethRegistry
export const ETH_REGISTRAR = ENS_DEPLOYMENT.ethRegistrar
export const MOCK_USDC = ENS_DEPLOYMENT.mockUsdc
export const VERIFIABLE_FACTORY = ENS_DEPLOYMENT.verifiableFactory
export const PERMISSIONED_RESOLVER_IMPL = ENS_DEPLOYMENT.permissionedResolverImpl
export const USER_REGISTRY_IMPL = ENS_DEPLOYMENT.userRegistryImpl
export const UNIVERSAL_RESOLVER = ENS_DEPLOYMENT.universalResolver

// ensSepolia is viem's Sepolia chain with the selected deployment's
// Universal Resolver. Pass it to every client that resolves names. viem's
// built-in Sepolia address happens to equal the official one today, but
// setting it here keeps `hackathon-test` correct and stops a future viem
// bump from moving resolution silently (docs/04_TECH_STACK.md, "Universal
// Resolver gotcha").
export const ensSepolia = {
  ...sepolia,
  contracts: { ...sepolia.contracts, ensUniversalResolver: { address: UNIVERSAL_RESOLVER } },
}

// EAC role constants (values from the ENSv2 docs' Permissioned Registry /
// Permissioned Resolver role tables, not guessed).
export const ROLE_SET_SUBREGISTRY = 1n << 20n
export const ROLE_SET_RESOLVER = 1n << 24n
export const ROLE_CAN_TRANSFER_ADMIN = (1n << 28n) << 128n
export const REGISTRATION_ROLE_BITMAP =
  ROLE_SET_SUBREGISTRY |
  (ROLE_SET_SUBREGISTRY << 128n) | // ROLE_SET_SUBREGISTRY_ADMIN
  ROLE_SET_RESOLVER |
  (ROLE_SET_RESOLVER << 128n) | // ROLE_SET_RESOLVER_ADMIN
  ROLE_CAN_TRANSFER_ADMIN

export const ROLE_SET_TEXT = 1n << 4n
export const ROLE_SET_ADDRESS = 1n << 0n

// Registry-level role gating who may call register() to enroll a new device
// subname — a ROOT_RESOURCE role on the subregistry contract itself, NOT
// part of REGISTRATION_ROLE_BITMAP above (which is what's granted to the
// *new token's owner*, a separate concern). Verified from primary source,
// not the docs page (same discipline as the initializer-signature drift in
// docs/11_SOURCE_NOTES.md): ensdomains/contracts-v2's
// contracts/src/registry/libraries/RegistryRolesLib.sol defines
// `ROLE_REGISTRAR = 1 << 0`, and PermissionedRegistry._register() calls
// `_checkRoles(ROOT_RESOURCE, RegistryRolesLib.ROLE_REGISTRAR, msg.sender)`
// for a fresh (never-registered) label. Granted via grantRootRoles(), not
// grantRoles() — see docs/adr/0004-admin-cli-writes-directly-to-registry.md.
export const ROLE_REGISTRAR = 1n << 0n
export const ROLE_REGISTRAR_ADMIN = ROLE_REGISTRAR << 128n

// Every regular + admin role bit set (bit 0 of all 64 nybbles), computed
// rather than copy-pasted, to avoid a uint256-overflow typo.
export const ALL_ROLES = BigInt('0x' + '1'.repeat(64))

export const RPC_URL = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'

export const SIDECAR_PORT = Number(process.env.BRAMBLE_SIDECAR_PORT || 7890)

// A node's sidecar belongs to exactly one tailnet, and must know which
// subregistry contract governs it — this is bootstrap config, not a record
// schema decision (Phase 2 still owns record schema / wildcard-resolution
// discretion, see docs/05_BUILD_PLAN.md Phase 2). getState() is a
// registry-specific call, unlike text-record reads which resolve across the
// whole hierarchy automatically via the Universal Resolver.
function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required (sidecar config, not chain state)`)
  return value
}

export function tailnetName(): string {
  return requiredEnv('BRAMBLE_TAILNET_NAME')
}

export function tailnetRegistry(): `0x${string}` {
  return getAddress(requiredEnv('BRAMBLE_TAILNET_REGISTRY'))
}

// Bounds the tailnet device registry's own LabelRegistered log scan
// (sidecar/src/ens/devices.ts's listDeviceLabels, used by admincli's
// enroll.ts to allocate a mesh-ip — docs/adr/0009) to blocks that could
// possibly contain a registration, the same role
// relayRegistryDeployBlock() plays for resolveRelays() below. Set once, at
// tailnet-provisioning time (the subregistry deploy transaction's own
// block, verified directly against chain state — see .env's comment on
// this var), never changes afterward.
export function tailnetRegistryDeployBlock(): bigint {
  return BigInt(requiredEnv('BRAMBLE_TAILNET_REGISTRY_DEPLOY_BLOCK'))
}

// The relay registry (docs/adr/0003's Consequence section, resolved): a
// UserRegistry deployed structurally separate from the tailnet's own device
// registry (Gate 1.4 requires this — relay records must live somewhere
// device/agent write paths can't reach even by mistake), set up once via
// admincli/src/setup-relay-registry.ts. Optional: a tailnet with no relay
// discovery configured (yet, or ever, if it only uses -rendezvous/
// -data-relay overrides) just doesn't call resolveRelays().
export function relayRegistry(): `0x${string}` | undefined {
  const value = process.env.BRAMBLE_RELAY_REGISTRY
  return value ? getAddress(value) : undefined
}

// Bounds resolveRelays()'s LabelRegistered log scan to blocks that could
// possibly contain a registration — avoids re-scanning from genesis on
// every call. Set once, at relay-registry setup time (the deploy
// transaction's own block), never changes afterward.
export function relayRegistryDeployBlock(): bigint {
  return BigInt(requiredEnv('BRAMBLE_RELAY_REGISTRY_DEPLOY_BLOCK'))
}

// Read-only surface only — no write functions here. This sidecar's Section A
// scope is resolution, not enrollment/revocation (see docs/adr/0002).
export const registryAbi = parseAbi([
  'function ownerOf(uint256 id) view returns (address)',
  'function getState(uint256 anyId) view returns (uint8 status, uint64 expiry, address latestOwner, uint256 tokenId, uint256 resource)',
  'function roles(uint256 anyId, address account) view returns (uint256)',
])

// EAC role state: a verified read ABI now exists (Phase 2 finding,
// correcting the prior "no verified read ABI yet" note left after Gate 0.3).
// `roles(anyId, account)` returns the effective role bitmap for an account
// on a name, confirmed against ensdomains/contracts-v2's
// EnhancedAccessControl.sol/PermissionedRegistry.sol source and the ENSv2
// docs' "Enhanced Access Control" page. Not required for Gate 2.1's
// permit/deny test (Gate 0.3's simulateContract pattern already proves
// that), but available for anything that wants to display or assert current
// role state directly rather than inferring it from a simulated call.
