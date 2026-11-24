/**
 * Client helper for calling a server action (POST /api/actions/:name).
 *
 * Attaches the caller's verified JWT via the SDK's `getAuthToken()` (sourced
 * from the auth-worker session — never localStorage). Returns the action's
 * ActionResult discriminated union so callers branch on `success`.
 */

import { getAuthToken } from 'deepspace'

export type ActionResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string; status?: number }

export async function callAction<T = unknown>(
  name: string,
  params: Record<string, unknown> = {},
): Promise<ActionResult<T>> {
  const token = await getAuthToken()
  if (!token) return { success: false, code: 'not_signed_in', error: 'You are not signed in.' }

  let res: Response
  try {
    res = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
  } catch {
    return { success: false, code: 'network', error: 'Network error. Please try again.' }
  }

  const data = (await res.json().catch(() => null)) as ActionResult<T> | null
  if (!data) return { success: false, code: 'bad_response', error: `Request failed (${res.status}).` }
  return data
}
