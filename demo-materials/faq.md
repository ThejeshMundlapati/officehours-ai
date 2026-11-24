# CS 2100 (Demo) — Frequently Asked Questions

> Fictional demo FAQ for the OfficeHours app.

### 1. How do I get help at office hours?

Open the OfficeHours app during a scheduled session and join the queue with one
question. Give it a specific title (for example, "HW3 count_paths returns 0 for
2×2") and describe what you already tried. Your live position in line is shown
on the page.

### 2. Can I join the queue with more than one question?

No. You can have one open question at a time. When a TA finishes with you, you
may rejoin with your next question.

### 3. How many late days do I have, and how do they work?

You have 4 late days per semester for homework only, with at most 2 on any one
assignment. Each late day is 24 hours and is applied automatically. After they
are used up, late homework loses 20% per day and is not accepted after 2 days.

### 4. Can I use a late day on a quiz or exam?

No. Late days apply only to homework. Missing a quiz or exam requires a
documented emergency arranged in advance with the instructor.

### 5. When are the exams and what can I bring?

The midterm is Wednesday, October 14, in lecture. The final is Thursday,
December 10, 1:00–3:00 PM. Both are closed-book; you may bring one
double-sided, handwritten page of notes.

### 6. My recursive function raises `RecursionError`. What does that mean?

Your function keeps calling itself without reaching a base case. Check that the
base case covers the smallest input (such as `n == 0` or an empty string) and
that every recursive call moves closer to it (for example, `n // 10` or
`lo + 1, hi - 1`).

### 7. Can I use a loop inside a helper function on Homework 3?

No. For Problems 1–3, helpers must also be recursive. Any loop earns 0 for that
problem even if the autograder tests pass.

### 8. Why is my `count_paths` so slow for big grids?

The plain recursive version recomputes the same subproblems many times, so it
takes exponential time. Memoize: store each `(rows, cols)` result in a
dictionary and return it if you have seen that pair before.

### 9. Will a TA tell me whether my code will get full marks?

No. TAs help you understand concepts and debug, but they do not pre-grade
submissions. Use the provided public tests and write your own edge cases.

### 10. What happens if I'm not there when a TA calls me?

If you do not respond within 3 minutes, your question is closed and you can
rejoin at the back of the queue.
