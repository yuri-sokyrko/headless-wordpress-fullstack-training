---
title: 'E2E Depth: Auth, Preview & i18n'
module: 23
lesson: 6
teaches: [playwright-projects, storage-state, mutation-isolation, cache-coherency, test-only-hooks, e2e-preview, e2e-locale-routing]
produces: ['next-app/playwright.config.ts', 'next-app/e2e/auth.setup.ts', 'next-app/e2e/moderation.spec.ts', 'next-app/e2e/preview.spec.ts', 'next-app/e2e/i18n.spec.ts']
requires: [23.5, 18.4, 17.2, 20.3]
---

# Lesson 23.6 — E2E Depth: Auth, Preview & i18n

## Quick Overview

Module 12's smoke suite proved the pages load. This lesson tests the flows that only exist when
both applications, the database, the cache and the webhook are all running together — which is
also why they are the flows nobody tests until they break in production. Three of them matter:
the moderation loop (a reporter submits a pending incident, a moderator publishes it in wp-admin,
the revalidation webhook fires, the public list shows it), draft preview (an editor hits Preview
and Next renders the unpublished draft through `draftMode()`), and locale routing (the same
document reachable in three languages with a switcher that preserves the slug and the query string).

Getting there needs Playwright structured properly. A **setup project** logs in once and writes
`storageState` to disk, so the other projects start authenticated instead of driving the login
form forty times. Then the projects **split by whether they mutate**: reads run `fullyParallel`
because they cannot interfere, mutations run with `workers: 1` and `fullyParallel: false` because
two workers publishing incidents in the same database will interleave and produce failures that
reproduce only in CI. Cleanup runs after, deterministically.

And then the gotcha that will cost you an afternoon if nobody warns you. **After
`wp db reset && wp db import`, Next.js still serves the previous data**, because ISR does not know
the database changed — the cache entry is still fresh and the tag was never purged. Your test
passes alone and fails in the suite, or passes locally and fails in CI, which is the worst
possible failure signature. The fix is a test-only route handler that purges the cache after a
reset — and the fix is itself the lesson, because **a test hook is an unauthenticated endpoint
unless you make it not one.** It 404s unless `E2E_MODE=1` **and** an `X-BTT-E2E-Secret` header matches,
per [appendix 04 §3.1](../appendix/04-env-reference.md#31-server-only-no-prefix).

By the end of this lesson you will have:

- `playwright.config.ts` with the `setup` project plus `smoke`, `mutations` and `a11y`,
  dependencies declared,
  and mutation isolation configured
- `e2e/auth.setup.ts` — one login per role, `storageState` per role, credentials from the
  environment and never from a literal
- `e2e/moderation.spec.ts` — submit as reporter, publish as moderator, assert the public list,
  through the real webhook
- `e2e/preview.spec.ts` — an editor previewing a draft, and the negative: no preview cookie means
  the draft is not visible
- `e2e/i18n.spec.ts` — all three locales, the switcher preserving the translated slug and the
  query string
- A hardened test-only cache-reset hook with a spec proving it 404s without the secret, and a
  reset-and-reseed fixture that leaves the suite reproducible in any order

## Classic WP Analogy

Your Classic equivalent was a staging site and a written test plan — and if the plan was good, it
looked a lot like these specs: log in as a contributor, submit a post, log in as an editor,
publish it, check the archive, check the RSS feed. Same scenarios. The difference is that a human
did it, once per release, and quietly skipped steps four through nine when the release was urgent.

| Classic WordPress | Playwright |
|---|---|
| A staging site plus a checklist | `e2e/*.spec.ts`, on every pull request |
| Log in through `wp-login.php` each time | A setup project and `storageState` |
| A database snapshot before testing | `wp db reset && wp blame seed --fresh` per run |
| "Clear the cache" as a checklist step | An authenticated, gated cache-purge hook |
| Preview verified by clicking Preview | `e2e/preview.spec.ts`, including the negative case |
| Someone forgets the German page | Parameterised over three locales |

The break is genuinely new and it is the cache one, so it is worth stating in full. In a Classic
WordPress stack, the database *is* the state. Reset it and the next request renders from the
reset data, because rendering happens on every request from the current database — that is the
whole reason page caching was something you bolted on. Any page cache you did add lived in
WordPress, so `wp cache flush` cleared it and your checklist had a line for that.

Here, **the cache lives in a different application, on a different host, in a different runtime,
and it has no idea your database moved.** Next's ISR entries are still valid, their revalidation
windows have not elapsed, and nothing purged their tags — so the front end will confidently serve
data that no longer exists for the next ten minutes. There is no `wp cache flush` that reaches it,
and there is no way to make ISR "notice", because not noticing is precisely what makes it fast.
Every headless test suite eventually hits this, usually as a flake nobody can reproduce. The
lasting takeaway is broader than the fix: in a decoupled architecture, **resetting state means
resetting state in every tier**, and any tier you forget becomes intermittent.

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
