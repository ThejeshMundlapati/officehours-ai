/**
 * TA queue (Phase 2). Staff see every OPEN question live.
 *
 * A TA is a platform MEMBER whose userId is in the `staff` collection; the
 * `questions` rows become visible to them through the `collaborator` read rule
 * (their id is in each row's `collaborators`). An admin/instructor sees all via
 * `read:true`. A member who is neither sees the "not on staff" prompt.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useUser } from 'deepspace'
import { Badge } from '@/components/ui'
import { QUESTION_OPEN_STATUSES, type Question, type QuestionStatus, type Staff } from '@/lib/types'

const STATUS_LABEL: Record<QuestionStatus, string> = {
  waiting: 'Waiting',
  ai_answered: 'AI answered',
  claimed: 'Claimed',
  solved: 'Solved',
  left: 'Left',
}

function waited(iso: string, now: number): string {
  const started = new Date(iso).getTime()
  if (!Number.isFinite(started)) return ''
  const mins = Math.max(0, Math.floor((now - started) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m waiting`
  const h = Math.floor(mins / 60)
  return `${h}h ${mins % 60}m waiting`
}

export default function TaQueuePage() {
  const { user } = useUser()
  const myId = user?.id ?? ''
  const isAdmin = user?.role === 'admin'

  const { records: staff, status: staffStatus } = useQuery<Staff>('staff')
  const { records: questions } = useQuery<Question>('questions')

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(t)
  }, [])

  const isStaff = isAdmin || staff.some((r) => r.recordId === myId)

  const open = useMemo(
    () =>
      questions
        .filter((r) => QUESTION_OPEN_STATUSES.includes(r.data.status))
        .sort((a, b) => (a.data.createdAt < b.data.createdAt ? -1 : 1)),
    [questions],
  )

  return (
    <div data-testid="ta-page" className="min-h-full text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="mb-6 text-3xl font-bold tracking-tight">TA queue</h1>

        {staffStatus === 'loading' ? (
          <p data-testid="ta-loading" className="text-sm text-muted-foreground">
            Loading&hellip;
          </p>
        ) : !isStaff ? (
          <div data-testid="ta-not-staff" className="rounded-lg border border-border bg-card p-6">
            <p className="text-sm text-foreground">You&rsquo;re not on staff.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Join with an invite code to help answer questions.
            </p>
            <Link
              to="/join-staff"
              className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Join with a code
            </Link>
          </div>
        ) : (
          <div data-testid="ta-ready">
            <p className="mb-6 text-sm text-muted-foreground">
              {open.length === 0
                ? 'No open questions right now.'
                : `${open.length} open question${open.length === 1 ? '' : 's'}.`}
            </p>
            {open.length === 0 ? (
              <div data-testid="ta-empty" />
            ) : (
              <ul data-testid="ta-queue" className="space-y-3">
                {open.map((r) => (
                  <li
                    key={r.recordId}
                    data-testid="ta-question"
                    className="rounded-lg border border-border bg-card p-5"
                  >
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <h2 className="font-semibold">{r.data.title}</h2>
                      <Badge>{STATUS_LABEL[r.data.status]}</Badge>
                    </div>
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span data-testid="ta-student-name" className="font-medium text-foreground">
                        {String(r.data.studentName || 'Student')}
                      </span>
                      <span data-testid="ta-position">#{Number(r.data.queuePosition) || 0}</span>
                      {r.data.topic ? (
                        <span className="uppercase tracking-wide">{r.data.topic}</span>
                      ) : null}
                      <span>{waited(r.data.createdAt, now)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-foreground">{r.data.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
