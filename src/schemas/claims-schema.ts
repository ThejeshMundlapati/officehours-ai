/**
 * `claims` — one row per TA claim of a question (Phase 6).
 *
 * `uniqueOn: ['questionId']` makes the claim atomic: the RecordRoom checks for
 * an existing row and inserts in one synchronous step inside the Durable
 * Object (deepspace/dist/worker.js, the uniqueOn block before INSERT), and a
 * SQLite UNIQUE index backs it. A second insert for the same question is
 * refused with `{ success: false, error: 'Duplicate: …' }`.
 *
 * Rows are created WITHOUT an explicit recordId: `tools.create(coll, data, id)`
 * with an id is an upsert and would merge into the winner instead of failing.
 *
 * A released claim is deleted (so the question can be claimed again). A
 * resolved claim stays as history with `active: 0`. Admin-only: members never
 * read or write claims; all writes go through server actions.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const claimsSchema: CollectionSchema = {
  name: 'claims',
  uniqueOn: ['questionId'],
  columns: [
    { name: 'questionId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'taId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'taName', storage: 'text', interpretation: 'plain' },
    // 1 while the TA is with the student, 0 once resolved (history). Lets
    // removeStaff find a TA's ACTIVE claims by equality, not a history scan.
    { name: 'active', storage: 'number', interpretation: 'plain' },
    { name: 'createdAt', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
