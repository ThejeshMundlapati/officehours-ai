/**
 * Phase 2 — TA invite code + live staff queue.
 *
 * Needs two usable test accounts (members, not admin). Serial, because the
 * tests share the account pool and mutate shared queue/staff state.
 *
 * Getting a valid code without an admin session: `devGetInviteCode` /
 * `devLeaveStaff` are DEV/TEST-only actions gated on `env.ALLOW_DEBUG_ROUTES`
 * (set by `deepspace dev`/`test`, unset in production). They are invoked via the
 * DEV-only `window.__callAction` bridge mounted in the protected layout.
 */
import type { Page } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

test.describe.configure({ mode: 'serial' })

const usable = loadAllTestAccounts().length
test.skip(
  usable < 2,
  `Needs 2 usable test accounts, found ${usable}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" --password-stdin`.',
)

type BridgeResult = { success: boolean; data?: Record<string, unknown>; code?: string; error?: string }

/** Invoke a server action as the signed-in user via the DEV bridge. */
async function callActionAs(
  page: Page,
  name: string,
  params: Record<string, unknown> = {},
): Promise<BridgeResult> {
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

async function clearQueue(page: Page): Promise<void> {
  await page.goto('/queue')
  await expect(page.getByTestId('queue-ready')).toBeVisible({ timeout: 15_000 })
  const leave = page.getByTestId('leave-button')
  if (await leave.isVisible().catch(() => false)) {
    await leave.click()
    await page.getByRole('button', { name: 'Yes, leave' }).click()
    await expect(page.getByTestId('submit-form')).toBeVisible({ timeout: 15_000 })
  }
}

async function getInviteCode(page: Page): Promise<string> {
  const res = await callActionAs(page, 'devGetInviteCode', {})
  expect(res.success).toBe(true)
  const code = String(res.data?.code ?? '')
  expect(code.length).toBeGreaterThanOrEqual(12)
  return code
}

test('wrong invite code is refused and the user is not on staff', async ({ users }) => {
  const [b] = await users(1)
  await callActionAs(b.page, 'devLeaveStaff', {})

  const res = await callActionAs(b.page, 'joinAsStaff', { code: 'WRONGCODE2345' })
  expect(res.success).toBe(false)
  expect(res.code).toBe('invalid_code')

  await b.page.goto('/ta')
  await expect(b.page.getByTestId('ta-not-staff')).toBeVisible({ timeout: 15_000 })
})

test('correct invite code makes the user staff and reaches /ta', async ({ users }) => {
  const [b] = await users(1)
  await callActionAs(b.page, 'devLeaveStaff', {})

  const code = await getInviteCode(b.page)
  const res = await callActionAs(b.page, 'joinAsStaff', { code })
  expect(res.success).toBe(true)

  await b.page.goto('/ta')
  await expect(b.page.getByTestId('ta-ready')).toBeVisible({ timeout: 15_000 })

  await callActionAs(b.page, 'devLeaveStaff', {})
})

test('backfill: a question submitted BEFORE joining is visible after joining', async ({ users }) => {
  const [a, b] = await users(2)
  await callActionAs(b.page, 'devLeaveStaff', {})
  await clearQueue(a.page)

  const title = `Backfill ${Date.now()}`
  const created = await callActionAs(a.page, 'submitQuestion', {
    title,
    body: 'Submitted before B joined.',
  })
  expect(created.success).toBe(true)

  const code = await getInviteCode(b.page)
  expect((await callActionAs(b.page, 'joinAsStaff', { code })).success).toBe(true)

  await b.page.goto('/ta')
  await expect(b.page.getByText(title)).toBeVisible({ timeout: 15_000 })

  // cleanup
  await callActionAs(a.page, 'leaveQueue', { questionId: String(created.data?.recordId ?? '') })
  await callActionAs(b.page, 'devLeaveStaff', {})
})

test('live: a question submitted while a TA watches /ta appears without reload', async ({ users }) => {
  const [a, b] = await users(2)
  await callActionAs(b.page, 'devLeaveStaff', {})
  await clearQueue(a.page)

  const code = await getInviteCode(b.page)
  expect((await callActionAs(b.page, 'joinAsStaff', { code })).success).toBe(true)

  await b.page.goto('/ta')
  await expect(b.page.getByTestId('ta-ready')).toBeVisible({ timeout: 15_000 })

  const title = `Live ${Date.now()}`
  const created = await callActionAs(a.page, 'submitQuestion', { title, body: 'Appears live for B.' })
  expect(created.success).toBe(true)

  // B's page is NOT reloaded — this is the proof that a newly created,
  // collaborator-visible record pushes to an existing subscription.
  await expect(b.page.getByText(title)).toBeVisible({ timeout: 20_000 })

  // cleanup
  await callActionAs(a.page, 'leaveQueue', { questionId: String(created.data?.recordId ?? '') })
  await callActionAs(b.page, 'devLeaveStaff', {})
})

test('a plain student on /ta sees the not-on-staff message and no questions', async ({ users }) => {
  const [a] = await users(1)
  await callActionAs(a.page, 'devLeaveStaff', {})
  await clearQueue(a.page)

  const created = await callActionAs(a.page, 'submitQuestion', {
    title: `Mine ${Date.now()}`,
    body: 'My own question.',
  })
  expect(created.success).toBe(true)

  await a.page.goto('/ta')
  await expect(a.page.getByTestId('ta-not-staff')).toBeVisible({ timeout: 15_000 })
  await expect(a.page.getByTestId('ta-question')).toHaveCount(0)

  await callActionAs(a.page, 'leaveQueue', { questionId: String(created.data?.recordId ?? '') })
})

test('after leaving staff, the former TA no longer sees open questions', async ({ users }) => {
  const [a, b] = await users(2)
  await callActionAs(b.page, 'devLeaveStaff', {})
  await clearQueue(a.page)

  const code = await getInviteCode(b.page)
  expect((await callActionAs(b.page, 'joinAsStaff', { code })).success).toBe(true)

  const title = `Removable ${Date.now()}`
  const created = await callActionAs(a.page, 'submitQuestion', { title, body: 'Visible until B leaves.' })
  expect(created.success).toBe(true)

  await b.page.goto('/ta')
  await expect(b.page.getByText(title)).toBeVisible({ timeout: 15_000 })

  // Remove B from staff (the admin `removeStaff` shares the same internal path).
  expect((await callActionAs(b.page, 'devLeaveStaff', {})).success).toBe(true)

  await b.page.goto('/ta')
  await expect(b.page.getByTestId('ta-not-staff')).toBeVisible({ timeout: 15_000 })

  // cleanup
  await callActionAs(a.page, 'leaveQueue', { questionId: String(created.data?.recordId ?? '') })
})

test('members cannot rotate the code or remove staff (admin-gated)', async ({ users }) => {
  const [m] = await users(1)

  const rotate = await callActionAs(m.page, 'rotateInviteCode', {})
  expect(rotate.success).toBe(false)
  expect(rotate.code).toBe('forbidden')

  const remove = await callActionAs(m.page, 'removeStaff', { userId: 'anybody' })
  expect(remove.success).toBe(false)
  expect(remove.code).toBe('forbidden')
})
