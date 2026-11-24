/**
 * Server actions for TA invite codes and the staff allowlist.
 *
 * Same trust model as src/actions/questions.ts: these run RBAC-OFF, so each
 * must reject anonymous callers and authorize privileged operations itself.
 * Identity is only ever `ctx.userId` (the verified JWT subject).
 *
 * The invite code lives as a single `settings` row (recordId 'ta_invite_code').
 * `settings` is admin-only to clients, so members can never read the code — but
 * these actions reach it through `tools` (RBAC off) to compare it server-side.
 */

import { isAnonymousUserId } from 'deepspace/worker'
import type { ActionHandler, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Question, Staff } from '../lib/types'
import { recomputeQueue, queueStoreFromTools, listOpenQuestions } from './queue'
import { isAdmin, isTestAccount } from './auth'
import { closeClaimIfAny, releaseClaimsForTa } from './claims'
import { releaseActiveSlot } from './active'

const SETTINGS_INVITE_KEY = 'ta_invite_code'
// Unambiguous alphabet (no 0/O/1/I/L). 32 chars divides 256 evenly → no modulo bias.
const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const INVITE_CODE_LENGTH = 14

const asString = (v: unknown): string => (typeof v === 'string' ? v : '')

function generateInviteCode(): string {
  const bytes = new Uint8Array(INVITE_CODE_LENGTH)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) out += INVITE_CODE_ALPHABET[bytes[i] % INVITE_CODE_ALPHABET.length]
  return out
}

async function readInviteCode(tools: ActionTools): Promise<string> {
  const got = await tools.get<{ key: string; value: string }>('settings', SETTINGS_INVITE_KEY)
  return got.success ? asString(got.data.record.data.value) : ''
}

function storeInviteCode(tools: ActionTools, code: string) {
  return tools.create('settings', { key: SETTINGS_INVITE_KEY, value: code }, SETTINGS_INVITE_KEY)
}

/** Add or remove `userId` across the collaborators of every OPEN question. */
async function mutateOpenCollaborators(
  tools: ActionTools,
  userId: string,
  op: 'add' | 'remove',
): Promise<void> {
  // One equality query per open status — never a full-history scan.
  for (const r of await listOpenQuestions(tools)) {
    const current = Array.isArray(r.data.collaborators) ? (r.data.collaborators as string[]) : []
    const has = current.includes(userId)
    if (op === 'add' && !has) {
      await tools.update<Question>('questions', r.recordId, { collaborators: [...current, userId] })
    } else if (op === 'remove' && has) {
      await tools.update<Question>('questions', r.recordId, {
        collaborators: current.filter((id) => id !== userId),
      })
    }
  }
}

async function doRemoveStaff(tools: ActionTools, userId: string): Promise<void> {
  // Release their active claims FIRST so those students go back in line
  // (at their original rank) before the TA loses read access to the rows.
  await releaseClaimsForTa(tools, userId)
  await tools.remove('staff', userId)
  await mutateOpenCollaborators(tools, userId, 'remove')
}

/** rotateInviteCode() — admin only. Generates and stores a fresh code. */
const rotateInviteCode: ActionHandler<Env> = async ({ userId, tools, env }) => {
  if (isAnonymousUserId(userId)) return { success: false, code: 'anonymous', error: 'Sign in first.' }
  if (!(await isAdmin(env, userId))) return { success: false, code: 'forbidden', error: 'Admins only.' }
  const code = generateInviteCode()
  const stored = await storeInviteCode(tools, code)
  if (!stored.success) return stored
  return { success: true, data: { code } }
}

/**
 * joinAsStaff({ code }) — any signed-in member. On a correct code, upserts the
 * caller into `staff` (idempotent, recordId = userId) and backfills their id
 * into the collaborators of every open question.
 */
