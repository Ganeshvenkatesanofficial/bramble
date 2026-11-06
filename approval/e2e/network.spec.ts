import AxeBuilder from '@axe-core/playwright'
import { writeFile } from 'node:fs/promises'
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

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} no-feed graph retains approval facts and console-host probes`, async ({ page, request }, info) => {
    await request.post('/__test/no-feed')
    const headers = { authorization: 'Bearer browser-test-only' }
    await request.post('/api/requests', {
      headers,
      data: { agentLabel: 'agent-1', gatewayLabel: 'gateway-1', service: 'tasks' },
    })
    await request.post('/api/joins', { data: { label: 'laptop', tailnet: 'bramble.eth', pubkey: 'ab'.repeat(32) } })
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    await page.goto('/')
    await page.getByLabel('Demo token', { exact: true }).fill('browser-test-only')
    await page.getByRole('button', { name: 'Unlock', exact: true }).press('Enter')
    const panel = page.getByRole('region', { name: 'Tailnet network' })
    await expect(panel.getByRole('article', { name: 'Network node bramble.eth' })).toBeVisible()
    const device = panel.getByRole('article', { name: 'Network node agent-1.bramble.eth' })
    await expect(device).toContainText('Admission unavailable')
    await expect(device).toContainText('Path unavailable')
    await expect(device).toContainText('Last handshake: Unavailable')
    await expect(device.getByRole('button', { name: 'Ping device' })).toBeDisabled()
    await expect(device).toContainText('No supported probe target')
    await expect(panel.locator('line.unavailable')).toHaveCount(2)
    const relay = panel.getByRole('article', { name: 'Network node relay-local' })
    await relay.getByRole('button', { name: 'Check relay' }).press('Enter')
    await expect(relay.getByRole('status')).toContainText('HTTP RTT')
    await expect(relay.getByRole('status')).toContainText('console host')
    await expect(relay.getByRole('status')).toContainText('does not prove tunnel connectivity')
    await expect(relay.locator('time')).toHaveAttribute('datetime', /T/)
    await request.post('/__test/probe-failed')
    await relay.getByRole('button', { name: 'Check relay' }).click()
    await expect(relay.getByRole('status')).toContainText('Probe failed')
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const reportPath = info.outputPath(`axe-no-feed-${theme}-${info.project.name}.json`)
    await writeFile(reportPath, JSON.stringify(results, null, 2))
    await info.attach('axe-no-feed', { path: reportPath, contentType: 'application/json' })
    expect(results.violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`no-feed-${theme}-${info.project.name}.png`), fullPage: true })
  })
}
