/**
 * Online staff, derived from usePresence() (sdk-reference/client/realtime):
 * `users` is the room roster ({ id, name, role, lastSeenAt }), `isOnline(id)`
 * is true while the user's 60-second heartbeat is fresher than the timeout
 * (default 5 minutes). "Staff" = a row in `staff` (readable by every member)
 * or the admin role (the instructor).
 */

import { useMemo } from 'react'
import { usePresence, useQuery } from 'deepspace'
import type { Staff } from '@/lib/types'

export interface OnlineStaffMember {
  id: string
  name: string
  isInstructor: boolean
}

export function useOnlineStaff(): OnlineStaffMember[] {
  const { users, isOnline } = usePresence()
  const { records: staff } = useQuery<Staff>('staff')
  return useMemo(() => {
    const staffIds = new Set(staff.map((r) => r.recordId))
    return users
      .filter((u) => (staffIds.has(u.id) || u.role === 'admin') && isOnline(u.id))
      .map((u) => ({ id: u.id, name: u.name || 'TA', isInstructor: u.role === 'admin' }))
      .sort((a, b) => a.name.localeCompare(b.name))
    // isOnline is re-created on the hook's 30s tick, so it re-evaluates here.
  }, [users, isOnline, staff])
}

/** "N TAs online" line for the student queue page. */
export function StaffOnlineCount() {
  const online = useOnlineStaff()
  const n = online.length
  return (
    <p data-testid="staff-online-count" className="text-sm text-muted-foreground">
      <span
        className={`mr-1.5 inline-block h-2 w-2 rounded-full ${n > 0 ? 'bg-success' : 'bg-muted-foreground/40'}`}
        aria-hidden
      />
      {n === 0 ? 'No TAs online right now' : `${n} TA${n === 1 ? '' : 's'} online`}
    </p>
  )
}

/** Online staff list for the TA page. */
export function StaffOnlineList() {
  const online = useOnlineStaff()
  return (
    <section data-testid="staff-online-list" className="mb-6 rounded-lg border border-border bg-card px-4 py-3">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Staff online ({online.length})
      </p>
      {online.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody else is online.</p>
      ) : (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {online.map((s) => (
            <li key={s.id} data-testid="staff-online" className="flex items-center gap-1.5 text-foreground">
              <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
              {s.name}
              {s.isInstructor && <span className="text-xs text-muted-foreground">(instructor)</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
