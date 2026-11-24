/**
 * Cron task definitions — registered into the AppCronRoom DO at construction
 * time (worker.ts). The DO alarm fires `runTask(name, env)` on the schedule
 * declared here; the schedule arms on the app's first request after deploy
 * (see guides/scheduled-jobs and the armCronRoom middleware in worker.ts).
 *
 * Each task declares EITHER `intervalMinutes` OR `schedule` + `timezone`.
 */

import type { CronTask } from 'deepspace/worker'
import { buildCronContext, knowledge } from 'deepspace/worker'
import type { Env } from '../worker'
import { recomputeQueue, queueStoreFromCron } from './actions/queue'
import { syncPendingMaterials, materialStoreFromCron } from './actions/materials'
import { expireStalePendingAnswers } from './actions/answer'

export const tasks: CronTask[] = [
  // Safety net. Every queue-mutating action already recomputes synchronously;
  // this repairs any transient inconsistency left by two actions interleaving.
  // Second step: sync knowledge ingestion status for materials still
  // queued/running (no knowledge call at all when none are pending).
  { name: 'recompute-queue', intervalMinutes: 1 },
]

export async function runTask(name: string, env: Env): Promise<void> {
  if (name === 'recompute-queue') {
    const ctx = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)
    await recomputeQueue(queueStoreFromCron(ctx.records))
    // Isolated so a knowledge-base outage never fails the queue step above.
    try {
      await syncPendingMaterials(materialStoreFromCron(ctx.records), knowledge(env))
    } catch (err) {
      console.warn(`[cron] materials sync failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    // Third step: an answer-question job that crashed (maxAttempts 1) would
    // leave aiStatus 'pending' forever; flip those to 'error' after 20 min.
    try {
      await expireStalePendingAnswers(ctx.records)
    } catch (err) {
      console.warn(`[cron] stale AI sweep failed: ${err instanceof Error ? err.name : 'error'}`)
    }
  }
}
