/**
 * Phase 4 — course materials are instructor (admin) only.
 *
 * Pooled test accounts are MEMBERS, so these tests prove the admin gate: every
 * materials action refuses a member with 'forbidden' — including requests whose
 * input is also invalid, which shows the admin check runs before validation
 * (and so before any owner-billed knowledge call).
 *
 * The validation order for an ADMIN caller (invalid extension / oversize text →
 * 'invalid_input' before any knowledge call) is covered by the unit test
 * src/actions/materials.test.ts, because the fixture cannot sign in as the app
 * owner. The positive upload → index → search path is a manual check.
 */
import type { Page } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

test.describe.configure({ mode: 'serial' })

const usable = loadAllTestAccounts().length
test.skip(
  usable < 1,
  `Needs 1 usable test account, found ${usable}. Create one with ` +
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

test('a member is refused every materials action with forbidden', async ({ users }) => {
  const [m] = await users(1)

  const cases: Array<[string, Record<string, unknown>]> = [
    ['uploadMaterial', { filename: 'notes.md', text: '# hello' }],
    ['deleteMaterial', { materialId: 'anything' }],
    ['refreshMaterials', {}],
    ['searchMaterials', { query: 'late policy' }],
    ['diagnoseMaterials', {}],
  ]
  for (const [name, params] of cases) {
    const res = await callActionAs(m.page, name, params)
    expect(res.success, name).toBe(false)
    expect(res.code, name).toBe('forbidden')
  }
})

test('a member with invalid input still gets forbidden (admin gate precedes validation)', async ({ users }) => {
  const [m] = await users(1)

  const badExt = await callActionAs(m.page, 'uploadMaterial', { filename: 'virus.exe', text: 'x' })
  expect(badExt.code).toBe('forbidden')

  const oversize = await callActionAs(m.page, 'uploadMaterial', {
    filename: 'big.md',
    text: 'a'.repeat(200_001),
  })
  expect(oversize.code).toBe('forbidden')
})

test('a member sees the not-authorized instructor page and no materials panel', async ({ users }) => {
  const [m] = await users(1)
  await m.page.goto('/instructor')
  await expect(m.page.getByTestId('instructor-forbidden')).toBeVisible({ timeout: 15_000 })
  await expect(m.page.getByTestId('materials-section')).toHaveCount(0)
})
