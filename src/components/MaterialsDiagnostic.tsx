/**
 * TEMPORARY — Phase 4 search investigation. Admin-only, read-only view of
 * materials rows vs the raw knowledge list, plus side-by-side search variants.
 * Remove together with `diagnoseMaterials` / `diagnoseSearchBatch`.
 */

import { useState, type FormEvent } from 'react'
import { Button, Input, useToast } from '@/components/ui'
import { callAction } from '@/lib/actions'

interface VariantResult {
  label: string
  queryKind?: string
  count: number
  hits: Array<{ filename: string; score: number; textChars: number }>
  error?: string
}
interface QueryVariants {
  query: string
  variants: VariantResult[]
}

function VariantTable({ result }: { result: QueryVariants }) {
  return (
    <div data-testid="diag-variants" className="mt-4">
      <p className="mb-1 text-sm font-medium text-foreground">&ldquo;{result.query}&rdquo;</p>
      <table className="w-full text-left text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1 pr-3 font-medium">variant</th>
            <th className="py-1 pr-3 font-medium">queryKind</th>
            <th className="py-1 pr-3 font-medium">n</th>
            <th className="py-1 font-medium">hits (filename score)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {result.variants.map((v) => (
            <tr key={v.label} className="align-top">
              <td className="py-1 pr-3 font-mono">{v.label}</td>
              <td className="py-1 pr-3 font-mono">{v.queryKind ?? '—'}</td>
              <td className="py-1 pr-3">{v.count}</td>
              <td className="py-1 font-mono">
                {v.error ? (
                  <span className="text-destructive">{v.error}</span>
                ) : v.hits.length === 0 ? (
                  '—'
                ) : (
                  v.hits.map((h) => `${h.filename} ${h.score.toFixed(3)}`).join(', ')
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function MaterialsDiagnostic() {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)
  const [tables, setTables] = useState<QueryVariants[]>([])
  const [output, setOutput] = useState('')

  async function run(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const res = await callAction<{ search: QueryVariants | null }>(
      'diagnoseMaterials',
      query.trim() ? { query } : {},
    )
    setBusy(false)
    if (res.success) {
      setOutput(JSON.stringify(res.data, null, 2))
      setTables(res.data.search ? [res.data.search] : [])
    } else toast.error('Diagnostic failed', res.error)
  }

  async function runBatch() {
    setBatchBusy(true)
    const res = await callAction<{ results: QueryVariants[] }>('diagnoseSearchBatch')
    setBatchBusy(false)
    if (res.success) {
      setOutput(JSON.stringify(res.data, null, 2))
      setTables(res.data.results)
    } else toast.error('Batch failed', res.error)
  }

  return (
    <section data-testid="materials-diagnostic" className="mt-8 rounded-lg border border-dashed border-border bg-card p-6">
      <h2 className="mb-1 text-lg font-semibold">Knowledge diagnostic (temporary)</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Read-only. Run with no query to list materials vs knowledge items. A query runs 5 variants (folder course,
        limit 5, matchThreshold 0): hybrid, semantic, fulltext, hybrid+rewrite, semantic+rewrite.
      </p>
      <form onSubmit={run} className="flex gap-2">
        <Input
          data-testid="diag-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Optional query, e.g. when is the midterm"
        />
        <Button type="submit" data-testid="diag-run" loading={busy} disabled={busy || batchBusy}>
          Run
        </Button>
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          data-testid="diag-batch"
          loading={batchBusy}
          disabled={busy || batchBusy}
          onClick={runBatch}
        >
          Run 4-query variant batch
        </Button>
        <span className="text-xs text-muted-foreground">20 searches (16 hybrid/semantic + 4 fulltext)</span>
      </div>

      {tables.map((t) => (
        <VariantTable key={t.query} result={t} />
      ))}

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
