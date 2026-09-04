---
title: 'CI with GitHub Actions'
module: 24
lesson: 4
teaches: [github-actions, paths-filter, reusable-workflows, matrix-sharding, e2e-against-built-image, required-check-aggregation, secrets-hygiene]
produces: ['.github/workflows/ci.yml', '.github/workflows/_web.yml', '.github/workflows/_php.yml', '.github/workflows/_docker-wp.yml']
requires: [23.6, 24.2]
---

# Lesson 24.4 — CI with GitHub Actions

## Quick Overview

This lesson assumes you have never written a workflow file, because plenty of excellent
WordPress developers have deployed exclusively by FTP and there is nothing embarrassing about
that. So it starts from the vocabulary — a **workflow** is a YAML file triggered by an event, made
of **jobs** that run on **runners**, each job a list of **steps** that are either shell commands
or reusable **actions** — and builds up to a real pipeline for a two-application repository.

Four design decisions carry the lesson. **Path filtering** with `dorny/paths-filter`, so a
PHP-only change does not run the Playwright suite and a docs change runs almost nothing —
otherwise CI takes twelve minutes for a typo and people stop waiting for it. **Reusable
workflows** (`_web.yml`, `_php.yml`, `_docker-wp.yml`), called with inputs, so the same job
definition serves pull requests, `main` and the nightly run without three copies drifting apart.
**Sharded E2E against the built WordPress image** — not a dev container, not `wordpress:latest`,
the actual image produced by `_docker-wp.yml` in this same run, because that is the only
arrangement in which CI tests what deploys. And **one aggregation job**, `ci-required`, that
depends on everything and reports a single conclusion; branch protection points at that one job,
so a path-filtered skip does not sit as "expected" forever and block every merge.

Secrets hygiene runs through all of it, per
[appendix 04 §7](../appendix/04-env-reference.md#7-secret-injection-per-target). Never a secret in
a build arg. Never `echo` a secret. `::add-mask::` for anything derived from one. And note what
CI does *not* need: because `schema.graphql` is committed, no CI job holds a database password or
a JWT secret at all.

By the end of this lesson you will have:

- `.github/workflows/ci.yml` — the entry workflow: path detection, then the reusable calls
- `_web.yml` — `tsc --noEmit`, ESLint `--max-warnings=0`, `@graphql-eslint`, Vitest with coverage,
  `next build`, with dependency and Next build caching
- `_php.yml` — PHPCS, PHPStan, Pest and `wp-phpunit` against a service MySQL — and
  `_docker-wp.yml`, which builds the production WordPress image, scans it and pushes it to GHCR
- A contract job checking schema and codegen drift with `git diff --exit-code`
- A sharded E2E job (four shards) running against the **built** image, with merged reports and
  traces uploaded on failure
- Lighthouse CI and axe against the Vercel preview, and `ci-required` aggregating every job,
  treating skipped as pass, pointed at by branch protection

## Classic WP Analogy

Be honest about the baseline: for most Classic WordPress work, "deployment" was an FTP client and
"CI" did not exist. The best case was a Git deploy hook or a WP Pusher plugin. The common case was
dragging a folder into a remote pane and hoping nobody was mid-request.

| Classic WordPress | GitHub Actions |
|---|---|
| Drag files in FileZilla | `git push`, and a workflow decides if it may proceed |
| "Test on staging" as a checklist line | A job that fails the pull request |
| Editing a plugin file live to fix a bug | Impossible — `DISALLOW_FILE_MODS` from Lesson 24.1 |
| A `.zip` backup before touching anything | An immutable image tag you can redeploy |
| The developer who knows the deploy steps | A workflow file every developer can read |
| Deploying at 5pm on a Friday and hoping | Deploying because every gate went green |

The mental shift is the one worth internalising: **the pipeline is the deploy procedure, written
down and executable.** Every step that used to live in someone's memory or a wiki page — build the
block assets, run composer install with `--no-dev`, flush the rewrites, clear the cache — becomes
a line in a file, reviewed like code, and it either works or the deploy stops. That is not
ceremony; it is the removal of a single point of failure who also takes holidays.

Where the analogy breaks is the discipline that makes CI meaningful and has no FTP equivalent
whatsoever: **CI must test the artifact that ships.** FTP had a sort of accidental honesty about
this — you uploaded the exact files and those exact files ran. A CI pipeline can very easily test
something that is not what you deploy: run E2E against `wordpress:6.8` from Docker Hub while
production runs your multi-stage image with opcache on, `DISALLOW_FILE_MODS` set and no dev
plugins, and you have built an elaborate apparatus for testing a different application. Every
difference between the tested environment and the deployed one is a bug that CI is structurally
incapable of finding. Building the image once and running the tests against **that image** is the
whole reason `_docker-wp.yml` runs before the E2E job rather than after.

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
