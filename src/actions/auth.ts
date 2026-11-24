/**
 * Shared caller-authorization helpers for server actions.
 *
 * Actions run RBAC-off, so every privileged action authorizes the caller here
 * against `ctx.userId` (the verified JWT subject) — never against params.
 */

import { resolveAppRole } from 'deepspace/worker'
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
