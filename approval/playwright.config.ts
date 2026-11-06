import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3101', headless: true },
  projects: [
    { name: '1280', use: { viewport: { width: 1280, height: 1000 } } },
    { name: '390', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    { command: 'pnpm start', url: 'http://127.0.0.1:3001', timeout: 60_000 },
    { command: 'bun e2e/memory-server.ts', url: 'http://127.0.0.1:3101/api/requests', timeout: 30_000 },
  ],
})
