---
title: 'Why Tests When You Have a Staging Site'
module: 12
lesson: 1
teaches: [test-strategy, test-pyramid, regression-cost, deploy-risk, test-scope-table]
produces: []
requires: [11.5]
---

# Lesson 12.1 — Why Tests When You Have a Staging Site

## Quick Overview

You have shipped WordPress sites for years without an automated test, and they worked. That is
not a confession, it is evidence — Classic WordPress made manual QA a rational strategy, and
this lesson explains exactly why, and exactly which of those conditions this stack has removed.
Three of them are gone: there is now a build step between your source and what runs, a deploy is
an immutable artifact rather than an editable file on a server, and the application is split
across two systems that can disagree with each other. Manual QA has not become immoral; it has
become insufficient.

This is the only reading-heavy lesson in Phase 2 and it produces no code. What it produces is a
decision: a written scope table saying what is tested by which suite, and — just as important —
what is deliberately not tested at all. Testing everything is how test suites become the thing
people delete. The lesson also settles the toolchain arguments before they cost you time:
Vitest rather than Jest, Playwright rather than Cypress, and no snapshot tests of rendered
markup anywhere in this codebase.

By the end of this lesson you will have:

- A written scope table: Vitest, Playwright, PHPUnit, Verification blocks, and manual review, each with what it owns
- A list of the five most expensive things that can break in Blame The Tech, mapped to the cheapest suite that would catch each
- A written "do not test" list, with a reason per line
- The Vitest-over-Jest and Playwright-over-Cypress decisions recorded, with the ESM argument spelled out
- An honest estimate of what the suites in this module will and will not catch, so Module 23 has a starting point

## Classic WP Analogy

The Classic WordPress deploy-and-verify ritual is a test suite. It is just executed by a human:

| Classic WordPress ritual | Automated equivalent |
|---|---|
| Click through staging before pushing live | `e2e/smoke.spec.ts` (Lesson 12.3) |
| `error_log()` and reload to check a function | a Vitest unit test (Lesson 12.2) |
| Query Monitor to check the query count | a performance budget (Module 21) |
| "does the form still submit?" by hand | an E2E journey (Module 23) |
| `wp db export` before a risky change | `wp blame reset` and the fixture restore (Lesson 12.4) |
| A colleague looking over your shoulder | code review with a CI gate (Module 24) |

The ritual worked because Classic WordPress had four properties that made it work. **The
artifact was the source** — the PHP you edited was the PHP that ran, with no build step to
disagree with you. **A deploy was reversible in seconds** by copying the previous file back.
**The blast radius was one file**, because PHP fails per-request rather than per-build. And
**one system held everything**, so there was no contract between two deployables to break.

Every one of those is now false, and that is where the analogy breaks. Your source is
TypeScript compiled by a bundler, so "it worked when I saved the file" is no longer a
guarantee about what ships. A production deploy is an immutable image on Fly.io plus a Vercel
build, and `wp core update-db` cannot be rolled back at all — Module 24 states that plainly.
Blame The Tech is two deployables that agree on a GraphQL schema, a cache-tag naming scheme
and a webhook signature, and any of those three can drift while both halves look healthy.
Manual QA cannot detect a contract drift, because both systems appear to work when you click
around.

There is a fifth difference, and it is the one that actually changes your day. **Staging tells
you about the thing you are looking at.** It has never told you about the twelve routes you did
not open, and this app now has twenty-eight. The question a test suite answers is not "does my
new feature work" — you can see that — it is "did my new feature break something I have no
reason to suspect". That is also why writing your first test at Module 23 would be too late:
by then half the components in the app would have been built without a way to answer it.

Two things staging still does better than any test, and the course keeps using it for both:
telling you whether the page *feels* right, and telling you what real editor-authored content
does to your layout. Neither is automatable, and neither is what this module is for.

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
