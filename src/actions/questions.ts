/**
 * Server actions for the student queue.
 *
 * These run RBAC-OFF (see src/server/action-routes.ts): the `tools` reach the
 * record room as the app, so every action must (1) reject anonymous callers and
 * (2) authorize ownership itself against `userId` before writing. Identity comes
 * only from `ctx.userId` (the verified JWT subject) — never from params.
 */

import { isAnonymousUserId } from 'deepspace/worker'
import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  QUESTION_OPEN_STATUSES,
  TITLE_MAX,
  BODY_MAX,
  TOPIC_MAX,
  type Question,
  type Staff,
} from '../lib/types'

const asString = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * submitQuestion({ title, body, topic? }) — create one 'waiting' question owned
 * by the caller, refusing a second while they already have one open.
 */
const submitQuestion: ActionHandler<Env> = async ({ userId, params, tools }) => {
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

  const created = await tools.create<Question>('questions', {
    studentId: userId,
    title,
    body,
    topic,
    status: 'waiting',
    claimedBy: '',
    groupId: '',
    queuePosition: 0,
    peopleAhead: 0,
    collaborators,
    createdAt: new Date().toISOString(),
  })
  if (!created.success) return created

  return { success: true, data: { recordId: created.data.recordId } }
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

  const updated = await tools.update<Question>('questions', questionId, { status: 'left' })
  if (!updated.success) return updated

  return { success: true, data: { recordId: questionId } }
}

export const questionActions: Record<string, ActionHandler<Env>> = {
  submitQuestion,
  leaveQueue,
}
