/**
 * Shared domain types and constants for the office-hours queue.
 *
 * Pure types + constants only — no runtime imports from `deepspace/worker`,
 * so this file is safe to import from BOTH the client (pages) and the server
 * (actions). The validation limits live here so the action and the form agree.
 */

export type QuestionStatus = 'waiting' | 'ai_answered' | 'claimed' | 'solved' | 'left'

/** Statuses that count as "still in the queue". A student may hold at most one. */
export const QUESTION_OPEN_STATUSES: QuestionStatus[] = ['waiting', 'ai_answered', 'claimed']

/**
 * Statuses that are "in line" — awaiting a TA and therefore ranked. A claimed
 * question is being handled, so it is open but NOT in line (position 0).
 */
export const QUESTION_IN_LINE_STATUSES: QuestionStatus[] = ['waiting', 'ai_answered']

export const TITLE_MAX = 200
export const BODY_MAX = 5000
export const TOPIC_MAX = 100

/**
 * User-defined fields of a `questions` record (lives under `record.data`).
 * Indexable so it satisfies the `Record<string, unknown>` constraint on the
 * worker `tools.*<T>` generics.
 */
export interface Question {
  [key: string]: unknown
  /** Owner (ownerField). Set by the server action to the caller's userId. */
  studentId: string
  title: string
  body: string
  topic: string
  status: QuestionStatus
  /** Student display name, snapshotted server-side from the users record. */
  studentName: string
  /** userId of the TA who claimed it, or '' while unclaimed. */
  claimedBy: string
  /** Duplicate-group id (populated in a later phase), or ''. */
  groupId: string
  /** Live position fields maintained server-side (later phase). */
  queuePosition: number
  peopleAhead: number
  /** Snapshot of staff userIds (collaboratorsField) so TAs can read it. */
  collaborators: string[]
  createdAt: string
  /** AI answer state (Phase 5). Written only by server code. */
  aiStatus?: AiStatus
  aiAnswer?: string
  /** Filenames of course materials the answer cites. */
  aiCitations?: string[]
  aiFeedback?: AiFeedback
}

export type AiStatus = 'pending' | 'answered' | 'not_covered' | 'error'
export type AiFeedback = '' | 'helped' | 'needs_help'
export const AI_ANSWER_MAX = 4000

/** Public queue counters. Single record, recordId 'global'. */
export interface QueueStats {
  [key: string]: unknown
  waitingCount: number
  updatedAt: string
}

/** Knowledge item statuses (mirrors deepspace/worker `KnowledgeStatus`). */
export type MaterialStatus = 'queued' | 'running' | 'completed' | 'error' | 'skipped' | 'outdated'
export const MATERIAL_STATUSES: MaterialStatus[] = ['queued', 'running', 'completed', 'error', 'skipped', 'outdated']
/** Ingestion still in progress — the only rows the status sync touches. */
export const MATERIAL_PENDING_STATUSES: MaterialStatus[] = ['queued', 'running']

/** User-defined fields of a `materials` record (admin-only collection). */
export interface Material {
  [key: string]: unknown
  filename: string
  /** Provider item id returned by knowledge(env).add — used for remove/sync. */
  knowledgeItemId: string
  sizeBytes: number
  status: MaterialStatus
  chunksCount: number
  uploadedBy: string
  createdAt: string
}

/** One chunk returned by searchMaterials. */
export interface MaterialSearchHit {
  filename: string
  score: number
  excerpt: string
}

/** User-defined fields of a `staff` record. recordId === userId. */
export interface Staff {
  [key: string]: unknown
  userId: string
  displayName: string
  rank: 'ta' | 'instructor'
  joinedAt: string
}
