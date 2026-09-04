# Module 12 — Your First Tests

## Prerequisites

Before starting this module you should have completed:

- **Module 11** — the design system, the accessible app shell, and `/en/hobt` all render
- **Module 10** — `src/lib/graphql/` holds pure functions worth unit testing, and cache tags are constructed in one place
- **Module 04** — `wp blame seed` exists as a WP-CLI command in `blame-the-tech-core`

> ⚠️ **Do not skip this module because it is not the fun part.** Writing your first test at
> Module 23 is too late: half the components in the app would already be untestable, and you
> would have spent eleven modules with no way to answer "did I break it?". Lesson 12.3 in
> particular changes how you write every component that follows.

## Starting State

```bash
# 1. The styled site runs
cd next-app && npm run dev
open http://localhost:3000/en/hobt
# Expected: the HOBT landing page, styled, CTAs present but inert

# 2. The seeder still produces the fixed content set
cd ../wordpress-headless
docker compose run --rm wpcli wp post list --post_type=incident --format=count
# Expected: 40
```

```
next-app/
├── tailwind.config.ts  components.json  postcss.config.mjs   (M11)
└── src/
    ├── components/{ui,layout,incidents,hobt}/                (M11)
    ├── lib/graphql/{client,errors,tags}.ts                   (M10)
    └── app/[locale]/...                                      (M09/M10/M11)
```

There is no `vitest.config.ts`, no `playwright.config.ts`, no `e2e/` and no `*.test.ts`.

## What You'll Learn

- **What a test is for on this stack** — the three things a staging site cannot tell you, and the two it tells you better than any test
- **Vitest, not Jest** — native ESM, no Babel transform, and the fact that `next-intl` and MSW v2 are ESM-only, so Jest would need a transform pipeline you do not want to own
- **Unit-testing pure logic** — cache-tag construction, the GraphQL error mapper, the severity ordering
- **Playwright** — a real browser, a real Next server, and the smoke suite that proves the site boots
- **Locators that survive a redesign** — `getByRole`, accessible names, and why `page.locator('.card-title')` is a test you will delete in Module 22
- **Deterministic data** — fixed slugs never IDs, explicit `post_date`, no `wp_rand`, no unseeded Faker, and passwords read from the environment
- **A CI-cached SQL dump** — the same seeded state in two seconds instead of ninety, gitignored, rebuilt from the seeder

## What You'll Build

`vitest.config.ts` with unit tests next to the code they test; `playwright.config.ts` with a
`webServer` block that boots Next for you; `e2e/smoke.spec.ts` walking every route from the
Module 09 inventory; `e2e/global-setup.ts` that resets WordPress to a known state; and the
determinism work in `wp-content/mu-plugins/blame-seeder/`, including `wp blame reset` and a
fixture export.

After this module `npm test` and `npx playwright test` are green against data that is byte-for-byte
the same on your laptop and in CI. Module 23 deepens both suites; this module makes them exist.

## Lessons

| #  | Lesson | New Technology | What You Build |
|----|--------|----------------|----------------|
| 01 | [Why Tests When You Have a Staging Site](01-why-tests-when-you-have-a-staging-site.md) | The test pyramid, applied to headless WordPress | A written scope table: what is tested where, and what is deliberately not |
| 02 | [Your First Vitest Test](02-your-first-vitest-test.md) | Vitest, `expect`, `describe`, coverage | `vitest.config.ts` and unit tests for `src/lib/graphql/` |
| 03 | [Your First Playwright Test](03-your-first-playwright-test.md) | Playwright, `webServer`, role-based locators | `playwright.config.ts` and `e2e/smoke.spec.ts` |
| 04 | [Deterministic Test Data](04-deterministic-test-data.md) | `wp blame reset`, fixture export, `global-setup` | A reproducible database and a two-second CI restore |

## What each suite is responsible for

A test that could live in two places belongs in the cheaper one. This table is the answer to
"where do I put this test?" for the rest of the course.

| Suite | Runs | Answers | Does **not** answer |
|---|---|---|---|
| Vitest (`src/**/*.test.ts`) | milliseconds, no server | Is this function correct? | Does the page render? |
| Playwright (`e2e/`) | seconds, real browser + real WP | Can a user complete this journey? | Why it broke |
| Verification blocks | on demand, by you | Did this lesson land? | Anything after you stop running them |
| PHPUnit / Pest (Module 23) | seconds, WordPress bootstrapped | Does the plugin enforce capabilities? | Anything in the browser |

Env variables introduced here are `E2E_MODE` and `E2E_SECRET` — see
[the env reference](../appendix/04-env-reference.md#31-server-only-no-prefix). The test-only
revalidation hook they gate is built in Module 18; here they only gate the seeder reset.

## The determinism rules, in one place

Lesson 12.4 implements every row. They are collected here because you will come back to this
table every time a spec goes red for no apparent reason.

| Rule | The failure it prevents |
|---|---|
| Reference content by **slug**, never by ID | Auto-increment values differ between two runs of the same seeder |
| Set `post_date` **and** `post_date_gmt` explicitly | "The six most recent incidents" is a different six tomorrow |
| No `wp_rand()`, no `time()`, no unseeded Faker | A suite that fails one run in forty, which is worse than no suite |
| One fixed `WP_HOME` for both seeding and running | Absolute URLs baked into content by the wrong host |
| Create terms in a fixed order | Term IDs shift, and anything that stored one goes stale |
| Passwords from the environment, never literals | A committed secret, permanently, in every clone |
| The SQL dump is derived from the seeder, never the reverse | An artifact nobody knows how to regenerate |

## How to Work

1. **Read the module README** and confirm Starting State, including the incident count of 40. A different number means your database has drifted and Lesson 12.4 is where you fix that.
2. **Work the lessons in order.** 12.1 is the only reading-heavy lesson in Phase 2; read it anyway, because it is what stops you writing forty useless tests in Module 23.
3. **Watch a test fail on purpose.** Break the thing it asserts, run it, read the failure output, put it back. A test you have never seen fail is not yet a test.
4. **Run `## Verification` before moving on**, then commit: `git commit -m "test(next): vitest and playwright smoke suites on deterministic seed data"`.
