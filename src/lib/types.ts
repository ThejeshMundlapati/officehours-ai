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
}

/** User-defined fields of a `staff` record. recordId === userId. */
export interface Staff {
  [key: string]: unknown
  userId: string
  displayName: string
  rank: 'ta' | 'instructor'
  joinedAt: string
}
