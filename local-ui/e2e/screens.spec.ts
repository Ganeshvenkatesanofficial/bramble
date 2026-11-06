import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const shotDir = process.env.SCREENSHOT_DIR
if (shotDir) mkdirSync(shotDir, { recursive: true })

async function shot(page: Page, info: TestInfo, name: string) {
  await page.waitForTimeout(300)
  const file = `${name}-${info.project.name}.png`
  await page.screenshot({ path: shotDir ? join(shotDir, file) : info.outputPath(file), fullPage: true })
}

const hook = (request: APIRequestContext, path: string, data: object = {}) => request.post(`/__test/${path}`, { data })
const reset = (request: APIRequestContext, scenario: string, admin = false) =>
  hook(request, 'reset', { scenario, admin })

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error
  })
})

test.afterEach(async ({ page }) => {
  // The page must never scroll sideways, whatever state it ended in.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('first run: name the device, then join with a request that the admin approves', async ({
  page,
  request,
}, info) => {
  await reset(request, 'fresh')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Name this device' })).toBeVisible()
  await expect(page.getByText('9f3a c1d2 7b4e 86a0 5c13 de7f 2a98 b410')).toBeVisible()
  await shot(page, info, '01-setup')

  await page.getByLabel('Device name').fill('Ana Laptop!')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Use lowercase letters, numbers and hyphens.', { exact: false })).toBeVisible()
  await shot(page, info, '02-setup-invalid')

  await page.getByLabel('Device name').fill('laptop-ana')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Which network do you want to join?' })).toBeVisible()
  await shot(page, info, '03-join')

  await page.getByLabel('Network name').fill('acme')
  await page.getByRole('button', { name: 'Request to join' }).click()
  await expect(page.getByText('A network name has dots in it', { exact: false })).toBeVisible()

  await page.getByLabel('Network name').fill('unknown.bramble.eth')
  await page.getByRole('button', { name: 'Request to join' }).click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'No network called unknown.bramble.eth was found.'
  )
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Check the spelling with your admin.')
  await shot(page, info, '04-join-error')

  await page.getByLabel('Network name').fill('acme.bramble.eth')
  await page.getByRole('button', { name: 'Request to join' }).click()
  await expect(page.getByRole('heading', { name: 'Waiting for approval' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('acme.bramble.eth')
  await shot(page, info, '05-pending')

  // The admin approves from their own session; this page follows by itself.
  await hook(request, 'state', { isAdmin: true })
  const joins = await (await request.get('/api/admin/joins')).json()
  const mine = joins.joins.find((join: { label: string }) => join.label === 'laptop-ana')
  await request.post(`/api/admin/joins/${mine.id}/approve`)
  await expect(page.getByRole('heading', { name: 'You are in. Connecting…' })).toBeVisible({ timeout: 3000 })
  await shot(page, info, '06-approved')
  await expect(page.getByRole('heading', { name: 'You are on the network' })).toBeVisible({ timeout: 6000 })
})

test('a denied request explains what to do and starts over', async ({ page, request }, info) => {
  await reset(request, 'denied')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'This device cannot join yet' })).toBeVisible()
  await expect(page.getByText('did not approve', { exact: false })).toBeVisible()
  await shot(page, info, '07-denied')
  await page.getByRole('button', { name: 'Start over' }).click()
  await expect(page.getByRole('heading', { name: 'Which network do you want to join?' })).toBeVisible()
})

test('pending request can be cancelled', async ({ page, request }) => {
  await reset(request, 'pending')
  await page.goto('/')
  await page.getByRole('button', { name: 'Cancel request' }).click()
  await expect(page.getByRole('heading', { name: 'Which network do you want to join?' })).toBeVisible()
})

test('connected: peers show direct and relayed paths, tests report results, leaving needs a confirm', async ({
  page,
  request,
}, info) => {
  await reset(request, 'connected')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'You are on the network' })).toBeVisible()
  await expect(page.getByText('100.64.0.7').first()).toBeVisible()
  const direct = page.getByRole('listitem', { name: 'Device gateway-1' })
  await expect(direct.getByText('Direct')).toBeVisible()
  await expect(page.getByRole('listitem', { name: 'Device agent-1' }).getByText('Relayed')).toBeVisible()
  await expect(page.getByRole('listitem', { name: 'Device laptop-bo' }).getByText('Not connected')).toBeVisible()
  await shot(page, info, '08-connected')

  await page.getByRole('button', { name: 'Test connection', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Testing…' })).toBeDisabled()
  await expect(page.getByRole('status').filter({ hasText: 'Reached the network in 38 ms.' })).toBeVisible()
  await shot(page, info, '09-test-ok')

  await hook(request, 'flags', { test: { ok: false, status: 504, ms: 5000 } })
  await direct.getByRole('button', { name: 'Test connection to gateway-1' }).click()
  const result = page.getByRole('status').filter({ hasText: 'Could not reach gateway-1.' })
  await expect(result).toContainText('status 504')
  await expect(result).toContainText('Check that the other device is online')
  await shot(page, info, '10-test-failed')

  await page.getByRole('button', { name: 'Leave network' }).click()
  await expect(page.getByText('will need approval again', { exact: false })).toBeVisible()
  await shot(page, info, '11-leave-confirm')
  await page.getByRole('button', { name: 'Stay' }).click()
  await page.getByRole('button', { name: 'Leave network' }).click()
  await page.getByRole('button', { name: 'Leave network' }).last().click()
  await expect(page.getByRole('heading', { name: 'Which network do you want to join?' })).toBeVisible()
})

