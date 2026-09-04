---
title: 'Your First Vitest Test'
module: 12
lesson: 2
teaches: [vitest, unit-testing, esm-test-runner, pure-functions, test-colocation, coverage]
produces: ['next-app/vitest.config.ts', 'next-app/src/lib/graphql/tags.test.ts', 'next-app/src/lib/graphql/errors.test.ts']
requires: [12.1, 10.3, 10.4]
---

# Lesson 12.2 — Your First Vitest Test

## Quick Overview

A unit test is a function that calls your function and asserts something about the result.
That is the entire concept, and the whole of this lesson's novelty is in the plumbing around
it: where the file lives, how the runner finds it, what a good assertion looks like, and how
to read a failure. You will start with the two most testable modules in the repo — the cache-tag
builders from Lesson 10.3 and the error mapper from Lesson 10.4 — because both are pure
functions, and pure functions are where unit tests pay for themselves immediately.

**Vitest, not Jest**, and the reason is concrete rather than fashionable. This project is
native ESM end to end, and two dependencies it will acquire — `next-intl` in Module 20 and MSW
v2 in Module 23 — publish ESM only. Jest would need a Babel or SWC transform pipeline
configured, maintained and debugged in order to import them, and that pipeline is a permanent
tax paid to make a test runner accept modern JavaScript. Vitest reads your `tsconfig.json`
paths, understands ESM natively, and shares Vite's transform pipeline. The lesson also teaches
the part most tutorials skip: making a test fail on purpose, reading the diff output, and
noticing that a test you have never seen fail is not yet a test.

By the end of this lesson you will have:

- `next-app/vitest.config.ts` with the `@/*` path alias resolving and a `node` test environment
- `next-app/src/lib/graphql/tags.test.ts` — tags asserted against the exact strings Module 18's webhook will send
- `next-app/src/lib/graphql/errors.test.ts` — including the HTTP-200-with-`errors` case from Lesson 10.4
- `npm test` and `npm run test:watch` scripts, plus coverage reporting configured but not yet gated
- One test broken on purpose, its failure output read, and the code fixed rather than the assertion

## Classic WP Analogy

You have already written unit tests. They were called `test.php` and you deleted them
afterwards:

| What you did in WordPress | What a unit test is |
|---|---|
| A scratch `test.php` you hit in the browser | a test file, saved and named |
| `wp eval 'var_dump(btt_blame_score(3, 90));'` | `expect(blameScore(3, 90)).toBe(…)` |
| `error_log(print_r($result, true))` then reload | an assertion the runner checks for you |
| "let me try it with an empty value" | a second `it()` case |
| Running it once, then never again | the runner running it on every change |
| PHPUnit, if you were disciplined | Vitest — Module 23 adds Pest on the PHP side |

The instinct is already correct. When you `wp eval` a function with three different inputs to
see what it does, you are unit testing. The only things missing are that nobody else can run
it, nothing tells you when it stops being true, and the expected answer lives in your head
rather than in the file.

The analogy breaks on **isolation**, and it is the break that changes how you write code. Your
`wp eval` runs inside a booted WordPress with a real database, so it can call anything —
`get_post()`, `get_option()`, a REST endpoint — and it works. A unit test cannot: there is no
WordPress, no database, no network, and no server. If a function needs any of those, it cannot
be unit tested without mocking, and mocking is expensive enough that the better answer is
usually to restructure the function so the impure part is somewhere else. That constraint is
the actual benefit of this lesson. `buildIncidentTag(slug)` is trivially testable because it
takes a string and returns a string; the reason it takes a string and returns a string is
partly that Lesson 10.3 was written by someone who knew this lesson was coming.

The second break: `wp eval` runs against your real content, so it tests your data as much as
your code. A unit test that touches real data is not a unit test — it is a slow, flaky
integration test, and it will fail on a colleague's machine for reasons that have nothing to do
with the code. Anything genuinely needing WordPress goes to Playwright (Lesson 12.3) or to the
PHP integration suite in Module 23. Knowing which of the three a given test belongs in is the
scope table you wrote in Lesson 12.1.

---

## Key Concepts

<!-- TODO: Phase B -->

---

## Task

<!-- TODO: Phase B -->

---

## Verification

<!-- TODO: Phase B -->

## Control Questions

<!-- TODO: Phase B -->

## Learn More

<!-- TODO: Phase B -->
