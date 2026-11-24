/**
 * Server actions for the student queue.
 *
 * These run RBAC-OFF (see src/server/action-routes.ts): the `tools` reach the
 * record room as the app, so every action must (1) reject anonymous callers and
 * (2) authorize ownership itself against `userId` before writing. Identity comes
 * only from `ctx.userId` (the verified JWT subject) — never from params.
 */

import { enqueueJob, isAnonymousUserId } from 'deepspace/worker'
import type { ActionHandler, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  QUESTION_OPEN_STATUSES,
  TITLE_MAX,
  BODY_MAX,
  TOPIC_MAX,
  type Question,
  type QuestionStatus,
  type Staff,
} from '../lib/types'
import { recomputeQueue, queueStoreFromTools } from './queue'
import { ANSWER_JOB_TYPE } from './answer'
import { isDevTestCaller } from './auth'

const asString = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * submitQuestion({ title, body, topic? }) — create one 'waiting' question owned
 * by the caller, refusing a second while they already have one open.
 */
const submitQuestion: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  if (isAnonymousUserId(userId)) {
    return { success: false, code: 'anonymous', error: 'Sign in to ask a question.' }
  }

  const title = asString(params.title).trim()
  const body = asString(params.body).trim()
  const topic = asString(params.topic).trim()

  if (title.length < 1 || title.length > TITLE_MAX) {
    return { success: false, code: 'invalid_input', error: `Title must be 1–${TITLE_MAX} characters.` }
  }
  if (body.length < 1 || body.length > BODY_MAX) {
    return { success: false, code: 'invalid_input', error: `Question must be 1–${BODY_MAX} characters.` }
  }
  if (topic.length > TOPIC_MAX) {
    return { success: false, code: 'invalid_input', error: `Topic must be at most ${TOPIC_MAX} characters.` }
  }

  // One open question per student.
  const mine = await tools.query<Question>('questions', { where: { studentId: userId } })
  if (!mine.success) return mine
  const hasOpen = mine.data.records.some((r) => QUESTION_OPEN_STATUSES.includes(r.data.status))
  if (hasOpen) {
    return { success: false, code: 'already_open', error: 'You already have an open question in the queue.' }
  }

  // Snapshot current staff ids into collaborators so TAs can read this row.
  const staff = await tools.query<Staff>('staff')
  const collaborators = staff.success ? staff.data.records.map((r) => r.recordId) : []

  // Snapshot the student's display name from their users record — never params.
  const userRow = await tools.get<{ name?: string; email?: string }>('users', userId)
  const studentName =
    (userRow.success
      ? asString(userRow.data.record.data.name) || asString(userRow.data.record.data.email)
      : '') || 'Student'

  // Paid AI work is skipped for automated test accounts in dev (see auth.ts).
  const aiEnabled = !(await isDevTestCaller(env, tools, userId))

  const created = await tools.create<Question>('questions', {
    studentId: userId,
    title,
    body,
    topic,
    status: 'waiting',
    studentName,
    claimedBy: '',
    groupId: '',
    queuePosition: 0,
    peopleAhead: 0,
    collaborators,
    createdAt: new Date().toISOString(),
    ...(aiEnabled ? { aiStatus: 'pending' as const } : {}),
    aiAnswer: '',
    aiCitations: [],
    aiFeedback: '',
    aiReason: '',
  })
  if (!created.success) return created
  const questionId = created.data.recordId

  await recomputeQueue(queueStoreFromTools(tools))

  // Fire-and-forget: the AI answer runs in the background job room. enqueueJob
  // only inserts a queue row (one DO round-trip), so this returns immediately.
  if (aiEnabled) try {
    await enqueueJob(env.JOB_ROOMS, `app:${env.DEEPSPACE_APP_ID}`, ANSWER_JOB_TYPE, { questionId }, {
      maxAttempts: 1,
      enqueuedBy: userId,
    })
  } catch (err) {
    // Never leave the student on a spinner: the question keeps its place.
    console.warn(`[submitQuestion] q=${questionId} enqueue failed: ${err instanceof Error ? err.name : 'error'}`)
    await tools.update<Question>('questions', questionId, { aiStatus: 'error', aiReason: 'enqueue_error' })
  }
  return { success: true, data: { recordId: questionId } }
}

