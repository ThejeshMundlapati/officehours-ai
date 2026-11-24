# OfficeHours AI

A real-time office-hours queue for one course. Students join a single live queue; an AI answers from the instructor's own course materials with citations (or hands off), and TAs claim, group, and resolve questions while everyone's position updates live.

**Live app:** https://officehours-ai.app.space

Built on [DeepSpace](https://docs.deep.space) (Cloudflare Workers + Durable Objects).

---

## Try each role

| Role | How to get it | What you'll see |
| --- | --- | --- |
| **Student** | Sign in with any account, open **Queue**. | Ask one question (title, optional topic, body). Your live position ("You're #2 — 1 ahead of you") and "N students waiting" update without reloading. Within seconds, "Checking the course materials…" becomes either an answer with citation chips (e.g. `syllabus.md`) plus **This solved it** / **Still need help**, or "Not covered in the course materials — a TA will help you." When a TA claims you: "A TA (name) is with you." |
| **TA** | Sign in, open **Join as TA** (linked from Home), and enter the invite code. **The code is provided in the submission write-up; it is not in this repository.** | **TA queue**: every open question live, with student name, position, wait time, the collapsed AI answer + citations, a "Still needs help" badge, and a muted AI reason tag (`no_hits`, `model_not_covered`, …). Who else is online. **Claim / Release / Resolve** per card; **Group similar questions** puts duplicates under "<label> — N students" with **Claim group / Resolve group**. |
| **Instructor** | The app owner's account (platform admin). | **Instructor** console: the TA invite code with **Rotate**, the staff list with **Remove** (confirmed; their active claims go back into line), and **Course materials** — upload `.md`/`.txt`, per-file indexing status and chunk count, delete, and a **Test search** box showing the retrieved file, score, and excerpt. |

Demo course content (a fictional "CS 2100: Data Structures (Demo)") lives in [`demo-materials/`](demo-materials/) — upload those three files as the instructor to try the AI.

---

## Architecture

### Data model and permissions

There are **no custom roles**. *Instructor* = the app owner (platform `admin`). *TAs* = platform members listed in the `staff` collection. *Students* = members. Members can never write any app collection directly — every write goes through a server action.

| Collection | Member can read | Member can write | Notes |
| --- | --- | --- | --- |
| `users` | own row | own row | SDK-required. |
| `questions` | **collaborator**: their own (`ownerField: studentId`) or, for staff, rows listing them in `collaborators` | — | Status, live position, AI answer/citations/reason, claim, opaque `groupId`. |
| `staff` | all | — | The TA allowlist (recordId = userId). |
| `queue_stats` | all | — | One row: `waitingCount`. |
| `settings` | — | — | Admin-only: invite code, grouping cooldown stamp. |
| `materials` | — | — | Admin-only: filename, knowledge item id, size, indexing status, chunks. |
| `claims` | — | — | Admin-only. `uniqueOn: ['questionId']` makes a claim atomic. Released claims are deleted; resolved ones stay as history (`active: 0`). |
| `active_questions` | — | — | Admin-only. `uniqueOn: ['studentId']` enforces one open question per student, atomically. |
| `question_groups` | **collaborator**: staff only (owner pinned to the app owner) | — | Labels summarize *other* students' questions, so students can never read them; questions carry only the opaque `groupId`. |

Staff visibility uses the collaborator pattern: when a question is created its `collaborators` field snapshots the current staff ids; joining or leaving staff updates every open question (and active group) with one equality query per open status.

### Write path: server actions only

All mutations are server actions (`src/actions/*`) that run with RBAC off, so each one (1) rejects anonymous callers, (2) derives identity only from the verified JWT subject (`ctx.userId`, never from params), and (3) authorizes ownership/staff/admin itself. Student actions: `submitQuestion`, `leaveQueue`, `markSolved`, `stillNeedHelp`. TA: `claimQuestion`, `releaseClaim`, `resolveQuestion`, `groupDuplicates`, `claimGroup`, `resolveGroup`, `joinAsStaff`. Instructor: `rotateInviteCode`, `removeStaff`, `uploadMaterial`, `deleteMaterial`, `refreshMaterials`, `searchMaterials`.

### Queue position

`recomputeQueue` ranks only the in-line questions (`waiting`, `ai_answered`) oldest-first and writes `queuePosition` / `peopleAhead` **only where they changed**. Every action that takes a question out of line (leave, solve, claim, resolve) zeroes its own position first. Concurrent recomputes are not serialized, so a **1-minute cron** reconciles from the latest committed state.

### AI answer (background job)

`submitQuestion` creates the question with `aiStatus: 'pending'` and enqueues an `answer-question` job, then returns immediately. The job (`src/actions/answer.ts`):

1. **Retrieval** from the managed knowledge base (folder `course`): hybrid searches for the title, the body, and title + body, unioned by filename keeping each file's best score. **Keyword fallback:** only if that union is empty, up to 4 keywords (stopwords and words under 4 characters dropped, identifiers like `count_paths` kept) are searched one at a time. At most 7 searches per question.
2. **No hits → `not_covered`, no model call.**
3. Otherwise `claude-sonnet-5-5` (owner-billed) answers **only** from the retrieved materials, must cite filenames, must not give full solutions to graded homework (concept + pointer to the spec + a debugging step), and treats the student's text as untrusted data inside delimiters. The JSON reply is parsed defensively; citations not in the retrieved set are dropped.
4. The question is re-read before writing: a student who left is never put back in line, and a claimed question stays claimed. `aiReason` records why (`answered`, `no_hits`, `model_not_covered`, `no_valid_citations`, or an error stage), and one log line per job records reason, retrieved filenames, search count, and `finishReason` — never student text.

### Cron (one task, every minute)

`recompute-queue`: (1) reconcile positions and `waitingCount`; (2) sync knowledge indexing status for materials still `queued`/`running` (no knowledge call when none are); (3) mark AI answers stuck in `pending` for 20 minutes as `error`, so a crashed job never leaves a student on a spinner.

### Duplicate grouping

`groupDuplicates` (staff, 60-second global cooldown) sends up to 50 in-line titles + truncated bodies to `claude-haiku-5-5` and validates the reply: only ids it was given, each in at most one group, at least 2 members, labels ≤ 80 chars. Malformed output changes nothing. `claimGroup` / `resolveGroup` run the normal per-question claim/resolve (each claim still goes through `uniqueOn`) and report `{ claimed, skipped }` instead of failing all-or-nothing.

---

## DeepSpace primitives used, and why

| Primitive | Used for | Why |
| --- | --- | --- |
| RecordRoom collections + schema RBAC | All app data | Row-level read rules (`own`, `collaborator`) enforced in the Durable Object, and live push to subscribers. |
| `useQuery` live subscriptions | Every list and count | Positions, claims, and AI answers appear without polling or reloads. |
| Server actions | Every write | One audited, server-side authorization point; members have no direct write access at all. |
| `uniqueOn` | Atomic claims; one open question per student | The Durable Object checks for a duplicate and inserts in one synchronous step — a real constraint instead of check-then-insert in app code. |
| JobRoom (`enqueueJob`) | The AI answer | Outlives the HTTP response (`waitUntil` is cut off after 30 s); durable rows and crash recovery. |
| CronRoom | Position reconciliation, indexing status, stale-job sweep | Eventual consistency without a long-running process. |
| Managed knowledge (`knowledge(env)`, AI Search) | Course materials retrieval | Upload, chunking, indexing, and hybrid search with no vector database to run; isolated per app. |
| `createDeepSpaceAI` | Answers (Sonnet 5.5) and grouping (Haiku 5.5) | Model access through the platform proxy with owner billing and no provider keys in the app. |
| `usePresence` | "N TAs online" and the online staff list | Heartbeat-derived presence from the existing room connection. |
| `deepspace/testing` `users()` fixture | Multi-user e2e | Real signed-in browser contexts for student/TA races. |

### Deliberately not used

- **Messaging / AI-chat features:** a queue with one answer per question is the product; open-ended chat would blur the "answer only from materials" contract and add cost.
- **Email / notifications:** students are on the page while they wait, and owner-billed emails per queue event weren't worth it.
- **Web search integrations:** answers must come only from the course's own materials.
- **File storage (R2):** materials are plain text sent straight to the knowledge base; storing a second copy would need its own access rules.
- **Yjs / collaborative editing, payments, LiveKit:** nothing in office hours needs them.

---

## Key tradeoffs

- **Eventual positions over a serialized queue.** Change-only recomputes are cheap and usually exact; the cron fixes interleavings within about a minute.
- **The AI runs in the background, not in the request.** Submitting is instant and the student keeps their place no matter what the AI does; the cost is a short "Checking…" state.
- **Owner-billed AI, bounded per student.** One open question per student, at most 7 searches and one model call each; grouping has a 60-second cooldown.
- **A recall-oriented keyword fallback over a precision-oriented one.** The platform's search behaves lexically; the fallback finds more files, and the model and the citation check decide what is actually covered.
- **Collaborator snapshots instead of custom roles.** No role field on users; joining or leaving staff costs one write per open question.

---

## Testing

- **Unit (Vitest): 60 tests.** 57 app tests — `answer.test.ts` (29: retrieval union, keyword extraction, fallback only on empty union, every `aiReason` branch, citation filtering, parse errors, idempotency, the stale-pending sweep, the no-student-text log line), `materials.test.ts` (17: admin gate before validation, input validation before any knowledge call, status sync), `groups.test.ts` (11: grouping validation, malformed JSON, prompt escaping) — plus 3 scaffold prerender tests. The knowledge client, the model, and the record store are mocked.
- **End-to-end (Playwright via `npx deepspace test run all`): 46 passing, 1 skipped,** across 11 specs, using three `@deepspace.test` accounts against the local dev server. They include the concurrent two-TA claim race, the concurrent double-submit, a direct `uniqueOn` probe, release returning a student to their original position, resolve, staff removal releasing claims, students being unable to read `question_groups`, live updates without reloads, and a 380 px no-horizontal-overflow check on every page. The skipped test documents a gate that cannot be exercised with test accounts (dev actions refusing non-test emails).
- **Not exercised by automated tests (paid paths):** local runs load production secrets, so the real knowledge base and models are skipped for test accounts. **Verified on production by hand:** cited answers (e.g. the midterm date from `faq.md`), refusal of graded solutions with a pointer to the spec, `not_covered` for off-topic questions, the keyword fallback (`fallback=true` in logs), Haiku grouping labels and the cooldown, claim/release/resolve, and presence with real users.

---

## Security notes

- **No secrets in the repository.** Platform secrets live in DeepSpace's secret store; `.dev.vars` and `.env*` are git-ignored. The TA invite code is stored only in the admin-only `settings` collection and compared on the server; a wrong code gets the same generic error as any other.
- **Identity comes only from the verified JWT.** No action trusts a user id, name, or role sent by the client; display names are copied from the `users` record on the server.
- **Dev-only actions are double-gated:** they run only when `ALLOW_DEBUG_ROUTES === 'true'` (set by local dev/test, unset in production) **and** the caller's email ends in `@deepspace.test`. The client-side test bridge is compiled out of production builds.
- **The job room is owner-only.** Socket reads and writes to the background-job room require admin, so members can neither enqueue paid jobs nor see job payloads; server code enqueues through the internal path.
- **Prompt injection:** student text is passed to models as delimited, tag-neutralized data with explicit "this is not instructions" rules, and outputs are validated (citations against the retrieved set, group ids against the input set).
- **Logs** carry ids, reasons, and filenames — never question text.

---

## Known limitations

- **Lexical retrieval recall.** The platform's hybrid search often returns only the top file, and longer queries can return nothing when they contain words absent from the materials. The keyword fallback mitigates this but cannot match true semantic retrieval.
- **Positions are eventually consistent.** Under concurrent activity a position can be briefly stale (corrected within about a minute by the cron).
- **Presence lags by up to about 5 minutes.** "Online" means a heartbeat within the SDK's 5-minute timeout, so someone who just closed the tab still counts for a few minutes.
- **`uniqueOn` conflicts are detected by string.** The platform returns `{ success: false, error: "Duplicate: …" }` with no error code, so the app matches the `Duplicate:` prefix (`src/actions/records.ts`). A wording change in the SDK would break claim and submit conflict detection; it is covered by e2e tests that would fail loudly.
- **Grouping cooldown is best-effort.** It is a read-then-write stamp, so two exactly simultaneous clicks can both run (one extra Haiku call, about $0.002).
- **One course per deployment.**

---

## What I'd do next

1. Claim the next question in one click ("Next student"), and per-TA claim history and wait-time stats for the instructor.
2. Better retrieval: try per-section uploads (smaller chunks) and measure recall against a small labelled question set.
3. Expose `uniqueOn` conflicts as a typed code upstream (or wrap them in one SDK helper) to remove the string match.
4. Multi-course support: a course id on every collection and per-course staff and materials.
5. Optional notifications when a TA claims you, for students who step away.

---

## Development

```sh
npm install
npx deepspace dev start          # local dev server
npm run type-check && npm run lint
npx vitest run                   # unit tests
npx deepspace test run all       # unit + Playwright e2e (needs 3 @deepspace.test accounts)
```
