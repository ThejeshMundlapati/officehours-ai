/**
 * `staff` — the TA/instructor allowlist. recordId === the staff member's userId.
 *
 * Rows are written only by privileged paths (the instructor/admin, and in a
 * later phase a `joinAsStaff` server action). Any member may READ it so the
 * client can label which questions a TA can see and, later, who is online —
 * but no member may write it, so "being staff" can never be self-granted.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const staffSchema: CollectionSchema = {
  name: 'staff',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'displayName', storage: 'text', interpretation: 'plain' },
    {
      name: 'rank',
      storage: 'text',
      interpretation: { kind: 'select', options: ['ta', 'instructor'] },
      required: true,
    },
    { name: 'joinedAt', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
