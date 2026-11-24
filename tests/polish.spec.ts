/**
 * Phase 8 — branding, landing, role-aware home, and the 380px mobile check.
 */
import type { Page } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

test.describe.configure({ mode: 'serial' })

type BridgeResult = { success: boolean; data?: Record<string, unknown>; code?: string; error?: string }

async function callActionAs(page: Page, name: string, params: Record<string, unknown> = {}): Promise<BridgeResult> {
  await page.goto('/queue')
  await page.waitForFunction(
    () => Boolean((window as unknown as { __callAction?: unknown }).__callAction),
    undefined,
    { timeout: 15_000 },
  )
  return page.evaluate(
    ([n, p]) =>
      (
        window as unknown as {
          __callAction: (name: string, params: Record<string, unknown>) => Promise<BridgeResult>
        }
      ).__callAction(n as string, p as Record<string, unknown>),
    [name, params] as const,
  )
}

/** Fail if the page scrolls sideways at the current viewport width. */
async function expectNoHorizontalOverflow(page: Page, path: string) {
  await page.goto(path)
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(500)
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${path} overflows horizontally at ${clientWidth}px`).toBeLessThanOrEqual(clientWidth + 1)
}

test('landing: real product page, app-specific title, reviewer section, no placeholder copy', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Office hours, minus the hallway line.')
  await expect(page).toHaveTitle(/OfficeHours AI/)
  await expect(page.getByTestId('landing-reviewers')).toContainText('invite code')
  await expect(page.getByTestId('landing-reviewers')).toContainText('not published here')
  const cta = page.getByTestId('landing-cta')
  await expect(cta).toHaveAttribute('href', '/home')
  const body = await page.locator('body').innerText()
  expect(body).not.toMatch(/placeholder|A DeepSpace app|static front door|Replace src\//i)
})

test('landing has no horizontal overflow at 380px (signed out)', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 800 })
  await expectNoHorizontalOverflow(page, '/')
  await expectNoHorizontalOverflow(page, '/home')
})

test.describe('signed in', () => {
  const usable = loadAllTestAccounts().length
  test.skip(usable < 2, `Needs 2 usable test accounts, found ${usable}.`)

  test('/home is role-aware: student sees the queue step, staff also sees the TA queue', async ({ users }) => {
    const [a, b] = await users(2)
    await callActionAs(a.page, 'devLeaveStaff', {})
    await callActionAs(b.page, 'devLeaveStaff', {})
    const code = await callActionAs(b.page, 'devGetInviteCode', {})
    expect((await callActionAs(b.page, 'joinAsStaff', { code: String(code.data?.code ?? '') })).success).toBe(true)

    await a.page.goto('/home')
    await expect(a.page.getByRole('heading', { level: 1 })).toHaveText('Office hours, live')
    await expect(a.page.getByTestId('home-queue-link')).toBeVisible({ timeout: 15_000 })
    await expect(a.page.getByTestId('home-ta-link')).toHaveCount(0)
    await expect(a.page.getByTestId('home-instructor-link')).toHaveCount(0)
    expect(await a.page.locator('body').innerText()).not.toMatch(/placeholder page|Replace src\//i)

    await b.page.goto('/home')
    await expect(b.page.getByTestId('home-ta-link')).toBeVisible({ timeout: 15_000 })
    await expect(b.page.getByTestId('home-instructor-link')).toHaveCount(0) // staff, not admin

    await callActionAs(b.page, 'devLeaveStaff', {})
  })

  test('every app page fits a 380px-wide screen (with a long question title)', async ({ users }) => {
    const [a, b] = await users(2)
    await callActionAs(a.page, 'devResetQueue', {})
    await callActionAs(b.page, 'devLeaveStaff', {})
    const code = await callActionAs(b.page, 'devGetInviteCode', {})
    await callActionAs(b.page, 'joinAsStaff', { code: String(code.data?.code ?? '') })
    const q = await callActionAs(a.page, 'submitQuestion', {
      title: `Averyveryverylongunbrokenidentifier_count_paths_memoized_${'x'.repeat(60)}`,
      body: 'Long body text '.repeat(30),
    })
    expect(q.success).toBe(true)

    for (const p of [a.page, b.page]) await p.setViewportSize({ width: 380, height: 800 })
    for (const path of ['/home', '/queue', '/settings', '/join-staff', '/instructor']) {
      await expectNoHorizontalOverflow(a.page, path)
    }
    await expectNoHorizontalOverflow(b.page, '/ta')

    await callActionAs(a.page, 'leaveQueue', { questionId: String(q.data?.recordId ?? '') })
    await callActionAs(b.page, 'devLeaveStaff', {})
  })
})
