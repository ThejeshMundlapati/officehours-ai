/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 *
 * Add schemas by creating a file in src/schemas/ and importing it here.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { questionsSchema } from './schemas/questions-schema'
import { staffSchema } from './schemas/staff-schema'
import { queueStatsSchema } from './schemas/queue-stats-schema'
import { materialsSchema } from './schemas/materials-schema'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  questionsSchema,
  staffSchema,
  queueStatsSchema,
  materialsSchema,
]
