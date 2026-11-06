import { expect, test } from '@playwright/test'

const headers = { authorization: 'Bearer browser-test-only' }
const input = {
  agentLabel: 'agent-1',
  gatewayLabel: 'gateway-1',
  service: 'staging-tasks',
  requestedDuration: 300,
  note: 'Read the next staging task. Access is limited to this service.',
}

test.beforeEach(async ({ request }) => {
  await request.post('/__test/reset')
})

test('human approves and revokes an API request, then denies a new request', async ({ page, request }, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByText('No pending requests.', { exact: false })).toBeVisible()
  await request.post('/api/requests', { data: input, headers })
  const card = page.getByRole('article', { name: 'Request from agent-1' })
  await expect(card.getByRole('button', { name: 'Approve', exact: true })).toBeVisible({ timeout: 2000 })
  await expect(card.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled()
  await expect(card.getByText('Public key published').first()).toBeVisible()
  await page.screenshot({ path: info.outputPath('beat-2-request.png'), fullPage: true })
  await page.getByLabel('Demo token', { exact: true }).fill('browser-test-only')
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await card.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(card.getByText('Waiting for transaction confirmation…')).toBeVisible()
  await page.screenshot({ path: info.outputPath('beat-2-pending.png'), fullPage: true })
  await expect(card.getByText('Access granted', { exact: true }).first()).toBeVisible({ timeout: 6000 })
  await expect(card.getByRole('link', { name: 'View on Sepolia Etherscan' })).toHaveAttribute(
    'href',
    `https://sepolia.etherscan.io/tx/0x${'1'.repeat(64)}`
  )
  await expect(card.getByText(/s until scheduled revoke/)).toBeVisible()
  await page.screenshot({ path: info.outputPath('beat-2-granted.png'), fullPage: true })
  await card.getByRole('button', { name: 'Revoke access' }).click()
  await expect(card.getByText('Waiting for transaction confirmation…')).toBeVisible()
  await expect(card.getByText('Access revoked', { exact: true }).first()).toBeVisible({ timeout: 6000 })
  await expect(card.getByText('Revoke confirmed')).toBeVisible()
  await page.screenshot({ path: info.outputPath('beat-5-revoked.png'), fullPage: true })
  await request.post('/api/requests', { data: { ...input, service: 'another-task' }, headers })
  const pending = page.getByRole('article').filter({ has: page.getByRole('button', { name: 'Deny', exact: true }) })
  await pending.getByRole('button', { name: 'Deny', exact: true }).click()
  await expect(page.getByText('Request denied', { exact: true }).first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
  await page.getByRole('button', { name: 'Lock console' }).click()
  await page.reload()
  await expect(page.getByLabel('Demo token', { exact: true })).toHaveValue('')
})

test('failed authorization and signer failures never report a grant', async ({ page, request }) => {
  await request.post('/api/requests', { data: input, headers })
  await page.goto('/')
  await page.getByLabel('Demo token', { exact: true }).fill('incorrect')
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('valid demo bearer token')
  await expect(page.getByText('Access granted', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Lock console' }).click()
  await page.getByLabel('Demo token', { exact: true }).fill('browser-test-only')
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await request.post('/__test/fail-grant')
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('did not confirm the grant')
  await expect(page.getByText('Access granted', { exact: true })).toHaveCount(0)
})
