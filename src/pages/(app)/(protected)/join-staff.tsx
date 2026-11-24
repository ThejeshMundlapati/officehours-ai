/**
 * Join as TA (Phase 2). A signed-in member enters the invite code; on success
 * `joinAsStaff` adds them to `staff` and backfills open questions, then we route
 * to /ta. The code is compared server-side — nothing about it is exposed here.
 */

import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Input, Label, useToast } from '@/components/ui'
import { callAction } from '@/lib/actions'

export default function JoinStaffPage() {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy || code.trim().length === 0) return
    setBusy(true)
    const res = await callAction('joinAsStaff', { code })
    setBusy(false)
    if (res.success) {
      toast.success('You are now a TA')
      navigate('/ta')
    } else {
      toast.error('Could not join', res.error)
    }
  }

  return (
    <div className="min-h-full text-foreground">
      <div className="mx-auto max-w-md px-6 py-20">
        <h1 className="mb-2 text-2xl font-bold tracking-tight">Join as TA</h1>
        <p className="mb-8 text-sm text-muted-foreground">
          Enter the invite code your instructor gave you.
        </p>
        <form
          data-testid="join-form"
          onSubmit={onSubmit}
          className="space-y-4 rounded-lg border border-border bg-card p-6"
        >
          <div className="space-y-1.5">
            <Label htmlFor="code">Invite code</Label>
            <Input
              id="code"
              data-testid="join-code-input"
              value={code}
              autoComplete="off"
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. ABCD2345EFGHJK"
            />
          </div>
          <Button type="submit" data-testid="join-submit" disabled={busy || code.trim().length === 0} loading={busy}>
            Join
          </Button>
        </form>
      </div>
    </div>
  )
}