/**
 * leaveQueue({ questionId }) — the owning student removes their question
 * (status -> 'left'). Ownership is enforced here because RBAC is off.
 */
const leaveQueue: ActionHandler<Env> = async ({ userId, params, tools }) => {
  if (isAnonymousUserId(userId)) {
    return { success: false, code: 'anonymous', error: 'Sign in first.' }
  }

  const questionId = asString(params.questionId)
  if (!questionId) {
    return { success: false, code: 'invalid_input', error: 'Missing questionId.' }
  }

  const got = await tools.get<Question>('questions', questionId)
  if (!got.success) {
    return { success: false, code: 'not_found', error: 'Question not found.' }
  }
  if (got.data.record.data.studentId !== userId) {
    return { success: false, code: 'forbidden', error: 'You can only leave your own question.' }
  }
  const currentStatus = got.data.record.data.status as QuestionStatus
  if (!QUESTION_OPEN_STATUSES.includes(currentStatus)) {
    return { success: false, code: 'not_open', error: 'This question is not in the queue.' }
  }

  // Zero this row's position as it leaves the line — recompute only (re)ranks
  // the remaining in-line questions, it never rescans departed ones.
  const updated = await tools.update<Question>('questions', questionId, {
    status: 'left',
    queuePosition: 0,
    peopleAhead: 0,
  })
  if (!updated.success) return updated

  await recomputeQueue(queueStoreFromTools(tools))
  return { success: true, data: { recordId: questionId } }
}

/**
 * Load the caller's OWN open question, or return the refusal. Ownership is
 * checked here because actions run RBAC-off.
 */
async function loadOwnOpenQuestion(
  tools: ActionTools,
  userId: string,
  rawId: unknown,
): Promise<{ ok: true; id: string; data: Question } | { ok: false; res: { success: false; code: string; error: string } }> {
  if (isAnonymousUserId(userId)) return { ok: false, res: { success: false, code: 'anonymous', error: 'Sign in first.' } }
  const id = asString(rawId)
  if (!id) return { ok: false, res: { success: false, code: 'invalid_input', error: 'Missing questionId.' } }
  const got = await tools.get<Question>('questions', id)
  if (!got.success) return { ok: false, res: { success: false, code: 'not_found', error: 'Question not found.' } }
  const data = got.data.record.data
  if (data.studentId !== userId) {
    return { ok: false, res: { success: false, code: 'forbidden', error: 'You can only update your own question.' } }
  }
  if (!QUESTION_OPEN_STATUSES.includes(data.status as QuestionStatus)) {
    return { ok: false, res: { success: false, code: 'not_open', error: 'This question is not in the queue.' } }
  }
  return { ok: true, id, data }
}

/**
 * markSolved({ questionId }) — the owner says the AI answer solved it. The
 * question leaves the line, so its position is zeroed HERE before recompute.
 */
const markSolved: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const q = await loadOwnOpenQuestion(tools, userId, params.questionId)
  if (!q.ok) return q.res
  const updated = await tools.update<Question>('questions', q.id, {
    status: 'solved',
    aiFeedback: 'helped',
    queuePosition: 0,
    peopleAhead: 0,
  })
  if (!updated.success) return updated
  await recomputeQueue(queueStoreFromTools(tools))
  return { success: true, data: { recordId: q.id } }
}

/** stillNeedHelp({ questionId }) — flag for the TA; place in line is unchanged. */
const stillNeedHelp: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const q = await loadOwnOpenQuestion(tools, userId, params.questionId)
  if (!q.ok) return q.res
  const updated = await tools.update<Question>('questions', q.id, { aiFeedback: 'needs_help' })
  if (!updated.success) return updated
  return { success: true, data: { recordId: q.id } }
}

export const questionActions: Record<string, ActionHandler<Env>> = {
  submitQuestion,
  leaveQueue,
  markSolved,
  stillNeedHelp,
}
