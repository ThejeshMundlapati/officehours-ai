/**
 * Design Direction — OfficeHours AI landing
 *
 * Brief
 *   Product: a live office-hours queue for one course; an AI answers from the
 *     instructor's own materials with citations, or hands off to a TA.
 *   Emotion: relief — "I'm in line, I know where I stand, and I might not even
 *     need to wait."
 *   Visual metaphor: the handout and the blackboard — paper, ink, chalk.
 *   References: a printed course syllabus; a library call-number slip; a
 *     departure board showing your place.
 *   Signature element: the student's own queue card, rendered in code, with
 *     the live position and a cited answer.
 *   Hero visual: that card, slightly lifted, beside the headline.
 *
 * Style Tile
 *   Color: `chalk` theme tokens only (paper + blackboard green / chalk amber).
 *   Type pair: bookish system serif for headings, system sans for UI.
 *   Theme: light and dark follow the OS (prefers-color-scheme).
 *   Art direction: typographic, ruled lines, numbered steps — no stock art.
 *   Motion personality: still. No continuous animation.
 *   Voice: plain, specific, a TA talking to a student. No hype words.
 *
 * STATIC page: lives at the top level of src/pages/, so no DeepSpace providers
 * mount — no auth fetch, no records WebSocket (guarded by smoke.spec.ts). It
 * is prerendered at build; keep it free of window/document during render.
 */

import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, GraduationCap, KeyRound, Users } from 'lucide-react'
import { Seo } from '../components/Seo'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

const STEPS = [
  {
    title: 'A student asks one question',
    body: 'They join a single live queue and see their exact place in line, updating as others are helped.',
  },
  {
    title: 'AI checks the course materials',
    body: 'It answers only from what the instructor uploaded and cites the file it used. Graded homework gets a hint and a pointer to the spec, never a solution. If the materials don’t cover it, it says so and the student keeps their place.',
  },
  {
    title: 'A TA claims and resolves',
    body: 'TAs see the queue live, claim a question (two TAs can’t grab the same one), group duplicates to help several students at once, and resolve.',
  },
]

const ROLES = [
  {
    icon: GraduationCap,
    name: 'Student',
    how: 'Sign in with any account and open the queue.',
    sees: 'Your question, your live position, the AI answer with citations, and which TA is with you.',
  },
  {
    icon: Users,
    name: 'Teaching assistant',
    how: 'Sign in, then enter the TA invite code on the “Join as TA” page. The code is in the submission write-up — it is deliberately not published here.',
    sees: 'Every open question in real time, who else is online, Claim / Release / Resolve, and AI duplicate grouping.',
  },
  {
    icon: KeyRound,
    name: 'Instructor',
    how: 'The app owner’s account.',
    sees: 'The invite code and its rotation, the staff list, course-material uploads, and a retrieval test box.',
  },
]

function QueueCardPreview() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-sm">
      <div className="absolute inset-0 translate-x-2 translate-y-2 rounded-lg border border-border bg-secondary" />
      <div className="relative rounded-lg border border-border bg-card p-5 text-left shadow-sm">
        <div className="mb-3 flex items-start justify-between gap-3">
          <p className="font-display text-lg font-semibold leading-snug text-card-foreground">
            count_paths is slow for 16×16
          </p>
          <span className="shrink-0 rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground">
            In line
          </span>
        </div>
        <p className="mb-4 text-sm font-medium text-foreground">You’re #3 — 2 ahead of you</p>
        <div className="rounded-md border border-border bg-background p-3">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            From the course materials
          </p>
          <p className="text-sm text-foreground">
            Your recursion recomputes the same sub-grids. Problem 3(b) asks for a memoized version — store each
            (rows, cols) result in a dictionary first.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-foreground">
              hw3-recursion.md
            </span>
            <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-foreground">
              faq.md
            </span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">This solved it</span>
          <span className="rounded-md bg-secondary px-3 py-1.5 font-medium text-secondary-foreground">
            Still need help
          </span>
        </div>
      </div>
    </div>
  )
}

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background text-foreground">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
          <span className="font-display text-lg font-semibold tracking-tight">{APP_NAME}</span>
          <Link
            to="/home"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-foreground underline-offset-4 hover:underline"
          >
            Open the app
          </Link>
        </header>

        <main>
          <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-8 sm:px-6 md:grid-cols-2 md:pt-16">
            <div>
              <p className="mb-4 text-sm font-medium uppercase tracking-widest text-primary">Office hours, organized</p>
              <h1 className="mb-5 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
                Office hours, minus the hallway line.
              </h1>
              <p className="mb-8 max-w-lg text-lg text-muted-foreground">
                One live queue for your course. An AI answers from your own course materials — with citations — and
                hands everything else to a TA.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <Link
                  to="/home"
                  data-testid="landing-cta"
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Enter the app
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <a href="#how-it-works" className="text-sm font-medium text-foreground underline-offset-4 hover:underline">
                  How it works
                </a>
              </div>
            </div>
            <QueueCardPreview />
          </section>

          <section id="how-it-works" className="border-t border-border">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
              <h2 className="mb-10 text-3xl font-semibold tracking-tight">How it works</h2>
              <ol className="divide-y divide-border border-y border-border">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="grid gap-2 py-6 sm:grid-cols-[5rem_16rem_1fr] sm:gap-6">
                    <span className="font-display text-4xl font-semibold leading-none text-primary">{i + 1}</span>
                    <h3 className="text-lg font-semibold">{s.title}</h3>
                    <p className="max-w-2xl text-muted-foreground">{s.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section id="reviewers" data-testid="landing-reviewers" className="border-t border-border bg-card">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
              <div className="mb-8 flex items-center gap-3">
                <BookOpen className="h-5 w-5 text-primary" aria-hidden />
                <h2 className="text-3xl font-semibold tracking-tight">For reviewers</h2>
              </div>
              <p className="mb-8 max-w-2xl text-muted-foreground">
                The app has three roles. Try them in separate browser profiles to watch the queue update live between
                a student and a TA.
              </p>
              <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
                {ROLES.map(({ icon: Icon, name, how, sees }) => (
                  <div key={name} className="bg-background p-6">
                    <dt className="mb-3 flex items-center gap-2 font-semibold">
                      <Icon className="h-4 w-4 text-primary" aria-hidden />
                      {name}
                    </dt>
                    <dd className="mb-3 text-sm text-foreground">{how}</dd>
                    <dd className="text-sm text-muted-foreground">{sees}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <section className="border-t border-border">
            <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-14 sm:px-6 md:flex-row md:items-center">
              <p className="font-display max-w-xl text-2xl font-semibold tracking-tight">
                Get in line, or get to work helping the line move.
              </p>
              <Link
                to="/home"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                Enter the app
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </section>
        </main>

        <footer className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-muted-foreground sm:px-6">
            {APP_NAME} · Demo course content is fictional.
          </div>
        </footer>
      </div>
    </>
  )
}
