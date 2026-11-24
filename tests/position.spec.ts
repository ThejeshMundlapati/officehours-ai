/**
 * Phase 3 — live queue position, waiting count, not_open, studentName.
 *
 * Two members, serial (shared pool + shared queue state).
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

test('positions and waiting count update live across students', async ({ users }) => {
  const [a, b] = await users(2)
  // users(2) holds both pooled accounts, so this test has the queue to itself;
  // reset clears any stale in-line rows from earlier runs (positions are global).
  await callActionAs(a.page, 'devResetQueue', {})

  const aq = await callActionAs(a.page, 'submitQuestion', { title: `A ${Date.now()}`, body: 'A body' })
  expect(aq.success).toBe(true)
  await a.page.goto('/queue')
  await expect(a.page.getByTestId('queue-position')).toContainText('#1', { timeout: 15_000 })

  const bq = await callActionAs(b.page, 'submitQuestion', { title: `B ${Date.now()}`, body: 'B body' })
  expect(bq.success).toBe(true)
  await b.page.goto('/queue')
  await expect(b.page.getByTestId('queue-position')).toContainText('#2', { timeout: 15_000 })
  await expect(b.page.getByTestId('queue-position')).toContainText('1 ahead', { timeout: 15_000 })

  // Public stats row reads 2 on B's page.
  await expect(b.page.getByTestId('waiting-count')).toContainText('2 students waiting', { timeout: 15_000 })

  // A leaves — B's position and the count update WITHOUT a reload of B's page.
  expect((await callActionAs(a.page, 'leaveQueue', { questionId: String(aq.data?.recordId ?? '') })).success).toBe(true)
  await expect(b.page.getByTestId('queue-position')).toContainText('#1', { timeout: 20_000 })
  await expect(b.page.getByTestId('waiting-count')).toContainText('1 student waiting', { timeout: 20_000 })

  // cleanup
  await callActionAs(b.page, 'leaveQueue', { questionId: String(bq.data?.recordId ?? '') })
})

test('leaving an already-left question returns not_open', async ({ users }) => {
  const [a] = await users(1)
  await callActionAs(a.page, 'devResetQueue', {})

  const q = await callActionAs(a.page, 'submitQuestion', { title: `NO ${Date.now()}`, body: 'x body' })
  expect(q.success).toBe(true)
  const id = String(q.data?.recordId ?? '')

  expect((await callActionAs(a.page, 'leaveQueue', { questionId: id })).success).toBe(true)

  const again = await callActionAs(a.page, 'leaveQueue', { questionId: id })
  expect(again.success).toBe(false)
  expect(again.code).toBe('not_open')
})

test('TA card shows the server-snapshotted student name and position', async ({ users }) => {
  const [a, b] = await users(2)
  await callActionAs(b.page, 'devLeaveStaff', {})
  await callActionAs(a.page, 'devResetQueue', {})

  const title = `Named ${Date.now()}`
  const aq = await callActionAs(a.page, 'submitQuestion', { title, body: 'needs help' })
  expect(aq.success).toBe(true)

  const codeRes = await callActionAs(b.page, 'devGetInviteCode', {})
  expect(codeRes.success).toBe(true)
  expect((await callActionAs(b.page, 'joinAsStaff', { code: String(codeRes.data?.code ?? '') })).success).toBe(true)

  await b.page.goto('/ta')
  const card = b.page.getByTestId('ta-question').filter({ hasText: title })
  await expect(card).toBeVisible({ timeout: 15_000 })
  // studentName was snapshotted server-side (never from params), so it is present.
  await expect(card.getByTestId('ta-student-name')).toHaveText(/\S/, { timeout: 15_000 })
  await expect(card.getByTestId('ta-position')).toContainText('#1', { timeout: 15_000 })

  // cleanup
  await callActionAs(a.page, 'leaveQueue', { questionId: String(aq.data?.recordId ?? '') })
  await callActionAs(b.page, 'devLeaveStaff', {})
})

// Not runnable with the fixture: every pooled test account is @deepspace.test,
// and the fixture cannot sign in as an arbitrary real user. The dev actions gate
// on BOTH env.ALLOW_DEBUG_ROUTES === 'true' AND the caller's users-record email
// ending in '@deepspace.test' (src/actions/staff.ts isTestAccount). A
// non-@deepspace.test caller gets { success:false, code:'not_available' }.
// Verified by code inspection; the production flag-unset path already returns
// not_available.
test.skip('dev actions refuse a non-@deepspace.test account', () => {})
