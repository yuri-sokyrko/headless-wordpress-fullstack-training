---
title: 'CI with GitHub Actions'
module: 24
lesson: 4
teaches: [github-actions, paths-filter, reusable-workflows, matrix-sharding, e2e-against-built-image, required-check-aggregation, secrets-hygiene]
produces: ['.github/workflows/ci.yml', '.github/workflows/_web.yml', '.github/workflows/_php.yml', '.github/workflows/_docker-wp.yml', '.github/ci-wp-stack.sh']
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
something that is not what you deploy: run E2E against `wordpress:7.1` from Docker Hub while
production runs your multi-stage image with opcache on, `DISALLOW_FILE_MODS` set and no dev
plugins, and you have built an elaborate apparatus for testing a different application. Every
difference between the tested environment and the deployed one is a bug that CI is structurally
incapable of finding. Building the image once and running the tests against **that image** is the
whole reason `_docker-wp.yml` runs before the E2E job rather than after.

---

## Key Concepts

### 1. The vocabulary, in one pass

Five words. Learn them once and every workflow file in the world becomes readable.

| Word | What it is | In this repository |
|---|---|---|
| **workflow** | a YAML file in `.github/workflows/`, triggered by an **event** | `ci.yml`, plus three that only run when called |
| **event** | what starts it: `push`, `pull_request`, `schedule`, `workflow_dispatch`, `workflow_call` | `ci.yml` takes four; the others take only `workflow_call` |
| **job** | a unit that runs on one **runner**, in parallel with other jobs unless `needs:` says otherwise | `detect`, `web`, `php`, `image`, `contract`, `e2e`, `quality`, `ci-required` |
| **runner** | a fresh virtual machine per job. Nothing survives between jobs except artifacts and caches | `ubuntu-latest` |
| **step** | either `run:` (a shell command) or `uses:` (a reusable **action**) | `uses: actions/checkout@v4`, then `run: npm ci` |

```yaml
# the whole shape, in nine lines
name: ci
on: [pull_request]          # the EVENT
jobs:
  checks:                   # a JOB
    runs-on: ubuntu-latest  # the RUNNER
    steps:
      - uses: actions/checkout@v4   # a STEP that is an ACTION
      - run: npm ci                 # a STEP that is a command
```

The one thing that surprises people coming from FTP: **each job gets a clean machine.** Job `web`
cannot see files job `image` created. Passing anything between jobs is explicit — an `outputs:`
value, an uploaded artifact, or a pushed image. That constraint is what makes a pipeline
reproducible, and it is why Key Concept 6 is possible at all.

Lesson 23.9 already wrote one workflow, `agentic-qa.yml`, as the smallest thing that works. Read
it before this lesson: it is one job, one trigger, minimal `permissions:`, and it is
**advisory by construction** — see Key Concept 10.

### 2. The pipeline, read as a graph

The module README's diagram is frozen and Lesson 24.5 points branch protection at its last box.
Here it is as the `needs:` graph the YAML actually expresses:

```
detect ──┬──▶ web  ──────────┐
         ├──▶ php  ──────────┼──▶ contract ──┐
         └──▶ image ─────────┴──▶ e2e (×4) ──┼──▶ ci-required
                                  quality ───┘        ▲
   agentic-qa.yml (23.9) ── separate workflow ─────── ✗ not here, on purpose
```

Two readings of the diagram to keep straight. The three boxes fanning out of `detect` are
**parallel** — a PHP-only change runs `php` and nothing else. The convergent box is a **stage**,
not a single job: `contract`, `e2e` and `quality` are three jobs with three different
dependencies, and `e2e` is the only one that genuinely needs the image.

> **A job id containing a hyphen cannot be read in an expression with dot syntax.**
> `needs.docker-wp.result` parses `-` as subtraction and silently evaluates to empty, so a guard
> written that way is always false and the job always skips. Either use
> `needs['docker-wp'].result` or — as this lesson does — name job ids without hyphens. The one
> exception is `ci-required`, which is never referenced in an expression and whose name is a
> contract with branch protection.

### 3. Path filtering: what it saves, and the trap it sets

Without it, a typo in a README runs Playwright four times. With it, CI is fast enough that people
wait for it — and a pipeline nobody waits for is a pipeline that is not a gate.

| Change | Runs | Wall clock |
|---|---|---|
| `docs/**` only | `detect`, `ci-required` | ~30 s |
| `next-app/src/**` | `detect`, `web`, `contract`, `quality`, `ci-required` | ~6 min |
| the plugin only | `detect`, `php`, `contract`, `ci-required` | ~4 min |
| `wordpress-headless/**` | everything, including `image` and sharded `e2e` | ~12 min |

**The trap.** GitHub's branch protection lists required checks by **job name**. A job that never
runs never reports, and a required check that never reports sits as *Expected* forever and blocks
the merge — permanently, with no error message. That is why Key Concept 5 exists, and it is the
single most common way a path-filtered pipeline gets abandoned.

`dorny/paths-filter` needs a base to diff against, which a `pull_request` has and a `schedule`
does not. So every filter output is `true` unconditionally for any event that is not a pull
request. A nightly run tests everything, which is what a nightly run is for.

### 4. Reusable workflows, and the two things they are not

`_web.yml`, `_php.yml` and `_docker-wp.yml` declare `on: workflow_call`, take `inputs:`, and are
invoked with `uses: ./.github/workflows/_web.yml`. The leading underscore is a convention, not a
mechanism: it says "not an entry point".

| Mechanism | Shares | Runs on | Use when |
|---|---|---|---|
| **reusable workflow** | whole jobs, with their own runners, services and matrix | its own runners | a job definition serves several callers — this is the one |
| composite action | a sequence of **steps** | the caller's runner | the same five steps appear in three jobs |
| copy-paste | nothing | — | never; three copies drift and you find out from the one that stopped running |

Two things a reusable workflow is not. It is **not** a function: `inputs:` are strings, booleans
and numbers, never objects, and `outputs:` must be declared at the workflow level and wired from
a job. And it does **not** inherit the caller's permissions by default — you set `permissions:`
on the **calling job**, and the reusable workflow's own `permissions:` cannot grant more than the
caller has.

One `_web.yml` therefore serves pull requests, `main` and the nightly run with different inputs
and no second copy. The cost: a failure inside a reusable workflow is one more click away in the
UI, and `needs:` cannot reach a job *inside* it.

### 5. `ci-required`, and why skipped must count as pass

Branch protection points at **one** job. Everything else reports for information.

```
                      needs: [detect, web, php, image, contract, e2e, quality]
                                      │
                                if: always()      ← WITHOUT THIS the job is
                                      │              skipped whenever any
                                      ▼              dependency skipped, and
              ┌──────────────────────────────┐       reports NOTHING
              │ any result == failure  → fail│
              │ any result == cancelled→ fail│
              │ success or skipped     → PASS│
              └──────────────────────────────┘
```

Three rules, each earned:

- **`if: always()`.** A job whose `needs:` includes a skipped job is skipped by default. Without
  `always()`, `ci-required` disappears on every docs-only pull request — which is precisely the
  case it exists to make mergeable.
- **`skipped` counts as pass.** `web` skipping on a PHP-only change is the path filter working.
  Treating it as a failure would mean either running everything always or never merging.
- **`cancelled` counts as fail.** A cancelled job proved nothing. Silently passing it is how a
  concurrency-cancelled run merges untested.

The check reads `toJSON(needs)` and iterates, so **adding a job means appending one id to
`needs:` and nothing else.** Lesson 24.5 adds `gitleaks`, `licences` and `commitlint` that way —
one line, no logic change. Written like this on purpose.

### 6. CI must test the artifact that ships

This is the discipline with no FTP equivalent, and the argument is one sentence: **every
difference between the tested environment and the deployed one is a bug CI is structurally
incapable of finding.**

