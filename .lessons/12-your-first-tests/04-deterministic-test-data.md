---
title: 'Deterministic Test Data'
module: 12
lesson: 4
teaches: [deterministic-seeding, fixed-slugs, sql-fixture-dump, wp-cli-seeding, global-setup, secrets-from-environment]
produces: ['wordpress-headless/wp-content/mu-plugins/blame-seeder/blame-seeder.php', 'next-app/e2e/global-setup.ts']
requires: [12.3, 4.4]
---

# Lesson 12.4 — Deterministic Test Data

## Quick Overview

The smoke spec from Lesson 12.3 passes on your machine and will fail on a colleague's, because
it asserts things about content and your two databases are not the same. This lesson makes the
data a controlled input rather than an accident. `wp blame seed` becomes genuinely
deterministic — the same command, run twice, on two machines, in either order, produces
byte-identical content — and a dev/CI-only mu-plugin adds `wp blame reset` plus a fixture
export so restoring that state takes two seconds instead of ninety.

The determinism rules are unglamorous and each one exists because it broke somebody's suite.
**Reference content by slug, never by ID**, because auto-increment values differ between two
runs of the same seeder. **Set `post_date` and `post_date_gmt` explicitly**, because the default
is "now", which makes "the six most recent incidents" a different six on Tuesday. **No
randomness at all** — no `wp_rand()`, no `time()`, no unseeded Faker — because a flaky test that
fails one run in forty is worse than no test. And **passwords come from the environment**: the
seeder reads `E2E_SECRET` and the WordPress user passwords from env vars, and a literal password
never appears in a seeder file, because seeder files get committed. The full rule set is
recorded in
[the content model contract](../appendix/03-content-model-reference.md#9-seed-data), and this
lesson implements it.

By the end of this lesson you will have:

- `wordpress-headless/wp-content/mu-plugins/blame-seeder/blame-seeder.php` — dev/CI-only, never in the production image
- `wp blame reset` restoring the exact seeded state, and a `wp blame seed --fresh` that is idempotent
- A gitignored SQL fixture dump, exported from the seeder and cached in CI, with a documented staleness check
- `next-app/e2e/global-setup.ts` resetting WordPress before the Playwright run, gated on `E2E_MODE`
- The Lesson 12.3 spec passing twice in a row, with content assertions on fixed slugs and no literal password anywhere in git

## Classic WP Analogy

You already have a way of getting a known database, and you have already been bitten by its
weaknesses:

| Classic WordPress | Here |
|---|---|
| `wp db export backup.sql` before a risky change | the fixture dump, but derived rather than captured |
| Pulling a copy of production down to local | rejected: production content is not a fixture |
| `wp import` on a WXR export file | `wp blame seed`, which is code |
| `wp post create` in a shell script | the same, made deterministic |
| A migration plugin syncing staging to local | `wp blame reset` |
| "works on my machine" | the exact problem this lesson removes |

If you have ever copied a production database to debug something and found that the bug
vanished, you already know the failure mode: a captured database is a snapshot of accumulated
drift, and nobody can tell you which parts of it matter. The seeder is the opposite. It is code,
it is reviewed, and every piece of content in it exists because a test needs it — two of the ten
blog posts use every custom block specifically so Module 14's block-rendering spec has something
to assert against.

The analogy breaks on the relationship between the dump and the truth. `wp db export` treats the
database as the source and the file as a copy. Here it is inverted: **the seeder is the source of
truth and the SQL dump is a cache.** That ordering is what keeps it honest. The dump is
gitignored, keyed on a hash of the seeder, and rebuilt whenever the seeder changes, so it can
never become an artifact nobody knows how to regenerate — which is exactly what the
`backup-final-v2.sql` sitting in every agency's shared drive is.

The second break is the one that produces the most confusing failures: **WordPress is only
deterministic if you make it so, and most of the nondeterminism is invisible.** Auto-increment
IDs restart differently after a `TRUNCATE`. `post_date` defaults to the current time, so an
`orderby: date` query returns a stable order only within one seed run. `wp_rand()` seeds itself
from the system. Term IDs shift if terms are created in a different order. Uploads land in a
`uploads/2026/09/` folder that depends on the month you ran the seeder. None of this matters for
a real site and all of it matters for a test asserting the third card on a page. Classic
WordPress development never surfaces any of it, because nothing was ever asserting anything.

One security note, because seeders are a common leak. A seeder that creates users needs
passwords, and a password written into a PHP file in git is a committed secret — permanently,
in every clone, even after you delete the line. The seeder reads them from the environment and
fails loudly if the variable is absent. `E2E_MODE` and `E2E_SECRET` are introduced here, and
[appendix 04 §1](../appendix/04-env-reference.md#1-the-five-rules) is the rule set they follow.

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
