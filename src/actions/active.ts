/**
 * One-open-question-per-student slot, backed by `active_questions`
 * (uniqueOn studentId). See src/schemas/active-questions-schema.ts.
 */

import type { ActionTools } from 'deepspace/worker'
import { QUESTION_OPEN_STATUSES, type Question, type QuestionStatus } from '../lib/types'
import { isDuplicateInsert } from './records'

interface ActiveRow {
  [key: string]: unknown
  studentId: string
  questionId: string
  createdAt: string
}

/** A slot whose submit never finished binding a question is stale after this. */
export const IN_FLIGHT_STALE_MS = 2 * 60 * 1000

export type AcquireResult =
  | { ok: true; slotId: string }
  | { ok: false; reason: 'already_open' }
  | { ok: false; reason: 'error'; error: string }

/**
 * Insert the student's slot. On a uniqueness conflict, check whether the
 * existing slot is still live (bound to an open question, or an in-flight
 * submit younger than IN_FLIGHT_STALE_MS); if it is stale, delete it and try
 * once more. Never deletes a live slot.
 */
export async function acquireActiveSlot(
  tools: ActionTools,
  studentId: string,
  now = Date.now(),
): Promise<AcquireResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const created = await tools.create<ActiveRow>('active_questions', {
      studentId,
      questionId: '',
      createdAt: new Date(now).toISOString(),
    })
    if (created.success) return { ok: true, slotId: created.data.recordId }
    if (!isDuplicateInsert(created)) return { ok: false, reason: 'error', error: created.error }

    const existing = await tools.query<ActiveRow>('active_questions', { where: { studentId }, limit: 1 })
    const row = existing.success ? existing.data.records[0] : undefined
    if (!row) continue // removed between our insert and the lookup → retry

    let live: boolean
    if (row.data.questionId) {
      const q = await tools.get<Question>('questions', row.data.questionId)
      live = q.success && QUESTION_OPEN_STATUSES.includes(q.data.record.data.status as QuestionStatus)
    } else {
      live = now - Date.parse(row.data.createdAt) < IN_FLIGHT_STALE_MS
    }
    if (live) return { ok: false, reason: 'already_open' }
    await tools.remove('active_questions', row.recordId) // stale → clear and retry once
  }
  return { ok: false, reason: 'already_open' }
}

export async function bindActiveSlot(tools: ActionTools, slotId: string, questionId: string): Promise<void> {
  await tools.update<ActiveRow>('active_questions', slotId, { questionId })
}

export async function dropSlotById(tools: ActionTools, slotId: string): Promise<void> {
  await tools.remove('active_questions', slotId)
}

/** Called whenever a student's question leaves the open statuses. */
export async function releaseActiveSlot(tools: ActionTools, studentId: string): Promise<void> {
  if (!studentId) return
  await tools.deleteWhere('active_questions', { studentId }, 10)
}