test('connected with nobody else on the network shows an empty state', async ({ page, request }, info) => {
  await reset(request, 'connected-empty')
  await page.goto('/')
  await expect(page.getByText('No other devices yet.', { exact: false })).toBeVisible()
  await shot(page, info, '12-connected-empty')
})

test('a problem shows what to do next, and a lost daemon keeps the last state on screen', async ({
  page,
  request,
}, info) => {
  await reset(request, 'error')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Bramble hit a problem' })).toBeVisible()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('could not reach the relay')
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Check your internet connection.')
  await shot(page, info, '13-error')

  await reset(request, 'connected')
  await expect(page.getByRole('heading', { name: 'You are on the network' })).toBeVisible({ timeout: 3000 })
  await hook(request, 'flags', { offline: true })
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Lost contact with Bramble', { timeout: 3000 })
  await expect(page.getByRole('heading', { name: 'You are on the network' })).toBeVisible()
  await shot(page, info, '14-lost-contact')
  await hook(request, 'flags', { offline: false })
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0, { timeout: 3000 })
})

test('when Bramble is not running the page says so and recovers', async ({ page, request }, info) => {
  await reset(request, 'ready')
  await hook(request, 'flags', { offline: true })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Bramble is not running' })).toBeVisible()
  await shot(page, info, '15-not-running')
  await hook(request, 'flags', { offline: false })
  await expect(page.getByRole('heading', { name: 'Which network do you want to join?' })).toBeVisible({ timeout: 3000 })
})

test('admin: approve and deny requests, revoke a device', async ({ page, request }, info) => {
  await reset(request, 'connected', true)
  await page.goto('/')
  const tabs = page.getByRole('navigation', { name: 'Sections' })
  await expect(tabs.getByLabel('1 waiting')).toBeVisible()
  await tabs.getByRole('button', { name: 'Admin' }).click()
  await expect(page.getByRole('heading', { name: 'Who can join your network' })).toBeVisible()
  const card = page.getByRole('article', { name: 'Join request from laptop-bo' })
  await expect(card.getByRole('button', { name: 'Approve' })).toBeVisible()
  await shot(page, info, '16-admin')

  await card.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('No requests waiting.', { exact: false })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Join request from laptop-bo' }).getByText('Approved')).toBeVisible()

  const agent = page.getByRole('article', { name: 'Join request from agent-1' })
  await agent.getByRole('button', { name: 'Revoke access' }).click()
  await shot(page, info, '17-admin-revoke-confirm')
  await agent.getByRole('button', { name: 'Revoke agent-1' }).click()
  await expect(agent.getByText('Revoked')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Closed requests' })).toBeVisible()
  await shot(page, info, '18-admin-after')

  await tabs.getByRole('button', { name: 'This device' }).click()
  await expect(page.getByRole('heading', { name: 'You are on the network' })).toBeVisible()
})

test('admin: deny a request', async ({ page, request }) => {
  await reset(request, 'connected', true)
  await page.goto('/')
  await page.getByRole('button', { name: 'Admin' }).click()
  const card = page.getByRole('article', { name: 'Join request from laptop-bo' })
  await card.getByRole('button', { name: 'Deny' }).click()
  await expect(card.getByText('Denied')).toBeVisible()
})

test('admin: an unreachable approval service or rejected sign-in pauses decisions and says what to do', async ({
  page,
  request,
}, info) => {
  await reset(request, 'connected', true)
  await page.goto('/')
  await page.getByRole('button', { name: 'Admin' }).click()
  await expect(page.getByRole('button', { name: 'Approve' })).toBeEnabled()

  await hook(request, 'flags', { admin: 'down' })
  const alert = page.getByRole('main').getByRole('alert')
  await expect(alert).toContainText('The approval service is not answering.', { timeout: 3000 })
  await expect(alert).toContainText('Decisions stay paused')
  await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled()
  await shot(page, info, '19-admin-down')

  await hook(request, 'flags', { admin: 'rejected' })
  await expect(alert).toContainText('The admin sign-in was not accepted.', { timeout: 3000 })
  await expect(alert).toContainText('bramble admin login')
  await shot(page, info, '20-admin-rejected')

  await hook(request, 'flags', { admin: 'ok' })
  await expect(alert).toHaveCount(0, { timeout: 3000 })
  await expect(page.getByRole('button', { name: 'Approve' })).toBeEnabled()
})

test('admin with nothing yet shows empty states; non-admins see no admin tab', async ({ page, request }, info) => {
  await reset(request, 'connected')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'You are on the network' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Admin' })).toHaveCount(0)

  await hook(request, 'reset', { scenario: 'connected', admin: true })
  await hook(request, 'state', { isAdmin: true })
  // An admin whose network is brand new has no requests and no devices.
  await request.post('/__test/joins', { data: [] })
  await page.getByRole('button', { name: 'Admin' }).click()
  await expect(page.getByText('No approved devices yet.')).toBeVisible()
  await shot(page, info, '21-admin-empty')
})