| | Tested in a dev container | Tested in the built image |
|---|---|---|
| PHP version | whatever the dev image has | the version production runs |
| opcache | off | on — and opcache changes behaviour on a file that changed mid-request |
| `DISALLOW_FILE_MODS` | `false` | `true`, so a plugin activation at runtime fails |
| dev plugins | present | absent |
| plugin code | your bind mount | **what is in the image** |
| `WP_ENVIRONMENT_TYPE` | `local` | `staging` — so Lesson 24.1's hardening is on |

So the `e2e` job runs against `ghcr.io/<owner>/btt-wp:<sha>` — **the SHA tag produced in this same
run**, never `:latest`, which is whatever `main` last pushed and therefore not what you are
reviewing. `:latest` is the mistake that makes a whole pipeline decorative.

**Getting there takes one deliberate move**, because `docker-compose.yml` bind-mounts
`./wp-content/plugins` and `./wp-content/themes` over whatever the image holds — so a naive
`docker compose up` on the built image would test the **working tree's** plugin code and prove
nothing. Step 3's overlay replaces those two bind mounts with **named volumes**, matched by
target path, and Docker initialises a named volume from the image on first use. The code under
test is then the image's.

**The one difference this pipeline accepts, enumerated rather than hidden.** `wp-content/mu-plugins`
stays a bind mount, because Lesson 12.4's seeder is excluded from the production image on
purpose and without it there is no content and no E2E at all. One known, named, single-directory
difference — and `WP_ENVIRONMENT_TYPE=staging` keeps every other hardening branch in its
production state, while `production` itself would make the seeder return early, because Lesson
12.4 gave it `if ( 'production' === wp_get_environment_type() ) { return; }`.

**And fork pull requests do not get this job.** Pushing to GHCR needs `packages: write`, which a
fork's `GITHUB_TOKEN` does not have. The "fix" is `pull_request_target`, which runs the base
branch's workflow with **write permissions and repository secrets** against an untrusted head —
so a contributor who edits a script your workflow runs gets your secrets. This repository has
zero uses of it and Verification check 5 proves it. Fork contributions get every other job and a
human runs the E2E locally.

### 7. Caching: the key is the whole design

Two caches, and each has a wrong-key failure in both directions.

| Cache | Path | Key includes | Wrong key too **broad** | Wrong key too **narrow** |
|---|---|---|---|---|
| npm | the npm cache dir, via `actions/setup-node`'s `cache: npm` | `package-lock.json` | a stale dependency tree reused after a lockfile change — a green CI for code that does not build locally | never a hit; you pay upload time for nothing |
| Next build | `next-app/.next/cache` | lockfile **and** a hash of the source | a stale compiled module served after its source changed, producing a failure that does not reproduce | full rebuild every run, which is the *safe* wrong answer |

Note the asymmetry, because it decides how you choose. **Too broad is dangerous; too narrow is
merely slow.** So `restore-keys:` is a prefix — a near-miss restores a partial cache and the run
repopulates it — and the exact `key:` still changes whenever the source does.

`.next/cache` is the one worth caching: it is Next's compiler and image cache, and a cold one
adds minutes to `next build`. `node_modules` is deliberately **not** cached — `npm ci` from a
warm npm cache is nearly as fast and cannot desynchronise from the lockfile.

### 8. Secrets hygiene, and the list of what CI does not need

