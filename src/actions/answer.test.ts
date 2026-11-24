/**
 * Unit tests for the answer-question job core. Knowledge search and the model
 * call are injected fakes — no platform, no credits.
 */
import { describe, expect, it, vi } from 'vitest'

// answer.ts imports these at module level; the core under test never calls them.
vi.mock('deepspace/worker', () => ({
  buildCronContext: vi.fn(),
  createDeepSpaceAI: vi.fn(),
  knowledge: vi.fn(),
}))
vi.mock('ai', () => ({ generateText: vi.fn() }))

import {
  answerQuestion,
  buildRetrievalQueries,
  expireStalePendingAnswers,
  extractKeywords,
  MAX_FALLBACK_KEYWORDS,
  retrieveWithFallback,
  parseModelReply,
  retrieve,
  RETRIEVAL_QUERY_MAX,
  STALE_PENDING_MS,
  type AnswerDeps,
  type QuestionRow,
} from './answer'
import type { Question } from '../lib/types'

type Chunk = { id: string; score: number; text: string; filename?: string; key?: string }

function question(overrides: Partial<Question> = {}): QuestionRow {
  return {
    recordId: 'q1',
    data: {
      studentId: 's1',
      title: 'count_paths is slow',
      body: 'My recursion takes forever for 16x16.',
      topic: '',
      status: 'waiting',
      studentName: 'S',
      claimedBy: '',
      groupId: '',
      queuePosition: 1,
      peopleAhead: 0,
      collaborators: [],
      createdAt: new Date().toISOString(),
      aiStatus: 'pending',
      ...overrides,
    },
  }
}

function harness(opts: {
  row?: QuestionRow | null
  chunksPerQuery?: Chunk[][]
  reply?: { text: string; finishReason?: string } | Error
}) {
  let row = opts.row === undefined ? question() : opts.row
  const updates: Array<Partial<Question>> = []
  let call = 0
  const search = {
    search: vi.fn(async () => ({ chunks: opts.chunksPerQuery?.[call++] ?? [] })),
  }
  const generate = vi.fn(async () => {
    if (opts.reply instanceof Error) throw opts.reply
    return { text: opts.reply?.text ?? '', finishReason: opts.reply?.finishReason ?? 'stop' }
  })
  const logs: string[] = []
  const deps: AnswerDeps = {
    store: {
      getQuestion: vi.fn(async () => row),
      updateQuestion: vi.fn(async (_id: string, patch: Partial<Question>) => {
        updates.push(patch)
        if (row) row = { ...row, data: { ...row.data, ...patch } }
      }),
    },
    search: search as unknown as AnswerDeps['search'],
    generate,
    log: (l) => logs.push(l),
  }
  return { deps, search, generate, updates, logs, current: () => row }
}

const hit = (filename: string, score: number, text = `text of ${filename}`): Chunk => ({
  id: `${filename}-${score}`,
  filename,
  score,
  text,
})

