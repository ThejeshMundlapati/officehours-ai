/**
 * Course materials → the app's managed knowledge base (Phase 4).
 *
 * All four actions are ADMIN ONLY (the instructor). Same trust model as the
 * other actions: RBAC is off, identity is only `ctx.userId`, and the order of
 * checks is fixed — anonymous → admin → input validation → knowledge call — so
 * a refused request never reaches the (owner-billed) knowledge API.
 *
 * Knowledge API: docs.deep.space/bindings/knowledge.md and the installed
 * deepspace/dist/worker.d.ts (`KnowledgeClient`). Ingestion is asynchronous —
 * `add` only means the provider accepted the item — so `status`/`chunksCount`
 * are synced later by `syncPendingMaterials` (cron + `refreshMaterials`).
 */

import { isAnonymousUserId, knowledge, KnowledgeError } from 'deepspace/worker'
import type { ActionHandler, ActionResult, ActionTools, KnowledgeClient, KnowledgeItem } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  MATERIAL_PENDING_STATUSES,
  MATERIAL_STATUSES,
  type Material,
  type MaterialSearchHit,
  type MaterialStatus,
} from '../lib/types'
import { MATERIALS_FOLDER, MATERIAL_SEARCH_QUERY_MAX, validateMaterialInput } from '../lib/materials'
import { isAdmin } from './auth'

const asString = (v: unknown): string => (typeof v === 'string' ? v : '')
const EXCERPT_CHARS = 280
// knowledge list `perPage` must be 1..50 (docs: "Limits and validation").
const LIST_PER_PAGE = 50
// Hard stop on list pagination (50 * 20 = 1,000 items) so a bad `totalPages`
// can never loop forever.
const LIST_MAX_PAGES = 20
const PENDING_QUERY_LIMIT = 500

function asStatus(v: unknown): MaterialStatus {
  return MATERIAL_STATUSES.includes(v as MaterialStatus) ? (v as MaterialStatus) : 'queued'
}

function knowledgeFailure(err: unknown): ActionResult<never> {
  if (err instanceof KnowledgeError) {
    return { success: false, code: 'knowledge_error', error: `Knowledge base error (${err.code}): ${err.message}` }
  }
  return { success: false, code: 'knowledge_error', error: 'Knowledge base request failed.' }
}

/** Shared admin gate. Returns a refusal, or null when the caller may proceed. */
async function refuseUnlessAdmin(env: Env, userId: string): Promise<ActionResult<never> | null> {
  if (isAnonymousUserId(userId)) return { success: false, code: 'anonymous', error: 'Sign in first.' }
  if (!(await isAdmin(env, userId))) return { success: false, code: 'forbidden', error: 'Admins only.' }
  return null
}

// ── status sync (shared by cron and refreshMaterials) ───────────────────────

export interface MaterialRow {
  recordId: string
  data: Material
}

/** Minimal record access the sync needs; actions and cron supply adapters. */
export interface MaterialStore {
  listByStatus(status: MaterialStatus): Promise<MaterialRow[]>
  update(recordId: string, patch: Partial<Material>): Promise<void>
}

export function materialStoreFromTools(tools: ActionTools): MaterialStore {
  return {
    async listByStatus(status) {
      const res = await tools.query<Material>('materials', { where: { status }, limit: PENDING_QUERY_LIMIT })
      return res.success ? res.data.records.map((r) => ({ recordId: r.recordId, data: r.data })) : []
    },
    async update(recordId, patch) {
      await tools.update<Material>('materials', recordId, patch)
    },
  }
}

type CronRecords = {
  query(collection: string, opts?: { where?: Record<string, unknown>; limit?: number }): Promise<unknown[]>
  update(collection: string, recordId: string, data: Record<string, unknown>): Promise<unknown>
}

export function materialStoreFromCron(records: CronRecords): MaterialStore {
  return {
    async listByStatus(status) {
      const arr = await records.query('materials', { where: { status }, limit: PENDING_QUERY_LIMIT })
      const rows: MaterialRow[] = []
      for (const raw of arr) {
        if (!raw || typeof raw !== 'object') continue
        const rec = raw as { recordId?: unknown; data?: unknown }
        if (typeof rec.recordId !== 'string' || !rec.data || typeof rec.data !== 'object') continue
        rows.push({ recordId: rec.recordId, data: rec.data as Material })
      }
      return rows
    },
    async update(recordId, patch) {
      await records.update('materials', recordId, patch as Record<string, unknown>)
    },
  }
}

/**
 * Update status/chunksCount on materials still queued/running. Does NOTHING —
 * no knowledge call at all — when no row is pending, so the 1-minute cron is
 * free in the steady state. Only rows whose values changed are written.
 */
