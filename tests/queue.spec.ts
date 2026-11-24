/**
 * Phase 1 — student queue.
 *
 * Needs two usable test accounts. These run against the dev server, so
 * `import.meta.env.DEV` is true and the DEV-only RBAC probe + the
 * `window.__callAction` bridge on /queue are present.
 *
 * Serial: the tests share a small account pool and mutate each other's queue
 * state (the one-open-question invariant), so they must not run concurrently.
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

type BridgeResult = { success: boolean; data?: { recordId?: string }; code?: string; error?: string }

/** Invoke a server action as the signed-in user via the DEV bridge on /queue. */
async function callActionAs(
  page: Page,
  name: string,
  params: Record<string, unknown>,
): Promise<BridgeResult> {
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

/** Leave any open question so the account starts each test with an empty queue. */
async function resetQueue(page: Page): Promise<void> {
  await page.goto('/queue')
  await expect(page.getByTestId('queue-ready')).toBeVisible({ timeout: 15_000 })
  const leave = page.getByTestId('leave-button')
  if (await leave.isVisible().catch(() => false)) {
    await leave.click()
    await page.getByRole('button', { name: 'Yes, leave' }).click()
    await expect(page.getByTestId('submit-form')).toBeVisible({ timeout: 15_000 })
  }
}

test('student submits a question and can leave the queue', async ({ users }) => {
  const [student] = await users(1)
  const page = student.page
  await resetQueue(page)

  const title = `Why does my pointer segfault? ${Date.now()}`
  await page.getByTestId('input-title').fill(title)
  await page.getByTestId('input-body').fill('It crashes on the second dereference.')
  await page.getByTestId('submit-button').click()

  await expect(page.getByTestId('open-question-title')).toHaveText(title, { timeout: 15_000 })
  await expect(page.getByTestId('open-question-status')).toHaveText('Waiting', { timeout: 15_000 })

  await page.getByTestId('leave-button').click()
  // Leaving is destructive (you lose your place), so it is confirmed first.
  await expect(page.getByRole('button', { name: 'Stay in line' })).toBeVisible()
  await page.getByRole('button', { name: 'Yes, leave' }).click()
  await expect(page.getByTestId('submit-form')).toBeVisible({ timeout: 15_000 })
})

test('a direct client create on questions is rejected by RBAC (non-admin)', async ({ users }) => {
  const [student] = await users(1)
  const page = student.page
  await page.goto('/queue')

  // Role must be a non-admin for this to prove RBAC; the pool accounts are members.
  await expect(page.getByTestId('rbac-probe-role')).toHaveText('role: member', { timeout: 15_000 })

  const probe = page.getByTestId('rbac-probe-create')
  await expect(probe).toBeEnabled({ timeout: 15_000 })
  await probe.click()
  await expect(page.getByTestId('rbac-probe-result')).toHaveText('create-rejected', {
    timeout: 15_000,
  })
})

test('submitting a second question while one is open is refused', async ({ users }) => {
  const [student] = await users(1)
  const page = student.page
  await resetQueue(page)

  const first = await callActionAs(page, 'submitQuestion', {
    title: `First ${Date.now()}`,
    body: 'The first open question.',
  })
  expect(first.success).toBe(true)
  const questionId = first.data?.recordId
  expect(questionId).toBeTruthy()

  const second = await callActionAs(page, 'submitQuestion', {
    title: `Second ${Date.now()}`,
    body: 'A second question that should be refused.',
  })
  expect(second.success).toBe(false)
  expect(second.code).toBe('already_open')

  // cleanup
  await callActionAs(page, 'leaveQueue', { questionId })
})

test('a non-owner cannot leave another students question', async ({ users }) => {
  const [a, b] = await users(2)
  await resetQueue(a.page)
  await resetQueue(b.page)

  const created = await callActionAs(a.page, 'submitQuestion', {
    title: `Owned by A ${Date.now()}`,
    body: 'Only A may leave this.',
  })
  expect(created.success).toBe(true)
  const questionId = created.data?.recordId
  expect(questionId).toBeTruthy()

  // B attempts to leave A's question — ownership check (not role) must refuse it.
  const bAttempt = await callActionAs(b.page, 'leaveQueue', { questionId })
  expect(bAttempt.success).toBe(false)
  expect(bAttempt.code).toBe('forbidden')

  // A's question is untouched and still waiting.
  await a.page.goto('/queue')
  await expect(a.page.getByTestId('open-question-status')).toHaveText('Waiting', { timeout: 15_000 })

  // A can leave their own.
  const aLeave = await callActionAs(a.page, 'leaveQueue', { questionId })
  expect(aLeave.success).toBe(true)
})
