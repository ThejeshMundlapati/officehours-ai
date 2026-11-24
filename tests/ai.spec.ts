/**
 * Phase 5 — student AI-feedback actions (markSolved / stillNeedHelp).
 *
 * The real AI path is NOT exercised here: locally the knowledge call fails
 * closed (no APP_IDENTITY_TOKEN before deploy), so the job marks aiStatus
 * 'error' without a model call or credits. These tests cover ownership, the
 * leave-the-line bookkeeping, and live TA visibility. Serial: shared pool and
 * global queue.
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

async function joinStaff(page: Page): Promise<void> {
  const code = await callActionAs(page, 'devGetInviteCode', {})
  expect(code.success).toBe(true)
  expect((await callActionAs(page, 'joinAsStaff', { code: String(code.data?.code ?? '') })).success).toBe(true)
}

test('dev test accounts never trigger the paid AI job (no AI panel, stays waiting)', async ({ users }) => {
  // Local runs load production secrets, so a real job would hit the owner-
  // billed knowledge base and model. submitQuestion must skip it for
  // @deepspace.test callers while ALLOW_DEBUG_ROUTES is on.
  const [a] = await users(1)
  await callActionAs(a.page, 'devResetQueue', {})
  const q = await callActionAs(a.page, 'submitQuestion', { title: `No AI ${Date.now()}`, body: 'test account' })
  expect(q.success).toBe(true)

  await a.page.goto('/queue')
  await expect(a.page.getByTestId('open-question')).toBeVisible({ timeout: 15_000 })
  await a.page.waitForTimeout(3000)
  for (const id of ['ai-pending', 'ai-answer', 'ai-not-covered', 'ai-error']) {
    await expect(a.page.getByTestId(id)).toHaveCount(0)
  }
  await expect(a.page.getByTestId('open-question-status')).toHaveText('Waiting')

  await callActionAs(a.page, 'leaveQueue', { questionId: String(q.data?.recordId ?? '') })
})

test('markSolved by the owner leaves the line: next student moves up, TA queue drops it', async ({ users }) => {
  const [a, b] = await users(2)
  await callActionAs(b.page, 'devLeaveStaff', {})
  await callActionAs(a.page, 'devResetQueue', {})
  await joinStaff(b.page) // B is a TA AND a student in this test

  const aTitle = `Solved-by-AI ${Date.now()}`
  const aq = await callActionAs(a.page, 'submitQuestion', { title: aTitle, body: 'a body' })
  expect(aq.success).toBe(true)
  const bq = await callActionAs(b.page, 'submitQuestion', { title: `Behind ${Date.now()}`, body: 'b body' })
  expect(bq.success).toBe(true)

  // B is #2 behind A, and B (as TA) sees A's question.
  await b.page.goto('/queue')
  await expect(b.page.getByTestId('queue-position')).toContainText('#2', { timeout: 15_000 })
  const ta = await b.page.context().newPage()
  await ta.goto('/ta')
  await expect(ta.getByText(aTitle)).toBeVisible({ timeout: 15_000 })

  // A marks it solved.
  const solved = await callActionAs(a.page, 'markSolved', { questionId: String(aq.data?.recordId ?? '') })
  expect(solved.success).toBe(true)

  // A's open question is gone; B moves to #1 live; A drops off the TA queue live.
  await a.page.goto('/queue')
  await expect(a.page.getByTestId('submit-form')).toBeVisible({ timeout: 15_000 })
  await expect(b.page.getByTestId('queue-position')).toContainText('#1', { timeout: 20_000 })
  await expect(ta.getByText(aTitle)).toHaveCount(0, { timeout: 20_000 })

  // Solving again is refused (no longer open).
  const again = await callActionAs(a.page, 'markSolved', { questionId: String(aq.data?.recordId ?? '') })
  expect(again.code).toBe('not_open')

  // cleanup
  await ta.close()
  await callActionAs(b.page, 'leaveQueue', { questionId: String(bq.data?.recordId ?? '') })
  await callActionAs(b.page, 'devLeaveStaff', {})
})

test('a non-owner is refused markSolved and stillNeedHelp with forbidden', async ({ users }) => {
  const [a, b] = await users(2)
  await callActionAs(a.page, 'devResetQueue', {})

  const aq = await callActionAs(a.page, 'submitQuestion', { title: `Owned ${Date.now()}`, body: 'mine' })
  expect(aq.success).toBe(true)
  const id = String(aq.data?.recordId ?? '')

  const solve = await callActionAs(b.page, 'markSolved', { questionId: id })
  expect(solve.success).toBe(false)
  expect(solve.code).toBe('forbidden')

  const help = await callActionAs(b.page, 'stillNeedHelp', { questionId: id })
  expect(help.success).toBe(false)
  expect(help.code).toBe('forbidden')

  // A's question is untouched and still in line.
  await a.page.goto('/queue')
  await expect(a.page.getByTestId('open-question')).toBeVisible({ timeout: 15_000 })
  await expect(a.page.getByTestId('queue-position')).toContainText('#1', { timeout: 15_000 })

  await callActionAs(a.page, 'leaveQueue', { questionId: id })
})

test('stillNeedHelp by the owner keeps the place and shows the badge to the TA', async ({ users }) => {
  const [a, b] = await users(2)
  await callActionAs(b.page, 'devLeaveStaff', {})
  await callActionAs(a.page, 'devResetQueue', {})
  await joinStaff(b.page)

  const title = `Needs help ${Date.now()}`
  const aq = await callActionAs(a.page, 'submitQuestion', { title, body: 'still stuck' })
  expect(aq.success).toBe(true)
  const id = String(aq.data?.recordId ?? '')

  await b.page.goto('/ta')
  const card = b.page.getByTestId('ta-question').filter({ hasText: title })
  await expect(card).toBeVisible({ timeout: 15_000 })

  expect((await callActionAs(a.page, 'stillNeedHelp', { questionId: id })).success).toBe(true)

  await expect(card.getByTestId('ta-needs-help')).toBeVisible({ timeout: 20_000 })
  await expect(card.getByTestId('ta-position')).toContainText('#1')

  // cleanup
  await callActionAs(a.page, 'leaveQueue', { questionId: id })
  await callActionAs(b.page, 'devLeaveStaff', {})
})
