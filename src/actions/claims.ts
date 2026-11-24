/**
 * Phase 6 — TA claim / release / resolve.
 *
 * Same trust model as every action: RBAC is off, so each one rejects anonymous
 * callers and authorizes against `ctx.userId` only. "Staff" = a `staff` row or
 * an app admin (the instructor).
 *
 * Atomicity comes from `claims.uniqueOn: ['questionId']`: the claim row is
 * inserted FIRST, and only the caller whose insert succeeds goes on to mark the
 * question claimed. A losing insert returns
 *   { success: false, error: 'Duplicate: a record with questionId=… already exists in claims' }
 * (no `code` field — matched by its 'Duplicate:' prefix).
 */

import { isAnonymousUserId } from 'deepspace/worker'
import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { QUESTION_OPEN_STATUSES, type Claim, type Question, type QuestionStatus } from '../lib/types'
import { isAdmin, isTestAccount } from './auth'
import { recomputeQueue, queueStoreFromTools } from './queue'
import { releaseActiveSlot } from './active'
import { isDuplicateInsert } from './records'

const asString = (v: unknown): string => (typeof v === 'string' ? v : '')
type Refusal = { success: false; code: string; error: string }

async function isStaffOrAdmin(env: Env, tools: ActionTools, userId: string): Promise<boolean> {
  if (await isAdmin(env, userId)) return true
  const row = await tools.get('staff', userId)
  return row.success
}

async function displayName(tools: ActionTools, userId: string, fallback: string): Promise<string> {
  const row = await tools.get<{ name?: string; email?: string }>('users', userId)
  if (!row.success) return fallback
  return asString(row.data.record.data.name) || asString(row.data.record.data.email) || fallback
}

async function loadQuestion(tools: ActionTools, rawId: unknown): Promise<{ id: string; data: Question } | Refusal> {
  const id = asString(rawId)
  if (!id) return { success: false, code: 'invalid_input', error: 'Missing questionId.' }
  const got = await tools.get<Question>('questions', id)
  if (!got.success) return { success: false, code: 'not_found', error: 'Question not found.' }
  return { id, data: got.data.record.data }
}

/** The question's claim rows (0 or 1 — uniqueOn questionId). */
async function findClaim(tools: ActionTools, questionId: string): Promise<{ recordId: string; data: Claim } | null> {
  const res = await tools.query<Claim>('claims', { where: { questionId }, limit: 1 })
  if (!res.success || res.data.records.length === 0) return null
  const r = res.data.records[0]
  return { recordId: r.recordId, data: r.data }
}

/** Put a claimed question back in line and delete its claim (used by release + removeStaff). */
async function returnToLine(tools: ActionTools, questionId: string, q: Question, claimRecordId: string | null) {
  if (claimRecordId) await tools.remove('claims', claimRecordId)
  await tools.update<Question>('questions', questionId, {
    status: q.aiStatus === 'answered' ? 'ai_answered' : 'waiting',
    claimedBy: '',
    claimedByName: '',
  })
}

/**
 * If a question that is leaving the queue (student left / solved) had an
 * active claim, close it as history so the TA isn't shown as busy.
 */
export async function closeClaimIfAny(tools: ActionTools, questionId: string): Promise<void> {
  const claim = await findClaim(tools, questionId)
  if (claim && claim.data.active === 1) await tools.update<Claim>('claims', claim.recordId, { active: 0 })
}

/**
 * Claim ONE question for `userId` (caller already verified as staff). Inserts
 * the claim row FIRST (uniqueOn questionId). Does not recompute the queue —
 * callers do that once. Shared by claimQuestion and claimGroup.
 */
