# CS 2100 (Demo) — Homework 3: Recursion

> Fictional demo assignment for the OfficeHours app.

- **Released:** Monday, September 21
- **Due:** Friday, October 2 at 11:59 PM (late days may be used; see syllabus)
- **Submit:** `recursion.py` to the demo autograder

## Learning goals

1. Identify a base case and a recursive case for a problem.
2. Trust the recursive call ("the recursive leap of faith").
3. Reason about the call stack and recursion depth.
4. Compare a recursive solution with an iterative one.

## Rules

- Problems 1–3 **must be recursive**. No `for` or `while` loops, and no
  built-ins that do the work for you (`sum`, `max`, `reversed`, slicing tricks
  such as `s[::-1]`).
- Helper functions are allowed if they are also recursive.
- Do not change the function signatures.

## Problem 1 — `count_digits(n)` (10 points)

Return the number of digits in a non-negative integer `n`.

```python
count_digits(0)      # 1
count_digits(7)      # 1
count_digits(2100)   # 4
```

Hint: `n // 10` removes the last digit. What is the base case?

## Problem 2 — `is_palindrome(s)` (15 points)

Return `True` if the string `s` reads the same forwards and backwards. Ignore
case, but **do not** ignore spaces or punctuation.

```python
is_palindrome("")          # True
is_palindrome("Racecar")   # True
is_palindrome("ab a")      # False
```

Use indices (`is_palindrome_helper(s, lo, hi)`) rather than creating new
substrings on every call.

## Problem 3 — `count_paths(rows, cols)` (25 points)

A robot starts in the top-left cell of a `rows × cols` grid and may only move
**right** or **down**. Return the number of distinct paths to the bottom-right
cell.

```python
count_paths(1, 1)   # 1
count_paths(2, 2)   # 2
count_paths(3, 3)   # 6
count_paths(3, 7)   # 28
```

Part (b): your plain recursive version will be slow for `count_paths(16, 16)`.
Add a memoized version `count_paths_memo(rows, cols)` using a dictionary
passed between calls. Explain in a comment why it is faster.

## Problem 4 — written (10 points)

In `answers.md`, draw the call tree for `count_paths(3, 3)` and state how many
calls the non-memoized version makes. Then give the Big-O running time of both
versions.

## Grading notes

- **Autograder (60%)**: hidden tests include `n = 0`, empty strings, and
  `1 × n` grids. A missing base case is the most common reason for failure.
- **Recursion check (20%)**: TAs read your code. Any loop in Problems 1–3 earns
  **0** for that problem, even if the tests pass.
- **Style (10%)**: clear names, a docstring per function, no dead code.
- **Written answers (10%)**: correct call count and complexity with a
  one-sentence justification.
- `RecursionError: maximum recursion depth exceeded` almost always means the
  base case is never reached — check that every recursive call moves toward it.
- Partial credit is given for a correct base case and recursive structure even
  if an off-by-one error fails some tests.
