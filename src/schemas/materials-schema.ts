/**
 * `materials` — course documents uploaded to the app's managed knowledge base.
 *
 * Admin (instructor) only. Members can neither read nor write: the rows name
 * knowledge item ids and filenames that students have no business enumerating.
 * Every write goes through admin-gated server actions (src/actions/materials.ts)
 * or the cron status sync (src/cron.ts).
 */

import type { CollectionSchema } from 'deepspace/schema'

export const materialsSchema: CollectionSchema = {
  name: 'materials',
  columns: [
    { name: 'filename', storage: 'text', interpretation: 'plain', required: true, maxLength: 128 },
    { name: 'knowledgeItemId', storage: 'text', interpretation: 'plain' },
    { name: 'sizeBytes', storage: 'number', interpretation: 'plain' },
    {
      name: 'status',
      storage: 'text',
      interpretation: {
        kind: 'select',
        options: ['queued', 'running', 'completed', 'error', 'skipped', 'outdated'],
      },
      required: true,
    },
    { name: 'chunksCount', storage: 'number', interpretation: 'plain' },
    { name: 'uploadedBy', storage: 'text', interpretation: 'plain' },
    { name: 'createdAt', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
