/**
 * Unit tests for the materials actions' CHECK ORDER, which the e2e suite can't
 * reach: pooled test accounts are members, so they stop at the admin gate and
 * never get to input validation. Here the caller is the app owner (admin via
 * env.OWNER_USER_ID), and `knowledge()` is a spy that must never be called for
 * invalid input.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const kb = vi.hoisted(() => ({
  add: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  search: vi.fn(),
}))
const knowledgeFactory = vi.hoisted(() => vi.fn(() => kb))

vi.mock('deepspace/worker', () => ({
  isAnonymousUserId: (id: string) => !id || id.startsWith('anon'),
  resolveAppRole: vi.fn(async () => 'member'),
  knowledge: knowledgeFactory,
  KnowledgeError: class KnowledgeError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message)
    }
  },
}))

import {
  uploadMaterial,
  deleteMaterial,
  refreshMaterials,
  searchMaterials,
  diagnoseMaterials,
  diagnoseSearchBatch,
  DIAG_BATCH_QUERIES,
  syncPendingMaterials,
} from './materials'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { MATERIAL_TEXT_MAX_BYTES } from '../lib/materials'

const OWNER = 'owner-1'
const env = { OWNER_USER_ID: OWNER } as unknown as Env

function fakeTools(): ActionTools {
  const ok = async () => ({ success: true, data: { records: [], count: 0, recordId: 'r1' } })
  return {
    create: vi.fn(ok),
    update: vi.fn(ok),
    remove: vi.fn(ok),
    deleteWhere: vi.fn(ok),
    get: vi.fn(ok),
    query: vi.fn(ok),
    integration: vi.fn(ok),
    registerUser: vi.fn(ok),
  } as unknown as ActionTools
}

function call(handler: typeof uploadMaterial, userId: string, params: Record<string, unknown>) {
  return handler({ userId, params, tools: fakeTools(), env, callerJwt: 'jwt' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('admin gate comes first', () => {
  it.each([
    ['uploadMaterial', uploadMaterial, { filename: 'bad.exe', text: 'x' }],
    ['deleteMaterial', deleteMaterial, { materialId: 'm1' }],
    ['refreshMaterials', refreshMaterials, {}],
    ['searchMaterials', searchMaterials, { query: 'late policy' }],
    ['diagnoseMaterials', diagnoseMaterials, { query: 'late policy' }],
    ['diagnoseSearchBatch', diagnoseSearchBatch, {}],
  ] as const)('%s refuses a member with forbidden and never touches knowledge', async (_n, h, params) => {
    const res = await call(h, 'member-1', params)
    expect(res).toMatchObject({ success: false, code: 'forbidden' })
    expect(knowledgeFactory).not.toHaveBeenCalled()
  })

  it('refuses anonymous callers', async () => {
    const res = await call(uploadMaterial, 'anon-123', { filename: 'a.md', text: 'x' })
    expect(res).toMatchObject({ success: false, code: 'anonymous' })
  })
})

describe('uploadMaterial input validation (as admin) refuses before any knowledge call', () => {
  it.each([
    ['wrong extension', { filename: 'notes.pdf', text: 'hello' }],
    ['no extension', { filename: 'README', text: 'hello' }],
    ['double extension ending in exe', { filename: 'syllabus.md.exe', text: 'hello' }],
    ['oversize text', { filename: 'big.md', text: 'a'.repeat(MATERIAL_TEXT_MAX_BYTES + 1) }],
    ['oversize multibyte text', { filename: 'big.txt', text: 'é'.repeat(MATERIAL_TEXT_MAX_BYTES / 2 + 1) }],
    ['empty text', { filename: 'empty.md', text: '   ' }],
    ['filename too long', { filename: `${'a'.repeat(130)}.md`, text: 'hello' }],
    ['non-string text', { filename: 'a.md', text: 42 }],
  ])('%s → invalid_input', async (_label, params) => {
    const res = await call(uploadMaterial, OWNER, params)
    expect(res).toMatchObject({ success: false, code: 'invalid_input' })
    expect(knowledgeFactory).not.toHaveBeenCalled()
    expect(kb.add).not.toHaveBeenCalled()
  })

  it('a valid upload sanitizes the name and calls add with folder course', async () => {
    kb.add.mockResolvedValueOnce({ items: [{ id: 'item-1', key: 'course/My-Notes.md', status: 'queued' }] })
    const res = await call(uploadMaterial, OWNER, { filename: '../dir/My Notes!.MD', text: '# hi' })
    expect(res).toMatchObject({ success: true, data: { knowledgeItemId: 'item-1', status: 'queued' } })
    const [file, opts] = kb.add.mock.calls[0] as [File, { folder: string }]
    expect(file.name).toBe('My-Notes.md')
    expect(opts).toEqual({ folder: 'course' })
  })
})

describe('searchMaterials input validation (as admin)', () => {
  it('empty query → invalid_input without a knowledge call', async () => {
    const res = await call(searchMaterials, OWNER, { query: '   ' })
    expect(res).toMatchObject({ success: false, code: 'invalid_input' })
    expect(kb.search).not.toHaveBeenCalled()
  })
})

describe('diagnoseSearchBatch (as admin)', () => {
  it('runs 5 variants × 4 queries with folder course, limit 5, threshold 0', async () => {
    kb.search.mockResolvedValue({ chunks: [], queryKind: 'text' })
    const res = await call(diagnoseSearchBatch, OWNER, {})
    expect(res.success).toBe(true)
    expect(kb.search).toHaveBeenCalledTimes(5 * DIAG_BATCH_QUERIES.length)
    const opts = kb.search.mock.calls.map((c) => c[1] as Record<string, unknown>)
    for (const o of opts) expect(o).toMatchObject({ folder: 'course', limit: 5, matchThreshold: 0 })
    const combos = new Set(opts.map((o) => `${o.mode}/${o.queryRewrite}`))
    expect(combos).toEqual(
      new Set(['hybrid/false', 'semantic/false', 'fulltext/false', 'hybrid/true', 'semantic/true']),
    )
  })
})

describe('syncPendingMaterials', () => {
  it('makes no knowledge call when nothing is pending', async () => {
    const store = { listByStatus: vi.fn(async () => []), update: vi.fn() }
    const res = await syncPendingMaterials(store, kb)
    expect(res).toEqual({ pending: 0, updated: 0 })
    expect(kb.list).not.toHaveBeenCalled()
  })

  it('updates only changed pending rows', async () => {
    const rows = {
      queued: [{ recordId: 'm1', data: { knowledgeItemId: 'i1', status: 'queued', chunksCount: 0 } }],
      running: [{ recordId: 'm2', data: { knowledgeItemId: 'i2', status: 'running', chunksCount: 0 } }],
    } as Record<string, unknown[]>
    const store = {
      listByStatus: vi.fn(async (s: string) => rows[s] ?? []),
      update: vi.fn(async () => {}),
    }
    kb.list.mockResolvedValueOnce({
      items: [
        { id: 'i1', key: 'course/a.md', status: 'completed', chunksCount: 4 },
        { id: 'i2', key: 'course/b.md', status: 'running', chunksCount: 0 },
      ],
      page: 1,
      perPage: 50,
      totalPages: 1,
    })
    const res = await syncPendingMaterials(store as never, kb)
    expect(store.update).toHaveBeenCalledTimes(1)
    expect(store.update).toHaveBeenCalledWith('m1', { status: 'completed', chunksCount: 4 })
    expect(res).toEqual({ pending: 1, updated: 1 })
    expect(kb.list).toHaveBeenCalledWith({ folder: 'course', page: 1, perPage: 50 })
  })
})