export async function claimOne(
  tools: ActionTools,
  userId: string,
  taName: string,
  questionId: string,
): Promise<{ ok: true; claimId: string } | Refusal> {
  const q = await loadQuestion(tools, questionId)
  if ('success' in q) return q
  if (q.data.studentId === userId) {
    return { success: false, code: 'own_question', error: 'You cannot claim your own question.' }
  }
  if (!QUESTION_OPEN_STATUSES.includes(q.data.status as QuestionStatus)) {
    return { success: false, code: 'not_open', error: 'This question is not in the queue.' }
  }
  if (q.data.status === 'claimed') {
    return { success: false, code: 'already_claimed', error: 'Another TA already claimed this question.' }
  }

  // No explicit recordId: an id would make this an upsert, defeating uniqueOn.
  const inserted = await tools.create<Claim>('claims', {
    questionId: q.id,
    taId: userId,
    taName,
    active: 1,
    createdAt: new Date().toISOString(),
  })
  if (isDuplicateInsert(inserted)) {
    // Shape evidence for the uniqueOn finding (no student text in it).
    console.info(`[claimQuestion] q=${q.id} duplicate insert refused: ${JSON.stringify(inserted)}`)
    return { success: false, code: 'already_claimed', error: 'Another TA just claimed this question.' }
  }
  if (!inserted.success) return { success: false, code: 'error', error: inserted.error }

  // We own the claim. Re-check the question didn't leave the queue meanwhile.
  const now = await tools.get<Question>('questions', q.id)
  const nowStatus = now.success ? (now.data.record.data.status as QuestionStatus) : 'left'
  if (!QUESTION_OPEN_STATUSES.includes(nowStatus)) {
    await tools.remove('claims', inserted.data.recordId)
    return { success: false, code: 'not_open', error: 'This question just left the queue.' }
  }

  const updated = await tools.update<Question>('questions', q.id, {
    status: 'claimed',
    claimedBy: userId,
    claimedByName: taName,
    queuePosition: 0,
    peopleAhead: 0,
  })
  if (!updated.success) {
    await tools.remove('claims', inserted.data.recordId)
    return { success: false, code: 'error', error: updated.error }
  }
  return { ok: true, claimId: inserted.data.recordId }
}

/** Staff gate + the caller's display name (snapshotted onto claims). */
export async function staffContext(
  env: Env,
  tools: ActionTools,
  userId: string,
): Promise<{ ok: true; taName: string } | Refusal> {
  if (isAnonymousUserId(userId)) return { success: false, code: 'anonymous', error: 'Sign in first.' }
  if (!(await isStaffOrAdmin(env, tools, userId))) {
    return { success: false, code: 'forbidden', error: 'Only TAs can do that.' }
  }
  return { ok: true, taName: await displayName(tools, userId, 'TA') }
}

/** claimQuestion({ questionId }) — staff only. */
const claimQuestion: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const staff = await staffContext(env, tools, userId)
  if ('success' in staff) return staff
  const r = await claimOne(tools, userId, staff.taName, asString(params.questionId))
  if ('success' in r) return r
  await recomputeQueue(queueStoreFromTools(tools))
  return { success: true, data: { questionId: asString(params.questionId), claimId: r.claimId } }
}

/** Shared gate for release/resolve: the question must be claimed, by the caller (or caller is admin). */
async function loadOwnClaim(
  env: Env,
  tools: ActionTools,
  userId: string,
  rawId: unknown,
): Promise<{ id: string; data: Question; claim: { recordId: string; data: Claim } | null } | Refusal> {
  if (isAnonymousUserId(userId)) return { success: false, code: 'anonymous', error: 'Sign in first.' }
  const q = await loadQuestion(tools, rawId)
  if ('success' in q) return q
  if (q.data.status !== 'claimed') return { success: false, code: 'not_claimed', error: 'This question is not claimed.' }
  const claim = await findClaim(tools, q.id)
  const claimant = claim?.data.taId ?? q.data.claimedBy
  if (claimant !== userId && !(await isAdmin(env, userId))) {
    return { success: false, code: 'forbidden', error: 'Only the TA who claimed it (or the instructor) can do that.' }
  }
  return { ...q, claim }
}