describe('answerQuestion', () => {
  it('no hits → not_covered and NO model call', async () => {
    const h = harness({ chunksPerQuery: [[], [], []] })
    expect(await answerQuestion('q1', h.deps)).toBe('not_covered')
    expect(h.generate).not.toHaveBeenCalled()
    expect(h.updates).toEqual([{ aiStatus: 'not_covered', aiReason: 'no_hits', aiAnswer: '', aiCitations: [] }])
    expect(h.current()?.data.status).toBe('waiting') // still in line
  })

  it('filters hallucinated citations and keeps only retrieved filenames', async () => {
    const h = harness({
      chunksPerQuery: [[hit('hw3-recursion.md', 0.6)], [hit('faq.md', 0.9)], []],
      reply: {
        text: JSON.stringify({
          covered: true,
          answer: 'Memoize count_paths with a dictionary; see Problem 3 part (b).',
          citations: ['faq.md', 'secret-solutions.md', 'hw3-recursion.md', 'faq.md'],
        }),
      },
    })
    expect(await answerQuestion('q1', h.deps)).toBe('answered')
    const patch = h.updates.at(-1)!
    expect(patch.aiStatus).toBe('answered')
    expect(patch.status).toBe('ai_answered')
    expect(patch.aiCitations).toEqual(['faq.md', 'hw3-recursion.md'])
    expect(patch.aiReason).toBe('answered')
  })

  it('only hallucinated citations → not_covered', async () => {
    const h = harness({
      chunksPerQuery: [[hit('faq.md', 0.9)]],
      reply: { text: JSON.stringify({ covered: true, answer: 'x', citations: ['made-up.md'] }) },
    })
    expect(await answerQuestion('q1', h.deps)).toBe('not_covered')
    expect(h.updates.at(-1)!.aiReason).toBe('no_valid_citations')
  })

  it('covered=false → not_covered', async () => {
    const h = harness({
      chunksPerQuery: [[hit('faq.md', 0.9)]],
      reply: { text: JSON.stringify({ covered: false, answer: 'Not in materials.', citations: ['faq.md'] }) },
    })
    expect(await answerQuestion('q1', h.deps)).toBe('not_covered')
    expect(h.updates.at(-1)!.aiReason).toBe('model_not_covered')
  })

  it('malformed JSON → error, question keeps its place, log has no student text', async () => {
    const h = harness({ chunksPerQuery: [[hit('faq.md', 0.9)]], reply: { text: 'Sure! Here is my answer: {oops' } })
    expect(await answerQuestion('q1', h.deps)).toBe('error')
    expect(h.updates).toEqual([{ aiStatus: 'error', aiReason: 'parse_error' }])
    expect(h.current()?.data.status).toBe('waiting')
    expect(h.logs.join('\n')).not.toMatch(/count_paths is slow|recursion takes forever|oops/)
  })

  it('model throws → error', async () => {
    const h = harness({ chunksPerQuery: [[hit('faq.md', 0.9)]], reply: new Error('upstream 500') })
    expect(await answerQuestion('q1', h.deps)).toBe('error')
    expect(h.updates.at(-1)!.aiReason).toBe('model_error')
  })

  it("finishReason 'length' → error", async () => {
    const h = harness({
      chunksPerQuery: [[hit('faq.md', 0.9)]],
      reply: { text: '{"covered": true, "answer": "trunc', finishReason: 'length' },
    })
    expect(await answerQuestion('q1', h.deps)).toBe('error')
    expect(h.updates.at(-1)!.aiReason).toBe('model_finish')
  })

  it('search throws → error without a model call', async () => {
    const h = harness({})
    h.search.search.mockRejectedValueOnce(new Error('knowledge down'))
    expect(await answerQuestion('q1', h.deps)).toBe('error')
    expect(h.updates.at(-1)!.aiReason).toBe('retrieve_error')
    expect(h.generate).not.toHaveBeenCalled()
  })

  it.each([
    ['missing question', null],
    ['not pending', question({ aiStatus: 'answered' })],
    ['left the queue', question({ status: 'left' })],
    ['solved', question({ status: 'solved' })],
  ])('skips when %s (idempotent; no search, no model, no write)', async (_l, row) => {
    const h = harness({ row })
    expect(await answerQuestion('q1', h.deps)).toBe('skipped')
    expect(h.search.search).not.toHaveBeenCalled()
    expect(h.generate).not.toHaveBeenCalled()
    expect(h.updates).toEqual([])
  })

  it('a claimed question is answered but stays claimed (never pushed back in line)', async () => {
    const h = harness({
      row: question({ status: 'claimed' }),
      chunksPerQuery: [[hit('faq.md', 0.9)]],
      reply: { text: JSON.stringify({ covered: true, answer: 'See FAQ 8.', citations: ['faq.md'] }) },
    })
    expect(await answerQuestion('q1', h.deps)).toBe('answered')
    expect(h.updates.at(-1)!.status).toBeUndefined()
  })

  it('does not write if the student left while the model was running', async () => {
    const h = harness({
      chunksPerQuery: [[hit('faq.md', 0.9)]],
      reply: { text: JSON.stringify({ covered: true, answer: 'x', citations: ['faq.md'] }) },
    })
    h.generate.mockImplementationOnce(async () => {
      await h.deps.store.updateQuestion('q1', { status: 'left' }) // simulate leaveQueue
      return { text: JSON.stringify({ covered: true, answer: 'x', citations: ['faq.md'] }), finishReason: 'stop' }
    })
    expect(await answerQuestion('q1', h.deps)).toBe('skipped')
    expect(h.current()?.data.status).toBe('left')
    expect(h.current()?.data.aiStatus).toBe('pending')
  })
})

