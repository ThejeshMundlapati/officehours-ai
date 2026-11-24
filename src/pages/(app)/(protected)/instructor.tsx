/**
 * Instructor console (Phase 2). Admin only — the app owner is auto-admin.
 *
 * Shows the TA invite code (read live from the admin-only `settings`
 * collection), a rotate button, and the staff list with per-TA removal.
 * Non-admins get a "not authorized" message.
 */

import { useState } from 'react'
import { useQuery, useUser } from 'deepspace'
import { Button, useToast } from '@/components/ui'
import { callAction } from '@/lib/actions'
import type { Staff } from '@/lib/types'
import MaterialsSection from '@/components/MaterialsSection'
import MaterialsDiagnostic from '@/components/MaterialsDiagnostic'

const INVITE_CODE_RECORD_ID = 'ta_invite_code'

export default function InstructorPage() {
  const { user } = useUser()
  const isAdmin = user?.role === 'admin'

  const { records: settings } = useQuery<{ key: string; value: string }>('settings')
  const { records: staff } = useQuery<Staff>('staff')
  const toast = useToast()
  const [rotating, setRotating] = useState(false)
  const [removingId, setRemovingId] = useState('')

  if (!isAdmin) {
    return (
      <div className="min-h-full text-foreground">
        <div className="mx-auto max-w-2xl px-6 py-20">
          <div
            data-testid="instructor-forbidden"
            className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground"
          >
            Not authorized. This page is for instructors.
          </div>
        </div>
      </div>
    )
  }

  const codeRow = settings.find((r) => r.recordId === INVITE_CODE_RECORD_ID)
  const code = codeRow ? String(codeRow.data.value) : '—'

  async function rotate() {
    setRotating(true)
    const res = await callAction('rotateInviteCode')
    setRotating(false)
    if (res.success) toast.success('Invite code rotated', 'The previous code no longer works.')
    else toast.error('Could not rotate', res.error)
  }

  async function remove(id: string) {
    setRemovingId(id)
    const res = await callAction('removeStaff', { userId: id })
    setRemovingId('')
    if (res.success) toast.success('TA removed')
    else toast.error('Could not remove', res.error)
  }

  return (
    <div className="min-h-full text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="mb-8 text-3xl font-bold tracking-tight">Instructor</h1>

        <section className="mb-8 rounded-lg border border-border bg-card p-6">
          <h2 className="mb-1 text-lg font-semibold">TA invite code</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Share this with your TAs. Rotating it immediately invalidates the old one.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <code
              data-testid="invite-code"
              className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm tracking-widest"
            >
              {code}
            </code>
            <Button
              data-testid="rotate-code"
              variant="secondary"
              loading={rotating}
              disabled={rotating}
              onClick={rotate}
            >
              Rotate code
            </Button>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-3 text-lg font-semibold">Staff</h2>
          {staff.length === 0 ? (
            <p data-testid="staff-empty" className="text-sm text-muted-foreground">
              No TAs yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {staff.map((r) => (
                <li
                  key={r.recordId}
                  data-testid="staff-row"
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">
                      {String(r.data.displayName || r.recordId)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {String(r.data.rank || 'ta')}
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    loading={removingId === r.recordId}
                    disabled={removingId === r.recordId}
                    onClick={() => remove(r.recordId)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <MaterialsSection />
        {/* TEMPORARY — remove with diagnoseMaterials */}
        <MaterialsDiagnostic />
      </div>
    </div>
  )
}
