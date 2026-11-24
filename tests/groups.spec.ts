/**
 * Phase 7 — duplicate groups. Three pooled accounts; serial (global queue).
 *
 * No model call happens here: groupDuplicates skips the paid model for dev
 * test accounts, and groups are created with devCreateGroup, which writes via
 * the same applyGroups path the real action uses.
 */
import type { Page } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

test.describe.configure({ mode: 'serial' })

const usable = loadAllTestAccounts().length
test.skip(usable < 3, `Needs 3 usable test accounts, found ${usable}.`)

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

async function joinStaff(page: Page) {
  const code = await callActionAs(page, 'devGetInviteCode', {})
  expect((await callActionAs(page, 'joinAsStaff', { code: String(code.data?.code ?? '') })).success).toBe(true)
}

async function submit(page: Page, title: string): Promise<string> {
  const r = await callActionAs(page, 'submitQuestion', { title, body: `${title} body` })
  expect(r.success, JSON.stringify(r)).toBe(true)
  return String(r.data?.recordId ?? '')
}

/** Wait for the DEV groups probe to finish loading and return its count. */
async function visibleGroups(page: Page): Promise<number> {
  await page.goto('/queue')
  const probe = page.getByTestId('groups-probe')
  await expect(probe).toBeVisible({ timeout: 15_000 })
  await expect(probe).not.toHaveAttribute('data-status', 'loading', { timeout: 15_000 })
  await page.waitForTimeout(1000) // let any pushed rows arrive
  return Number(await page.getByTestId('groups-probe-count').textContent())
}

async function resetAll(pages: Page[]) {
  await callActionAs(pages[0], 'devResetQueue', {})
  for (const p of pages) await callActionAs(p, 'devLeaveStaff', {})
}

test('non-staff are refused groupDuplicates, claimGroup and resolveGroup (forbidden)', async ({ users }) => {
  const [a] = await users(1)
  await callActionAs(a.page, 'devLeaveStaff', {})
  for (const [name, params] of [
    ['groupDuplicates', {}],
    ['claimGroup', { groupId: 'anything' }],
    ['resolveGroup', { groupId: 'anything' }],
  ] as const) {
    const r = await callActionAs(a.page, name, params)
    expect(r.success, name).toBe(false)
    expect(r.code, name).toBe('forbidden')
  }
})

test('staff grouping in dev skips the paid model for test accounts', async ({ users }) => {
  const [b] = await users(1)
  await callActionAs(b.page, 'devLeaveStaff', {})
  await joinStaff(b.page)
  const r = await callActionAs(b.page, 'groupDuplicates', {})
  expect(r.success).toBe(true)
  expect(r.data?.skipped).toBe('test_account')
  await callActionAs(b.page, 'devLeaveStaff', {})
})

test('students cannot read question_groups; staff can and see the group header', async ({ users }) => {
  const [a, b, c] = await users(3)
  await resetAll([a.page, b.page, c.page])
  await joinStaff(b.page)

  const aq = await submit(a.page, `Group A ${Date.now()}`)
  const cq = await submit(c.page, `Group C ${Date.now()}`)
  const g = await callActionAs(b.page, 'devCreateGroup', { label: 'Pointer arithmetic', questionIds: [aq, cq] })
  expect(g.success).toBe(true)
  expect((g.data?.groupIds as string[]).length).toBe(1)

  // Student A owns a member question, yet a direct useQuery returns nothing.
  expect(await visibleGroups(a.page)).toBe(0)
  expect(await visibleGroups(c.page)).toBe(0)
  // Staff B (collaborator) sees it — proves the probe isn't trivially 0.
  expect(await visibleGroups(b.page)).toBeGreaterThanOrEqual(1)

  await b.page.goto('/ta')
  const group = b.page.getByTestId('ta-group').filter({ hasText: 'Pointer arithmetic' })
  await expect(group.getByTestId('ta-group-label')).toHaveText('Pointer arithmetic — 2 students', { timeout: 15_000 })
  await expect(group.getByTestId('ta-question')).toHaveCount(2)

  // A label never reaches the student's page.
  await a.page.goto('/queue')
  await expect(a.page.getByText('Pointer arithmetic')).toHaveCount(0)

  await callActionAs(a.page, 'leaveQueue', { questionId: aq })
  await callActionAs(c.page, 'leaveQueue', { questionId: cq })
  await callActionAs(b.page, 'devLeaveStaff', {})
})

test('claimGroup claims every eligible member and reports partial results; resolveGroup resolves them', async ({
  users,
}) => {
  const [a, b, c] = await users(3)
  await resetAll([a.page, b.page, c.page])
  await joinStaff(b.page)

  const aq = await submit(a.page, `Dup A ${Date.now()}`)
  const cq = await submit(c.page, `Dup C ${Date.now()}`)
  const bq = await submit(b.page, `Dup B own ${Date.now()}`) // B's OWN question → must be skipped
  const g = await callActionAs(b.page, 'devCreateGroup', { label: 'Linked lists', questionIds: [aq, cq, bq] })
  const groupId = (g.data?.groupIds as string[])[0]

  const claimed = await callActionAs(b.page, 'claimGroup', { groupId })
  expect(claimed.success).toBe(true)
  expect(claimed.data?.claimed).toBe(2)
  expect(claimed.data?.skipped).toBe(1)
  expect(claimed.data?.details).toEqual([{ questionId: bq, code: 'own_question' }])

  for (const p of [a.page, c.page]) {
    await p.goto('/queue')
    await expect(p.getByTestId('queue-position')).toContainText('is with you', { timeout: 15_000 })
  }
  // Claiming again: everything is skipped, nothing fails.
  const again = await callActionAs(b.page, 'claimGroup', { groupId })
  expect(again.data?.claimed).toBe(0)
  expect(again.data?.skipped).toBe(3)

  const resolved = await callActionAs(b.page, 'resolveGroup', { groupId })
  expect(resolved.success).toBe(true)
  expect(resolved.data?.resolved).toBe(2)
  expect(resolved.data?.skipped).toBe(1) // B's own question was never claimed

  for (const p of [a.page, c.page]) {
    await p.goto('/queue')
    await expect(p.getByTestId('submit-form')).toBeVisible({ timeout: 15_000 })
  }

  await callActionAs(b.page, 'leaveQueue', { questionId: bq })
  await callActionAs(b.page, 'devLeaveStaff', {})
})
