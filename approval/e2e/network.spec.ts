import { expect, test } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  await request.post('/__test/reset')
})

test('operator unlocks the private graph and runs device and relay checks with failure timestamps', async ({
  page,
  request,
}, info) => {
  await page.goto('/')
  const panel = page.getByRole('region', { name: 'Tailnet network' })
  await expect(panel).toContainText('Unlock the console')
  await expect(panel.getByText('agent-1.bramble.eth', { exact: true })).toHaveCount(0)
  await page.getByLabel('Demo token', { exact: true }).fill('browser-test-only')
  await page.getByRole('button', { name: 'Unlock', exact: true }).press('Enter')
  await expect(panel.getByRole('img', { name: 'Observed tailnet connections' })).toBeVisible()
  const device = panel.getByRole('article', { name: 'Network node agent-1.bramble.eth' })
  await expect(device).toContainText('Direct')
  await device.getByRole('button', { name: 'Ping device' }).press('Enter')
  await expect(device.getByRole('status')).toContainText('12.4 ms')
  await expect(device.locator('time').last()).toHaveAttribute('datetime', /T/)
  const relay = panel.getByRole('article', { name: 'Network node relay-eu' })
  await relay.getByRole('button', { name: 'Check relay' }).click()
  await expect(relay.getByRole('status')).toContainText('HTTP RTT')
  await panel.screenshot({ path: info.outputPath(`probe-success-${info.project.name}.png`) })
  await request.post('/__test/probe-failed')
  await device.getByRole('button', { name: 'Ping device' }).click()
  await expect(device.getByRole('status')).toContainText('Probe failed')
  await panel.screenshot({ path: info.outputPath(`probe-failed-${info.project.name}.png`) })
  await request.post('/__test/network-offline')
  await panel.getByRole('button', { name: 'Refresh network' }).click()
  await expect(panel.getByRole('alert')).toContainText('unavailable')
  await expect(device.getByRole('button', { name: 'Ping device' })).toBeDisabled()
  await page.getByRole('button', { name: 'Lock console' }).click()
  await expect(panel.getByRole('article')).toHaveCount(0)
})
