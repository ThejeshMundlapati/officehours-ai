/**
 * `questions` — the office-hours queue.
 *
 * Security model (see docs/concepts/permissions):
 * - `ownerField: 'studentId'` so `read:'own'`/`'collaborator'` evaluate against
 *   the student id the server action stamps, NOT `createdBy`.
 * - `collaboratorsField: 'collaborators'` holds a JSON array of staff userIds,
 *   snapshotted by the server actions. `member read:'collaborator'` therefore
 *   grants read to the owning student OR any listed staff member — a plain
 *   student is never in another row's collaborators, so they see only their own.
 * - Members (students AND TAs at the platform level) cannot create/update/delete
 *   directly; every write goes through a server action (src/actions/questions.ts).
 */

import type { CollectionSchema } from 'deepspace/schema'

export const questionsSchema: CollectionSchema = {
  name: 'questions',
  ownerField: 'studentId',
  collaboratorsField: 'collaborators',
  columns: [
    { name: 'studentId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'title', storage: 'text', interpretation: 'plain', required: true, maxLength: 200 },
    { name: 'body', storage: 'text', interpretation: 'plain', required: true, maxLength: 5000 },
    { name: 'topic', storage: 'text', interpretation: 'plain', maxLength: 100 },
    { name: 'studentName', storage: 'text', interpretation: 'plain' },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['waiting', 'ai_answered', 'claimed', 'solved', 'left'] },
      required: true,
    },
    { name: 'claimedBy', storage: 'text', interpretation: 'plain' },
    { name: 'groupId', storage: 'text', interpretation: 'plain' },
    { name: 'queuePosition', storage: 'number', interpretation: 'plain' },
    { name: 'peopleAhead', storage: 'number', interpretation: 'plain' },
    { name: 'collaborators', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'createdAt', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'collaborator', create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
