/**
 * Navigation Config
 *
 * Add one entry per nav item. Routes are handled by generouted
 * (file-based routing in src/pages/), this just controls what
 * appears in the navigation bar.
 */

import type { Role } from './constants'

export interface NavItem {
  path: string
  label: string
  roles?: Role[]
  /** Visible only to app staff (TAs in the `staff` collection) or admins. */
  staffOnly?: boolean
  devOnly?: boolean
}

export const nav: NavItem[] = [
  { path: '/home', label: 'Home' },
  { path: '/queue', label: 'Queue' },
  { path: '/ta', label: 'TA queue', staffOnly: true },
  { path: '/instructor', label: 'Instructor', roles: ['admin'] },
  { path: '/settings', label: 'Settings' },
  // ── Features add nav items below this line ──
]
