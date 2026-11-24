/**
 * `question_groups` — AI-detected duplicate clusters (Phase 7).
 *
 * A label summarizes OTHER students' questions, so students must never read
 * it. Same pattern as `questions`: member read is 'collaborator', and the
 * collaborators column holds the staff ids (kept in sync by joinAsStaff /
 * removeStaff). `ownerField` is pinned to `ownerId`, which server code always
 * sets to the app owner — otherwise the row creator (the TA who ran grouping)
 * would own the row and keep reading it after leaving staff. Admin reads all.
 * Questions carry only the opaque `groupId`. No member writes.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const questionGroupsSchema: CollectionSchema = {
  name: 'question_groups',
  ownerField: 'ownerId',
  collaboratorsField: 'collaborators',
  columns: [
    { name: 'label', storage: 'text', interpretation: 'plain', maxLength: 80 },
    { name: 'questionIds', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'collaborators', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'ownerId', storage: 'text', interpretation: 'plain' },
    // 1 = current grouping, 0 = retired. Lets regrouping find old groups by equality.
    { name: 'active', storage: 'number', interpretation: 'plain' },
    { name: 'createdAt', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'collaborator', create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
