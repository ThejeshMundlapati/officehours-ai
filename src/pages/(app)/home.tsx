/* home pattern: data-forward — live queue numbers above the fold, then the one next step for your role */
/**
 * /home — role-aware dashboard.
 *   Signed out → the same numbers in preview form + an inline sign-in CTA.
 *   Student    → their own question's state (or "ask one") + link to the queue.
 *   Staff      → students waiting, who is online, link to the TA queue.
 *   Admin      → the above plus the instructor console and materials status.
 * Reads only collections the caller may read: queue_stats/staff (members),
 * their own questions (owner), materials (admin only — RBAC returns nothing
 * to anyone else).
 */

import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AuthOverlay, useAuthProfileReady, useQuery } from 'deepspace'
import { ArrowRight, BookOpen, ClipboardList, KeyRound, MessageCircleQuestion, Users } from 'lucide-react'
import { Badge, Button } from '@/components/ui'
import { useOnlineStaff } from '@/components/StaffPresence'
import { APP_NAME } from '../../constants'
import {
  QUESTION_OPEN_STATUSES,
  type Material,
  type Question,
  type QueueStats,
  type Staff,
} from '@/lib/types'

function Stat({ label, value, testId }: { label: string; value: ReactNode; testId: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p data-testid={testId} className="font-display mt-1 text-3xl font-semibold text-card-foreground">
        {value}
      </p>
    </div>
  )
}

function NextStep({
  icon,
  title,
  body,
  to,
  cta,
  testId,
}: {
  icon: ReactNode
  title: string
  body: string
  to: string
  cta: string
  testId: string
}) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className="group flex items-start gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:bg-accent"
    >
      <span className="mt-0.5 text-primary [&_svg]:h-5 [&_svg]:w-5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-card-foreground">{title}</span>
        <span className="mt-1 block text-sm text-muted-foreground">{body}</span>
      </span>
      <span className="hidden items-center gap-1 self-center text-sm font-medium text-primary sm:flex">
        {cta}
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  )
}

export default function HomePage() {
  const { isLoaded, isSignedIn, user, userLoading } = useAuthProfileReady({ requireUser: true })
  const [showAuth, setShowAuth] = useState(false)
  const myId = user?.id ?? ''
  const isAdmin = user?.role === 'admin'

  const { records: statsRows, status: statsStatus } = useQuery<QueueStats>('queue_stats')
  const { records: staff } = useQuery<Staff>('staff')
  const mineOpts = useMemo(() => ({ where: { studentId: myId } }), [myId])
  const { records: mine } = useQuery<Question>('questions', mineOpts)
  const { records: materials } = useQuery<Material>('materials')
  const online = useOnlineStaff()

  const waiting = Number(statsRows.find((r) => r.recordId === 'global')?.data.waitingCount ?? 0)
  const isStaff = isAdmin || staff.some((r) => r.recordId === myId)
  const open = mine.find((r) => r.data.studentId === myId && QUESTION_OPEN_STATUSES.includes(r.data.status))
  const loadingNumbers = statsStatus === 'loading'
  const profileLoading = !isLoaded || (isSignedIn && (userLoading || !user))

  return (
    <div data-testid="home-page" className="min-h-full text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <p className="mb-2 text-sm font-medium uppercase tracking-widest text-primary">{APP_NAME}</p>
        <h1 className="mb-2 text-3xl font-semibold tracking-tight sm:text-4xl">Office hours, live</h1>
        <p className="mb-8 max-w-xl text-muted-foreground">
          One queue for the course. Ask a question, see your place, and get a cited answer from the course
          materials while you wait.
        </p>

        <div className="mb-10 grid gap-3 sm:grid-cols-2">
          <Stat
            label="Students waiting"
            testId="home-waiting"
            value={loadingNumbers ? <span className="inline-block h-8 w-10 animate-pulse rounded-md bg-muted" /> : waiting}
          />
          <Stat label="TAs online" testId="home-online" value={online.length} />
        </div>

        {profileLoading ? (
          <div className="space-y-3" aria-hidden>
            <div className="h-20 animate-pulse rounded-lg bg-muted" />
            <div className="h-20 animate-pulse rounded-lg bg-muted" />
          </div>
        ) : !isSignedIn ? (
          <div data-testid="home-signed-out" className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-1 text-xl font-semibold">Sign in to join the queue</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Any account works for students. TAs sign in first, then enter their invite code.
            </p>
            <Button onClick={() => setShowAuth(true)}>Sign in</Button>
            {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="mb-1 text-lg font-semibold">
              {isAdmin ? 'Instructor' : isStaff ? 'Teaching assistant' : 'Your next step'}
            </h2>

            {isStaff && (
              <NextStep
                testId="home-ta-link"
                icon={<Users />}
                title={waiting === 0 ? 'The queue is clear' : `${waiting} student${waiting === 1 ? '' : 's'} waiting`}
                body="Claim a question, group duplicates, and resolve — updates live for every TA."
                to="/ta"
                cta="TA queue"
              />
            )}

            {isAdmin && (
              <NextStep
                testId="home-instructor-link"
                icon={<KeyRound />}
                title="Instructor console"
                body={`TA invite code, staff list, and course materials (${materials.length} uploaded${
                  materials.some((m) => m.data.status === 'queued' || m.data.status === 'running') ? ', some indexing' : ''
                }).`}
                to="/instructor"
                cta="Open"
              />
            )}

            {open ? (
              <NextStep
                testId="home-queue-link"
                icon={<ClipboardList />}
                title={
                  open.data.status === 'claimed'
                    ? 'A TA is with you'
                    : Number(open.data.queuePosition) > 0
                      ? `You’re #${Number(open.data.queuePosition)} in line`
                      : 'You’re in line'
                }
                body={String(open.data.title)}
                to="/queue"
                cta="View"
              />
            ) : (
              <NextStep
                testId="home-queue-link"
                icon={<MessageCircleQuestion />}
                title="Ask a question"
                body="Describe what you’re stuck on. You’ll get an answer from the course materials if they cover it."
                to="/queue"
                cta="Join the queue"
              />
            )}

            {!isStaff && (
              <p className="flex flex-wrap items-center gap-2 pt-2 text-sm text-muted-foreground">
                <BookOpen className="h-4 w-4" aria-hidden />
                TA for this course?
                <Link to="/join-staff" className="font-medium text-foreground underline-offset-4 hover:underline">
                  Join with an invite code
                </Link>
                {online.length > 0 && <Badge variant="success">{online.length} online</Badge>}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
