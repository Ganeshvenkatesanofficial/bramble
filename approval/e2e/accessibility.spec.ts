import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const headers = { authorization: 'Bearer browser-test-only' }

// WCAG relative luminance; compare the rendered theme tokens with the specified thresholds.
function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const digits = hex.trim().replace('#', '')
    const channels = (digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits)
      .match(/../g)!
      .map((value) => {
        const s = parseInt(value, 16) / 255
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
  const x = luminance(a),
    y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
test.beforeEach(async ({ request }) => {
  await request.post('/__test/reset')
})

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} console supports keyboard decisions and meets automated WCAG AA checks`, async ({
    page,
    request,
  }, info) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    await request.post('/api/requests', {
      headers,
      data: {
        agentLabel: 'agent-1',
        gatewayLabel: 'gateway-1',
        service: 'staging-tasks',
        note: 'Private staging access for the demo.',
        requestedDuration: 300,
      },
    })
    await page.goto('/')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
    await page.keyboard.press('Enter')
    await page.getByLabel('Demo token', { exact: true }).fill('browser-test-only')
    await page.getByRole('button', { name: 'Unlock', exact: true }).focus()
    expect(
      await page
        .getByRole('button', { name: 'Unlock', exact: true })
        .evaluate((element) => getComputedStyle(element).outlineStyle)
    ).toBe('solid')
    await page.keyboard.press('Enter')
    const card = page.getByRole('article', { name: 'Request from agent-1' })
    const approve = card.getByRole('button', { name: 'Approve', exact: true })
    await approve.focus()
    await page.keyboard.press('Space')
    await expect(card.getByText('Grant confirmed')).toBeVisible({ timeout: 6000 })
    await expect(page.getByRole('region', { name: 'Device onboarding', exact: true })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Pending device joins', exact: true })).toHaveCount(1)
    await expect(page.getByRole('region', { name: 'Tailnet members', exact: true })).toHaveCount(1)
    await request.post('/api/requests', {
      headers,
      data: { agentLabel: 'agent-2', gatewayLabel: 'gateway-1', service: 'staging-tasks' },
    })
    await expect(page.getByRole('article', { name: 'Request from agent-2' })).toBeVisible()
    const network = page.getByRole('region', { name: 'Tailnet network' })
    await expect(network.getByRole('img', { name: 'Observed tailnet connections' })).toBeVisible()
    await network.getByRole('button', { name: 'Refresh network' }).click()
    await expect(network.getByRole('article', { name: 'Network node agent-1.bramble.eth' })).toContainText('Granted')
    const palette = await page.evaluate(() =>
      Object.fromEntries(
        [
          'foreground',
          'background',
          'surface',
          'muted',
          'muted-foreground',
          'primary',
          'on-primary',
          'destructive',
          'border',
          'focus',
          'pending',
        ].map((name) => [name, getComputedStyle(document.documentElement).getPropertyValue(`--${name}`)])
      )
    )
    for (const text of ['foreground', 'muted-foreground', 'primary', 'destructive', 'pending']) {
      for (const background of ['background', 'surface', 'muted'])
        expect(contrast(palette[text], palette[background]), `${text} on ${background}`).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(palette['on-primary'], palette.primary)).toBeGreaterThanOrEqual(4.5)
    for (const control of ['border', 'focus']) {
      for (const background of ['background', 'surface', 'muted'])
        expect(contrast(palette[control], palette[background]), `${control} on ${background}`).toBeGreaterThanOrEqual(3)
    }
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    await info.attach(`axe-${theme}-${info.project.name}.json`, {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json',
    })
    expect(results.violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`console-${theme}-${info.project.name}.png`), fullPage: true })
    await network.screenshot({ path: info.outputPath(`network-${theme}-${info.project.name}.png`) })
    const revoke = card.getByRole('button', { name: 'Revoke access' })
    await revoke.focus()
    await page.keyboard.press('Enter')
    await expect(card.getByText('Revoke confirmed')).toBeVisible({ timeout: 6000 })
    await page.screenshot({ path: info.outputPath(`revoked-${theme}-${info.project.name}.png`), fullPage: true })
    await page.getByRole('button', { name: 'Lock console' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('Demo token', { exact: true })).toHaveValue('')
    await expect(network.getByRole('article')).toHaveCount(0)
  })
}