Per [appendix 04 §7](../appendix/04-env-reference.md#7-secret-injection-per-target):

| Rule | Why |
|---|---|
| never a secret in a `build-args` | `docker history` prints build args in plain text, forever, to anyone with pull access |
| never `echo` a secret | step logs are readable by anyone with repository read access, and artifacts outlive the run |
| `::add-mask::` anything **derived** from a secret | GitHub masks the secret's exact value; a base64 or a substring of it is not masked |
| `permissions:` declared per job, minimal | the default token can be far broader than a job needs, and a compromised action inherits it |
| no `pull_request_target` | Key Concept 6 |
| `ACTIONS_STEP_DEBUG` off for anything that deploys | debug logging prints values the normal log redacts |

**And now the part worth saying out loud: no CI job in this pipeline holds a database password or
a JWT secret at all.** Because `schema.graphql` is committed (Lesson 06.3), `npm run codegen:check`
regenerates types from the **file** rather than introspecting a live WordPress — so the contract
job needs no WordPress and no credential. The E2E job's MySQL is a throwaway service container
whose test user is created in a step with a password generated in that step and masked. The whole
secret inventory is `GITHUB_TOKEN` for GHCR, plus `E2E_*` and `SENTRY_AUTH_TOKEN`. That is
appendix 04's promise, cashed in.

### 9. Sharding, and what a retry is actually buying

`npx playwright test --shard=2/4` splits the spec files four ways. Four runners, four HTML
reports, one merged report via `playwright merge-reports`.

| Setting | Value | Reason |
|---|---|---|
| shards | **4** | past four, per-job startup dominates the specs |
| `fail-fast` | `false` | shard 2 failing must not cancel shard 3; you want the whole picture in one run |
| `retries` | `1` in CI, `0` locally | already in `playwright.config.ts` (Lesson 12.3) |
| `workers` | `1` in CI | already there, spread conditionally so `exactOptionalPropertyTypes` accepts it |
| traces | `on-first-retry` | a trace of the run that failed, nothing on the happy path |

**What `retries: 1` buys, precisely.** It distinguishes *flaky* from *broken*: a spec that fails
then passes is reported as flaky, and a flaky spec is a bug in the spec or a race in the app.
What it does not buy is reliability — a suite that only passes on the retry is a suite that is
lying to you, and `retries: 3` is how a team stops knowing. One retry, and the flaky count is a
number somebody looks at.

Playwright starts its own server via `webServer` in `playwright.config.ts`, whose `url` is
`http://127.0.0.1:3000/api/health` — **not `localhost`**, because Node may resolve `localhost` to
`::1` while `next dev` binds IPv4, and the symptom is `ECONNREFUSED` against a server your
browser can load. That is Lesson 12.3's finding and CI inherits it.

### 10. Advisory by construction, and why `agentic-qa.yml` stays out

Lesson 23.9's workflow is the contrast case. It is **not** in `ci-required`'s `needs:`, and that
is a design decision rather than an omission.

| | `ci-required` jobs | `agentic-qa.yml` |
|---|---|---|
| Determinism | the same input gives the same result | an agent explores; two runs differ |
| Trigger | every pull request | nightly, or on a label |
| Failure means | the change is wrong | *something might be worth looking at* |
| Blocks a merge | yes | **no** |

The reason is not that the agent is untrustworthy. It is that **a non-deterministic gate is not a
gate** — a check that fails for reasons unrelated to the change in front of it gets ignored
within a week, and then the checks next to it get ignored too. Lesson 23.9's own output is a
finding a human converts into a deterministic spec, and *that* spec runs in `e2e` and does block.

The wrong way to make an advisory job is `continue-on-error: true` on a required one: it reports
success, so nobody ever reads it. The right way is a separate workflow, outside the aggregation,
whose output is a comment or an artifact a person reads. Lesson 24.8's AI review job is the same
shape for the same reason.

---

## Task

### Step 1: Look at the workflow you already have

```bash
ls -la .github/workflows/
cat .github/workflows/agentic-qa.yml
grep -n 'permissions\|on:\|continue-on-error' .github/workflows/agentic-qa.yml
```

**Verify §1:**

- [ ] `agentic-qa.yml` exists — Lesson 23.9 wrote it, and it is the first workflow in this course.
- [ ] It declares `permissions:` explicitly. Every workflow in this repository does.
- [ ] `grep -c 'continue-on-error' .github/workflows/agentic-qa.yml` is `0`. It is advisory
      because it is a **separate workflow outside the aggregation**, not because a flag hides its
      result — Key Concept 10.
- [ ] Nothing you write in this lesson references it. Verification check 6 proves that.

### Step 2: `ci.yml` — the entry workflow and path detection

```yaml
# .github/workflows/ci.yml
name: ci

on:
  push:
    branches: [main]
  pull_request:
  # A nightly run tests everything, including what a path filter would have skipped.
  schedule:
    - cron: '0 3 * * *'
  workflow_dispatch:

# Read-only by default at the workflow level, then widened per job. A compromised
# action inherits whatever the job has, so the job is where you are stingy.
permissions:
  contents: read

# One run per ref. Cancel superseded PR runs; NEVER cancel a run on `main`, whose
# result is what Lesson 24.6 and 24.7 deploy from.
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  detect:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
    outputs:
      # Every output is `true` for any event that is NOT a pull request, because
      # dorny/paths-filter needs a base to diff against and a schedule has none.
      # Output values are STRINGS: compare with == 'true', never as a boolean.
      web: ${{ github.event_name != 'pull_request' || steps.filter.outputs.web == 'true' }}
      php: ${{ github.event_name != 'pull_request' || steps.filter.outputs.php == 'true' }}
      image: ${{ github.event_name != 'pull_request' || steps.filter.outputs.image == 'true' }}
    steps:
      - uses: actions/checkout@v4

      - uses: dorny/paths-filter@v3
        id: filter
        if: github.event_name == 'pull_request'
        with:
          # Filter names have NO hyphens: `steps.filter.outputs.docker-wp` would
          # parse the hyphen as subtraction and evaluate to empty (Key Concept 2).
          filters: |
            web:
              - 'next-app/**'
              - '.github/workflows/_web.yml'
              - '.github/workflows/ci.yml'
            php:
              - 'wordpress-headless/wp-content/plugins/blame-the-tech-core/**'
              - 'wordpress-headless/schema.graphql'
              - '.github/workflows/_php.yml'
            image:
              - 'wordpress-headless/**'
              - '.github/workflows/_docker-wp.yml'

  # ── the three reusable workflows, in parallel ─────────────────────────────
  image:
    needs: detect
    if: needs.detect.outputs.image == 'true'
    permissions:
      contents: read
      packages: write
    uses: ./.github/workflows/_docker-wp.yml

  web:
    needs: detect
    if: needs.detect.outputs.web == 'true'
    permissions:
      contents: read
      packages: read
    uses: ./.github/workflows/_web.yml
    with:
      node-version: '22'
      # The LAST GREEN MAIN image, not this run's. `next build` needs *a*
      # WordPress to answer generateStaticParams; it does not need THIS one.
      # The E2E job is the one that must test what deploys (Key Concept 6), and
      # it uses the SHA tag. Two consumers, two requirements, stated out loud.
      wp-image: ghcr.io/${{ github.repository_owner }}/btt-wp:main

  php:
    needs: detect
    if: needs.detect.outputs.php == 'true'
    permissions:
      contents: read
    uses: ./.github/workflows/_php.yml
    with:
      # Matches the `phptest` runner (Lesson 23.4 §1.1), NOT the
      # wordpress:7.1-php8.4-apache application image. Pest 1 does not run on
      # 8.4; PHPCS's `testVersion 8.4-` is what covers the deployed interpreter.
      php-version: '8.3'
```

**Verify §2:**

- [ ] `actionlint .github/workflows/ci.yml` reports nothing. Install it with
      `brew install actionlint` or `go install github.com/rhysd/actionlint/cmd/actionlint@latest`.
- [ ] No filter name and no job id contains a hyphen, except `ci-required` in Step 8.
- [ ] `cancel-in-progress` is `false` for a `push` to `main`. Cancelling a `main` run leaves you
      with no artifact to deploy and a green tick from a run that stopped halfway.
- [ ] Every job declares `permissions:`. Verification check 4 asserts no job has `write-all`.

### Step 3: The shared stack script, then `_web.yml`

Two jobs need a WordPress running the built image: `_web.yml`, because
`generateStaticParams` fetches and `next build` therefore has a live data dependency, and the
`e2e` job, because that is the whole point. One script, two callers — the alternative is two
copies that drift, and a composite action under `.github/actions/` would be tidier still and is
the named follow-up.

**It writes `docker-compose.override.yml`, and the name is the mechanism.** `docker compose` reads
that file automatically (Lesson 02.2 §5), which means `e2e/global-setup.ts`'s plain
`docker compose run --rm -T wpcli wp …` (Lesson 12.4 Step 6) picks it up with **no flags and no
edit to that file**.

```bash
#!/usr/bin/env bash
# .github/ci-wp-stack.sh
# Bring up the WordPress Compose stack in CI on the image named by $BTT_WP_IMAGE,
# minting every credential it needs for this run only. Run from wordpress-headless/.
set -euo pipefail

: "${BTT_WP_IMAGE:?BTT_WP_IMAGE is required}"

rand() { openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48; }

DB_PASSWORD="$(rand)"; ROOT_PASSWORD="$(rand)"
APP_TOKEN="$(rand)"; REVALIDATE_SECRET="$(rand)"; PREVIEW_SECRET="$(rand)"

for v in "$DB_PASSWORD" "$ROOT_PASSWORD" "$APP_TOKEN" "$REVALIDATE_SECRET" "$PREVIEW_SECRET"; do
  # ::add-mask:: anything GENERATED or DERIVED. GitHub masks the exact value of a
  # repository secret; it knows nothing about a value a step invented.
  echo "::add-mask::$v"
done

{
  printf 'MYSQL_DATABASE=btt\nMYSQL_USER=btt\n'
  printf 'WORDPRESS_DB_NAME=btt\nWORDPRESS_DB_USER=btt\nWORDPRESS_TABLE_PREFIX=wp_\n'
  printf 'WORDPRESS_DB_PASSWORD=%s\nMYSQL_ROOT_PASSWORD=%s\n' "$DB_PASSWORD" "$ROOT_PASSWORD"
  printf 'WP_HOME=http://127.0.0.1:8080\nWP_SITEURL=http://127.0.0.1:8080\n'
  # staging, NOT production: Lesson 24.1's hardening branches are all on, but
  # Lesson 12.4's seeder returns early when the type is `production`.
  printf 'WP_ENVIRONMENT_TYPE=staging\nWORDPRESS_DEBUG=0\n'
  printf 'GRAPHQL_JWT_AUTH_CORS_ENABLE=false\n'
  printf 'BTT_FRONTEND_URL=http://127.0.0.1:3000\n'
  printf 'BTT_APP_TOKEN=%s\n' "$APP_TOKEN"
  printf 'BTT_REVALIDATE_SECRET=%s\n' "$REVALIDATE_SECRET"
  printf 'BTT_PREVIEW_SHARED_SECRET=%s\n' "$PREVIEW_SECRET"
  printf 'BTT_LEAD_IP_HMAC_KEY=%s\n' "$(rand)"
  printf 'BTT_SMTP_HOST=mailpit\nBTT_SMTP_PORT=1025\n'
  # The nine independent values from appendix 04 §2. wp-config.php's btt_env()
  # EXITS on a missing required name, which is what you want: if the container
  # exits complaining about a name, add that name to this list.
  for k in AUTH_KEY SECURE_AUTH_KEY LOGGED_IN_KEY NONCE_KEY \
           AUTH_SALT SECURE_AUTH_SALT LOGGED_IN_SALT NONCE_SALT \
           GRAPHQL_JWT_AUTH_SECRET_KEY; do
    printf '%s=%s\n' "$k" "$(rand)"
  done
} > .env

# Hand the three SHARED values to the Next side so both halves agree. Redirected
# to /dev/null when this script is run outside Actions.
{
  printf 'WP_APP_TOKEN=%s\n' "$APP_TOKEN"
  printf 'REVALIDATE_SECRET=%s\n' "$REVALIDATE_SECRET"
  printf 'PREVIEW_SHARED_SECRET=%s\n' "$PREVIEW_SECRET"
} >> "${GITHUB_ENV:-/dev/null}"

# Generated, never committed. Compose reads this filename with no -f flag.
cat > docker-compose.override.yml <<'YAML'
services:
  wordpress:
    image: ${BTT_WP_IMAGE:?BTT_WP_IMAGE is required}
    # Named volumes REPLACE the base file's plugin and theme BIND MOUNTS, matched
    # by target path. Docker initialises a named volume from the image on first
    # use, so the code under test is the IMAGE's and not the working tree's —
    # which is the whole point of Key Concept 6. `mu-plugins` is deliberately
    # NOT overridden: that bind mount is the one enumerated difference, and
    # without the Lesson 12.4 seeder there is no content and no E2E.
    volumes:
      - btt-ci-plugins:/var/www/html/wp-content/plugins
      - btt-ci-themes:/var/www/html/wp-content/themes
  wpcli:
    volumes:
      - btt-ci-plugins:/var/www/html/wp-content/plugins
      - btt-ci-themes:/var/www/html/wp-content/themes
volumes:
  btt-ci-plugins:
  btt-ci-themes:
YAML

docker pull "$BTT_WP_IMAGE"
docker compose up -d --wait

# `wpcli` is wordpress:cli-php8.4 and ships no WordPress of its own; it sees core
# through the shared btt-wp-core volume, which Docker initialises from the BUILT
# image. This one command is what proves that worked, and it is the same
# invocation e2e/global-setup.ts uses.
docker compose run --rm -T wpcli wp core version
```

Then the workflow.

```yaml
# .github/workflows/_web.yml
name: _web

on:
  workflow_call:
    inputs:
      node-version:
        required: false
        type: string
        default: '22'
      wp-image:
        description: 'WordPress image for the build data dependency. Empty skips the build.'
        required: false
        type: string
        default: ''

permissions:
  contents: read

jobs:
  checks:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: read
    defaults:
      run:
        working-directory: next-app

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ inputs.node-version }}
          # Caches the npm CACHE DIRECTORY, keyed on the lockfile — not
          # node_modules, which can desynchronise from the lockfile silently.
          cache: npm
          cache-dependency-path: next-app/package-lock.json

      - run: npm ci

      # Four gates as four steps, so a failure names itself. `npm run verify`
      # (Lesson 07.5) chains them locally; here you want to know WHICH one.
      - name: tsc --noEmit
        run: npm run type-check

      - name: ESLint, zero warnings
        # --max-warnings=0 is inside the script (Lesson 07.5). @graphql-eslint is
        # folded into this same command by Lesson 23.5 — there is no separate
        # script and adding one would let the two configs drift.
        run: npm run lint

      - name: Vitest with coverage
        run: npm run test:coverage

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage-web
          path: next-app/coverage/
          retention-days: 7

      - uses: actions/cache@v4
        with:
          path: next-app/.next/cache
          # Lockfile AND a source hash. Too broad reuses a stale compiled module
          # after its source changed — a failure that does not reproduce locally.
          # Too narrow only costs time. Key Concept 7.
          key: next-${{ runner.os }}-${{ hashFiles('next-app/package-lock.json') }}-${{ hashFiles('next-app/src/**', 'next-app/*.ts', 'next-app/*.mjs') }}
          restore-keys: |
            next-${{ runner.os }}-${{ hashFiles('next-app/package-lock.json') }}-

      - name: Bring up WordPress for the build's data dependency
        id: wp
        # `generateStaticParams` FETCHES (Lessons 09.4, 18.1), so `next build`
        # cannot run without a WordPress answering. Tolerated failure: until
        # Lesson 24.6 writes the Dockerfile there is no image on GHCR to pull.
        continue-on-error: true
        working-directory: wordpress-headless
        env:
          BTT_WP_IMAGE: ${{ inputs.wp-image }}
        run: |
          test -n "$BTT_WP_IMAGE" || exit 1
          echo '${{ secrets.GITHUB_TOKEN }}' | docker login ghcr.io -u '${{ github.actor }}' --password-stdin
          bash ../.github/ci-wp-stack.sh          # written by Step 6; see the note there
          for i in $(seq 1 40); do
            curl -fsS http://127.0.0.1:8080/graphql -o /dev/null -X POST \
              -H 'Content-Type: application/json' -d '{"query":"{ __typename }"}' && exit 0
            sleep 3
          done
          exit 1

      - name: next build
        if: steps.wp.outcome == 'success'
        env:
          WP_GRAPHQL_ENDPOINT: http://127.0.0.1:8080/graphql
          WP_REST_BASE: http://127.0.0.1:8080/wp-json
          NEXT_PUBLIC_SITE_URL: http://127.0.0.1:3000
          NEXT_PUBLIC_DEFAULT_LOCALE: en
        run: npm run build

      - name: next build skipped
        if: steps.wp.outcome != 'success'
        run: |
          echo "::warning::next build skipped — no WordPress image available yet."
          echo "::warning::Lesson 24.6 writes the production Dockerfile; until then the Vercel preview is the build gate."

      - name: NEGATIVE — no secret reached the client bundle
        if: steps.wp.outcome == 'success'
        run: |
          ! grep -rq 'BTT_APP_TOKEN\|GRAPHQL_JWT_AUTH_SECRET_KEY' .next/static/
```

**Verify §3:**

- [ ] The overlay is named `docker-compose.override.yml`. Any other name and
      `e2e/global-setup.ts` — which runs `docker compose run --rm -T wpcli wp …` with no `-f`
      flags — brings up the **stock** image instead of yours, silently.
- [ ] `mu-plugins` appears nowhere in the overlay's `volumes:`. Overriding it would remove the
      seeder and every spec would fail on missing content.
- [ ] `docker compose run --rm -T wpcli wp core version` prints a version. If it says
      `This does not seem to be a WordPress installation`, the `btt-wp-core` volume did not
      initialise from your image — Lesson 02.2 Key Concept 3.
- [ ] `actionlint .github/workflows/_web.yml` is clean.
- [ ] Four separate named steps for `type-check`, `lint`, `test:coverage` and `build`. One
      chained `&&` step reports "checks failed" and tells you nothing.
- [ ] `grep -c 'npm test' .github/workflows/_web.yml` is `0`. `npm test` is **watch mode**
      (Lesson 12.2) and would hang the runner until the job timeout.
- [ ] The `.next/cache` key includes both the lockfile and a source hash.
- [ ] `grep -c 'build-args' .github/workflows/_web.yml` is `0`.

### Step 4: `_php.yml` — PHPCS, PHPStan, Pest and `wp-phpunit`

```yaml
# .github/workflows/_php.yml
name: _php

on:
  workflow_call:
    inputs:
      php-version:
        required: false
        type: string
        # 8.3, NOT the 8.4 the application runs on. This job's job is to execute
        # Pest 1, and Pest 1 dies on 8.4 — Lesson 23.4 §1.1. The 8.4 coverage
        # comes from PHPCS's `testVersion 8.4-` in the PHPCS step below, which
        # is why that step is load-bearing rather than cosmetic.
        default: '8.3'

permissions:
  contents: read

jobs:
  php:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    defaults:
      run:
        # phpcs.xml.dist and phpstan.neon live HERE, beside composer.json, and
        # PHPCS discovers phpcs.xml.dist from the working directory. That is why
        # NO --standard flag appears anywhere in this file. The file used to sit
        # at wordpress-headless/phpcs.xml.dist, which NEITHER container could
        # see, so `composer run phpcs` could never have worked.
        working-directory: wordpress-headless/wp-content/plugins/blame-the-tech-core

    services:
      mysql:
        image: mysql:8.4
        env:
          # No literal password in a tracked file. The wp_test USER and its
          # password are created in a step below, generated per run and masked.
          MYSQL_ALLOW_EMPTY_PASSWORD: 'yes'
          MYSQL_DATABASE: wp_test
        ports: ['3306:3306']
        options: >-
          --health-cmd="mysqladmin ping -h 127.0.0.1 --silent"
          --health-interval=5s --health-timeout=5s --health-retries=20

    steps:
      - uses: actions/checkout@v4

      - uses: shivammathur/setup-php@v2
        with:
          # 8.3, matching the local `phptest` service rather than the
          # application image. Deliberate, and the reason is at the input
          # default above: the runner and the runtime are split, and PHPCS
          # carries the 8.4 half.
          php-version: ${{ inputs.php-version }}
          tools: composer:v2
          coverage: none
          extensions: mysqli, mbstring, zip

      - id: composercache
        run: echo "dir=$(composer config cache-files-dir)" >> "$GITHUB_OUTPUT"

      - uses: actions/cache@v4
        with:
          path: ${{ steps.composercache.outputs.dir }}
          key: composer-${{ runner.os }}-php${{ inputs.php-version }}-${{ hashFiles('wordpress-headless/wp-content/plugins/blame-the-tech-core/composer.lock') }}
          restore-keys: composer-${{ runner.os }}-php${{ inputs.php-version }}-

      # A CI runner has PHP and Composer natively, so the Composer scripts run
      # verbatim. Locally, `composer test:integration` has to be bypassed — the
      # container that has WordPress has no Composer binary. A Composer script
      # documents a command; it does not guarantee every host can run it.
      - run: composer install --no-interaction --no-progress --prefer-dist

      - name: PHPCS
        run: composer run phpcs

      - name: PHPStan, level 6
        run: composer run phpstan

      - name: Pest unit — WordPress mocked out with Brain Monkey
        run: composer test:unit

      - name: Create the wp_test user with grants on wp_test only
        working-directory: .
        run: |
          pw="$(openssl rand -base64 24 | tr -d '\n=+/')"
          # Mask anything DERIVED from or generated as a credential. GitHub masks
          # the exact value of a repository secret; it knows nothing about this.
          echo "::add-mask::$pw"
          echo "WP_TESTS_DB_PASSWORD=$pw" >> "$GITHUB_ENV"
          mysql -h 127.0.0.1 -P 3306 -u root <<SQL
          CREATE USER 'wp_test'@'%' IDENTIFIED BY '$pw';
          GRANT ALL PRIVILEGES ON \`wp_test\`.* TO 'wp_test'@'%';
          FLUSH PRIVILEGES;
          SQL

      - name: Pest integration — wp-phpunit against a real MySQL
        env:
          # WordPress comes from Composer: wp-phpunit/wp-phpunit plus
          # roots/wordpress-no-content as dev dependencies, so a runner needs no
          # bin/install-wp-tests.sh and no network fetch of a tarball.
          WP_TESTS_DB_NAME: wp_test
          WP_TESTS_DB_USER: wp_test
          WP_TESTS_DB_HOST: 127.0.0.1:3306
          WP_TESTS_PHPUNIT_POLYFILLS_PATH: vendor/yoast/phpunit-polyfills
        run: composer test:integration
```

**Verify §4:**

- [ ] `grep -c -- '--standard' .github/workflows/_php.yml` is **`0`**. If you find yourself
      wanting one, `phpcs.xml.dist` is in the wrong directory.
- [ ] The `php-version` default is `8.3`, and the comment above it says why it is not `8.4`.
- [ ] `grep -c 'wp_test' .github/workflows/_php.yml` is `5` or more, and `root` appears only in
      the user-creation step. The suite never runs as `root` and never touches the development
      database.
- [ ] `grep -c 'add-mask' .github/workflows/_php.yml` is `1`.
- [ ] `grep -cE 'IDENTIFIED BY .[A-Za-z0-9]{8,}' .github/workflows/_php.yml` is `0` — the
      password is a variable, generated in the step.

### Step 5: `_docker-wp.yml` — build, scan, push

```yaml
# .github/workflows/_docker-wp.yml
name: _docker-wp

on:
  workflow_call:
    outputs:
      image:
        description: 'The SHA-tagged image reference, or empty if none was built.'
        value: ${{ jobs.image.outputs.image }}

permissions:
  contents: read

jobs:
  image:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    outputs:
      image: ${{ steps.tag.outputs.image }}

    steps:
      - uses: actions/checkout@v4

      # Lesson 24.6 writes wordpress-headless/Dockerfile. Until then this whole
      # workflow skips CLEANLY rather than failing — which is exactly what
      # `skipped counts as pass` in ci-required is for (Key Concept 5).
      - id: guard
        env:
          # hashFiles() is empty when the glob matches nothing, which is the
          # native way to ask "does this file exist yet" in an Actions expression.
          DOCKERFILE_HASH: ${{ hashFiles('wordpress-headless/Dockerfile') }}
        run: |
          if [ -n "$DOCKERFILE_HASH" ]; then
            echo 'ready=true' >> "$GITHUB_OUTPUT"
          else
            echo 'ready=false' >> "$GITHUB_OUTPUT"
            echo '::warning::no production Dockerfile yet — Lesson 24.6 writes it.'
          fi

      - id: tag
        if: steps.guard.outputs.ready == 'true'
        run: |
          # The image name is FROZEN as btt-wp by appendix 07 §6. Lowercase the
          # owner: GHCR rejects an uppercase path and an org name may have one.
          owner="$(echo '${{ github.repository_owner }}' | tr '[:upper:]' '[:lower:]')"
          echo "image=ghcr.io/$owner/btt-wp:${{ github.sha }}" >> "$GITHUB_OUTPUT"
          echo "owner=$owner" >> "$GITHUB_OUTPUT"

      - uses: docker/setup-buildx-action@v3
        if: steps.guard.outputs.ready == 'true'

      - uses: docker/login-action@v3
        if: steps.guard.outputs.ready == 'true'
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          # The only credential this workflow holds. Scoped to this repository,
          # expires with the run, and `packages: write` above is what grants it.
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/build-push-action@v6
        if: steps.guard.outputs.ready == 'true'
        with:
          context: wordpress-headless
          file: wordpress-headless/Dockerfile
          # A fork's GITHUB_TOKEN has no packages: write. Load locally instead —
          # and NEVER reach for pull_request_target, which would run an untrusted
          # head with this repository's secrets (Key Concept 6).
          push: ${{ github.event.pull_request.head.repo.fork != true }}
          load: ${{ github.event.pull_request.head.repo.fork == true }}
          tags: |
            ${{ steps.tag.outputs.image }}
            ${{ github.ref == 'refs/heads/main' && format('ghcr.io/{0}/btt-wp:main', steps.tag.outputs.owner) || '' }}
          # NO build-args and NO secrets. `docker history` prints build args in
          # plain text to anyone with pull access — appendix 04 §1 rule 3.
          cache-from: type=gha
          cache-to: type=gha,mode=max
          provenance: false

      - name: Trivy — HIGH and CRITICAL with a fix available
        if: steps.guard.outputs.ready == 'true'
        uses: aquasecurity/trivy-action@v0.28.0
        with:
          image-ref: ${{ steps.tag.outputs.image }}
          severity: HIGH,CRITICAL
          # The threshold is frozen by Lesson 24.5: zero HIGH/CRITICAL THAT HAVE
          # A FIX AVAILABLE. An unfixable CVE in a base image is not something
          # this pull request can act on, and a gate you cannot satisfy is a gate
          # somebody disables.
          ignore-unfixed: true
          exit-code: '1'
          format: table
```

**Verify §5:**

- [ ] `grep -c 'btt-wp' .github/workflows/_docker-wp.yml` is `3` or more, and the name is exactly
      `btt-wp` — frozen by [appendix 07 §6](../appendix/07-command-reference.md#6-quality-gates-module-21-22-24).
- [ ] `grep -c 'ignore-unfixed' .github/workflows/_docker-wp.yml` is `1`.
- [ ] `grep -c 'build-args\|secrets:' .github/workflows/_docker-wp.yml` is `0`.
- [ ] The `image` output is declared at the **workflow** level under `on.workflow_call.outputs`
      and wired from the job. A job-level `outputs:` alone is invisible to the caller, and the
      symptom is an `e2e` job that skips with no explanation.
- [ ] There is **no deploy step**. Lesson 24.6 owns `deploy-wp.yml`; this builds, scans and
      pushes only.

### Step 6: The contract job and the sharded E2E, in `ci.yml`

```yaml
# .github/workflows/ci.yml — append these two jobs
  # The stage the README's diagram draws after the three reusable workflows.
  # `!cancelled()` plus per-dependency result checks is the same pattern
  # ci-required uses, at smaller scale (Key Concept 5).
  contract:
    needs: [detect, web, php]
    if: >-
      ${{ !cancelled()
        && needs.web.result != 'failure'
        && needs.php.result != 'failure'
        && (needs.detect.outputs.web == 'true' || needs.detect.outputs.php == 'true') }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
    defaults:
      run:
        working-directory: next-app
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: next-app/package-lock.json
      - run: npm ci
      # THIS JOB HOLDS NO CREDENTIAL. codegen reads the COMMITTED
      # wordpress-headless/schema.graphql (Lesson 06.3) rather than introspecting
      # a live WordPress, which is appendix 04 §7's promise cashed in.
      - name: Codegen and schema drift
        run: npm run codegen:check
      - name: NEGATIVE — nothing else drifted either
        run: git diff --exit-code -- ../wordpress-headless/schema.graphql src/gql

  e2e:
    needs: [detect, web, image]
    if: >-
      ${{ !cancelled()
        && needs.web.result != 'failure'
        && needs.image.result == 'success'
        && needs.image.outputs.image != '' }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: read
    strategy:
      # shard 2 failing must not cancel shard 3 — you want the whole picture.
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4]
    # No `services:` block: docker-compose.yml already declares db, mailpit and
    # the run-on-demand wpcli, and e2e/global-setup.ts drives `wpcli` directly.
    steps:
      - uses: actions/checkout@v4

      - name: Bring up THE IMAGE THIS RUN BUILT
        working-directory: wordpress-headless
        env:
          # The SHA tag from needs.image.outputs.image. NOT :latest — :latest is
          # whatever main last pushed, which is not what you are reviewing.
          # Key Concept 6.
          BTT_WP_IMAGE: ${{ needs.image.outputs.image }}
        run: |
          echo '${{ secrets.GITHUB_TOKEN }}' | docker login ghcr.io -u '${{ github.actor }}' --password-stdin
          bash ../.github/ci-wp-stack.sh

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: next-app/package-lock.json

      - working-directory: next-app
        run: npm ci

      - working-directory: next-app
        run: npx playwright install --with-deps chromium

      - name: Seed, then shard ${{ matrix.shard }} of 4
        working-directory: next-app
        env:
          WP_GRAPHQL_ENDPOINT: http://127.0.0.1:8080/graphql
          WP_REST_BASE: http://127.0.0.1:8080/wp-json
          NEXT_PUBLIC_SITE_URL: http://127.0.0.1:3000
          NEXT_PUBLIC_DEFAULT_LOCALE: en
          E2E_MODE: '1'
          E2E_SECRET: ${{ secrets.E2E_SECRET }}
          BTT_EDITOR_PASSWORD: ${{ secrets.E2E_EDITOR_PASSWORD }}
          BTT_REPORTER_PASSWORD: ${{ secrets.E2E_REPORTER_PASSWORD }}
        # playwright.config.ts owns webServer, baseURL (127.0.0.1, never
        # localhost — Lesson 12.3) and retries. Nothing is re-specified here.
        run: npx playwright test --shard=${{ matrix.shard }}/4

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-shard-${{ matrix.shard }}
          path: |
            next-app/playwright-report/
            next-app/test-results/
          retention-days: 7
```

**Verify §6:**

- [ ] `grep -c ':latest' .github/workflows/ci.yml` is `0`. Verification check 2 asserts the
      positive form.
- [ ] The `e2e` job's `if:` requires `needs.image.result == 'success'`. A skipped `image` job
      skips `e2e`, and `ci-required` treats both skips as pass.
- [ ] `grep -c 'localhost:3000' .github/workflows/ci.yml` is `0`. Every address is `127.0.0.1`.
- [ ] `npm test` appears nowhere; `npx playwright test` is the only test invocation here.
- [ ] The contract job has no `services:` and no `WP_*` credential. If yours does, you are
      introspecting a live WordPress and have re-introduced the flakiness `schema.graphql` exists
      to remove.

### Step 7: The `quality` job — Lighthouse CI and axe against the preview

Lesson 21.4 wrote `lighthouserc.json` with the six budgeted routes and the thresholds; Lesson
22.4 finalised the `a11y` Playwright project. **This step wires them; it does not set a number.**

```yaml
# .github/workflows/ci.yml — append
  quality:
    needs: [detect, web]
    if: ${{ !cancelled() && needs.web.result == 'success' }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
      deployments: read
    defaults:
      run:
        working-directory: next-app
    steps:
      - uses: actions/checkout@v4

      # The Vercel GitHub integration creates a Deployment; Lesson 24.7 connects
      # it. Until then there is none, and this job SKIPS cleanly rather than
      # failing on a URL that does not exist.
      - id: preview
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          url=''
          for i in $(seq 1 20); do
            url="$(gh api "repos/${{ github.repository }}/deployments?sha=${{ github.sha }}&per_page=1" \
                    --jq '.[0].payload.web_url // empty' 2>/dev/null || true)"
            [ -n "$url" ] && break
            sleep 15
          done
          if [ -z "$url" ]; then
            echo '::warning::no Vercel preview for this SHA — Lesson 24.7 connects the integration.'
          fi
          echo "url=$url" >> "$GITHUB_OUTPUT"

      - uses: actions/setup-node@v4
        if: steps.preview.outputs.url != ''
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: next-app/package-lock.json

      - if: steps.preview.outputs.url != ''
        run: npm ci

      - name: Lighthouse CI against the preview
        if: steps.preview.outputs.url != ''
        env:
          # lighthouserc.json (Lesson 21.4) holds the six routes and every
          # threshold: First Load JS, LCP, CLS, TBT, and the category scores.
          # This job supplies only the origin.
          LHCI_BUILD_CONTEXT__CURRENT_HASH: ${{ github.sha }}
        run: npx lhci autorun --collect.url="${{ steps.preview.outputs.url }}/en"

      - name: axe against the preview
        if: steps.preview.outputs.url != ''
        env:
          PLAYWRIGHT_BASE_URL: ${{ steps.preview.outputs.url }}
          # WITHOUT this, six of the 23 scans are the authenticated ones and they
          # SKIP — and a skipped scan is not a failed scan, so the job goes green
          # having audited 17 routes while claiming 23. Lesson 22.4 Step 8 says so
          # in as many words. This is the whole reason the secret is here.
          BTT_REPORTER_PASSWORD: ${{ secrets.E2E_REPORTER_PASSWORD }}
        # Lesson 22.4's project. Zero critical and zero serious; moderate and
        # minor are reported, not failed — 22.4 set that and 24.5 restates it.
        run: npx playwright test --project=a11y

      - name: a11y counts into the job summary
        if: always() && steps.preview.outputs.url != ''
        # Lesson 22.4 Step 3's line, verbatim. "Reported, not enforced" means
        # nothing at all unless the report lands somewhere a human sees it
        # without downloading an artifact.
        run: |
          jq -s '{scans: length,
                  critical: (map(.counts.critical) | add),
                  serious:  (map(.counts.serious)  | add),
                  moderate: (map(.counts.moderate) | add),
                  minor:    (map(.counts.minor)    | add)}' \
            test-results/a11y/*.json >> "$GITHUB_STEP_SUMMARY"

      - uses: actions/upload-artifact@v4
        if: always() && steps.preview.outputs.url != ''
        with:
          name: quality-reports
          path: |
            next-app/.lighthouseci/
            next-app/playwright-report/
            next-app/test-results/a11y/
          retention-days: 7
```

**Verify §7:**

- [ ] No threshold appears in this file. Every number lives in `lighthouserc.json` (21.4) or in
      `e2e/a11y.spec.ts` (22.4). A number in two places is a number that will disagree with
      itself.
- [ ] `deployments: read` is the only permission beyond `contents: read`.
- [ ] The job **skips** cleanly with a warning when there is no preview, and `ci-required` counts
      that as pass. It goes live in Lesson 24.7.
- [ ] `BTT_REPORTER_PASSWORD` is set. Confirm it the only way that can fail: the summary line says
      `"scans": 23`, not `"scans": 17`. Six authenticated scans skipping is invisible in a green
      check, and a skip is what you get when the secret is absent.

### Step 8: `ci-required`, written so 24.5 can append one line

```yaml
# .github/workflows/ci.yml — the LAST job. Branch protection points at THIS and
# nothing else (Lesson 24.5 configures it).
  ci-required:
    # The NAME is a contract with branch protection. Do not rename it.
    name: ci-required
    # Lesson 24.5 appends `gitleaks`, `licences` and `commitlint` to this list.
    # ONE LINE, no logic change — the step below iterates whatever is here.
    needs: [detect, web, php, image, contract, e2e, quality]
    # WITHOUT always() this job is skipped whenever ANY dependency skipped, and
    # then reports nothing — leaving a required check sitting as "Expected"
    # forever on every docs-only pull request. Key Concept 5.
    if: always()
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Aggregate — skipped counts as pass, cancelled does not
        env:
          RESULTS: ${{ toJSON(needs) }}
        run: |
          echo "$RESULTS" | jq -r 'to_entries[] | "\(.key)\t\(.value.result)"'
          bad="$(echo "$RESULTS" | jq -r \
            '[to_entries[] | select(.value.result == "failure" or .value.result == "cancelled") | .key] | join(", ")')"
          if [ -n "$bad" ]; then
            echo "::error::failed or cancelled: $bad"
            exit 1
          fi
          echo 'every required job succeeded or was skipped'
```

**Verify §8:**

- [ ] `needs:` lists **every** job in `ci.yml` except `ci-required` itself. Count them: seven.
- [ ] `if: always()` is present. Remove it, push a docs-only change, and watch the pull request
      become unmergeable with no failing check anywhere. Worth doing once.
- [ ] `skipped` is **not** in the failure list and `cancelled` **is**.
- [ ] Adding a job to the aggregate is one line. If you had to touch the `jq`, rewrite it — 24.5
      appends three jobs and must not need to read this step.

### Step 9: Validate the YAML, then commit

You cannot run this pipeline from here; you can prove the files parse and that the guards read
correctly.

```bash
actionlint .github/workflows/*.yml
# If actionlint is unavailable, `gh workflow view` after pushing is the fallback,
# and `python3 -c 'import sys,yaml;[yaml.safe_load(open(f)) for f in sys.argv[1:]]' .github/workflows/*.yml`
# at least proves the YAML is well formed. Say which one you used.

git add .github/workflows/
git commit -m "ci: path-filtered pipeline, reusable workflows and the ci-required aggregate"
git push
gh run watch
```

**Verify §9:**

- [ ] `actionlint` reports nothing, or you have recorded which weaker check you ran instead.
      **Be honest about this** — an expression typo in a `needs.*.result` guard is silent, and
      `actionlint` is the only thing that catches it before a push.
- [ ] `gh pr checks` lists `ci-required`, and on a docs-only change it is the **only** green
      check. Every other job shows as skipped.
- [ ] `agentic-qa.yml` appears in `gh run list` and **not** in `ci-required`'s summary output.

---

## Verification

```bash
cd "$(git rev-parse --show-toplevel)"

# 1. Every workflow file parses. Say which tool you used, and be honest if you
#    could only reason about it: an expression typo in a needs.*.result guard is
#    silent, and actionlint is the only thing that catches it before a push.
actionlint .github/workflows/*.yml; echo "actionlint exit=$?"
# Expected: actionlint exit=0, no output
python3 -c 'import sys,yaml;[yaml.safe_load(open(f)) for f in sys.argv[1:]];print("yaml ok")' .github/workflows/*.yml
# Expected: yaml ok   (the fallback if actionlint is unavailable)

# 2. The E2E job's image reference is THIS RUN'S SHA TAG, not :latest.
#    This is the check that proves "CI tests what deploys" (Key Concept 6).
grep -c "needs.image.outputs.image" .github/workflows/ci.yml
# Expected: 2 or more — the e2e `if:` guard and the BTT_WP_IMAGE it exports
grep -n 'btt-wp' .github/workflows/_docker-wp.yml | grep -c 'github.sha'
# Expected: 1 — the SHA tag is what the image output carries
# 2b. NEGATIVE — nothing anywhere runs tests against a floating tag
grep -rn ':latest' .github/workflows/ | grep -vc 'ubuntu-latest'
# Expected: 0. `:latest` is whatever main last pushed, which is not what you
#           are reviewing, and it makes the whole pipeline decorative.
grep -rc 'wordpress:7.1-php8.4-apache' .github/workflows/
# Expected: 0 for every file — the dev image is not what production runs

# 3. NEGATIVE — pull_request_target appears nowhere
grep -rl 'pull_request_target' .github/ | wc -l
# Expected: 0. pull_request_target runs the base branch's workflow with WRITE
#           permissions and repository secrets against an untrusted head. There
#           is no safe use of it in this repository.

# 4. NEGATIVE — no job is over-permissioned
grep -rn 'permissions:' .github/workflows/ | wc -l
# Expected: 12 or more — one workflow-level and one per job
grep -rc 'write-all\|permissions: write' .github/workflows/
# Expected: 0 for every file
# 4b. Every `packages: write` is on the ONE job that pushes an image
grep -rn 'packages: write' .github/workflows/
# Expected: exactly two lines — the caller job `image` in ci.yml and the
#           `image` job in _docker-wp.yml. Nothing else needs it.

# 5. NEGATIVE — no secret in a build arg and no secret echoed
grep -rn 'build-args' .github/workflows/
# Expected: no output. `docker history` prints build args in plain text to
#           anyone with pull access (appendix 04 §1 rule 3).
grep -rnE 'run: *echo .*secrets\.' .github/workflows/
# Expected: no output
grep -rnE '\$\{\{ *secrets\.' .github/workflows/ | grep -c 'password-stdin'
# Expected: 2 — the two `docker login … --password-stdin` uses. A token on
#           stdin never reaches the process list or the step log.
# 5b. NEGATIVE — and no database or JWT credential exists in CI at all
grep -rncE 'WORDPRESS_DB_PASSWORD|GRAPHQL_JWT_AUTH_SECRET_KEY|BTT_APP_TOKEN' \
  .github/workflows/ | grep -v '_web.yml:1$'
# Expected: `:0` for every remaining file. `_web.yml` scores 1 and that hit is
#           this very check, which _web.yml also runs against the built bundle —
#           the pattern strings are in the file as grep arguments, not as values.
#           A check that matches its own text is the trap this course names most
#           often; here it is excluded by name rather than by loosening the
#           pattern, so a real leak in _web.yml would still show as `:2`.
#           Because schema.graphql is committed, codegen needs no live
#           WordPress — appendix 04 §7's promise, cashed in.

# 6. NEGATIVE — agentic-qa.yml is NOT aggregated
sed -n '/^  ci-required:/,/^  [a-z]/p' .github/workflows/ci.yml | grep -c 'agentic'
# Expected: 0 — it is advisory by construction (Key Concept 10)
grep -c 'agentic' .github/workflows/ci.yml
# Expected: 0 anywhere in the entry workflow

# 7. ci-required lists every other job, and treats skipped as pass
#    Anchored on the JOB NAME, not on `needs: [detect`: `contract` starts with the
#    same literal and appears earlier in the file, so the unanchored grep matched
#    the wrong job and printed a plausible answer to a question it never asked.
sed -n '/^  ci-required:/,/^    if:/p' .github/workflows/ci.yml | grep 'needs:'
# Expected: needs: [detect, web, php, image, contract, e2e, quality]
sed -n '/^  ci-required:/,$p' .github/workflows/ci.yml | grep -c 'if: always()'
# Expected: 1
# 7b. NEGATIVE — a SKIPPED job must not fail the aggregate
sed -n '/^  ci-required:/,$p' .github/workflows/ci.yml | grep -c "== 'skipped'"
# Expected: 0 — `skipped` appears nowhere in the failure predicate
sed -n '/^  ci-required:/,$p' .github/workflows/ci.yml | grep -c "cancelled"
# Expected: 1 — cancelled DOES fail: a cancelled job proved nothing

# 8. NEGATIVE — no --standard flag anywhere in the PHP job
grep -rc -- '--standard' .github/workflows/
# Expected: 0 for every file. phpcs.xml.dist now lives beside composer.json
#           inside the plugin, and PHPCS discovers it from the working
#           directory. A job written against the old layout — the file at
#           wordpress-headless/phpcs.xml.dist — could never have run, because
#           neither container could see it.
grep -c 'blame-the-tech-core$' .github/workflows/_php.yml
# Expected: 1 — the `defaults.run.working-directory`

# 9. NEGATIVE — no house-fact violations crept into a workflow
grep -rcE 'allow-root|exec wordpress wp|npm run typecheck' .github/workflows/
# Expected: 0 for every file
grep -rc 'next-app/schema' .github/workflows/   # this path must not exist anywhere
# Expected: 0 for every file. The committed schema is
#           wordpress-headless/schema.graphql (Lesson 06.3), and a copy under
#           next-app would be a second source of truth nothing regenerates.
grep -rc 'npm test' .github/workflows/
# Expected: 0 — `npm test` is watch mode and would hang until the job timeout.
#           `npm run test:coverage` and `npx playwright test` are the forms used.

# 10. PHP is 8.3, matching the phptest runner — NOT the application image
grep -A1 'php-version:' .github/workflows/_php.yml | grep -c "'8.3'"
# Expected: 1 or more

# 11. The four shards exist and do not cancel each other
grep -c 'shard: \[1, 2, 3, 4\]' .github/workflows/ci.yml
# Expected: 1
grep -c 'fail-fast: false' .github/workflows/ci.yml
# Expected: 1 — shard 2 failing must not cancel shard 3

# 11b. NEGATIVE — the overlay does NOT keep the plugin bind mounts, and does
#      keep the mu-plugins one. This is the check that proves CI tests the image.
grep -A12 'services:' .github/ci-wp-stack.sh | grep -c 'wp-content/plugins:/var/www/html/wp-content/plugins'
# Expected: 2 — btt-ci-plugins for `wordpress` and for `wpcli`, both NAMED
#           volumes. A `./wp-content/plugins:` here would mount the working tree
#           over the image and the whole E2E job would prove nothing.
grep -c 'mu-plugins' .github/ci-wp-stack.sh
# Expected: 1 — the comment explaining why it is NOT overridden. The base file's
#           bind mount stays, and that is the one enumerated difference.
grep -c 'docker-compose.override.yml' .github/ci-wp-stack.sh
# Expected: 1 — the filename Compose reads with no -f flag, which is what lets
#           e2e/global-setup.ts work unchanged (Lesson 12.4 Step 6).

# 11c. NEGATIVE — the generated files are not tracked
git check-ignore -v wordpress-headless/.env
# Expected: a .gitignore rule. No output = STOP.
git ls-files wordpress-headless/ | grep -c 'docker-compose.override'   # must not exist in git
# Expected: 0. The overlay is generated per run and must never be committed.

# 12. NEGATIVE — no threshold is duplicated into a workflow
grep -rcE '\b(180|2500|0\.90|0\.95|200)\b' .github/workflows/ci.yml
# Expected: 0. Every number lives in lighthouserc.json (21.4) or
#           e2e/a11y.spec.ts (22.4). A number in two files is a number that
#           will eventually disagree with itself.

# 13. NEGATIVE — a floating action version is not used for anything privileged
grep -rnE 'uses: .*@(main|master|v[0-9]+\.[0-9]+\.[0-9]+-)' .github/workflows/
# Expected: no output. Major-version tags are the compromise this repository
#           accepts; a branch reference would let an action change under you.

# 14. Once pushed: the aggregate is the single required check
gh run watch
gh pr checks
# Expected: `ci-required` present and green. On a docs-only pull request it is
#           the ONLY green check and every other job shows skipped.
gh run view --log --job ci-required | tail -12
# Expected: a job/result table, then "every required job succeeded or was skipped"
```

Checks 2b and 7b are the two that prove the design rather than the syntax. If check 2b finds a
`:latest`, the E2E suite is testing an image built from a different commit and every conclusion
it produces is about code you are not reviewing. If check 7b finds `skipped` in the failure
predicate, the first docs-only pull request becomes unmergeable with no failing check to point
at — and the usual fix somebody reaches for is `continue-on-error: true`, which nobody ever
removes.

## Control Questions

1. `_web.yml` builds against `btt-wp:main` while the `e2e` job uses `btt-wp:<sha>`. Justify the
   inconsistency by saying what each job is actually proving, then describe the class of bug this
   arrangement would miss and how you would decide whether that class matters enough to pay for.
2. `ci-required` treats `skipped` as pass. Construct a change that would merge green under that
   rule while genuinely being untested, then say which part of the path-filter configuration
   would have to be wrong for your scenario to be reachable.
3. The `e2e` job mounts `wp-content/mu-plugins` into an otherwise untouched production image.
   Name three properties of production that mount does **not** compromise, name the one it does,
   and propose an alternative that removes it — including what the alternative costs.
4. A contributor opens a pull request from a fork. Walk through which jobs run, which skip, and
   why — then explain precisely what `pull_request_target` would hand that contributor, and what
   you would put in `CONTRIBUTING.md` instead.
5. The `.next/cache` key hashes both the lockfile and the source tree. Describe a concrete failure
   caused by dropping the source hash, and a different concrete failure caused by dropping the
   `restore-keys:` prefix — then say which of the two you would rather ship and why.

## Learn More

- [GitHub Actions — workflow syntax](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions) —
  the authoritative key list; skim `concurrency`, `permissions`, `defaults.run` and `strategy`
  specifically, because those four carry most of this lesson
- [GitHub Actions — reusing workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) —
  `workflow_call`, how `inputs:` and `outputs:` are declared, and the permission-inheritance rule
  that catches everybody once
- [GitHub Actions — expressions and `needs` contexts](https://docs.github.com/en/actions/reference/evaluate-expressions-in-workflows-and-actions) —
  `always()`, `!cancelled()`, `toJSON()`, and the `needs.<id>.result` values the aggregate reads
- [`actionlint`](https://github.com/rhysd/actionlint) — install it before you push; it type-checks
  expressions and catches the `needs.docker-wp` hyphen trap from Key Concept 2
- [`dorny/paths-filter`](https://github.com/dorny/paths-filter) — the filter syntax, and its own
  note about needing a base ref, which is why every output here is unconditional off a pull request
- [GitHub — security hardening for Actions](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments) —
  read the `pull_request_target` section, then the script-injection section, then Key Concept 8 again
- [Playwright — sharding and merging reports](https://playwright.dev/docs/test-sharding) — how
  `--shard` splits work and what `merge-reports` needs to produce one HTML report from four
- [`shivammathur/setup-php`](https://github.com/shivammathur/setup-php) — version syntax,
  extensions, and the Composer cache recipe Step 4 uses
- [`aquasecurity/trivy-action`](https://github.com/aquasecurity/trivy-action) — `ignore-unfixed`,
  `exit-code` and the difference between scanning an image and scanning a filesystem
