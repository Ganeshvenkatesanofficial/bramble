// `pnpm demo`: starts the systemd units this machine's roles need, in order, and
// prints what to start on the other machines. The demo spans up to four
// machines (relays, gateway, worker, admin), so a launcher that only knew
// about one machine would hide the rest of the setup.
import { ROLES, unitsFor, type Role, type UnitOptions } from './topology'

export interface LaunchPlan {
  /** Roles this machine runs, in start order, each with its units. */
  here: Array<{ role: Role; units: string[] }>
  /** Roles another machine must start, with the command to run there. */
  elsewhere: Array<{ role: Role; command: string }>
}

export function planLaunch(localRoles: Role[], opts: UnitOptions): LaunchPlan {
  const here = ROLES.filter((r) => localRoles.includes(r)).map((role) => ({ role, units: unitsFor(role, opts) }))
  const elsewhere = ROLES.filter((r) => !localRoles.includes(r)).map((role) => ({
    role,
    command: `pnpm demo --role ${role}`,
  }))
  return { here, elsewhere }
}

export function formatPlan(plan: LaunchPlan): string {
  const lines: string[] = []
  lines.push('On this machine:')
  if (plan.here.length === 0) lines.push('  (no roles)')
  for (const { role, units } of plan.here) lines.push(`  ${role}: ${units.join(' -> ')}`)
  if (plan.elsewhere.length > 0) {
    lines.push('', 'Start on the other machines (start order: relays, gateway, worker, admin):')
    for (const { role, command } of plan.elsewhere) lines.push(`  ${role.padEnd(7)} ${command}`)
  }
  return lines.join('\n')
}

/** Runs a command and reports its exit code. It does not throw on a non-zero exit. */
export type RunCommand = (file: string, args: string[]) => Promise<{ code: number; stdout: string }>

export interface LaunchResult {
  started: string[]
  failed?: { unit: string; reason: string }
}

/** Starts each unit in order and checks it is active. Stops at the first failure: later units depend on earlier ones. */
export async function startUnits(
  plan: LaunchPlan,
  run: RunCommand,
  opts: { asRoot: boolean; log: (line: string) => void }
): Promise<LaunchResult> {
  const sudo = (args: string[]): [string, string[]] => (opts.asRoot ? [args[0], args.slice(1)] : ['sudo', args])
  const started: string[] = []
  for (const { units } of plan.here) {
    for (const unit of units) {
      opts.log(`starting ${unit}`)
      const [file, args] = sudo(['systemctl', 'start', unit])
      const start = await run(file, args)
      if (start.code !== 0) {
        return { started, failed: { unit, reason: `systemctl start exited ${start.code}; see journalctl -u ${unit}` } }
      }
      const active = await run('systemctl', ['is-active', unit])
      if (active.stdout.trim() !== 'active') {
        return {
          started,
          failed: { unit, reason: `state is "${active.stdout.trim() || 'unknown'}"; see journalctl -u ${unit}` },
        }
      }
      started.push(unit)
    }
  }
  return { started }
}
