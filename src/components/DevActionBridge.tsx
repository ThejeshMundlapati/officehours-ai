/**
 * DEV-only bridge: exposes `callAction` on `window.__callAction` so e2e tests
 * can invoke a server action as the signed-in user (to exercise paths the UI
 * deliberately hides). Mounted only under `import.meta.env.DEV`
 * (see (app)/(protected)/_layout.tsx), so it is tree-shaken from production.
 */
import { useEffect } from 'react'
import { callAction } from '@/lib/actions'

export default function DevActionBridge() {
  useEffect(() => {
    const w = window as unknown as { __callAction?: typeof callAction }
    w.__callAction = callAction
    return () => {
      delete w.__callAction
    }
  }, [])
  return null
}
