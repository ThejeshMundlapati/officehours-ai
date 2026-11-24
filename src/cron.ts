/**
 * Cron task definitions — registered into the AppCronRoom DO at construction
 * time (worker.ts). The DO alarm fires `runTask(name, env)` on the schedule
 * declared here; the schedule arms on the app's first request after deploy
 * (see guides/scheduled-jobs and the armCronRoom middleware in worker.ts).
 *
 * Each task declares EITHER `intervalMinutes` OR `schedule` + `timezone`.
 */

import type { CronTask } from 'deepspace/worker'
import { buildCronContext } from 'deepspace/worker'
import type { Env } from '../worker'
import { recomputeQueue, queueStoreFromCron } from './actions/queue'

export const tasks: CronTask[] = [
  // Safety net. Every queue-mutating action already recomputes synchronously;
  // this repairs any transient inconsistency left by two actions interleaving.
  { name: 'recompute-queue', intervalMinutes: 1 },
]

export async function runTask(name: string, env: Env): Promise<void> {
  if (name === 'recompute-queue') {
    const ctx = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)
    await recomputeQueue(queueStoreFromCron(ctx.records))
  }
}