const joinAsStaff: ActionHandler<Env> = async ({ userId, params, tools }) => {
  if (isAnonymousUserId(userId)) return { success: false, code: 'anonymous', error: 'Sign in first.' }

  const input = asString(params.code).trim().toUpperCase()
  const stored = await readInviteCode(tools)
  // One generic failure: never reveal whether a code exists or how it differs.
  if (!stored || input !== stored) {
    return { success: false, code: 'invalid_code', error: 'Invalid invite code.' }
  }

  const userRow = await tools.get<{ name?: string; email?: string }>('users', userId)
  const displayName =
    (userRow.success
      ? asString(userRow.data.record.data.name) || asString(userRow.data.record.data.email)
      : '') || 'TA'

  const upsert = await tools.create<Staff>(
    'staff',
    { userId, displayName, rank: 'ta', joinedAt: new Date().toISOString() },
    userId,
  )
  if (!upsert.success) return upsert

  await mutateOpenCollaborators(tools, userId, 'add')
  return { success: true, data: { rank: 'ta' } }
}

/** removeStaff({ userId }) — admin only. Deletes the row and cleans collaborators. */
const removeStaff: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  if (isAnonymousUserId(userId)) return { success: false, code: 'anonymous', error: 'Sign in first.' }
  if (!(await isAdmin(env, userId))) return { success: false, code: 'forbidden', error: 'Admins only.' }
  const target = asString(params.userId)
  if (!target) return { success: false, code: 'invalid_input', error: 'Missing userId.' }
  await doRemoveStaff(tools, target)
  return { success: true, data: { userId: target } }
}

// ── DEV/TEST-ONLY actions ────────────────────────────────────────────────────
// Gated on the platform's debug flag, which `deepspace dev`/`test` set to
// "true" locally and production leaves unset. They let e2e tests obtain a valid
// code and remove themselves from staff without an admin session; in production
// they fail closed.

const devGetInviteCode: ActionHandler<Env> = async ({ userId, tools, env }) => {
  if (env.ALLOW_DEBUG_ROUTES !== 'true') {
    return { success: false, code: 'not_available', error: 'Not available.' }
  }
  if (isAnonymousUserId(userId)) return { success: false, code: 'anonymous', error: 'Sign in first.' }
  if (!(await isTestAccount(tools, userId))) {
    return { success: false, code: 'not_available', error: 'Not available.' }
  }
  let code = await readInviteCode(tools)
  if (!code) {
    code = generateInviteCode()
    const stored = await storeInviteCode(tools, code)
    if (!stored.success) return stored
  }
  return { success: true, data: { code } }
}

const devLeaveStaff: ActionHandler<Env> = async ({ userId, tools, env }) => {
  if (env.ALLOW_DEBUG_ROUTES !== 'true') {
    return { success: false, code: 'not_available', error: 'Not available.' }
  }
  if (isAnonymousUserId(userId)) return { success: false, code: 'anonymous', error: 'Sign in first.' }
  if (!(await isTestAccount(tools, userId))) {
    return { success: false, code: 'not_available', error: 'Not available.' }
  }
  await doRemoveStaff(tools, userId)
  return { success: true, data: { userId } }
}

/**
 * devResetQueue() — leave every open question so a test starts from an empty
 * global queue (positions are global, so stale rows from prior runs would skew
 * absolute-position assertions). Same flag + @deepspace.test gate.
 */
const devResetQueue: ActionHandler<Env> = async ({ userId, tools, env }) => {
  if (env.ALLOW_DEBUG_ROUTES !== 'true') {
    return { success: false, code: 'not_available', error: 'Not available.' }
  }
  if (isAnonymousUserId(userId)) return { success: false, code: 'anonymous', error: 'Sign in first.' }
  if (!(await isTestAccount(tools, userId))) {
    return { success: false, code: 'not_available', error: 'Not available.' }
  }
  for (const r of await listOpenQuestions(tools)) {
    await tools.update<Question>('questions', r.recordId, {
      status: 'left',
      queuePosition: 0,
      peopleAhead: 0,
    })
    if (r.data.status === 'claimed') await closeClaimIfAny(tools, r.recordId)
    await releaseActiveSlot(tools, r.data.studentId)
  }
  await recomputeQueue(queueStoreFromTools(tools))
  return { success: true, data: {} }
}

export const staffActions: Record<string, ActionHandler<Env>> = {
  rotateInviteCode,
  joinAsStaff,
  removeStaff,
  devGetInviteCode,
  devLeaveStaff,
  devResetQueue,
}
