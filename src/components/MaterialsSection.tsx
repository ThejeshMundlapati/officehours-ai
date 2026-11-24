/**
 * Instructor-only "Course materials" panel (Phase 4).
 *
 * Rendered only inside the admin branch of /instructor. `materials` is
 * admin-read-only by RBAC, so a non-admin subscription would receive nothing
 * anyway. All writes go through the admin-gated server actions.
 */

import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useQuery } from 'deepspace'
import { Badge, Button, ConfirmModal, EmptyState, Input, Label, useToast, type BadgeProps } from '@/components/ui'
import { FileText } from 'lucide-react'
import { callAction } from '@/lib/actions'
import { MATERIAL_SEARCH_QUERY_MAX, MATERIAL_TEXT_MAX_BYTES, validateMaterialInput } from '@/lib/materials'
import type { Material, MaterialSearchHit, MaterialStatus } from '@/lib/types'

const STATUS_VARIANT: Record<MaterialStatus, NonNullable<BadgeProps['variant']>> = {
  queued: 'secondary',
  running: 'info',
  completed: 'success',
  error: 'destructive',
  skipped: 'warning',
  outdated: 'warning',
}

function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`
  return `${(n / 1000).toFixed(1)} KB`
}

export default function MaterialsSection() {
  const { records } = useQuery<Material>('materials')
  const toast = useToast()
  const fileInput = useRef<HTMLInputElement>(null)

  const [uploading, setUploading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; filename: string } | null>(null)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [hits, setHits] = useState<MaterialSearchHit[] | null>(null)

  const materials = useMemo(
    () => [...records].sort((a, b) => (a.data.createdAt < b.data.createdAt ? 1 : -1)),
    [records],
  )

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file || uploading) return
    const text = await file.text()
    // Instant feedback; the server action re-validates and is the real gate.
    const v = validateMaterialInput(file.name, text)
    if (!v.ok) {
      toast.error('Cannot upload', v.error)
      return
    }
    setUploading(true)
    const res = await callAction('uploadMaterial', { filename: file.name, text })
    setUploading(false)
    if (res.success) toast.success('Uploaded', `${v.filename} is being indexed.`)
    else toast.error('Upload failed', res.error)
  }

  async function onRefresh() {
    setRefreshing(true)
    const res = await callAction<{ pending: number; updated: number }>('refreshMaterials')
    setRefreshing(false)
    if (res.success) toast.info('Status refreshed', `${res.data.updated} updated, ${res.data.pending} still indexing.`)
    else toast.error('Refresh failed', res.error)
  }

  async function onDelete(id: string) {
    setDeletingId(id)
    const res = await callAction('deleteMaterial', { materialId: id })
    setDeletingId('')
    setConfirmDelete(null)
    if (res.success) toast.success('Material deleted')
    else toast.error('Delete failed', res.error)
  }

  async function onSearch(e: FormEvent) {
    e.preventDefault()
    if (searching || !query.trim()) return
    setSearching(true)
    const res = await callAction<{ hits: MaterialSearchHit[] }>('searchMaterials', { query })
    setSearching(false)
    if (res.success) setHits(res.data.hits)
    else {
      setHits(null)
      toast.error('Search failed', res.error)
    }
  }

  return (
    <section data-testid="materials-section" className="mt-8 rounded-lg border border-border bg-card p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Course materials</h2>
        <Button variant="secondary" size="sm" loading={refreshing} disabled={refreshing} onClick={onRefresh}>
          Refresh status
        </Button>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Upload .md or .txt files (max {Math.floor(MATERIAL_TEXT_MAX_BYTES / 1000)} KB). Indexing runs in the
        background; status updates within about a minute.
      </p>

      <input
        ref={fileInput}
        data-testid="materials-file-input"
        type="file"
        accept=".md,.txt,text/markdown,text/plain"
        className="hidden"
        onChange={onPick}
      />
      <Button
        data-testid="materials-upload"
        loading={uploading}
        disabled={uploading}
        onClick={() => fileInput.current?.click()}
      >
        Upload file
      </Button>

      {materials.length === 0 ? (
        <EmptyState
          data-testid="materials-empty"
          className="py-8"
          icon={<FileText />}
          title="No course materials yet"
          description="Upload a syllabus, assignment spec, or FAQ (.md or .txt). The AI answers only from these files."
        />
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {materials.map((r) => (
            <li key={r.recordId} data-testid="material-row" className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-foreground">{r.data.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(Number(r.data.sizeBytes) || 0)} · {Number(r.data.chunksCount) || 0} chunks
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Badge data-testid="material-status" variant={STATUS_VARIANT[r.data.status] ?? 'secondary'}>
                  {r.data.status}
                </Badge>
                <Button
                  variant="destructive"
                  size="sm"
                  loading={deletingId === r.recordId}
                  disabled={deletingId === r.recordId}
                  onClick={() => setConfirmDelete({ id: r.recordId, filename: String(r.data.filename) })}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && onDelete(confirmDelete.id)}
        title={`Delete “${confirmDelete?.filename ?? ''}”?`}
        description="It is removed from the knowledge base, so the AI can no longer cite it."
        confirmText="Delete"
        loading={!!deletingId}
      />

      <form onSubmit={onSearch} className="mt-6 border-t border-border pt-5">
        <Label htmlFor="materials-query">Test search</Label>
        <div className="mt-1.5 flex gap-2">
          <Input
            id="materials-query"
            data-testid="materials-query"
            value={query}
            maxLength={MATERIAL_SEARCH_QUERY_MAX}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. What is the late policy?"
          />
          <Button type="submit" data-testid="materials-search" loading={searching} disabled={searching || !query.trim()}>
            Search
          </Button>
        </div>
        {hits !== null &&
          (hits.length === 0 ? (
            <p data-testid="materials-no-hits" className="mt-3 text-sm text-muted-foreground">
              No matching chunks.
            </p>
          ) : (
            <ol className="mt-3 space-y-3">
              {hits.map((h, i) => (
                <li key={i} data-testid="material-hit" className="rounded-md border border-border bg-background p-3">
                  <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                    <span className="truncate font-mono text-foreground">{h.filename}</span>
                    <span className="shrink-0 text-muted-foreground">score {h.score.toFixed(3)}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{h.excerpt}</p>
                </li>
              ))}
            </ol>
          ))}
      </form>
    </section>
  )
}