/** releaseClaim({ questionId }) — back in line at its ORIGINAL createdAt rank. */
const releaseClaim: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const r = await loadOwnClaim(env, tools, userId, params.questionId)
  if ('success' in r) return r
  await returnToLine(tools, r.id, r.data, r.claim?.recordId ?? null)
  await recomputeQueue(queueStoreFromTools(tools))
  return { success: true, data: { questionId: r.id } }
}

/**
 * Resolve ONE claimed question (caller must be the claimant or admin). No
 * queue recompute — callers do that once. Shared by resolveQuestion/resolveGroup.
 */
export async function resolveOne(
  env: Env,
  tools: ActionTools,
  userId: string,
  questionId: string,
): Promise<{ ok: true } | Refusal> {
  const r = await loadOwnClaim(env, tools, userId, questionId)
  if ('success' in r) return r
  const updated = await tools.update<Question>('questions', r.id, {
    status: 'solved',
    queuePosition: 0,
    peopleAhead: 0,
  })
  if (!updated.success) return { success: false, code: 'error', error: updated.error }
  if (r.claim) await tools.update<Claim>('claims', r.claim.recordId, { active: 0 })
  await releaseActiveSlot(tools, r.data.studentId)
  return { ok: true }
}

/** resolveQuestion({ questionId }) — done; leaves the queue; claim kept as history. */
const resolveQuestion: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const r = await resolveOne(env, tools, userId, asString(params.questionId))
  if ('success' in r) return r
  await recomputeQueue(queueStoreFromTools(tools))
  return { success: true, data: { questionId: asString(params.questionId) } }
}

/**
 * Release every ACTIVE claim held by `taId` (removeStaff / devLeaveStaff).
 * Equality query on (taId, active) — resolved history is never scanned.
 */
export async function releaseClaimsForTa(tools: ActionTools, taId: string): Promise<number> {
  const res = await tools.query<Claim>('claims', { where: { taId, active: 1 }, limit: 100 })
  if (!res.success) return 0
  let released = 0
  for (const c of res.data.records) {
    const q = await tools.get<Question>('questions', c.data.questionId)
    if (q.success && q.data.record.data.status === 'claimed' && q.data.record.data.claimedBy === taId) {
      await returnToLine(tools, c.data.questionId, q.data.record.data, c.recordId)
      released++
    } else {
      // Stale active flag (question already gone): just retire it.
      await tools.update<Claim>('claims', c.recordId, { active: 0 })
    }
  }
  if (released > 0) await recomputeQueue(queueStoreFromTools(tools))
  return released
}

/**
 * DEV/TEST-ONLY: empirical uniqueOn probe. Fires two claim inserts for the
 * same synthetic questionId CONCURRENTLY (both pass any app-level pre-check by
 * construction), returns both raw results, then deletes what it created.
 * Same gate as the other dev actions: debug flag AND @deepspace.test caller.
 */
const devProbeUniqueClaim: ActionHandler<Env> = async ({ userId, tools, env }) => {
  if (env.ALLOW_DEBUG_ROUTES !== 'true') return { success: false, code: 'not_available', error: 'Not available.' }
  if (isAnonymousUserId(userId)) return { success: false, code: 'anonymous', error: 'Sign in first.' }
  if (!(await isTestAccount(tools, userId))) return { success: false, code: 'not_available', error: 'Not available.' }

  const questionId = `probe-${crypto.randomUUID()}`
  const row = { questionId, taId: userId, taName: 'probe', active: 0, createdAt: new Date().toISOString() }
  const results: ActionResult<{ recordId: string }>[] = await Promise.all([
    tools.create<Claim>('claims', row),
    tools.create<Claim>('claims', row),
  ])
  const rows = await tools.query<Claim>('claims', { where: { questionId }, limit: 10 })
  const stored = rows.success ? rows.data.records.length : -1
  await tools.deleteWhere('claims', { questionId }, 10)
  return { success: true, data: { results, storedRows: stored } }
}

export const claimActions: Record<string, ActionHandler<Env>> = {
  claimQuestion,
  releaseClaim,
  resolveQuestion,
  devProbeUniqueClaim,
}
