/**
 * Student queue page (Phase 1).
 *
 * Students submit one open question and watch it live. All writes go through
 * server actions (src/actions/questions.ts) because members have
 * create/update:false on `questions`.
 *
 * Read scoping: the page queries `where: { studentId: me }` AND filters again
 * client-side, so even an admin/instructor (who has `read:true` and would
 * otherwise receive every row) only ever sees their OWN question here.
 */

import { useMemo, useState, type FormEvent } from 'react'
import { useQuery, useMutations, useUser } from 'deepspace'
import { Button, Input, Textarea, Label, Badge, useToast } from '@/components/ui'
import { callAction } from '@/lib/actions'
import { StaffOnlineCount } from '@/components/StaffPresence'
import {
  QUESTION_OPEN_STATUSES,
  TITLE_MAX,
  BODY_MAX,
  TOPIC_MAX,
  type Question,
  type QuestionStatus,
  type QueueStats,
} from '@/lib/types'

const STATUS_LABEL: Record<QuestionStatus, string> = {
  waiting: 'Waiting',
  ai_answered: 'AI answered — still in line',
  claimed: 'Claimed by a TA',
  solved: 'Solved',
  left: 'Left',
}

export default function QueuePage() {
  const { user } = useUser()
  const myId = user?.id ?? ''

  // Memoize so the subscription isn't torn down and rebuilt every render.
  const queryOptions = useMemo(() => ({ where: { studentId: myId } }), [myId])
  const { records, status } = useQuery<Question>('questions', queryOptions)
  const { records: statsRecords } = useQuery<QueueStats>('queue_stats')
  const { ready } = useMutations<Question>('questions')
  const toast = useToast()

  const waitingCount = Number(statsRecords.find((r) => r.recordId === 'global')?.data.waitingCount ?? 0)

  const [title, setTitle] = useState('')
  const [topic, setTopic] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [feedbackBusy, setFeedbackBusy] = useState<'' | 'solved' | 'help'>('')

  // Defense in depth: never surface a row that isn't the signed-in user's own,
  // regardless of what the server returned for their role.
  const open = records.find(
    (r) => r.data.studentId === myId && QUESTION_OPEN_STATUSES.includes(r.data.status),
  )

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    const res = await callAction('submitQuestion', { title, body, topic })
    setSubmitting(false)
    if (res.success) {
      setTitle('')
      setTopic('')
      setBody('')
      toast.success('Question submitted', 'You are in the queue.')
    } else {
      toast.error('Could not submit', res.error)
    }
  }

  async function onLeave() {
    if (!open || leaving) return
    setLeaving(true)
    const res = await callAction('leaveQueue', { questionId: open.recordId })
    setLeaving(false)
    if (res.success) toast.info('Left the queue', 'Your question was removed.')
    else toast.error('Could not leave', res.error)
  }

  async function onSolved() {
    if (!open || feedbackBusy) return
    setFeedbackBusy('solved')
    const res = await callAction('markSolved', { questionId: open.recordId })
    setFeedbackBusy('')
    if (res.success) toast.success('Glad it helped!', 'Your question is marked solved.')
    else toast.error('Could not update', res.error)
  }

  async function onNeedHelp() {
    if (!open || feedbackBusy) return
    setFeedbackBusy('help')
    const res = await callAction('stillNeedHelp', { questionId: open.recordId })
    setFeedbackBusy('')
    if (res.success) toast.info('Got it', 'You keep your place — a TA will help you.')
    else toast.error('Could not update', res.error)
  }

  const canSubmit = ready && !submitting && title.trim().length > 0 && body.trim().length > 0

  return (
    <div data-testid="queue-page" className="min-h-full text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="mb-2 text-3xl font-bold tracking-tight">Office hours queue</h1>
        <p className="mb-1 text-sm text-muted-foreground">
          Ask one question at a time. You&rsquo;ll see its status update live.
        </p>
        <p data-testid="waiting-count" className="mb-1 text-sm text-muted-foreground">
          {waitingCount} student{waitingCount === 1 ? '' : 's'} waiting
        </p>
        <div className="mb-10">
          <StaffOnlineCount />
        </div>

        {status === 'loading' ? (
          <div data-testid="queue-loading" className="text-sm text-muted-foreground">
            Loading&hellip;
          </div>
        ) : (
          <div data-testid="queue-ready">
            {open ? (
              <section
                data-testid="open-question"
                className="rounded-lg border border-border bg-card p-6"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 data-testid="open-question-title" className="text-lg font-semibold">
                    {open.data.title}
                  </h2>
                  <Badge data-testid="open-question-status">{STATUS_LABEL[open.data.status]}</Badge>
                </div>
                {open.data.status === 'claimed' ? (
                  <p data-testid="queue-position" className="mb-3 text-sm font-medium text-foreground">
                    {open.data.claimedByName
                      ? `A TA (${String(open.data.claimedByName)}) is with you.`
                      : 'A TA is with you.'}
                  </p>
                ) : Number(open.data.queuePosition) > 0 ? (
                  <p data-testid="queue-position" className="mb-3 text-sm font-medium text-foreground">
                    You&rsquo;re #{Number(open.data.queuePosition)} — {Number(open.data.peopleAhead) || 0} ahead of you
                  </p>
                ) : (
                  <p data-testid="queue-position" className="mb-3 text-sm font-medium text-foreground">
                    Finding your place in line&hellip;
                  </p>
                )}
                {open.data.topic ? (
                  <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                    {open.data.topic}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap text-sm text-foreground">{open.data.body}</p>
                <AiPanel
                  question={open.data}
                  busy={feedbackBusy}
                  onSolved={onSolved}
                  onNeedHelp={onNeedHelp}
                />
                <Button
                  data-testid="leave-button"
                  variant="destructive"
                  className="mt-6"
                  disabled={leaving}
                  loading={leaving}
                  onClick={onLeave}
                >
                  Leave queue
                </Button>
              </section>
            ) : (
              <form
                data-testid="submit-form"
                onSubmit={onSubmit}
                className="space-y-5 rounded-lg border border-border bg-card p-6"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="q-title">Title</Label>
                  <Input
                    id="q-title"
                    data-testid="input-title"
                    value={title}
                    maxLength={TITLE_MAX}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Short summary of your question"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="q-topic">Topic (optional)</Label>
                  <Input
                    id="q-topic"
                    data-testid="input-topic"
                    value={topic}
                    maxLength={TOPIC_MAX}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g. Pointers, Recursion"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="q-body">Question</Label>
                  <Textarea
                    id="q-body"
                    data-testid="input-body"
                    value={body}
                    maxLength={BODY_MAX}
                    rows={5}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Describe what you&rsquo;re stuck on"
                  />
                </div>
                <Button
                  type="submit"
                  data-testid="submit-button"
                  disabled={!canSubmit}
                  loading={submitting}
                >
                  Join the queue
                </Button>
              </form>
            )}
          </div>
        )}

        {import.meta.env.DEV && <DevTools role={user?.role ?? 'unknown'} />}
      </div>
    </div>
  )
}

/** The AI-answer area inside the student's open-question card. */
function AiPanel({
  question,
  busy,
  onSolved,
  onNeedHelp,
}: {
  question: Question
  busy: '' | 'solved' | 'help'
  onSolved: () => void
  onNeedHelp: () => void
}) {
  const status = question.aiStatus
  if (!status) return null
  const box = 'mt-5 rounded-md border border-border bg-background p-4 text-sm'

  if (status === 'pending') {
    return (
      <div data-testid="ai-pending" className={`${box} flex items-center gap-2 text-muted-foreground`}>
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
        Checking the course materials&hellip;
      </div>
    )
  }
  if (status === 'not_covered') {
    return (
      <div data-testid="ai-not-covered" className={`${box} text-muted-foreground`}>
        Not covered in the course materials — a TA will help you.
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div data-testid="ai-error" className={`${box} text-muted-foreground`}>
        Couldn&rsquo;t check the materials — you&rsquo;re still in line.
      </div>
    )
  }

  const citations = Array.isArray(question.aiCitations) ? question.aiCitations : []
  const askedForHelp = question.aiFeedback === 'needs_help'
  return (
    <div data-testid="ai-answer" className={box}>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        From the course materials
      </p>
      <p data-testid="ai-answer-text" className="whitespace-pre-wrap text-foreground">
        {question.aiAnswer}
      </p>
      {citations.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {citations.map((c) => (
            <Badge key={c} data-testid="ai-citation" variant="outline" className="font-mono">
              {c}
            </Badge>
          ))}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          data-testid="ai-solved"
          size="sm"
          loading={busy === 'solved'}
          disabled={busy !== ''}
          onClick={onSolved}
        >
          This solved it
        </Button>
        {askedForHelp ? (
          <span data-testid="ai-help-requested" className="text-xs text-muted-foreground">
            A TA will still help you — you keep your place.
          </span>
        ) : (
          <Button
            data-testid="ai-need-help"
            size="sm"
            variant="secondary"
            loading={busy === 'help'}
            disabled={busy !== ''}
            onClick={onNeedHelp}
          >
            Still need help
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * DEV-only tooling, tree-shaken out of production builds (`import.meta.env.DEV`):
 *  - an RBAC probe that proves a DIRECT client create is rejected — the result
 *    is shown next to the signed-in user's platform ROLE, because a direct
 *    create only fails for non-admin roles (admins have create:true).
 *
 * The `window.__callAction` test bridge is mounted separately in the protected
 * layout (src/components/DevActionBridge.tsx), also DEV-only.
 */
function DevTools({ role }: { role: string }) {
  const { createConfirmed, ready } = useMutations<Question>('questions')
  const [result, setResult] = useState('')

  async function run() {
    setResult('')
    try {
      await createConfirmed({
        studentId: 'probe',
        title: 'probe',
        body: 'probe',
        topic: '',
        status: 'waiting',
        studentName: 'probe',
        claimedBy: '',
        groupId: '',
        queuePosition: 0,
        peopleAhead: 0,
        collaborators: [],
        createdAt: '',
      })
      setResult('create-succeeded')
    } catch {
      setResult('create-rejected')
    }
  }

  return (
    <div className="mt-10 border-t border-dashed border-border pt-4 text-xs text-muted-foreground">
      <p className="mb-2">DEV tools (not shipped to production):</p>
      <button
        data-testid="rbac-probe-create"
        type="button"
        disabled={!ready}
        onClick={run}
        className="rounded-md border border-border px-3 py-1.5 disabled:opacity-50"
      >
        Attempt direct create
      </button>
      <span data-testid="rbac-probe-result" className="ml-3 font-mono">
        {result}
      </span>
      <span data-testid="rbac-probe-role" className="ml-3 font-mono">
        role: {role}
      </span>
    </div>
  )
}
