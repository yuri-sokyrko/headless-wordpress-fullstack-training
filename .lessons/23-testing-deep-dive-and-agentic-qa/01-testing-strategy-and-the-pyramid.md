---
title: 'Testing Strategy & the Pyramid'
module: 23
lesson: 1
teaches: [test-pyramid, rsc-testing-rule, test-boundaries, coverage-policy, five-suites]
produces: ['docs/testing-strategy.md']
requires: [12.1, 18.3]
---

# Lesson 23.1 — Testing Strategy & the Pyramid

## Quick Overview

You have two applications, two languages, one API contract between them and a cache in the
middle. Every one of those seams is a place a bug can live, and none of them is testable by the
same tool. So before writing another test, decide what goes where: five suites, each with a
stated job, a stated cost and a stated thing it is *not* responsible for. Vitest unit tests for
pure functions and sync client components. Vitest with MSW for anything that talks to
WPGraphQL. Pest for PHP logic with WordPress mocked. `wp-phpunit` for anything that needs a real
WordPress and a real database. Playwright for whatever only exists once all of it is running
together. Write it down in `docs/testing-strategy.md`, because a strategy that lives in
somebody's head produces a suite where the same behaviour is tested four times and the
interesting behaviour is tested nowhere.

One rule dominates the whole module and gets stated here first, in full, because it will save
you an afternoon:

> **The RSC testing rule.** If a component is `async`, or reads `cookies()` or `headers()`, do
> **not** unit-test the component. Unit-test the `lib/` function it awaits, and cover the
> rendered output in Playwright. Nobody can render an async Server Component through React
> Testing Library — RTL renders with `react-dom`, which has no server component runtime, no way
> to await a component function, and no request context to read cookies from. This is not a
> configuration gap. It is what those components *are*.

That rule is not a limitation to work around; it is a design instruction. It pushes logic out of
components and into `lib/` functions that are trivial to test, which is where it should have been
anyway. Lesson 23.3 shows what that looks like in practice.

By the end of this lesson you will have:

- `docs/testing-strategy.md` — five suites, each with its job, its tool, its speed and what it
  explicitly does not cover
- The RSC testing rule written down with the reasoning, so nobody re-litigates it in a pull request
- A decision table mapping every kind of code in the repo to exactly one suite
- A coverage policy: patch coverage rather than total, with a threshold and a list of excluded paths
- A flake policy: what quarantining means, where a quarantined test lives, and that the required
  CI set contains none
- The test-command surface — `npm test`, `npm run test:e2e`, `composer test:unit`,
  `composer test:integration` — with one command that runs everything

## Classic WP Analogy

Be honest about the starting point: most Classic WordPress work has no test suite. Not because
WordPress developers do not care, but because the platform makes it expensive. Global state,
`$wpdb` everywhere, plugin code that runs on `init` and touches the network, no dependency
injection, and a template layer where logic and markup are the same file. The pragmatic Classic
testing strategy was: a staging site, a checklist, and a colleague clicking through it.

| Classic WordPress habit | This module's equivalent |
|---|---|
| Click through staging before release | Playwright E2E, on every pull request |
| "It works on my machine" | The Compose stack plus a deterministic seeder |
| A `var_dump()` and a page refresh | A failing unit test that names the expectation |
| `WP_DEBUG` and the error log | Structured assertions, plus Sentry in Lesson 24.3 |
| Manually re-checking after a plugin update | The integration suite in Lesson 23.5 |
| A colleague reviewing the PR by reading it | The same, plus the gates in Lesson 24.5 |

Where the analogy breaks is not the tooling, it is **what changed to make testing worth it**.
The reason Classic WordPress testing felt like ceremony is that the units were not units — you
could not test `the_content()` filtering without a database, a post, and half of core loaded.
Here, the data layer is a typed function that takes variables and returns a shape; a Server
Action is a function that takes a `FormData` and returns a result; a block component is a
function of props. Those are cheap to test, so testing them stops being discipline and starts
being the fastest way to work.

The second break is a genuinely new problem: **the contract between two codebases**. In Classic
WordPress there was no contract, because there was no boundary — a template read post meta
directly and a typo was a blank space on the page. Now a renamed ACF field key in PHP silently
becomes `null` in TypeScript, at runtime, in production. Nothing in Classic testing practice
prepares you for that, and it is why Lesson 23.5 spends its second half on schema and
field-group contract tests rather than on more resolver coverage.

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