describe('retrieval', () => {
  it('unions by filename, keeping each file’s best score', async () => {
    const h = harness({
      chunksPerQuery: [
        [hit('faq.md', 0.4, 'faq-low'), hit('hw3-recursion.md', 0.7)],
        [hit('faq.md', 0.95, 'faq-high')],
        [hit('syllabus.md', 0.3), hit('hw3-recursion.md', 0.2)],
      ],
    })
    const docs = await retrieve(h.search as never, ['a', 'b', 'c'])
    expect(docs.map((d) => [d.filename, d.score])).toEqual([
      ['faq.md', 0.95],
      ['hw3-recursion.md', 0.7],
      ['syllabus.md', 0.3],
    ])
    expect(docs[0].text).toBe('faq-high')
  })

  it('searches title, body, and title+body with the agreed options', async () => {
    const h = harness({ chunksPerQuery: [[], [], []] })
    await retrieve(h.search as never, buildRetrievalQueries('T', 'B'))
    expect(h.search.search.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['T', 'B', 'T\nB'])
    for (const c of h.search.search.mock.calls) {
      expect((c as unknown[])[1]).toEqual({
        folder: 'course',
        mode: 'hybrid',
        limit: 5,
        matchThreshold: 0,
        queryRewrite: false,
      })
    }
  })

  it('caps each query and drops duplicates/empties', () => {
    const long = 'x'.repeat(RETRIEVAL_QUERY_MAX + 500)
    const qs = buildRetrievalQueries(long, '')
    expect(qs.length).toBe(1)
    expect(qs[0].length).toBe(RETRIEVAL_QUERY_MAX)
  })
})

describe('parseModelReply', () => {
  it('accepts fenced JSON and rejects wrong types', () => {
    expect(parseModelReply('```json\n{"covered":true,"answer":"a","citations":["f.md"]}\n```')).toEqual({
      covered: true,
      answer: 'a',
      citations: ['f.md'],
    })
    expect(parseModelReply('{"covered":"yes","answer":"a","citations":[]}')).toBeNull()
    expect(parseModelReply('no json here')).toBeNull()
  })
})

describe('expireStalePendingAnswers', () => {
  it('flips only pending answers older than the threshold', async () => {
    const now = Date.parse('2026-11-24T12:00:00Z')
    const records = {
      query: vi.fn(async () => [
        { recordId: 'old', data: { createdAt: new Date(now - STALE_PENDING_MS - 1000).toISOString() } },
        { recordId: 'new', data: { createdAt: new Date(now - 60_000).toISOString() } },
      ]),
      update: vi.fn(async () => ({})),
    }
    expect(await expireStalePendingAnswers(records as never, now)).toBe(1)
    expect(records.query).toHaveBeenCalledWith('questions', { where: { aiStatus: 'pending' }, limit: 200 })
    expect(records.update).toHaveBeenCalledWith('questions', 'old', { aiStatus: 'error', aiReason: 'expired' })
  })
})

describe('extractKeywords', () => {
  it('drops stopwords and short words, keeps identifiers intact, max 4', () => {
    const kw = extractKeywords(
      'HW3 count_paths memoized solution',
      'Write the complete memoized count_paths code for me so I can submit it.',
    )
    expect(kw).toEqual(['count_paths', 'memoized', 'solution', 'complete'])
    expect(kw.length).toBeLessThanOrEqual(MAX_FALLBACK_KEYWORDS)
    for (const stop of ['write', 'the', 'for', 'me', 'so', 'can', 'it', 'hw3']) expect(kw).not.toContain(stop)
  })

  it('prefers identifiers (snake_case, letter+digit, camelCase), then longer words', () => {
    expect(extractKeywords('Why is maxDepth wrong in tree2 and also count_paths', 'recursion recursion')).toEqual([
      'count_paths',
      'maxDepth',
      'tree2',
      'recursion',
    ])
  })

  it('de-duplicates case-insensitively and returns [] when nothing qualifies', () => {
    expect(extractKeywords('Midterm midterm MIDTERM', '')).toEqual(['midterm'])
    expect(extractKeywords('can you help me', 'what is it?')).toEqual([])
  })

  it('caps at 4 even with many candidates', () => {
    expect(extractKeywords('alpha bravo charlie delta echoes foxtrot golfing hotel', '').length).toBe(4)
  })
})

