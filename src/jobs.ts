/**
 * Background-job handler — invoked by AppJobRoom (worker.ts) for every job
 * picked up from the queue. Dispatch on `job.type`; return a JSON-serializable
 * result or throw to fail (guides/background-jobs).
 *
 * Limits (guides/background-jobs "Lifecycle and limits"): each run executes
 * inside a Durable Object alarm with a 15-minute wall-time limit; jobs run one
 * at a time; default maxAttempts is 1 (no retry); an orphaned `running` row is
 * rescued after ~16 min and then failed (attempts exhausted).
 *
 * Only server code enqueues: `submitQuestion` calls enqueueJob. AppJobRoom's
 * socket write/read access is admin-only (worker.ts).
 */

import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../worker'
import { ANSWER_JOB_TYPE, runAnswerQuestionJob } from './actions/answer'

export async function runJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  if (job.type === ANSWER_JOB_TYPE) {
    // The handler catches its own AI/search/parse failures and records them on
    // the question (aiStatus 'error'), so the job itself rarely throws.
    return runAnswerQuestionJob(job.payload, ctx.signal, env)
  }
  // Unknown type → fail loudly so it shows up in the failed list.
  throw new Error(`Unknown job type: ${job.type}`)
}
