// In-memory EnrollChain and Resolver for tests. No keys, RPC or transactions.
import type { EnrollChain, Resolver } from './lib'

export function memoryEnrollChain(options: { tailnetName: string; existing?: Record<string, string> }) {
  const records = new Map(Object.entries(options.existing ?? {}))
  const registered = new Set<string>()
  const resolvers = new Map<string, string>()
  const labelMeshIps = new Map<string, string>()
  const steps: string[] = []
  const faults = { failOn: undefined as string | undefined, remaining: 0 }

  const hash = () => `0x${(steps.length + 1).toString(16).padStart(64, '0')}`
  const step = (name: string) => {
    if (faults.failOn === name && faults.remaining > 0) {
      faults.remaining -= 1
      throw new Error(`injected ${name} failure`)
    }
    const txHash = hash()
    steps.push(name)
    return txHash
  }

  const resolver: Resolver = {
    async getText(name, key) {
      const value = records.get(`${name}|${key}`)
      return value === undefined || value === '' ? null : value
    },
  }
  const chain: EnrollChain = {
    async deployResolver() {
      const txHash = step('deploy')
      return { address: `0x${steps.length.toString(16).padStart(40, '0')}`, txHash }
    },
    async isRegistered(label) {
      return registered.has(label)
    },
    async registeredResolver(label) {
      return resolvers.get(label) ?? null
    },
    async register({ label, resolver }) {
      const txHash = step('register')
      registered.add(label)
      resolvers.set(label, resolver)
      return txHash
    },
    async setTextAt(_resolver, name, key, value) {
      const txHash = step(`setText:${key}`)
      records.set(`${name}|${key}`, value)
      if (key === 'mesh-ip') labelMeshIps.set(name.split('.')[0], value)
      return txHash
    },
    async usedMeshIPs(excludeLabel) {
      return [...labelMeshIps].filter(([label]) => label !== excludeLabel).map(([, ip]) => ip)
    },
  }
  return {
    records,
    registered,
    steps,
    resolver,
    chain,
    /** Make the next `times` calls of step `name` (for example `register`) throw before writing. */
    failNext(name: string, times = 1) {
      faults.failOn = name
      faults.remaining = times
    },
    tailnetName: options.tailnetName,
  }
}
