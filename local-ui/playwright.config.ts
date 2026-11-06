import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:7788', headless: true },
  projects: [
    { name: '1280', use: { viewport: { width: 1280, height: 900 } } },
    { name: '390', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: 'bun mock/server.ts', url: 'http://127.0.0.1:7788/api/state', timeout: 30_000 },
})
