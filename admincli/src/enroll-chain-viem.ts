// Real-chain EnrollChain for lib.ts's enrollDevice. Takes the clients from its caller, so it
// does not load .env the way setup.ts does: the approval service and enroll.ts both import it.
import {
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
  stringToHex,
  toHex,
  type Account,
  type Chain,
  type PublicClient,
  type Hex,
} from 'viem'
import { packetToBytes } from 'viem/ens'
import {
  ALL_ROLES,
  PERMISSIONED_RESOLVER_IMPL,
  REGISTRATION_ROLE_BITMAP,
  RPC_URL,
  VERIFIABLE_FACTORY,
  registryAbi,
  tailnetRegistry,
  tailnetName,
} from '../../sidecar/src/ens/config'
import { registryWriteAbi, resolverWriteAbi } from './roles'
import { usedMeshIPs } from './mesh-ip-scan'
import { deviceName, type EnrollChain } from './lib'

const verifiableFactoryAbi = parseAbi([
  'function deployProxy(address implementation, uint256 salt, bytes data) returns (address proxy)',
  'event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)',
])
const resolverInitAbi = parseAbi(['function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)'])
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

export interface ViemEnrollChainOptions {
  account: Account
  publicClient: PublicClient
  chain: Chain
  rpcUrl?: string
  /** Receives each transaction hash as soon as it is submitted. */
  log?: (line: string) => void
}

export function createViemEnrollChain(options: ViemEnrollChainOptions): EnrollChain {
  const { account, publicClient } = options
  const log = options.log ?? (() => {})
  const wallet = createWalletClient({ account, chain: options.chain, transport: http(options.rpcUrl ?? RPC_URL) })
  // A receipt timeout is not a revert. Keep its hash and check it on retry, never submit twice.
  const submitted = new Map<string, Hex>()

  async function writeAndWait(label: string, args: Parameters<typeof wallet.writeContract>[0]) {
    let hash = submitted.get(label)
    if (!hash) {
      hash = await wallet.writeContract(args)
      submitted.set(label, hash)
      log(`   tx (${label}): ${hash}`)
    }
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    submitted.delete(label)
    if (receipt.status !== 'success') throw new Error(`${label} reverted on-chain`)
    return { hash, receipt }
  }

  return {
    async deployResolver() {
      // The salt makes each deployment distinct without a counter to persist.
      const version = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000))
      const salt = BigInt(
        keccak256(
          encodeAbiParameters(
            [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }],
            [keccak256(stringToHex('OwnedResolver')), account.address, version]
          )
        )
      )
      const initData = encodeFunctionData({
        abi: resolverInitAbi,
        functionName: 'initialize',
        args: [[{ account: account.address, roleBitmap: ALL_ROLES }], []],
      })
      const { hash, receipt } = await writeAndWait('deploy resolver proxy', {
        address: VERIFIABLE_FACTORY,
        abi: verifiableFactoryAbi,
        functionName: 'deployProxy',
        args: [PERMISSIONED_RESOLVER_IMPL, salt, initData],
        chain: options.chain,
        account,
      })
      const [deployed] = parseEventLogs({ abi: verifiableFactoryAbi, eventName: 'ProxyDeployed', logs: receipt.logs })
      if (!deployed) throw new Error('resolver deployment emitted no ProxyDeployed event')
      return { address: deployed.args.proxyAddress, txHash: hash }
    },

    async isRegistered(label) {
      if (submitted.has(`register:${label}`)) return false
      const [, expiry] = await publicClient.readContract({
        address: tailnetRegistry(),
        abi: registryAbi,
        functionName: 'getState',
        args: [BigInt(keccak256(toHex(label)))],
      })
      return expiry > BigInt(Math.floor(Date.now() / 1000))
    },

    async registeredResolver(label) {
      return publicClient.getEnsResolver({ name: deviceName(label, tailnetName()) })
    },

    async register({ label, resolver, expirySeconds }) {
      const { hash } = await writeAndWait(`register:${label}`, {
        address: tailnetRegistry(),
        abi: registryWriteAbi,
        functionName: 'register',
        args: [
          label,
          account.address,
          ZERO_ADDRESS,
          resolver as `0x${string}`,
          REGISTRATION_ROLE_BITMAP,
          BigInt(expirySeconds),
        ],
        chain: options.chain,
        account,
      })
      return hash
    },

    async setTextAt(resolver, name, key, value) {
      const { hash } = await writeAndWait(`setText:${resolver}:${name}:${key}:${value}`, {
        address: resolver as `0x${string}`,
        abi: resolverWriteAbi,
        functionName: 'setText',
        args: [toHex(packetToBytes(name)), key, value],
        chain: options.chain,
        account,
      })
      return hash
    },

    usedMeshIPs: (excludeLabel) => usedMeshIPs(publicClient, excludeLabel),
  }
}
