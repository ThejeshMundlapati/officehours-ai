/**
 * Phase 6 — TA claims. Three pooled accounts (student + two TAs). Serial:
 * shared global queue and staff list.
 *
 * The first two tests are the EMPIRICAL uniqueOn check:
 *  1. devProbeUniqueClaim fires two claim inserts for one questionId
 *     concurrently inside one action, bypassing every app-level pre-check, so
 *     only the platform's uniqueOn can stop the second.
 *  2. Two TAs race claimQuestion on one real question via Promise.all from two
 *     browser contexts; exactly one may win.
 */
import type { Page } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

test.describe.configure({ mode: 'serial' })

const usable = loadAllTestAccounts().length
test.skip(
  usable < 3,
  `Needs 3 usable test accounts, found ${usable}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" --password-stdin`.',
)

type BridgeResult = { success: boolean; data?: Record<string, unknown>; code?: string; error?: string }

/** Load /queue and wait for the DEV action bridge (no call yet). */
async function ready(page: Page): Promise<void> {
  await page.goto('/queue')
  await page.waitForFunction(
    () => Boolean((window as unknown as { __callAction?: unknown }).__callAction),
    undefined,
    { timeout: 15_000 },
  )
}

/** Call an action on an already-ready page (no navigation → true concurrency). */
function invoke(page: Page, name: string, params: Record<string, unknown> = {}): Promise<BridgeResult> {
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

async function callActionAs(page: Page, name: string, params: Record<string, unknown> = {}) {
  await ready(page)
  return invoke(page, name, params)
}

async function joinStaff(page: Page): Promise<void> {
  const code = await callActionAs(page, 'devGetInviteCode', {})
  expect(code.success).toBe(true)
  expect((await callActionAs(page, 'joinAsStaff', { code: String(code.data?.code ?? '') })).success).toBe(true)
}

async function submit(page: Page, title: string): Promise<string> {
  const r = await callActionAs(page, 'submitQuestion', { title, body: `${title} body` })
  expect(r.success, JSON.stringify(r)).toBe(true)
  return String(r.data?.recordId ?? '')
}

async function resetAll(pages: Page[]): Promise<void> {
  await callActionAs(pages[0], 'devResetQueue', {})
  for (const p of pages) await callActionAs(p, 'devLeaveStaff', {})
}

test('EMPIRICAL uniqueOn: two concurrent claim inserts for one questionId → exactly one stored', async ({ users }) => {
  const [a] = await users(1)
  const res = await callActionAs(a.page, 'devProbeUniqueClaim', {})
  expect(res.success).toBe(true)
  const results = res.data?.results as BridgeResult[]
  console.log('UNIQUEON_PROBE', JSON.stringify(res.data))
  expect(results).toHaveLength(2)
  expect(results.filter((r) => r.success)).toHaveLength(1)
  const loser = results.find((r) => !r.success)!
  expect(loser.error).toMatch(/^Duplicate: a record with questionId=probe-[\w-]+ already exists in claims$/)
  expect(res.data?.storedRows).toBe(1)
})

test('RACE: two TAs claim the same question concurrently → exactly one winner', async ({ users }) => {
  const [a, b, c] = await users(3)
  await resetAll([a.page, b.page, c.page])
  await joinStaff(b.page)
  await joinStaff(c.page)

  for (let round = 1; round <= 3; round++) {
    const qid = await submit(a.page, `Race ${round} ${Date.now()}`)
    await Promise.all([ready(b.page), ready(c.page)])
    const [rb, rc] = await Promise.all([
      invoke(b.page, 'claimQuestion', { questionId: qid }),
      invoke(c.page, 'claimQuestion', { questionId: qid }),
    ])
    console.log(`RACE_ROUND ${round}`, JSON.stringify({ b: rb, c: rc }))
    const winners = [rb, rc].filter((r) => r.success)
    expect(winners, JSON.stringify({ rb, rc })).toHaveLength(1)
    const loser = rb.success ? rc : rb
    expect(loser.code).toBe('already_claimed')

    // The winner resolves so the student can ask again next round.
    const winnerPage = rb.success ? b.page : c.page
    expect((await callActionAs(winnerPage, 'resolveQuestion', { questionId: qid })).success).toBe(true)
  }

  await callActionAs(b.page, 'devLeaveStaff', {})
  await callActionAs(c.page, 'devLeaveStaff', {})
})

test('a non-staff member cannot claim (forbidden); a TA cannot claim their own question', async ({ users }) => {
  const [a, b] = await users(2)
  await resetAll([a.page, b.page])

  const aq = await submit(a.page, `Not staff ${Date.now()}`)
  const nonStaff = await callActionAs(b.page, 'claimQuestion', { questionId: aq })
  expect(nonStaff.code).toBe('forbidden')

  await joinStaff(b.page)
  const bq = await submit(b.page, `Own ${Date.now()}`)
  const own = await callActionAs(b.page, 'claimQuestion', { questionId: bq })
  expect(own.success).toBe(false)
  expect(own.code).toBe('own_question')

  await callActionAs(a.page, 'leaveQueue', { questionId: aq })
  await callActionAs(b.page, 'leaveQueue', { questionId: bq })
  await callActionAs(b.page, 'devLeaveStaff', {})
})

test('claim takes the student out of line; release returns them to their original position', async ({ users }) => {
  const [a, b, c] = await users(3)
  await resetAll([a.page, b.page, c.page])
  await joinStaff(b.page)

  const aq = await submit(a.page, `First ${Date.now()}`)
  const cq = await submit(c.page, `Second ${Date.now()}`)
  await c.page.goto('/queue')
  await expect(c.page.getByTestId('queue-position')).toContainText('#2', { timeout: 15_000 })

  expect((await callActionAs(b.page, 'claimQuestion', { questionId: aq })).success).toBe(true)
  await a.page.goto('/queue')
  await expect(a.page.getByTestId('queue-position')).toContainText(/A TA \(.+\) is with you\./, { timeout: 15_000 })
  await expect(c.page.getByTestId('queue-position')).toContainText('#1', { timeout: 20_000 })

  // A second claim attempt on a claimed question is refused.
  const again = await callActionAs(b.page, 'claimQuestion', { questionId: aq })
  expect(again.code).toBe('already_claimed')
  // Only the claiming TA (or admin) can release; C is not staff and not the claimant.
  expect((await callActionAs(c.page, 'releaseClaim', { questionId: aq })).code).toBe('forbidden')

  expect((await callActionAs(b.page, 'releaseClaim', { questionId: aq })).success).toBe(true)
  await expect(a.page.getByTestId('queue-position')).toContainText('#1', { timeout: 20_000 })
  await expect(c.page.getByTestId('queue-position')).toContainText('#2', { timeout: 20_000 })

  await callActionAs(a.page, 'leaveQueue', { questionId: aq })
  await callActionAs(c.page, 'leaveQueue', { questionId: cq })
  await callActionAs(b.page, 'devLeaveStaff', {})
})

test('resolve removes the question everywhere', async ({ users }) => {
  const [a, b] = await users(2)
  await resetAll([a.page, b.page])
  await joinStaff(b.page)

  const title = `Resolve me ${Date.now()}`
  const aq = await submit(a.page, title)
  expect((await callActionAs(b.page, 'claimQuestion', { questionId: aq })).success).toBe(true)

  const ta = await b.page.context().newPage()
  await ta.goto('/ta')
  const card = ta.getByTestId('ta-question').filter({ hasText: title })
  await expect(card.getByTestId('ta-claimed-by')).toBeVisible({ timeout: 15_000 })

  expect((await callActionAs(b.page, 'resolveQuestion', { questionId: aq })).success).toBe(true)
  await expect(card).toHaveCount(0, { timeout: 20_000 })
  await a.page.goto('/queue')
  await expect(a.page.getByTestId('submit-form')).toBeVisible({ timeout: 15_000 })
  await expect(a.page.getByTestId('waiting-count')).toContainText('0 students waiting', { timeout: 15_000 })

  // Resolving twice / releasing a resolved question is refused.
  expect((await callActionAs(b.page, 'resolveQuestion', { questionId: aq })).code).toBe('not_claimed')

  await ta.close()
  await callActionAs(b.page, 'devLeaveStaff', {})
})

test("removing a TA from staff releases their active claims back into line", async ({ users }) => {
  const [a, b] = await users(2)
  await resetAll([a.page, b.page])
  await joinStaff(b.page)

  const aq = await submit(a.page, `Orphaned claim ${Date.now()}`)
  expect((await callActionAs(b.page, 'claimQuestion', { questionId: aq })).success).toBe(true)
  await a.page.goto('/queue')
  await expect(a.page.getByTestId('queue-position')).toContainText('is with you', { timeout: 15_000 })

  // devLeaveStaff runs the same doRemoveStaff path as the admin removeStaff.
  expect((await callActionAs(b.page, 'devLeaveStaff', {})).success).toBe(true)

  await a.page.goto('/queue')
  await expect(a.page.getByTestId('queue-position')).toContainText('#1', { timeout: 20_000 })
  await expect(a.page.getByTestId('open-question-status')).toHaveText('Waiting')

  // It can be claimed again (the released claim row was deleted).
  await joinStaff(b.page)
  expect((await callActionAs(b.page, 'claimQuestion', { questionId: aq })).success).toBe(true)
  expect((await callActionAs(b.page, 'releaseClaim', { questionId: aq })).success).toBe(true)

  await callActionAs(a.page, 'leaveQueue', { questionId: aq })
  await callActionAs(b.page, 'devLeaveStaff', {})
})

test('Phase 1 race fixed: concurrent double-submit by one student → exactly one question', async ({ users }) => {
  const [a] = await users(1)
  await callActionAs(a.page, 'devResetQueue', {})

  for (let round = 1; round <= 3; round++) {
    await ready(a.page)
    const [r1, r2] = await Promise.all([
      invoke(a.page, 'submitQuestion', { title: `Double ${round}a ${Date.now()}`, body: 'first' }),
      invoke(a.page, 'submitQuestion', { title: `Double ${round}b ${Date.now()}`, body: 'second' }),
    ])
    console.log(`DOUBLE_SUBMIT ${round}`, JSON.stringify({ r1, r2 }))
    const ok = [r1, r2].filter((r) => r.success)
    expect(ok, JSON.stringify({ r1, r2 })).toHaveLength(1)
    expect((r1.success ? r2 : r1).code).toBe('already_open')

    // Exactly one open question on the page; leaving frees the slot for the next round.
    await a.page.goto('/queue')
    await expect(a.page.getByTestId('open-question')).toHaveCount(1, { timeout: 15_000 })
    expect((await callActionAs(a.page, 'leaveQueue', { questionId: String(ok[0].data?.recordId ?? '') })).success).toBe(
      true,
    )
  }

  // After leaving, a normal submit works again (slot was released).
  const again = await callActionAs(a.page, 'submitQuestion', { title: `After ${Date.now()}`, body: 'ok' })
  expect(again.success).toBe(true)
  await callActionAs(a.page, 'leaveQueue', { questionId: String(again.data?.recordId ?? '') })
})

test('presence: a connected TA is counted online on /queue and listed on /ta', async ({ users }) => {
  const [a, b] = await users(2)
  await resetAll([a.page, b.page])
  await joinStaff(b.page)

  await b.page.goto('/ta') // B connected (heartbeat) as staff
  await expect(b.page.getByTestId('staff-online-list')).toBeVisible({ timeout: 15_000 })
  await expect(b.page.getByTestId('staff-online').first()).toBeVisible({ timeout: 20_000 })

  await a.page.goto('/queue')
  await expect(a.page.getByTestId('staff-online-count')).toContainText(/[1-9]\d* TAs? online/, { timeout: 20_000 })

  await callActionAs(b.page, 'devLeaveStaff', {})
})
