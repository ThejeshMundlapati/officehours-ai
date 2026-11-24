/**
 * Theme catalog (metadata only — colour values live in src/themes.css).
 *
 * OfficeHours AI ships one theme, `chalk`, whose palette follows the OS
 * light/dark setting via `prefers-color-scheme`: warm paper + blackboard
 * green in light mode, blackboard + amber chalk in dark mode.
 */

export const THEMES = [
  {
    id: 'chalk',
    label: 'Chalk',
    description: 'Paper and ink by day, blackboard and chalk by night. Follows the OS colour scheme.',
  },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

/** Read the currently active theme id from <html data-theme>. */
export function getActiveTheme(): ThemeId {
  if (typeof document === 'undefined') return 'chalk'
  const id = document.documentElement.getAttribute('data-theme') as ThemeId | null
  return id ?? 'chalk'
}

/** Look up a theme entry by id, or fall back to the first theme. */
export function getTheme(id: string) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
