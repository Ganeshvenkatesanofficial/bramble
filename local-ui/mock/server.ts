/** Serves the static export and the mock local API on one origin: `bun mock/server.ts`. */
import { existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { createMock } from './model'

const root = join(import.meta.dir, '..', 'out')
const port = Number(process.env.MOCK_PORT ?? 7788)
const mock = createMock()

if (!existsSync(join(root, 'index.html'))) {
  console.error('Run `pnpm --filter @bramble/local-ui build` first: out/index.html is missing.')
  process.exit(1)
}

Bun.serve({
  hostname: '127.0.0.1',
  port,
  async fetch(request) {
    const api = await mock.handle(request)
    if (api) return api
    const { pathname } = new URL(request.url)
    const relative = normalize(pathname === '/' ? 'index.html' : pathname.slice(1))
    if (relative.startsWith('..')) return new Response('Not found', { status: 404 })
    const file = Bun.file(join(root, relative))
    return (await file.exists()) ? new Response(file) : new Response('Not found', { status: 404 })
  },
})
console.log(`Mock bramble at http://127.0.0.1:${port}/`)
