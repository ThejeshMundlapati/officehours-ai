/**
 * Shared caller-authorization helpers for server actions.
 *
 * Actions run RBAC-off, so every privileged action authorizes the caller here
 * against `ctx.userId` (the verified JWT subject) — never against params.
 */

import { resolveAppRole } from 'deepspace/worker'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'

/** The app owner (instructor) is always admin; otherwise ask the platform. */
export async function isAdmin(env: Pick<Env, 'OWNER_USER_ID'>, userId: string): Promise<boolean> {
  if (userId === env.OWNER_USER_ID) return true
  try {
    return (await resolveAppRole(env as Env, userId)) === 'admin'
  } catch {
    return false
  }
}

/** True only if the caller's users-record email ends with '@deepspace.test'. */
export async function isTestAccount(tools: ActionTools, userId: string): Promise<boolean> {
  const row = await tools.get<{ email?: string }>('users', userId)
  const email = row.success && typeof row.data.record.data.email === 'string' ? row.data.record.data.email : ''
  return email.toLowerCase().endsWith('@deepspace.test')
}

/**
 * Dev/test runs load the production secrets config, so the knowledge base and
 * model proxy are REAL and owner-billed even locally. Automated test accounts
 * therefore never trigger paid AI work: only when the debug flag is on AND the
 * caller is a @deepspace.test account. Production (flag unset) is unaffected.
 */
export async function isDevTestCaller(env: Pick<Env, 'ALLOW_DEBUG_ROUTES'>, tools: ActionTools, userId: string) {
  return env.ALLOW_DEBUG_ROUTES === 'true' && (await isTestAccount(tools, userId))
}
