// Load the repository fallback environment before ENS deployment selection.
// Explicit process environment values take precedence over the file.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const envPath = path.resolve(__dirname, '../../.env')
if (existsSync(envPath)) {
  const env = readFileSync(envPath, 'utf8')
  for (const line of env.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match && !process.env[match[1].trim()]) {
      // Strip one layer of matching surrounding quotes — every other
      // env-loading path in this repo does this for free (shell `source`,
      // Vite/vitest, Next.js), but this hand-rolled parser is a regex
      // split with no quote handling at all, so a quoted .env value (e.g.
      // BRAMBLE_TAILNET_NAME="foo.eth") previously landed in process.env
      // with the literal quote characters still attached — silently
      // breaking anything sensitive to the exact string (ENS name
      // normalization, hex key parsing).
      const rawValue = match[2].trim()
      process.env[match[1].trim()] = rawValue.replace(/^(['"])(.*)\1$/, '$2')
    }
  }
}