describe('retrieveWithFallback', () => {
  it('does NOT run the fallback when the 3-query union has a hit', async () => {
    const search = { search: vi.fn(async (q: string) => ({ chunks: q === 'T' ? [hit('faq.md', 0.5)] : [] })) }
    const r = await retrieveWithFallback(search as never, 'T', 'B')
    expect(r.usedFallback).toBe(false)
    expect(r.searches).toBe(3)
    expect(search.search).toHaveBeenCalledTimes(3)
    expect(r.docs.map((d) => d.filename)).toEqual(['faq.md'])
  })

  it('runs one search per keyword ONLY when the union is empty, then unions by filename', async () => {
    const title = 'HW3 count_paths memoized solution'
    const body = 'Write the complete memoized count_paths code for me so I can submit it.'
    const byQuery: Record<string, Chunk[]> = {
      memoized: [hit('hw3-recursion.md', 0.4)],
      count_paths: [hit('hw3-recursion.md', 0.7), hit('faq.md', 0.3)],
    }
    const search = { search: vi.fn(async (q: string) => ({ chunks: byQuery[q] ?? [] })) }
    const r = await retrieveWithFallback(search as never, title, body)
    expect(r.usedFallback).toBe(true)
    expect(r.searches).toBe(3 + 4)
    expect(search.search).toHaveBeenCalledTimes(7)
    const keywordCalls = search.search.mock.calls.slice(3).map((c) => (c as unknown[])[0])
    expect(keywordCalls).toEqual(['count_paths', 'memoized', 'solution', 'complete'])
    for (const c of search.search.mock.calls.slice(3)) {
      expect((c as unknown[])[1]).toEqual({
        folder: 'course',
        mode: 'hybrid',
        limit: 5,
        matchThreshold: 0,
        queryRewrite: false,
      })
    }
    expect(r.docs.map((d) => [d.filename, d.score])).toEqual([
      ['hw3-recursion.md', 0.7],
      ['faq.md', 0.3],
    ])
  })

  it('never exceeds 3 + 4 searches', async () => {
    const search = { search: vi.fn(async () => ({ chunks: [] })) }
    const long = Array.from({ length: 40 }, (_, i) => `keyword${i}xx`).join(' ')
    const r = await retrieveWithFallback(search as never, long, long + ' extra words here')
    expect(search.search.mock.calls.length).toBeLessThanOrEqual(7)
    expect(r.searches).toBe(search.search.mock.calls.length)
  })
})

describe('answerQuestion — fallback + observability', () => {
  it('fallback hit leads to a model call and an answered reason', async () => {
    const h = harness({
      row: question({ title: 'HW3 count_paths memoized solution', body: 'Write the complete code for me.' }),
      chunksPerQuery: [[], [], [], [hit('hw3-recursion.md', 0.6)]],
      reply: {
        text: JSON.stringify({ covered: true, answer: 'See Problem 3 (b); memoize with a dict.', citations: ['hw3-recursion.md'] }),
      },
    })
    expect(await answerQuestion('q1', h.deps)).toBe('answered')
    expect(h.generate).toHaveBeenCalledTimes(1)
    expect(h.updates.at(-1)!.aiReason).toBe('answered')
  })

  it('emits exactly one INFO line with reason, files, finishReason — and no student text or keywords', async () => {
    const h = harness({
      row: question({ title: 'Secret count_paths title', body: 'Private memoized body words' }),
      chunksPerQuery: [[hit('hw3-recursion.md', 0.6)], [hit('faq.md', 0.4)]],
      reply: { text: JSON.stringify({ covered: false, answer: '', citations: [] }) },
    })
    await answerQuestion('q1', h.deps)
    expect(h.logs).toHaveLength(1)
    const line = h.logs[0]
    expect(line).toContain('q=q1')
    expect(line).toContain('reason=model_not_covered')
    expect(line).toContain('files=2 [hw3-recursion.md,faq.md]')
    expect(line).toContain('finish=stop')
    expect(line).toContain('fallback=false')
    expect(line).not.toMatch(/Secret|Private|memoized|count_paths/)
  })

  it('logs a skipped line (and writes nothing) when the job is not applicable', async () => {
    const h = harness({ row: question({ aiStatus: 'answered' }) })
    await answerQuestion('q1', h.deps)
    expect(h.logs).toEqual([expect.stringContaining('reason=skipped')])
    expect(h.updates).toEqual([])
  })
})
