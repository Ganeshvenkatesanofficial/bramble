import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'

const head = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim()

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
  await page.screenshot({ path: info.outputPath(`beat-2-request-${info.project.name}-${head}.png`), fullPage: true })
  await page.getByLabel('Demo token', { exact: true }).fill('browser-test-only')
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await card.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(card.getByText('Waiting for transaction confirmation…')).toBeVisible()
  await page.screenshot({ path: info.outputPath(`beat-2-pending-${info.project.name}-${head}.png`), fullPage: true })
  await expect(card.getByText('Access granted', { exact: true }).first()).toBeVisible({ timeout: 6000 })
  await expect(card.getByRole('link', { name: 'View on Sepolia Etherscan' })).toHaveAttribute(
    'href',
    `https://sepolia.etherscan.io/tx/0x${'1'.repeat(64)}`
  )
  await expect(card.getByText(/s until scheduled revoke/)).toBeVisible()
  await page.screenshot({ path: info.outputPath(`beat-2-granted-${info.project.name}-${head}.png`), fullPage: true })
  await card.getByRole('button', { name: 'Revoke access' }).click()
  await expect(card.getByText('Waiting for transaction confirmation…')).toBeVisible()
  await expect(card.getByText('Access revoked', { exact: true }).first()).toBeVisible({ timeout: 6000 })
  await expect(card.getByText('Revoke confirmed')).toBeVisible()
  await page.screenshot({ path: info.outputPath(`beat-5-revoked-${info.project.name}-${head}.png`), fullPage: true })
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
  await expect(page.getByRole('main').getByRole('alert')).toContainText('valid demo bearer token')
  await expect(page.getByText('Access granted', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Lock console' }).click()
  await page.getByLabel('Demo token', { exact: true }).fill('browser-test-only')
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await request.post('/__test/fail-grant')
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('did not confirm the grant')
  await expect(page.getByText('Access granted', { exact: true })).toHaveCount(0)
})

test('a stale queue pauses decisions until a fresh API read succeeds', async ({ page, request }) => {
  await request.post('/api/requests', { data: input, headers })
  await page.goto('/')
  await page.getByLabel('Demo token', { exact: true }).fill('browser-test-only')
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  const approve = page.getByRole('button', { name: 'Approve', exact: true })
  await expect(approve).toBeEnabled()
  await request.post('/__test/offline')
  await expect(page.getByRole('main').getByRole('alert')).toContainText('decisions are paused')
  await expect(approve).toBeDisabled()
  await request.post('/__test/reset')
  await request.post('/api/requests', { data: input, headers })
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
  await expect(approve).toBeEnabled()
})

test('open device join is visible within two seconds, then the operator approves, revokes and denies', async ({
  page,
  request,
}) => {
  await page.goto('/')
  await page.getByLabel('Demo token', { exact: true }).fill('browser-test-only')
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Pending device joins' })).toBeVisible()
  const start = Date.now()
  const created = await request.post('/api/joins', {
    data: { label: 'laptop', pubkey: 'ab'.repeat(32), tailnet: 'mesh.eth' },
  })
  expect(created.status()).toBe(201)
  const pending = page
    .getByRole('region', { name: 'Pending device joins' })
    .getByRole('article', { name: 'Device laptop' })
  await expect(pending).toBeVisible({ timeout: 2000 })
  expect(Date.now() - start).toBeLessThan(2000)
  await pending.getByRole('button', { name: 'Approve', exact: true }).click()
  const member = page.getByRole('region', { name: 'Tailnet members' }).getByRole('article', { name: 'Device laptop' })
  await expect(member.getByText('Mesh IP: 10.77.0.2')).toBeVisible()
  await member.getByRole('button', { name: 'Revoke', exact: true }).click()
  await expect(member.getByText('revoked', { exact: true })).toBeVisible()
  await request.post('/api/joins', { data: { label: 'phone', pubkey: 'cd'.repeat(32), tailnet: 'mesh.eth' } })
  const phone = page
    .getByRole('region', { name: 'Pending device joins' })
    .getByRole('article', { name: 'Device phone' })
  await phone.getByRole('button', { name: 'Deny', exact: true }).click()
  await expect(phone).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Device activity' })).toContainText('denied')
})
