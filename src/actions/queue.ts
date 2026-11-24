/**
 * Queue position bookkeeping.
 *
 * `recomputeQueue` ranks only the "in line" questions (waiting or ai_answered),
 * oldest-first, writing `queuePosition` (1-based) and `peopleAhead` (= position
 * - 1) ONLY to records whose values changed. It never scans full history: a
 * question that LEAVES the line is zeroed (position 0 / peopleAhead 0) by the
 * action that changes its status (leaveQueue now; claim/solve later), so this
 * helper only ever reads and writes the (small) live in-line set. It also keeps
 * the public `queue_stats` row (`waitingCount` = number in line), writing it
 * only when the count changes.
 *
 * Concurrency: recompute is NOT serialized, and an OLDER run can overwrite a
 * NEWER one — reader A loads an earlier snapshot, writer B loads a later one and
 * commits, then A writes its stale ranks on top. Positions are therefore only
 * guaranteed correct once writes quiesce. The 1-minute `recompute-queue` cron
 * reconciles from the latest committed state, giving eventual consistency
 * (correct within ~1 min of the last change). Writes are change-only and
 * idempotent, so repeated runs are cheap.
 *
 * Two record APIs reach the DO with different shapes, so the pure logic takes a
 * small `QueueStore` and each caller supplies an adapter:
 *   - `queueStoreFromTools` for server actions (ActionTools, RBAC-off).
 *   - `queueStoreFromCron` for the cron safety net (CronContext.records).
 */

import type { ActionTools } from 'deepspace/worker'
import {
  QUESTION_IN_LINE_STATUSES,
  QUESTION_OPEN_STATUSES,
  type Question,
  type QueueStats,
} from '../lib/types'

export const QUEUE_STATS_RECORD_ID = 'global'
// Generous cap per status query. The live in-line set is small; history never
// enters these queries, so new questions can't fall outside the window the way
// a single unordered full-collection scan allowed.
const IN_LINE_QUERY_LIMIT = 1000

/**
 * Every OPEN question (waiting / ai_answered / claimed), one equality query per
 * status. `where` is equality-only (no `in`), so this is the only way to read
 * the open set without scanning history.
 */
export async function listOpenQuestions(tools: ActionTools): Promise<QueueRow[]> {
  const rows: QueueRow[] = []
  for (const status of QUESTION_OPEN_STATUSES) {
    const res = await tools.query<Question>('questions', { where: { status }, limit: IN_LINE_QUERY_LIMIT })
    if (res.success) for (const r of res.data.records) rows.push({ recordId: r.recordId, data: r.data })
  }
  return rows
}

export interface QueueRow {
  recordId: string
  data: Question
}
interface StatsRow {
  recordId: string
  data: QueueStats
}

export interface QueueStore {
  /** Only the in-line questions (waiting/ai_answered) — never a history scan. */
  listInLine(): Promise<QueueRow[]>
  updateQuestion(recordId: string, patch: Partial<Question>): Promise<void>
  listStats(): Promise<StatsRow[]>
  /** Upsert the single 'global' row. */
  upsertStats(data: QueueStats): Promise<void>
}

export async function recomputeQueue(store: QueueStore): Promise<void> {
  const inLine = (await store.listInLine()).sort((a, b) => {
    if (a.data.createdAt !== b.data.createdAt) return a.data.createdAt < b.data.createdAt ? -1 : 1
    // Stable, deterministic tie-break for identical timestamps.
    return a.recordId < b.recordId ? -1 : 1
  })

  for (let i = 0; i < inLine.length; i++) {
    const r = inLine[i]
    const pos = i + 1
    const ahead = i
    const curPos = typeof r.data.queuePosition === 'number' ? r.data.queuePosition : null
    const curAhead = typeof r.data.peopleAhead === 'number' ? r.data.peopleAhead : null
    if (curPos !== pos || curAhead !== ahead) {
      await store.updateQuestion(r.recordId, { queuePosition: pos, peopleAhead: ahead })
    }
  }

  const waitingCount = inLine.length
  const existing = (await store.listStats()).find((s) => s.recordId === QUEUE_STATS_RECORD_ID)
  if (!existing || existing.data.waitingCount !== waitingCount) {
    await store.upsertStats({ waitingCount, updatedAt: new Date().toISOString() })
  }
}

