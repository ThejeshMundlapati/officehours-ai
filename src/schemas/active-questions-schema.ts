/**
 * `active_questions` — at most ONE row per student while they have an open
 * question (Phase 6 fix for the Phase 1 double-submit race).
 *
 * `uniqueOn: ['studentId']` was proven empirically in tests/claims.spec.ts
 * (concurrent inserts → exactly one stored; the loser gets
 * `{ success: false, error: 'Duplicate: …' }`). submitQuestion inserts this
 * row FIRST, so two concurrent submits can't both pass. The row is deleted
 * when the question leaves the open statuses (leave, solve, resolve, reset).
 *
 * Rows are created WITHOUT an explicit recordId (an id would upsert). Admin
 * read only; members never touch it.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const activeQuestionsSchema: CollectionSchema = {
  name: 'active_questions',
  uniqueOn: ['studentId'],
  columns: [
    { name: 'studentId', storage: 'text', interpretation: 'plain', required: true },
    // '' while the submit is in flight, then the question's recordId.
    { name: 'questionId', storage: 'text', interpretation: 'plain' },
    { name: 'createdAt', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
