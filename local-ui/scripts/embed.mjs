// Copies the static export into the Go module so `go:embed all:dist` picks it up.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'out')
const target = resolve(root, '..', 'node-daemon', 'ui', 'dist')

if (!existsSync(join(source, 'index.html'))) {
  console.error(`No build in ${source}. Run \`pnpm --filter @bramble/local-ui build\` first.`)
  process.exit(1)
}

mkdirSync(target, { recursive: true })
for (const entry of readdirSync(target)) {
  if (entry !== '.keep') rmSync(join(target, entry), { recursive: true, force: true })
}
cpSync(source, target, { recursive: true })
console.log(`Copied ${source} to ${target}`)
