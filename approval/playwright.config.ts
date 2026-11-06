import { defineConfig } from '@playwright/test'

const uiPort = process.env.BRAMBLE_TEST_UI_PORT ?? '3001'
const apiPort = process.env.BRAMBLE_TEST_API_PORT ?? '3101'

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${apiPort}`, headless: true },
  projects: [
    { name: '1280', use: { viewport: { width: 1280, height: 1000 } } },
    { name: '390', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    {
      command: `pnpm exec next start --hostname 127.0.0.1 --port ${uiPort}`,
      url: `http://127.0.0.1:${uiPort}`,
      timeout: 60_000,
    },
    { command: 'bun e2e/memory-server.ts', url: `http://127.0.0.1:${apiPort}/api/requests`, timeout: 30_000 },
  ],
})