/** Adapter over server-action tools (RBAC-off). */
export function queueStoreFromTools(tools: ActionTools): QueueStore {
  return {
    async listInLine() {
      const rows: QueueRow[] = []
      // `where` is equality-only — no `in` operator (deepspace/dist/worker.js
      // rejects object values: "where values must be primitives (equality
      // only)"). So query per in-line status and merge.
      for (const status of QUESTION_IN_LINE_STATUSES) {
        const res = await tools.query<Question>('questions', { where: { status }, limit: IN_LINE_QUERY_LIMIT })
        if (res.success) for (const r of res.data.records) rows.push({ recordId: r.recordId, data: r.data })
      }
      return rows
    },
    async updateQuestion(recordId, patch) {
      await tools.update<Question>('questions', recordId, patch)
    },
    async listStats() {
      const res = await tools.query<QueueStats>('queue_stats', { limit: 10 })
      return res.success ? res.data.records.map((r) => ({ recordId: r.recordId, data: r.data })) : []
    },
    async upsertStats(data) {
      await tools.create<QueueStats>('queue_stats', data, QUEUE_STATS_RECORD_ID)
    },
  }
}

/** The subset of `CronContext.records` this module uses. */
type CronRecords = {
  query(collection: string, opts?: { where?: Record<string, unknown>; limit?: number }): Promise<unknown[]>
  update(collection: string, recordId: string, data: Record<string, unknown>): Promise<unknown>
}

// `CronContext.records.query` is typed `Promise<unknown[]>`
// (deepspace/dist/worker.d.ts:3675-3678). At runtime it returns the
// records.query tool's `records` array of `{ recordId, data, ... }`
// (deepspace/dist/worker.js:8148-8150). Guard each row rather than trust the cast.
function asQueueRow(raw: unknown): QueueRow | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as { recordId?: unknown; data?: unknown }
  if (typeof rec.recordId !== 'string' || !rec.data || typeof rec.data !== 'object') return null
  return { recordId: rec.recordId, data: rec.data as Question }
}
function asStatsRow(raw: unknown): StatsRow | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as { recordId?: unknown; data?: unknown }
  if (typeof rec.recordId !== 'string' || !rec.data || typeof rec.data !== 'object') return null
  return { recordId: rec.recordId, data: rec.data as QueueStats }
}

/** Adapter over the cron context's records API (bare arrays; no `get`). */
export function queueStoreFromCron(records: CronRecords): QueueStore {
  return {
    async listInLine() {
      const rows: QueueRow[] = []
      for (const status of QUESTION_IN_LINE_STATUSES) {
        const arr = await records.query('questions', { where: { status }, limit: IN_LINE_QUERY_LIMIT })
        for (const raw of arr) {
          const row = asQueueRow(raw)
          if (row) rows.push(row)
        }
      }
      return rows
    },
    async updateQuestion(recordId, patch) {
      await records.update('questions', recordId, patch as Record<string, unknown>)
    },
    async listStats() {
      const arr = await records.query('queue_stats', { limit: 10 })
      const rows: StatsRow[] = []
      for (const raw of arr) {
        const row = asStatsRow(raw)
        if (row) rows.push(row)
      }
      return rows
    },
    async upsertStats(data) {
      // Cron create() cannot set a recordId, so it can only UPDATE the existing
      // 'global' row. Actions (which upsert by id) create it on first submit.
      const arr = await records.query('queue_stats', { limit: 10 })
      const exists = arr.some((raw) => asStatsRow(raw)?.recordId === QUEUE_STATS_RECORD_ID)
      if (exists) await records.update('queue_stats', QUEUE_STATS_RECORD_ID, data as Record<string, unknown>)
    },
  }
}