export async function syncPendingMaterials(
  store: MaterialStore,
  kb: Pick<KnowledgeClient, 'list'>,
): Promise<{ pending: number; updated: number }> {
  const pending: MaterialRow[] = []
  for (const status of MATERIAL_PENDING_STATUSES) pending.push(...(await store.listByStatus(status)))
  if (pending.length === 0) return { pending: 0, updated: 0 }

  const byId = new Map<string, KnowledgeItem>()
  for (let page = 1; page <= LIST_MAX_PAGES; page++) {
    const res = await kb.list({ folder: MATERIALS_FOLDER, page, perPage: LIST_PER_PAGE })
    for (const item of res.items) byId.set(item.id, item)
    const totalPages = res.totalPages ?? (res.items.length < LIST_PER_PAGE ? page : page + 1)
    if (page >= totalPages || res.items.length === 0) break
  }

  let updated = 0
  let stillPending = 0
  for (const row of pending) {
    const item = byId.get(row.data.knowledgeItemId)
    if (!item) {
      stillPending++
      continue
    }
    const status = asStatus(item.status)
    const chunksCount = typeof item.chunksCount === 'number' ? item.chunksCount : Number(row.data.chunksCount) || 0
    if (status !== row.data.status || chunksCount !== row.data.chunksCount) {
      await store.update(row.recordId, { status, chunksCount })
      updated++
    }
    if (MATERIAL_PENDING_STATUSES.includes(status)) stillPending++
  }
  return { pending: stillPending, updated }
}

// ── actions ─────────────────────────────────────────────────────────────────

/** uploadMaterial({ filename, text }) — admin only. */
export const uploadMaterial: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const refused = await refuseUnlessAdmin(env, userId)
  if (refused) return refused

  const v = validateMaterialInput(params.filename, params.text)
  if (!v.ok) return { success: false, code: 'invalid_input', error: v.error }

  // Same key in the same folder would collide in the knowledge base.
  const dup = await tools.query<Material>('materials', { where: { filename: v.filename }, limit: 1 })
  if (dup.success && dup.data.records.length > 0) {
    return { success: false, code: 'already_exists', error: `"${v.filename}" is already uploaded. Delete it first.` }
  }

  const kb = knowledge(env)
  let item: KnowledgeItem | undefined
  try {
    const file = new File([params.text as string], v.filename, { type: v.mimeType })
    const added = await kb.add(file, { folder: MATERIALS_FOLDER })
    item = added.items[0]
  } catch (err) {
    return knowledgeFailure(err)
  }
  if (!item) return { success: false, code: 'knowledge_error', error: 'Knowledge base returned no item.' }

  const created = await tools.create<Material>('materials', {
    filename: v.filename,
    knowledgeItemId: item.id,
    sizeBytes: v.sizeBytes,
    status: asStatus(item.status),
    chunksCount: typeof item.chunksCount === 'number' ? item.chunksCount : 0,
    uploadedBy: userId,
    createdAt: new Date().toISOString(),
  })
  if (!created.success) {
    // Don't leave an orphaned, billed-for-storage item with no row pointing at it.
    try {
      await kb.remove(item.id)
    } catch {
      /* best effort */
    }
    return created
  }
  return {
    success: true,
    data: { recordId: created.data.recordId, knowledgeItemId: item.id, status: asStatus(item.status) },
  }
}

/** deleteMaterial({ materialId }) — admin only: remove from knowledge, then the row. */
export const deleteMaterial: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const refused = await refuseUnlessAdmin(env, userId)
  if (refused) return refused

  const materialId = asString(params.materialId)
  if (!materialId) return { success: false, code: 'invalid_input', error: 'Missing materialId.' }

  const got = await tools.get<Material>('materials', materialId)
  if (!got.success) return { success: false, code: 'not_found', error: 'Material not found.' }

  const itemId = asString(got.data.record.data.knowledgeItemId)
  if (itemId) {
    try {
      await knowledge(env).remove(itemId)
    } catch (err) {
      // Already gone upstream → still delete our row; anything else → keep it
      // so the instructor can retry rather than orphan the item.
      if (!(err instanceof KnowledgeError && err.status === 404)) return knowledgeFailure(err)
    }
  }

  const removed = await tools.remove('materials', materialId)
  if (!removed.success) return removed
  return { success: true, data: { recordId: materialId } }
}

/** refreshMaterials() — admin only: on-demand run of the cron status sync. */
export const refreshMaterials: ActionHandler<Env> = async ({ userId, tools, env }) => {
  const refused = await refuseUnlessAdmin(env, userId)
  if (refused) return refused
  try {
    const result = await syncPendingMaterials(materialStoreFromTools(tools), knowledge(env))
    return { success: true, data: result }
  } catch (err) {
    return knowledgeFailure(err)
  }
}

/** searchMaterials({ query }) — admin only, for verifying retrieval before the AI phase. */
export const searchMaterials: ActionHandler<Env> = async ({ userId, params, env }) => {
  const refused = await refuseUnlessAdmin(env, userId)
  if (refused) return refused

  const query = asString(params.query).trim()
  if (query.length < 1 || query.length > MATERIAL_SEARCH_QUERY_MAX) {
    return { success: false, code: 'invalid_input', error: `Query must be 1–${MATERIAL_SEARCH_QUERY_MAX} characters.` }
  }

  try {
    const res = await knowledge(env).search(query, { folder: MATERIALS_FOLDER, mode: 'hybrid', limit: 5 })
    const hits: MaterialSearchHit[] = res.chunks.map((c) => {
      const text = c.text.replace(/\s+/g, ' ').trim()
      return {
        filename: c.filename || (c.key ? c.key.split('/').pop() ?? c.key : 'unknown'),
        score: c.score,
        excerpt: text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}…` : text,
      }
    })
    return { success: true, data: { hits } }
  } catch (err) {
    return knowledgeFailure(err)
  }
}

export const materialActions: Record<string, ActionHandler<Env>> = {
  uploadMaterial,
  deleteMaterial,
  refreshMaterials,
  searchMaterials,
}
