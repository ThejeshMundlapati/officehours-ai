/**
 * `queue_stats` — public queue counters (single row, recordId 'global').
 *
 * Any member may READ it (so the student page can show "N students waiting"),
 * but no member may write it. It is written only by `recomputeQueue`
 * (src/actions/queue.ts), which runs as the app/owner.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const queueStatsSchema: CollectionSchema = {
  name: 'queue_stats',
  columns: [
    { name: 'waitingCount', storage: 'number', interpretation: 'plain' },
    { name: 'updatedAt', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
