/**
 * TEMPORARY — Phase 4 search investigation. Admin-only, read-only view of
 * materials rows vs the raw knowledge list/search. Remove with
 * `diagnoseMaterials` once the cause is fixed.
 */

import { useState, type FormEvent } from 'react'
import { Button, Input, useToast } from '@/components/ui'
import { callAction } from '@/lib/actions'

export default function MaterialsDiagnostic() {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [output, setOutput] = useState('')

  async function run(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const res = await callAction('diagnoseMaterials', query.trim() ? { query } : {})
    setBusy(false)
    if (res.success) setOutput(JSON.stringify(res.data, null, 2))
    else toast.error('Diagnostic failed', res.error)
  }

  return (
    <section data-testid="materials-diagnostic" className="mt-8 rounded-lg border border-dashed border-border bg-card p-6">
      <h2 className="mb-1 text-lg font-semibold">Knowledge diagnostic (temporary)</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Read-only. Shows materials rows next to the raw knowledge list. An optional query also runs two raw searches
        (as shipped, and with matchThreshold 0 across all folders).
      </p>
      <form onSubmit={run} className="flex gap-2">
        <Input
          data-testid="diag-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Optional query, e.g. when is the midterm"
        />
        <Button type="submit" data-testid="diag-run" loading={busy} disabled={busy}>
          Run
        </Button>
      </form>
      {output && (
        <>
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={() => navigator.clipboard?.writeText(output).then(() => toast.success('Copied'))}
          >
            Copy JSON
          </Button>
          <pre
            data-testid="diag-output"
            className="mt-3 max-h-[32rem] overflow-auto rounded-md border border-border bg-background p-3 text-xs"
          >
            {output}
          </pre>
        </>
      )}
    </section>
  )
}
