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
import { Inbox } from 'lucide-react'
import { useMutations, useQuery, useUser } from 'deepspace'
import { Badge, Button, EmptyState, useToast } from '@/components/ui'
import { callAction } from '@/lib/actions'
import { StaffOnlineList } from '@/components/StaffPresence'
import {
  QUESTION_OPEN_STATUSES,
  type Question,
  type QuestionGroup,
  type QuestionStatus,
  type Staff,
} from '@/lib/types'

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
  // One equality subscription per open status — never the whole collection
  // (an admin would otherwise receive every solved/left row ever written).
  const waitingOpts = useMemo(() => ({ where: { status: 'waiting' } }), [])
  const aiOpts = useMemo(() => ({ where: { status: 'ai_answered' } }), [])
  const claimedOpts = useMemo(() => ({ where: { status: 'claimed' } }), [])
  const { records: waitingQs } = useQuery<Question>('questions', waitingOpts)
  const { records: aiQs } = useQuery<Question>('questions', aiOpts)
  const { records: claimedQs } = useQuery<Question>('questions', claimedOpts)
  const questions = useMemo(() => [...waitingQs, ...aiQs, ...claimedQs], [waitingQs, aiQs, claimedQs])

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

  // Active groups (staff/admin-readable only). Members render under their
  // group header; everything else renders as before.
  const groupOpts = useMemo(() => ({ where: { active: 1 } }), [])
  const { records: groupRows } = useQuery<QuestionGroup>('question_groups', groupOpts)
  const sections = useMemo(() => {
    const byId = new Map(groupRows.map((g) => [g.recordId, g]))
    const members = new Map<string, typeof open>()
    const ungrouped: typeof open = []
    for (const r of open) {
      const gid = String(r.data.groupId || '')
      if (gid && byId.has(gid)) members.set(gid, [...(members.get(gid) ?? []), r])
      else ungrouped.push(r)
    }
    const groups = [...members.entries()].map(([gid, m]) => ({ group: byId.get(gid)!, members: m }))
    return { groups, ungrouped }
  }, [open, groupRows])

  const renderCard = (r: (typeof open)[number]) => (
                <li
                  key={r.recordId}
                  data-testid="ta-question"
                  className="rounded-lg border border-border bg-card p-5"
                >
                  <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
                    <h2 className="min-w-0 break-words font-semibold">{r.data.title}</h2>
                    <div className="flex shrink-0 items-center gap-2">
                      {r.data.aiFeedback === 'needs_help' && (
                        <Badge data-testid="ta-needs-help" variant="warning">
                          Still needs help
                        </Badge>
                      )}
                      <Badge>{STATUS_LABEL[r.data.status]}</Badge>
                    </div>
                  </div>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span data-testid="ta-student-name" className="font-medium text-foreground">
                      {String(r.data.studentName || 'Student')}
                    </span>
                    {r.data.status === 'claimed' ? (
                      <span data-testid="ta-claimed-by" className="font-medium text-foreground">
                        Claimed by {r.data.claimedBy === myId ? 'you' : String(r.data.claimedByName || 'a TA')}
                      </span>
                    ) : (
                      <span data-testid="ta-position">#{Number(r.data.queuePosition) || 0}</span>
                    )}
                    {r.data.topic ? (
                      <span className="uppercase tracking-wide">{r.data.topic}</span>
                    ) : null}
                    <span>{waited(r.data.createdAt, now)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{r.data.body}</p>
                  <TaAiSummary question={r.data} />
                  <ClaimControls
                    questionId={r.recordId}
                    question={r.data}
                    myId={myId}
                    isAdmin={isAdmin}
                  />
                </li>
  )

  return (
    <div data-testid="ta-page" className="min-h-full text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="mb-6 text-3xl font-bold tracking-tight">TA queue</h1>

        {staffStatus === 'loading' ? (
          <div data-testid="ta-loading" className="space-y-3" aria-busy="true">
            <div className="h-12 animate-pulse rounded-lg bg-muted" />
            <div className="h-28 animate-pulse rounded-lg bg-muted" />
            <div className="h-28 animate-pulse rounded-lg bg-muted" />
          </div>
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
            <StaffOnlineList />
            <GroupButton />
            <p className="mb-6 text-sm text-muted-foreground">
              {open.length === 0
                ? 'No open questions right now.'
                : `${open.length} open question${open.length === 1 ? '' : 's'}.`}
            </p>
            {open.length === 0 ? (
              <EmptyState
                data-testid="ta-empty"
                className="rounded-lg border border-dashed border-border"
                icon={<Inbox />}
                title="Nobody is waiting"
                description="New questions appear here the moment a student joins the queue."
              />
            ) : (
              <div data-testid="ta-queue" className="space-y-6">
                {sections.groups.map(({ group, members }) => (
                  <section key={group.recordId} data-testid="ta-group" className="rounded-xl border border-border bg-muted/30 p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-2">
                      <h2 data-testid="ta-group-label" className="text-sm font-semibold text-foreground">
                        {String(group.data.label)} — {members.length} student{members.length === 1 ? '' : 's'}
                      </h2>
                      <GroupControls groupId={group.recordId} />
                    </div>
                    <ul className="space-y-3">{members.map(renderCard)}</ul>
                  </section>
                ))}
                {sections.ungrouped.length > 0 && <ul className="space-y-3">{sections.ungrouped.map(renderCard)}</ul>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const AI_STATUS_NOTE: Record<string, string> = {
  pending: 'AI is checking the course materials…',
  not_covered: 'Not covered in the course materials.',
  error: 'AI check failed.',
}

/** Collapsed AI answer + citations on a TA card. */
function TaAiSummary({ question }: { question: Question }) {
  const status = question.aiStatus
  if (!status) return null
  if (status !== 'answered') {
    return (
      <p data-testid="ta-ai-note" className="mt-3 text-xs text-muted-foreground">
        {AI_STATUS_NOTE[status] ?? ''}
        <AiReasonTag reason={question.aiReason} />
      </p>
    )
  }
  const citations = Array.isArray(question.aiCitations) ? question.aiCitations : []
  return (
    <details data-testid="ta-ai-answer" className="mt-3 rounded-md border border-border bg-background p-3 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        AI answer{citations.length > 0 ? ` · cites ${citations.join(', ')}` : ''}
        <AiReasonTag reason={question.aiReason} />
      </summary>
      <p className="mt-2 whitespace-pre-wrap text-foreground">{question.aiAnswer}</p>
    </details>
  )
}

/** Staff-only diagnostic: the machine reason, shown small and muted. */
function AiReasonTag({ reason }: { reason?: string }) {
  if (!reason || reason === 'answered') return null
  return (
    <span data-testid="ta-ai-reason" className="ml-2 font-mono text-[10px] text-muted-foreground/70">
      ({reason})
    </span>
  )
}

/**
 * Claim / Release / Resolve, by state. The server actions are the authority
 * (staff check, own-question rule, atomic claim); this only picks buttons.
 */
function ClaimControls({
  questionId,
  question,
  myId,
  isAdmin,
}: {
  questionId: string
  question: Question
  myId: string
  isAdmin: boolean
}) {
  const toast = useToast()
  const { ready } = useMutations<Question>('questions')
  const [busy, setBusy] = useState<'' | 'claim' | 'release' | 'resolve'>('')

  async function run(kind: 'claim' | 'release' | 'resolve') {
    const action = kind === 'claim' ? 'claimQuestion' : kind === 'release' ? 'releaseClaim' : 'resolveQuestion'
    setBusy(kind)
    const res = await callAction(action, { questionId })
    setBusy('')
    if (!res.success) {
      toast.error(kind === 'claim' ? 'Could not claim' : 'Could not update', res.error)
    } else if (kind === 'resolve') {
      toast.success('Marked resolved')
    }
  }

  const disabled = !ready || busy !== ''
  if (question.status === 'claimed') {
    if (question.claimedBy !== myId && !isAdmin) return null
    return (
      <div className="mt-4 flex gap-2">
        <Button
          data-testid="ta-resolve"
          size="sm"
          loading={busy === 'resolve'}
          disabled={disabled}
          onClick={() => run('resolve')}
        >
          Resolve
        </Button>
        <Button
          data-testid="ta-release"
          size="sm"
          variant="secondary"
          loading={busy === 'release'}
          disabled={disabled}
          onClick={() => run('release')}
        >
          Release
        </Button>
      </div>
    )
  }
  if (question.studentId === myId) {
    return <p className="mt-4 text-xs text-muted-foreground">This is your own question.</p>
  }
  return (
    <div className="mt-4">
      <Button data-testid="ta-claim" size="sm" loading={busy === 'claim'} disabled={disabled} onClick={() => run('claim')}>
        Claim
      </Button>
    </div>
  )
}

/** Runs AI duplicate grouping (server enforces staff + 60 s cooldown). */
function GroupButton() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  async function run() {
    setBusy(true)
    setNote('')
    const res = await callAction<{ groups: number; considered?: number; skipped?: string }>('groupDuplicates')
    setBusy(false)
    if (res.success) {
      if (res.data.skipped === 'test_account') setNote('Grouping is skipped for test accounts in dev.')
      else setNote(res.data.groups === 0 ? 'No duplicates found.' : `${res.data.groups} group(s) found.`)
    } else if (res.code === 'cooldown') {
      setNote(res.error)
    } else {
      toast.error('Grouping failed', res.error)
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Button data-testid="ta-group-run" variant="secondary" size="sm" loading={busy} disabled={busy} onClick={run}>
        Group similar questions
      </Button>
      {note && (
        <span data-testid="ta-group-note" className="text-xs text-muted-foreground">
          {note}
        </span>
      )}
    </div>
  )
}

/** Claim group / Resolve group — partial results are reported, not hidden. */
function GroupControls({ groupId }: { groupId: string }) {
  const toast = useToast()
  const [busy, setBusy] = useState<'' | 'claim' | 'resolve'>('')

  async function run(kind: 'claim' | 'resolve') {
    setBusy(kind)
    const res = await callAction<{ claimed?: number; resolved?: number; skipped: number }>(
      kind === 'claim' ? 'claimGroup' : 'resolveGroup',
      { groupId },
    )
    setBusy('')
    if (!res.success) {
      toast.error('Could not update group', res.error)
      return
    }
    const done = kind === 'claim' ? res.data.claimed ?? 0 : res.data.resolved ?? 0
    const verb = kind === 'claim' ? 'Claimed' : 'Resolved'
    const msg = `${verb} ${done}${res.data.skipped ? `, skipped ${res.data.skipped}` : ''}`
    if (res.data.skipped) toast.info(msg)
    else toast.success(msg)
  }

  return (
    <div className="flex gap-2">
      <Button data-testid="ta-group-claim" size="sm" loading={busy === 'claim'} disabled={busy !== ''} onClick={() => run('claim')}>
        Claim group
      </Button>
      <Button
        data-testid="ta-group-resolve"
        size="sm"
        variant="secondary"
        loading={busy === 'resolve'}
        disabled={busy !== ''}
        onClick={() => run('resolve')}
      >
        Resolve group
      </Button>
    </div>
  )
}
