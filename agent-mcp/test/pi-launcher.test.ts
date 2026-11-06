import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const homes: string[] = []
const launcher = new URL('../../deploy/scripts/pi-agent.sh', import.meta.url).pathname

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'bramble-pi-launcher-'))
  homes.push(home)
  mkdirSync(join(home, '.config/bramble'), { recursive: true })
  writeFileSync(join(home, '.config/bramble/deepseek.key'), 'test-placeholder')
  writeFileSync(join(home, '.config/bramble/approval.token'), 'test-placeholder')
  const pi = join(home, 'pi')
  writeFileSync(
    pi,
    '#!/usr/bin/env bash\nset -eu\n[ "$DEEPSEEK_API_KEY" = test-placeholder ]\nprintf "%s\\0" "$@" > "$HOME/args"\n',
    { mode: 0o700 }
  )
  return { home, env: { ...process.env, HOME: home, PI_BIN: pi } }
}

test('launcher injects the selected workflow with built-in tools disabled', () => {
  const { home, env } = setup()
  const skill = join(home, 'trusted skill.md')
  writeFileSync(skill, 'Use request_private_access for task, then call_private_service.')
  const prompt = 'Fetch the task from the private staging service'
  const result = spawnSync('bash', [launcher, '-p', prompt], {
    env: { ...env, PI_AGENT_SKILL: skill },
    encoding: 'utf8',
  })
  expect(result.status).toBe(0)
  const args = readFileSync(join(home, 'args'), 'utf8').split('\0').filter(Boolean)
  expect(args).toEqual([
    '--model',
    'deepseek/deepseek-flash',
    '--no-builtin-tools',
    '--no-context-files',
    '--offline',
    '--append-system-prompt',
    skill,
    '-p',
    prompt,
  ])
})

test('launcher refuses to start Pi when the selected workflow is missing', () => {
  const { home, env } = setup()
  const skill = join(home, 'missing.md')
  const result = spawnSync('bash', [launcher, '-p', 'Fetch the task'], {
    env: { ...env, PI_AGENT_SKILL: skill },
    encoding: 'utf8',
  })
  expect(result.status).toBe(1)
  expect(result.stderr).toContain(`missing ${skill}`)
  expect(() => readFileSync(join(home, 'args'))).toThrow()
})
