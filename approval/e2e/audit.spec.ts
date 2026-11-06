import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fixtureAuditFeed } from '../src/lib/audit-fixture'

const head = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim()

test('offline HCS panel matches all three commitments and wraps full hashes', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/audit/fixtures')
  const panel = page.getByRole('region', { name: 'HCS audit trail' })
  await expect(panel.getByText('Commitment matched', { exact: true })).toHaveCount(3)
  await expect(panel.getByRole('status').filter({ hasText: 'Synthetic events' })).toBeVisible()
  await expect(panel.getByRole('link', { name: 'View HCS entry on HashScan' }).first()).toHaveAttribute(
    'href',
    'https://hashscan.io/testnet/transaction/1793932201.000000001'
  )
  await expect(panel.getByRole('link', { name: 'View topic', exact: false }).first()).toHaveAttribute(
    'href',
    'https://hashscan.io/testnet/topic/0.0.900001'
  )
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const html = await page.content()
  expect(html).not.toContain('0101010101010101010101010101010101010101010101010101010101010101')
  expect(html).not.toContain('demo-agent.example.eth')
  expect(errors).toEqual([])
  await page.screenshot({
    path: info.outputPath(`beat-3-hcs-fixtures-${info.project.name}-${head}.png`),
    fullPage: true,
  })
})

test('live panel requires unlock, marks failed refresh stale and clears on lock', async ({ page }) => {
  await page.route('**/api/requests', (route) => route.fulfill({ json: { requests: [] } }))
  const feed = await fixtureAuditFeed()
  let offline = false
  await page.route('**/api/audit/verification', (route) => {
    expect(route.request().headers().authorization).toBe('Bearer test-only')
    return offline
      ? route.fulfill({ status: 502, json: { error: { message: 'private upstream detail' } } })
      : route.fulfill({ json: feed })
  })
  await page.goto('/')
  const panel = page.getByRole('region', { name: 'HCS audit trail' })
  await expect(panel.getByText('Unlock the console', { exact: false })).toBeVisible()
  await page.getByLabel('Demo token', { exact: true }).fill('test-only')
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(panel.getByText('Commitment matched', { exact: true })).toHaveCount(3)
  offline = true
  await panel.getByRole('button', { name: 'Check again' }).click()
  await expect(panel.getByRole('alert')).toContainText('stale')
  await expect(panel.getByText('Commitment matched', { exact: true })).toHaveCount(0)
  await expect(panel.getByText('Stale · recheck needed', { exact: true })).toHaveCount(3)
  await expect(panel.getByText('Last successful check; recheck needed.', { exact: true })).toHaveCount(3)
  await expect(panel.getByText('reproduces the mirror message')).toHaveCount(0)
  await expect(page.getByText('private upstream detail')).toHaveCount(0)
  await page.getByRole('button', { name: 'Lock console' }).click()
  await expect(panel.getByRole('article')).toHaveCount(0)
  await expect(panel.getByRole('alert')).toHaveCount(0)
})
