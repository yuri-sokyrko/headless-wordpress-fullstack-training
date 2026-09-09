---
title: 'Quality Gates & Branch Protection'
module: 24
lesson: 5
teaches: [quality-gates, phpstan-baseline, patch-coverage, gitleaks, trivy, licence-allowlist, commitlint, branch-protection, ratchet-philosophy]
produces: ['docs/quality-gates.md', '.github/workflows/ci.yml', '.github/codecov.yml', 'next-app/scripts/check-patch-coverage.mjs', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/phpstan.neon']
requires: [24.4, 22.4, 21.4]
---

# Lesson 24.5 — Quality Gates & Branch Protection

## Quick Overview

A gate is a check with a threshold and a consequence. Without the threshold it is a dashboard;
without the consequence it is a suggestion. This lesson assembles every check the course has
produced into one table with four columns — `Gate | Tool | Threshold | Blocks merge?` — writes it
into `docs/quality-gates.md`, and then configures branch protection to enforce it. The table is
the deliverable, because a gate table is the shortest honest answer to "what does this
codebase guarantee?", and it is the first thing a new contributor should read.

Two gates need explaining beyond their row. **PHPStan runs at level 6 with a shrink-only
baseline**: existing violations are recorded in a baseline file so the gate does not fail on day
one, and the baseline may only get smaller — a pull request that adds an entry fails. That gives
you a strict analyser on a real codebase without a two-week stop-the-world cleanup. And
**coverage is measured on the patch, not the total**: 80% of the lines *this pull request*
changed, which is a threshold a reviewer can act on, unlike a total-coverage percentage that
moves by 0.1% and tells nobody anything.

Then the ratchet, restated because it applies to every row and it is what keeps a gate table
alive: **start every threshold at "no worse than today" and raise it in a dedicated pull
request.** A gate set at an aspirational number is red on arrival, red for reasons unrelated to
the change in front of it, and disabled within a week. A gate set at your measured baseline is
green on arrival and blocks exactly the regressions it exists to block.

By the end of this lesson you will have:

- `docs/quality-gates.md` — the complete table, with the threshold and the blocking decision for
  every gate, and the date each threshold was last raised
- A shrink-only PHPStan level 6 baseline enforced by a check, and Codecov patch coverage at
  ≥ 80% with a written list of legitimately excluded paths
- `gitleaks` scanning the full history on first run and the diff thereafter
- Trivy on the WordPress image failing on HIGH and CRITICAL **that have a fix available**, a
  per-directory licence allowlist, and `commitlint` on pull request titles and commits
- Branch protection on `main` requiring exactly one status check — `ci-required` — plus review,
  linear history and no force pushes
- A written escape-hatch procedure: how to ship past a gate on purpose and what gets recorded

The table you assemble, in summary — `docs/quality-gates.md` is the authoritative copy:

| Gate | Tool | Threshold | Blocks merge? |
|---|---|---|---|
| Type safety | `tsc --noEmit` | strict, zero errors | ✅ |
| JS lint | ESLint | `--max-warnings=0` | ✅ |
| GraphQL documents | `@graphql-eslint` | zero errors against `schema.graphql` | ✅ |
| PHP style | PHPCS (WPCS) | zero errors | ✅ |
| PHP static analysis | PHPStan | level 6, shrink-only baseline | ✅ |
| Patch coverage | Vitest + Codecov | ≥ 80% of changed lines | ✅ |
| Schema / codegen drift | `git diff --exit-code` | no diff | ✅ |
| E2E | Playwright | all pass; **zero quarantined tests in the required set** | ✅ |
| Accessibility | `@axe-core/playwright` | zero `critical`, zero `serious` | ✅ |
| Lighthouse | Lighthouse CI | perf ≥ 0.90, a11y ≥ 0.95, SEO ≥ 0.95 | ✅ |
| LCP / CLS | Lighthouse CI | ≤ 2500 ms / ≤ 0.10 | ✅ |
| Bundle budget | `next build` + script | ≤ 180 KB gzip, ≤ +10 KB vs `main` | ✅ |
| Secret scanning | gitleaks | zero findings | ✅ |
| Image vulnerabilities | Trivy | zero HIGH/CRITICAL **with a fix** | ✅ |
| Dependency licences | allowlist per directory | no GPL/AGPL in `next-app` | ✅ |
| Commit format | commitlint | conventional commits | ✅ |
| Agentic QA | Playwright MCP | advisory only — see Lesson 23.9 | ❌ |
| AI code review | review job | advisory except two findings — see Lesson 24.8 | ❌ |

## Classic WP Analogy

Your Classic equivalent, if you had one, was PHPCS with the WordPress Coding Standards ruleset —
and that is a genuinely good starting point, because it already taught you the central insight:
**a rule enforced by a tool changes the default, and a rule enforced by a person does not.**
Before PHPCS, correct spacing required someone to care at the moment of typing. After PHPCS,
incorrect spacing required someone to fight the tool.

Where the analogy breaks is scope and stakes. PHPCS covered one language, one concern, and its
failures were unambiguous. This table covers two languages, four runtimes, performance,
accessibility, security, licensing and commit hygiene, and several of its rows are **judgement
calls dressed as numbers**. Is 180 KB the right bundle budget? Is patch coverage at 80% right?
Neither has a correct answer; both have a *defensible* answer that someone wrote down, which is
strictly better than no answer.

That difference has a practical consequence with no PHPCS counterpart: **this table needs an
escape hatch, and PHPCS did not.** A style violation is always wrong, so a hard failure is always
correct. A bundle-budget violation might be the right trade for a genuinely valuable feature. So
the procedure is defined here — raise the threshold in the same pull request, in the file, with
the reason written down — and it is deliberately not "add `continue-on-error`". A gate that can
be bypassed silently is not a gate. A gate that can be bypassed *on the record* is a gate people
will still trust in a year.

---

## Key Concepts

### 1. The anatomy of a gate: five parts, and what is missing when one is absent

A gate is not a tool. A tool is one fifth of a gate. Write down which fifth you are missing and
the failure mode names itself.

| Part | What it answers | Absent, you get |
|---|---|---|
| **Check** | what is measured | nothing — this is the part everybody has |
| **Threshold** | what counts as failure | a **dashboard**: a number nobody compares to anything |
| **Consequence** | what happens on failure | a **suggestion**: a red tick people learn to scroll past |
| **Owner** | who may change the threshold | a **drifting** number, lowered by whoever was blocked last |
| **Escape hatch** | how you ship past it on purpose | a **disabled** gate, because the first genuine exception wins |

The last row is the one teams skip, and it is the one that kills gates. A gate with no defined way
past it does not become a gate people respect; it becomes a gate people route around, and the
route is always `continue-on-error: true`, added at 18:40 on a Friday and never removed.

```
   A CHECK                          A GATE
   ───────                          ──────
   run the tool                     run the tool
   print the number                 compare it to a threshold somebody chose
   ...                              fail the job if it is worse
                                    name the person who may raise the threshold
                                    define the recorded procedure for raising it
```

`docs/quality-gates.md` holds parts two to five; the tool configuration holds part one. The split
is deliberate: a threshold buried in YAML is invisible to a reviewer, and a threshold in a
document nobody enforces is a wish.

### 2. Where each of the eighteen numbers came from, and which are judgement calls

Provenance matters because it tells you who to argue with. Three of these categories are
arguable; one is not.

| Kind | Rows | Argue with |
|---|---|---|
| **Binary** — the tool says yes or no | type safety, ESLint, `@graphql-eslint`, PHPCS, schema/codegen drift, secret scanning, commit format, licences | nobody. There is no threshold to choose. |
| **Measured** — set from this codebase's own baseline | First Load JS (≤ 180 KB), the ≤ +10 KB delta, LCP, CLS, TBT | the measurement. Take a new one and the number moves. |
| **Community default** — an outside body chose it | Lighthouse ≥ 0.90 / ≥ 0.95 / ≥ 0.95, axe severity partition, PHPStan level 6 | the tool's own documentation. |
| **Judgement** — somebody wrote down a defensible answer | patch coverage ≥ 80%, quarantined-test count, Trivy's "with a fix" qualifier | a person, in a pull request. |

Every measured number was set by [Lesson 21.4](../21-core-web-vitals-and-performance/04-performance-budgets-and-guardrails.md);
the axe severity split by [Lesson 22.4](../22-accessibility/04-accessibility-in-ci.md). This
lesson re-derives none of them and changes none of them. It assembles them, decides which block a
merge, and configures the enforcement.

**Is 180 KB the right bundle budget? Is 80% the right patch-coverage floor?** Neither has a
correct answer. Both have a *defensible* answer somebody wrote down with a date, which is strictly
better than no answer and much better than a number chosen by whoever configured the tool. Several
rows are **judgement calls dressed as numbers**, and pretending otherwise is how a table stops
being believed.

### 3. The ratchet: start at "no worse than today"

[Lesson 21.4](../21-core-web-vitals-and-performance/04-performance-budgets-and-guardrails.md)
owns this argument; cite it rather than re-deriving it. The one-line version: a gate introduced at
an aspirational number is red on arrival, red for reasons unrelated to the change in front of it,
and disabled within a week. A gate introduced at your measured baseline is green on arrival and
blocks exactly the regressions it exists to block.

What is specific here is that the ratchet now applies to eighteen rows written by eleven modules,
so it needs a mechanism rather than a habit:

| | Aspirational gate | Ratcheted gate |
|---|---|---|
| Day one | red, on a change that broke nothing | green |
| First failure | "the gate is broken" | "this change made it worse" |
| Who investigates | nobody | the author, who still remembers why |
| Six weeks later | `continue-on-error: true` | one row tightened, with a date |

The cost is real: you ship a codebase measurably worse than your standard and write the current
number down as acceptable. That is a concession. The alternative is a gate that measures nothing
because it is off.

### 4. The escape hatch, defined — and what it is not

Because several rows are judgement calls, a violation is sometimes the right trade. A feature that
is genuinely worth 30 KB is a decision, not a defect. So the procedure is defined up front:

**To ship past a gate:** raise the threshold **in the same pull request**, in the file that holds
it, with the reason and the date written next to it. The gate goes green because the number
changed, and the number changed on the record.

**What is not the procedure**, and each of these has a specific failure:

| Bypass | Why it is not allowed |
|---|---|
| `continue-on-error: true` | the job reports success. Nothing in the pull request says a gate was skipped. |
| Deleting or commenting out the step | the same, plus it survives into every later pull request |
| `git commit --no-verify` | defeats the local hook only. CI still runs — which is the point of Lesson 24.8's design |
| An administrator merging past a red check | invisible in the diff; visible only in an audit log nobody reads |
| Lowering the threshold in a follow-up pull request | the change that needed it merged green, so nothing links the two |

> **The distinction in one sentence.** A gate that can be bypassed silently is not a gate; a gate
> that can be bypassed **on the record** is one people still trust in a year.

PHPCS never needed this, and that is the difference between the tool you know and the table you
are building. A style violation is a fact — the line is indented correctly or it is not — so a
hard failure is always right and no escape hatch is required. Eleven of these eighteen rows are
like that. Seven are not.

### 5. PHPStan level 6, with a baseline that may only shrink

PHPStan has ten levels. Turning it on at level 6 on a codebase that has never seen it produces
several hundred findings, mostly missing array shapes and parameter types. Three honest options:
fix them all first, run at level 0 and learn nothing, or **record the current violations and
forbid new ones.**

| Approach | Day one | What it catches | Cost |
|---|---|---|---|
| Level 6, no baseline | hundreds of errors, gate red | everything | a stop-the-world cleanup nobody schedules |
| Level 0 | green | almost nothing | a strict analyser that is not analysing |
| **Level 6 + shrink-only baseline** | **green** | **every new violation** | the baseline is a debt list somebody must actually shrink |

`phpstan-baseline.neon` is a generated file listing each existing violation with a count. PHPStan
ignores everything in it, so the analyser is strict about new code and silent about old code. The
rule that makes this honest rather than a permanent amnesty: **the baseline may only get
smaller.** A pull request that adds an entry fails.

**How the shrink-only check is implemented, and its limits.** There is no PHPStan flag for this.
It is a convention enforced by a script: sum the `count:` values in the committed baseline on the
base branch and on the head branch, fail if the head total is higher. Cheap, needs no PHP, and
defeatable in exactly one way — consolidating two entries into one lowers the total while the code
gets worse. The mitigation is that a hand-edited generated file is a large, obvious diff, so that
case is caught by review rather than by the script. Say that out loud rather than implying the
check is airtight.

`phpstan.neon` goes **inside the plugin**, beside `composer.json` and `phpcs.xml.dist`, for the
container reason [Lesson 07.5](../07-javascript-toolchain-and-typescript/05-linting-formatting-and-editor-setup.md)
established: the `composer` service mounts only the plugin directory at `/app`, so a config one
level up is invisible to it. It also needs a `tests/` exclusion, or the analyser reports on Brain
Monkey's doubles from [Lesson 23.4](../23-testing-deep-dive-and-agentic-qa/04-testing-wordpress-php-with-pest.md)
— code whose entire purpose is to be dynamically shaped.

### 6. Coverage on the patch, not the total

Total coverage is the wrong instrument, and the arithmetic shows why. Suppose the application has
8,000 measurable lines at 62% covered, and a pull request adds 200 lines with **no tests at all**:

```
   before   4960 / 8000 = 62.00%
   after    4960 / 8200 = 60.49%
   delta    -1.51 percentage points
```

A 1.5-point drop is inside the noise of a normal week. Now invert it: the same author writes
twelve trivial tests for existing getters and total coverage goes **up** while the new 200 lines
stay untested. Total coverage rewards the wrong action and is nearly silent about the right one.

Patch coverage asks one question a reviewer can act on: **of the lines this pull request changed,
how many does a test execute?** For the same change it reports **0%**, on the diff, to the person
who wrote it.

[Lesson 12.2](../12-your-first-tests/02-your-first-vitest-test.md) configured coverage with **no
thresholds**, deliberately, and said so twice: "Lesson 23.1 sets the policy; Lesson 24.5 gates it,
on the patch rather than the total." That is a promise made to this lesson by name, and this is
where it is paid.

Three things about the measurement a gate must handle honestly:

| Situation | What the gate does |
|---|---|
| A changed line in a file inside `coverage.include` | measured; counts toward the 80% |
| A changed line in a file **outside** `coverage.include` | **not measurable** — excluded from the denominator and reported separately, with a count |
| A changed line containing no statement (a `}`, a type, a blank) | not counted either way |

The middle row bites. `coverage.include` in `vitest.config.ts` is deliberately narrow —
[Lesson 12.2](../12-your-first-tests/02-your-first-vitest-test.md) restricted it so `src/gql/`,
12,000 generated lines at 0%, did not drown the signal — and
[Lesson 23.2](../23-testing-deep-dive-and-agentic-qa/02-component-testing-with-rtl-and-msw.md)
widens it. Treating "not instrumented" as "not covered" would fail every pull request touching a
route file, so the gate would be off within a week; treating it as "covered" would be a lie.
Reporting it as a third, visible number is the only honest option, and its visibility is what
stops it becoming a hiding place.

Legitimately excluded, and written into `docs/quality-gates.md` so it is a decision rather than a
side effect: `src/gql/**` (codegen output), `src/messages/**` (translation catalogues — data, not
code), `**/*.test.ts(x)`, `e2e/**` (Playwright's suite, verified by running it) and `**/*.d.ts`.

### 7. Secret scanning: the whole history once, the diff every time

Two modes, because they answer different questions.

| Mode | Command shape | Question | When |
|---|---|---|---|
| Full history | `gitleaks detect` over every commit | "has a secret **ever** been committed?" | once, on adoption, then on a schedule |
| Diff | `gitleaks detect --log-opts=base..head` | "is this pull request adding one?" | every pull request |

Running the full history on every pull request is the first mistake: it is slow, every finding is
the same finding, the job goes red forever and gets disabled. Running only the diff is the second:
a secret committed before you adopted the tool stays invisible until somebody finds it the hard
way.

> **A secret that has been in git is compromised even after deletion. Rotate it; do not just
> remove it.** The object stays in the object database, in every clone anyone has pulled, in every
> fork, and in GitHub's reflog for a while after a force push. `git rm` changes what the tip of
> the branch looks like and nothing else. The module README opens with this sentence and this is
> where it is cashed in: the *only* remediation is to make the value worthless — `fly secrets
> set`, a new Vercel variable, a new token from the provider — plus a rotation entry in
> `docs/runbook.md`. [Lesson 15.2](../15-authentication-and-sessions/02-wpgraphql-jwt-authentication.md)
> already wrote that procedure for the JWT secret; this gate is what tells you to run it.

For this repository specifically: `.env` and `.env.*` have been gitignored since Module 01 and the
tracked `.env.example` carries only `__CHANGE_ME__`, so the full-history scan should be clean on
the first run. If it is not, you have found something real and the finding is worth more than the
gate.

### 8. Trivy, and the qualifier that keeps it enabled

`trivy image ghcr.io/<owner>/btt-wp:latest --severity HIGH,CRITICAL` on a Debian-based WordPress
image returns findings on day one; most are in the base image and many have **no fixed version
available**. A gate that fails on those is red for reasons the pull request in front of it cannot
address — the exact shape of a gate that gets disabled.

So the threshold is **zero HIGH or CRITICAL that have a fix available**, which Trivy expresses
directly with `--ignore-unfixed`.

| Finding | Blocks? | Because |
|---|---|---|
| CRITICAL in a dependency you added, fix in 2.1.4 | yes | you can act on it today |
| HIGH in `libc` with no fixed version | no | there is nothing to do but wait for the base image |
| HIGH in `libc`, fixed upstream, base image not rebuilt | **yes** | rebuilding is the action, and it is yours |

The cost, stated: an unfixable CRITICAL ships. That is a risk carried knowingly, and the control
is a scheduled scan — the same command **without** `--ignore-unfixed`, nightly, reported and not
blocking — so "no fix available" is tracked rather than hidden.

The scan itself runs in `_docker-wp.yml`, which is [Lesson 24.4](04-ci-with-github-actions.md)'s
file: that is the only job holding a built image. This lesson owns the **threshold** and the row in
the table, and the two live in different files on purpose — the flag is where the tool runs, the
decision is where a reviewer will read it.

### 9. Licences and commit format: the two cheapest rows, and one of them is a legal control

These two share a job: both are fast, both need no build, both fail on the diff.

**Licences.** [Lesson 24.2](02-security-hardening-next.md) built the per-directory check and
argued the distinction; this lesson gates it. The rule inverts between two directories of one
repository — `next-app` is proprietary and its `package.json` says `"license": "MIT"`, so **no GPL
or AGPL dependency may enter it**, while the plugin declares `"license": "GPL-2.0-or-later"`
because it derives from GPL code. Per-directory, or it is wrong in one of them.

**Commit format.** Conventional commits, on the pull request title **and** every commit in the
branch, because they are read by different things: the title is what lands on `main` under a
squash merge and what a changelog generator sees; the commits are what `git log` and `git bisect`
read. Checking one leaves the other free to be `wip`.

### 10. Branch protection points at exactly one check

[Lesson 24.4](04-ci-with-github-actions.md) built `ci-required` for this: one job that `needs:`
everything and reports one conclusion, treating a path-filtered skip as a pass. Branch protection
requires **that job and nothing else.**

```
   TWO REQUIRED CHECKS                    ONE REQUIRED CHECK
   ───────────────────                    ──────────────────
   ci-required        ✅                   ci-required   ✅  (aggregates all of them)
   php-tests       skipped ← waits            └─ php-tests skipped → counted as pass
   → "Expected — waiting for status"
   → merge blocked forever on a
     docs-only pull request
```

A required check GitHub never sees a result for sits as "Expected" indefinitely, and with
`dorny/paths-filter` in the pipeline that happens on every pull request that does not touch PHP.
Pointing at the aggregation job is what makes path filtering and branch protection coexist — and
it means **adding a required check is a change to that job's `needs:` list, in a pull request**,
which is the ratchet applied to the gate list itself.

The rest of the settings, and what each prevents:

| Setting | Prevents |
|---|---|
| Require a pull request, 1 approval | pushing to `main` |
| Require branches up to date before merging | the semantic conflict two green branches produce when merged |
| Require **linear history** | a merge commit whose contents no check ever ran on |
| Block force pushes | rewriting the history the gitleaks full-history scan certified |
| Block deletions | deleting `main` |
| Include administrators | the escape hatch that is not on the list in Key Concept 4 |

`Include administrators` is the one people leave off, and leaving it off is defensible only if you
say so in `docs/quality-gates.md`. An unwritten administrator bypass is the silent
`continue-on-error` of branch protection.

---

## Task

### Step 1: Inventory what already exists, and confirm you are extending two files

Nothing in this lesson creates a check from nothing. Every row already has a tool; what is missing
is thresholds, consequences and one document. Start by proving that.

```bash
cd /path/to/headless-wordpress-fullstack-training

# The document you are EXTENDING, not creating. Lesson 15.5 wrote it.
grep -c 'Entry-point verification matrix' docs/quality-gates.md
grep -c '^## ' docs/quality-gates.md

# The eleven checks that already run locally
grep -o '"[a-z:-]*":' next-app/package.json | sort -u | head -20
grep -o '"[a-z:-]*":' wordpress-headless/wp-content/plugins/blame-the-tech-core/composer.json | sort -u

# The pipeline Lesson 24.4 built. You append to this file; you do not rewrite it.
ls .github/workflows/
grep -c 'ci-required' .github/workflows/ci.yml
```

**Verify §1:**

- [ ] `Entry-point verification matrix` returns `1`. A `0` means you are about to create a file
      that already exists — stop and find out why.
- [ ] `grep -c '^## '` returns **3 or more**: Lesson 15.5's matrix, Lesson 16.3's PII section, and
      whatever 16.4, 17.2 and 18.3 appended. Your table is the next `##` section, at the end.
- [ ] `.github/workflows/` holds `ci.yml`, `_web.yml`, `_php.yml` and `_docker-wp.yml` from
      [Lesson 24.4](04-ci-with-github-actions.md), plus `agentic-qa.yml` from
      [Lesson 23.9](../23-testing-deep-dive-and-agentic-qa/09-from-agent-findings-to-deterministic-specs.md).
- [ ] `composer.json` already has `phpcs` and `phpcbf` from
      [Lesson 07.5](../07-javascript-toolchain-and-typescript/05-linting-formatting-and-editor-setup.md)
      plus `test:unit` and `test:integration` from Module 23. You add exactly one more.

### Step 2: PHPStan at level 6, inside the plugin

Three dev dependencies, installed through the `composer` service — the `wordpress` image has no
Composer binary, and the service mounts only the plugin directory at `/app`.

```bash
cd wordpress-headless

docker compose run --rm composer require --dev \
  phpstan/phpstan:^2.0 \
  szepeviktor/phpstan-wordpress:^2.0 \
  php-stubs/wordpress-stubs:^7.1
```

`--dev` matters twice: it keeps the analyser out of `composer install --no-dev`, which is what
[Lesson 24.6](06-building-and-deploying-wordpress.md) runs in the production image, and it is the
same flag that keeps Pest and `wp-phpunit` out of that image.

```neon
# wordpress-headless/wp-content/plugins/blame-the-tech-core/phpstan.neon
#
# Beside composer.json and phpcs.xml.dist, for the container reason Lesson 07.5
# established: the `composer` service mounts ONLY this directory at /app, so a
# config file one level up is invisible to it. PHPStan discovers this file from
# the working directory — there is no --configuration flag anywhere in the course.

includes:
    # Registered explicitly rather than through phpstan/extension-installer,
    # which is a Composer plugin and would need an allow-plugins entry. One
    # include line is cheaper than a permission.
    - vendor/szepeviktor/phpstan-wordpress/extension.neon

parameters:
    level: 6

    paths:
        - includes
        - blame-the-tech-core.php

    # Brain Monkey (Lesson 23.4) builds doubles by dynamically shaping objects.
    # A static analyser is RIGHT to dislike that code, and there is nothing to
    # fix, so it is out of scope rather than baselined.
    excludePaths:
        - tests

    # The baseline: every violation that exists today. It may only get smaller.
    # Regenerate with:
    #   docker compose run --rm composer exec -- phpstan analyse --generate-baseline
    baseline: phpstan-baseline.neon

    # WordPress ships no return types on most hooks, so every `add_filter`
    # callback would otherwise be reported. The stubs cover core; this covers
    # the plugins that have none.
    treatPhpDocTypesAsCertain: false
```

Add the one Composer script this lesson owes, then generate the baseline:

```json
{
  "scripts": {
    "phpcs": "phpcs",
    "phpcbf": "phpcbf",
    "phpstan": "phpstan analyse --memory-limit=512M"
  }
}
```

That is a fragment of the plugin's `composer.json`. Its `scripts` block already holds `phpcs` and
`phpcbf` from Lesson 07.5 plus `test:unit` and `test:integration` from Module 23 — keep every
entry you have and add `phpstan` beside them.

```bash
# From wordpress-headless/. The first run has no baseline yet, so it reports
# everything — that is the number you are about to record.
docker compose run --rm composer run phpstan || true

# Record it. This WRITES phpstan-baseline.neon beside phpstan.neon.
docker compose run --rm composer exec -- phpstan analyse --generate-baseline

# Now it is green, and it is green for an honest reason.
docker compose run --rm composer run phpstan
```

**Verify §2:**

- [ ] The second `composer run phpstan` exits `0`. Confirm with `echo $?`.
- [ ] `phpstan-baseline.neon` exists **inside the plugin**, beside `phpstan.neon`, and is
      committed. A gitignored baseline makes the gate pass locally and fail in CI.
- [ ] `grep -c 'count:' wp-content/plugins/blame-the-tech-core/phpstan-baseline.neon` is greater
      than zero and you have written the number down. That is your debt figure and Step 3 is what
      stops it growing.
- [ ] `grep -c -- '--standard' wp-content/plugins/blame-the-tech-core/composer.json` is `0` and
      `grep -c 'configuration' phpstan.neon` is `0`. Both tools discover their config from the
      working directory, in both containers and on a CI runner.

### Step 3: The shrink-only guard, as a job in `ci.yml`

[Lesson 24.4](04-ci-with-github-actions.md) created `ci.yml` and the reusable workflows, and
`_php.yml` is where `composer phpstan` runs. This lesson appends its own jobs to `ci.yml` and
touches nothing 24.4 wrote.

```yaml
# .github/workflows/ci.yml
# FRAGMENT — one new job appended to the `jobs:` map Lesson 24.4 created.
# Every job that lesson wrote (detect, web, php, docker-wp, contract, e2e,
# preview, ci-required) is unchanged. Do not reprint the file.
  phpstan-baseline:
    name: PHPStan baseline may only shrink
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    permissions:
      contents: read
    steps:
      # The base commit is needed, so a shallow clone is not enough.
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Compare baseline totals
        env:
          BASE: ${{ github.event.pull_request.base.sha }}
          BASELINE: wordpress-headless/wp-content/plugins/blame-the-tech-core/phpstan-baseline.neon
        run: |
          # Sum every `count:` value. Robust to reordering, which a regenerated
          # baseline does constantly; NOT robust to two entries being merged
          # into one. That case is a large diff in a generated file and is
          # caught by review, not by this script. Key Concept 5 says so.
          total() { awk '/^[[:space:]]+count:/ { s += $2 } END { print s + 0 }'; }

          before=$(git show "$BASE:$BASELINE" 2>/dev/null | total)
          after=$(total < "$BASELINE")

          echo "baseline entries: $before on base, $after on this branch"
          echo "### PHPStan baseline: $before → $after" >> "$GITHUB_STEP_SUMMARY"

          if [ "$after" -gt "$before" ]; then
            echo "::error::The PHPStan baseline grew by $((after - before)) entries."
            echo "Fix the new violation, or state in the pull request why level 6 is wrong here."
            exit 1
          fi
```

The `if:` on the job is deliberate. On a push to `main` there is no base commit to compare
against, so the job would be comparing `main` to itself; on a pull request it is exactly the
comparison you want. `ci-required` treats a skipped job as a pass, so this costs nothing on
`main`.

### Step 4: Patch coverage, as a script you can also run locally

Codecov reports patch coverage beautifully and does not fail a job on it — it publishes a **commit
status**, which is not a job, which means `ci-required` cannot depend on it (Key Concept 10). So
the threshold is enforced by a script and the annotation is Codecov's job. Both halves, with the
division of labour stated.

```mjs
// next-app/scripts/check-patch-coverage.mjs
//
// Patch coverage: of the lines THIS branch changed, how many does a test execute?
// Three outcomes, not two — see Lesson 24.5 Key Concept 6. A changed line in a
// file outside `coverage.include` is NOT measurable, and reporting it as
// uncovered would fail every pull request that touches a route file.
//
// Reads coverage/coverage-final.json, which is produced by:
//   npx vitest run --coverage --coverage.reporter=json
// Deliberately NOT by adding a reporter to vitest.config.ts: that file's
// coverage block is Lesson 12.2's and Lesson 23.2 widens its `include`.
//
// Usage (from next-app/):  node scripts/check-patch-coverage.mjs [baseRef]

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { relative, resolve } from 'node:path';

const baseRef = process.argv[2] ?? 'origin/main';
const minimum = Number(process.env.PATCH_COVERAGE_MIN ?? '80');

/** Lines this branch added or changed, per file, relative to next-app/. */
function changedLines() {
  // --relative makes git print paths relative to the CWD, so `src/lib/nav.ts`
  // rather than `next-app/src/lib/nav.ts`. --unified=0 gives one hunk per run
  // of changed lines, which is what we want to count.
  const diff = execFileSync(
    'git',
    ['diff', '--unified=0', '--relative', '--diff-filter=ACMR', `${baseRef}...HEAD`, '--', 'src'],
    { encoding: 'utf8' }
  );

  const byFile = new Map();
  let file = null;

  for (const line of diff.split('\n')) {
    const header = line.match(/^\+\+\+ b\/(.+)$/);
    if (header) {
      file = header[1];
      if (!byFile.has(file)) byFile.set(file, new Set());
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk && file) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let n = start; n < start + count; n++) byFile.get(file).add(n);
    }
  }
  return byFile;
}

/** file → Map(line → executed?) built from the istanbul-shaped JSON report. */
function coverageByLine() {
  const raw = JSON.parse(readFileSync('coverage/coverage-final.json', 'utf8'));
  const out = new Map();

  for (const [absolute, entry] of Object.entries(raw)) {
    const lines = new Map();
    for (const [id, loc] of Object.entries(entry.statementMap ?? {})) {
      const hit = (entry.s?.[id] ?? 0) > 0;
      for (let n = loc.start.line; n <= loc.end.line; n++) {
        // A line is covered if ANY statement on it ran. `a && b()` on one line
        // is one line, and pretending otherwise reports noise.
        //
        // The same loop has an effect in the other direction, measured and
        // accepted: a statement SPANNING lines 5-13 — a multi-line call — marks
        // all nine hit once its first line executes. That can only inflate patch
        // coverage, never deflate it, which is the right direction for a gate
        // whose failure blocks a merge. Statement ids are also strings and
        // NON-CONTIGUOUS (0, 2, 4, 5 …), which is why this walks
        // Object.entries rather than counting up an index.
        lines.set(n, (lines.get(n) ?? false) || hit);
      }
    }
    out.set(relative(resolve('.'), absolute), lines);
  }
  return out;
}

// Never counted, and each exclusion is a decision recorded in docs/quality-gates.md.
const EXCLUDED = [/^src\/gql\//, /^src\/messages\//, /\.test\.tsx?$/, /\.d\.ts$/];

const changed = changedLines();
const covered = coverageByLine();

let hits = 0;
let measurable = 0;
const uninstrumented = [];

for (const [file, lines] of changed) {
  if (EXCLUDED.some((re) => re.test(file))) continue;

  const report = covered.get(file);
  if (!report) {
    uninstrumented.push(`${file} (${lines.size} changed lines)`);
    continue;
  }
  for (const line of lines) {
    // A changed line with no statement on it — a brace, a type, a blank — is
    // counted in NEITHER direction. It cannot be covered and it is not a gap.
    if (!report.has(line)) continue;
    measurable++;
    if (report.get(line)) hits++;
  }
}

const pct = measurable === 0 ? 100 : (hits / measurable) * 100;

console.log(`patch coverage: ${hits}/${measurable} measurable lines = ${pct.toFixed(1)}%`);
console.log(`threshold:      ${minimum}%`);
if (uninstrumented.length) {
  console.log(`\nNOT MEASURABLE — outside coverage.include in vitest.config.ts:`);
  for (const f of uninstrumented) console.log(`  · ${f}`);
  console.log(`Lesson 23.2 widens that include. This count is printed so it cannot hide.`);
}
if (measurable === 0) {
  console.log('\nNo measurable changed lines. Passing, and saying so rather than reporting 0%.');
}

process.exit(pct + 1e-9 >= minimum ? 0 : 1);
```

**Verify §4:**

- [ ] From `next-app/`: `npx vitest run --coverage --coverage.reporter=json` writes
      `coverage/coverage-final.json`.
- [ ] `node scripts/check-patch-coverage.mjs origin/main` prints three numbers and exits `0` on a
      branch with no changes under `src/`.
- [ ] `git check-ignore -v coverage` still names a rule from the root `.gitignore`. A committed
      coverage report is the fastest way to make this gate meaningless.
- [ ] The script never prints `0%` when `measurable` is `0`. A pull request that touches only
      `.github/` legitimately has no measurable lines, and failing it would be the first thing
      anyone disabled.

### Step 5: The reviewer-facing half, in `.github/codecov.yml`

```yaml
# .github/codecov.yml
# Codecov reads its configuration from the repository root, `.github/` or `dev/`.
# It lives beside the workflows here because that is where the rest of the CI
# configuration is. Codecov ANNOTATES the diff; the gate is Step 4's script,
# because a Codecov commit status is not a job and `ci-required` cannot need it.
coverage:
  status:
    # Deliberately off. Lesson 12.2 argued this: a total-coverage percentage
    # that moves by 0.1% tells nobody anything, and the cheapest way to raise
    # it is to test the getters. Key Concept 6.
    project: off
    patch:
      default:
        target: 80%
        # No slack. The number is the number; raise it in a pull request whose
        # only content is the new number.
        threshold: 0%
        only_pulls: true

comment:
  layout: 'diff, files'
  # Update the existing comment rather than adding one per push.
  behavior: default
  require_changes: true

# Mirrors EXCLUDED in scripts/check-patch-coverage.mjs. Two lists that must
# agree is a real cost; the alternative is Codecov reporting a different number
# from the gate, which is worse.
ignore:
  - 'next-app/src/gql/**'
  - 'next-app/src/messages/**'
  - 'next-app/e2e/**'
  - 'next-app/**/*.test.ts'
  - 'next-app/**/*.test.tsx'
```

The `CODECOV_TOKEN` secret is already in the inventory at
[appendix 04 §7](../appendix/04-env-reference.md#7-secret-injection-per-target). The upload step
lives in `_web.yml`, which is [Lesson 24.4](04-ci-with-github-actions.md)'s file — it runs Vitest
with coverage, so it is the only job holding a report to upload.

### Step 6: Secret scanning, both modes

```yaml
# .github/workflows/ci.yml
# FRAGMENT — a second new job. Two modes, because they answer different
# questions (Key Concept 7): the whole history on a schedule, the diff on
# every pull request.
  secrets:
    name: gitleaks
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Scan
        env:
          # A pinned tag, not `latest`. A floating tag changes your gate
          # without a pull request, which is the thing this whole lesson is
          # against.
          IMAGE: ghcr.io/gitleaks/gitleaks:v8.21.2
          BASE: ${{ github.event.pull_request.base.sha }}
        run: |
          # --redact is not optional. Without it a finding puts the secret in
          # a public build log, which is a second disclosure caused by the tool
          # that found the first one.
          if [ -n "$BASE" ]; then
            LOG_OPTS="--no-merges $BASE..HEAD"
          else
            # Push to main, or the scheduled run: the whole history.
            LOG_OPTS=""
          fi

          docker run --rm -v "$PWD:/repo" "$IMAGE" \
            detect --source=/repo --redact --exit-code=1 \
            ${LOG_OPTS:+--log-opts="$LOG_OPTS"}
```

Run the full-history scan once, now, before you trust the diff mode. The command is the one
[appendix 07 §6](../appendix/07-command-reference.md#6-quality-gates-module-21-22-24) froze for the
working tree, plus the history form:

```bash
# Working tree, no git history — the frozen local form
npx gitleaks detect --no-git --redact

# Every commit that has ever existed on this branch
docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.21.2 \
  detect --source=/repo --redact --exit-code=1
```

**Verify §6:**

- [ ] Both commands exit `0`. `.env` and `.env.*` have been gitignored since Module 01 and the
      tracked `.env.example` carries only `__CHANGE_ME__`, so a clean result is expected.
- [ ] If either finds something, **stop and rotate the value**, then record the rotation in
      `docs/runbook.md`. Deleting the file does not help — Key Concept 7, and it is the sentence
      the module README opens with.
- [ ] `grep -c redact .github/workflows/ci.yml` is at least `1`. A gitleaks run without
      `--redact` publishes what it finds.

### Step 7: Licences, commit format, and the four `needs:` entries

```yaml
# .github/workflows/ci.yml
# FRAGMENT — the last two new jobs, then the ONLY edit this lesson makes to a
# job Lesson 24.4 wrote: four names in `ci-required`'s `needs:` list.
  licences:
    name: Dependency licences
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
          cache-dependency-path: next-app/package-lock.json

      # next-app is PROPRIETARY and its package.json says "license": "MIT".
      # Lesson 24.2 wrote this allowlist; this job is the consequence half.
      - name: next-app — no copyleft
        working-directory: next-app
        run: |
          npm ci
          npx license-checker --production --summary
          npx license-checker --production --failOn \
            'GPL-2.0-only;GPL-2.0-or-later;GPL-3.0-only;GPL-3.0-or-later;AGPL-3.0-only;AGPL-3.0-or-later;SSPL-1.0'

      # The plugin is the OPPOSITE rule. It derives from WordPress, so GPL is
      # required, and a permissive licence here would be the defect.
      - name: blame-the-tech-core — GPL required
        working-directory: wordpress-headless/wp-content/plugins/blame-the-tech-core
        run: |
          composer licenses --format=json > /tmp/licences.json
          jq -e '.license | test("GPL-2.0-or-later")' /tmp/licences.json
          jq -r '.dependencies | to_entries[] | "\(.key)\t\(.value.license[0])"' /tmp/licences.json

  commit-format:
    name: Conventional commits
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc

      # `--extends` rather than a config file, because commitlint.config.mjs
      # does not exist yet — Lesson 24.8 adds it along with the local Husky
      # hook. commitlint merges a discovered config file with --extends, so
      # this step keeps working unchanged once that file arrives. Reasoned,
      # not executed: check `commitlint --help` if your major differs.
      - name: Every commit in the branch
        env:
          BASE: ${{ github.event.pull_request.base.sha }}
        run: >
          npx --yes @commitlint/cli@19 --extends=@commitlint/config-conventional
          --from "$BASE" --to HEAD --verbose

      # The title is what lands on `main` under a squash merge, and what a
      # changelog generator reads. Checking only the commits leaves it free to
      # be "Update stuff".
      - name: The pull request title
        env:
          # NEVER interpolate ${{ }} directly into a `run:` script. A pull
          # request title is attacker-controlled text and `run:` is a shell.
          # An env var is a value; an interpolation is source code.
          PR_TITLE: ${{ github.event.pull_request.title }}
        run: >
          printf '%s' "$PR_TITLE" |
          npx --yes @commitlint/cli@19 --extends=@commitlint/config-conventional --verbose
```

```yaml
# .github/workflows/ci.yml
# FRAGMENT — the aggregation job Lesson 24.4 wrote. Only the `needs:` list
# changes: four names appended. The job's body, its `if: always()` and its
# skipped-as-pass logic are 24.4's and are unchanged.
  ci-required:
    needs:
      # …every job Lesson 24.4 listed, unchanged…
      - phpstan-baseline # Lesson 24.5
      - secrets          # Lesson 24.5
      - licences         # Lesson 24.5
      - commit-format    # Lesson 24.5
```

**Verify §7:**

- [ ] `grep -c 'continue-on-error' .github/` returns nothing anywhere in the tree. Key Concept 4.
- [ ] `grep -n '${{ github.event' .github/workflows/ci.yml` shows every use inside an `env:`
      block, never inside a `run:` line. One interpolation of a title into a shell is a remote
      code execution in your CI account.
- [ ] `.nvmrc` is used for the Node version in both new jobs. A hard-coded `node-version: 22`
      drifts from the version `next build` runs on, and you find out from a build failure.

### Step 8: Extend `docs/quality-gates.md` with the table

[Lesson 15.5](../15-authentication-and-sessions/05-authorization-and-hardening.md) created this
file with the entry-point verification matrix; 16.3, 16.4, 17.2 and 18.3 each appended a section.
**Append yours. Do not rewrite theirs.**

```markdown
<!-- docs/quality-gates.md — append. Lesson 15.5 created this file. -->

## The CI gate table (Lesson 24.5)

A gate is a check with a threshold and a consequence. Every row below has all three, plus a
named owner for the threshold and one recorded way past it. Sixteen rows block a merge; two are
advisory and say why.

| Gate | Tool | Threshold | Blocks merge? | Threshold set by |
|---|---|---|---|---|
| Type safety | `tsc --noEmit` | strict, zero errors | yes | binary — nothing to choose |
| JS lint | ESLint | `--max-warnings=0` | yes | binary |
| GraphQL documents | `@graphql-eslint` | zero errors against `schema.graphql` | yes | binary |
| PHP style | PHPCS (WPCS) | zero errors | yes | binary |
| PHP static analysis | PHPStan | level 6, shrink-only baseline | yes | tool default (Lesson 24.5) |
| Patch coverage | Vitest + Codecov | ≥ 80% of changed lines | yes | **judgement** (Lesson 24.5) |
| Schema / codegen drift | `git diff --exit-code` | no diff | yes | binary |
| E2E | Playwright | all pass; zero quarantined tests in the required set | yes | judgement (Lesson 23.1) |
| Accessibility | `@axe-core/playwright` | zero `critical`, zero `serious` | yes | Lesson 22.4 |
| Lighthouse | Lighthouse CI | perf ≥ 0.90, a11y ≥ 0.95, SEO ≥ 0.95 | yes | Lesson 21.4 |
| LCP / CLS | Lighthouse CI | ≤ 2500 ms / ≤ 0.10 | yes | **measured** (Lesson 21.4) |
| Bundle budget | `next build` + script | ≤ 180 KB gzip, ≤ +10 KB vs `main` | yes | **measured** (Lesson 21.4) |
| Secret scanning | gitleaks | zero findings | yes | binary |
| Image vulnerabilities | Trivy | zero HIGH/CRITICAL **with a fix available** | yes | judgement (Lesson 24.5) |
| Dependency licences | allowlist per directory | no GPL/AGPL in `next-app`; GPL required in the plugin | yes | legal, not technical |
| Commit format | commitlint | conventional commits, title and commits | yes | binary |
| Agentic QA | Playwright MCP | advisory only — Lesson 23.9's nondeterminism argument | no | — |
| AI code review | review job | advisory except two findings — Lesson 24.8 | no | — |

### Why two rows are advisory

**Agentic QA.** The same charter run twice takes different paths and sometimes reaches different
conclusions. A merge gate has to be reproducible or it is a coin toss with a red X, so agents
never gate; they produce the deterministic specs that do. Lesson 23.9 owns the argument.

**AI code review.** Advisory, except "secret detected" and "unauthenticated mutation" — and both
of those are ALSO caught deterministically, by gitleaks and by an integration test. The AI is a
second net and never the only net. Lesson 24.8 owns the argument.

### Patch coverage: what is measured and what is not

Measured on the lines this pull request changed, never on the total. Three outcomes:

| Outcome | Counted |
|---|---|
| Changed line inside `coverage.include` | in the numerator and denominator |
| Changed line **outside** `coverage.include` | in neither — reported separately, with a count |
| Changed line with no statement on it | in neither |

Legitimately excluded, each one a decision rather than an oversight:

| Path | Why |
|---|---|
| `src/gql/**` | 12k generated lines. Excluded from `coverage.include` since Lesson 12.2 |
| `src/messages/**` | translation catalogues — data, not code |
| `**/*.test.ts`, `**/*.test.tsx` | the tests themselves |
| `e2e/**` | Playwright's suite, verified by running it |
| `**/*.d.ts` | declarations, erased at build time |

### The escape hatch

To ship past any gate: **raise the threshold in the same pull request, in the file that holds it,
with the reason and the date.** Nothing else is permitted, and specifically not:
`continue-on-error: true`, deleting the step, `git commit --no-verify`, an administrator merging
past a red check, or lowering the threshold in a follow-up pull request.

Every threshold row above carries the date it was last raised, in the file that holds it:
`lighthouserc.json`, `scripts/check-bundle-budget.mjs`, `.github/codecov.yml`,
`phpstan-baseline.neon`. A number with no date is a number nobody will dare touch.

### Branch protection on `main`

Exactly **one** required status check: `ci-required`. Not two. A second required check that a
path filter can skip sits as "Expected" forever and blocks every unrelated pull request.

| Setting | Value |
|---|---|
| Require a pull request before merging | on, 1 approval, dismiss stale approvals |
| Require status checks to pass | on: `ci-required`, and nothing else |
| Require branches to be up to date | on |
| Require linear history | on |
| Allow force pushes / deletions | off / off |
| Include administrators | **on** |

### Known gaps (Lesson 24.5 additions)

8. **The shrink-only baseline check is a convention, not a guarantee.** It sums `count:` values
   across the baseline; merging two entries into one lowers the total while the code gets worse.
   The mitigation is that a hand-edited generated file is an obvious diff, so this one is caught
   by review rather than by the script.
9. **An unfixable HIGH or CRITICAL in the base image ships.** `--ignore-unfixed` is what keeps
   the Trivy gate from being permanently red on a CVE nobody can act on, and the cost is real.
   The control is a nightly scan **without** that flag, reported and not blocking, so the
   unfixable set is tracked rather than hidden.

(Add your own row: which of these eighteen gates would you turn off first under deadline
pressure, and what would that tell you about the threshold rather than the gate?)
```

**Verify §8:**

- [ ] `grep -c 'Entry-point verification matrix' docs/quality-gates.md` is still `1`. If it is `0`
      you replaced Lesson 15.5's section instead of appending to the file.
- [ ] `grep -c 'PII and logging' docs/quality-gates.md` is still `1` — Lesson 16.3's section
      survived too.
- [ ] Your table has **18 rows** plus a header and separator, and exactly **two** of them say
      `no` in the "Blocks merge?" column.
- [ ] Your "Known gaps" additions continue the existing numbering. If your file now shows **two
      items numbered 5**, that is Lesson 18.3's numbering slip landing on top of Lesson 17.2's
      additions — renumber your copy, it is your document.
- [ ] You filled in the parenthesis. The gate you would turn off first is the gate whose
      threshold you do not believe.

### Step 9: Configure branch protection, then prove it

```bash
# One required check. Read Key Concept 10 before you add a second.
gh api -X PUT "repos/{owner}/{repo}/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["ci-required"]
  },
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "enforce_admins": true,
  "restrictions": null
}
JSON
```

`enforce_admins: true` is the line people leave off. Leaving it off is a defensible choice only if
you write it into `docs/quality-gates.md` as a known gap, because an unwritten administrator
bypass is the silent `continue-on-error` of branch protection.

```bash
git add -A
git commit -m "ci: quality gates, PHPStan baseline and branch protection"
```

---

## Verification

```bash
cd /path/to/headless-wordpress-fullstack-training

# 1. The document was EXTENDED, not replaced. The grep for a heading Lesson 15.5
#    wrote is the only check that can tell the difference.
grep -c 'Entry-point verification matrix' docs/quality-gates.md
# Expected: 1
grep -c 'PII and logging' docs/quality-gates.md
# Expected: 1  (Lesson 16.3's section survived too)
grep -c 'The CI gate table (Lesson 24.5)' docs/quality-gates.md
# Expected: 1  — yours, appended at the end

# 2. Eighteen gate rows, and exactly two of them advisory
sed -n '/## The CI gate table/,/^### Why two rows/p' docs/quality-gates.md | grep -c '^| '
# Expected: 20  — 18 gates plus the header row plus the separator row
sed -n '/## The CI gate table/,/^### Why two rows/p' docs/quality-gates.md | grep -c '| no |'
# Expected: 2  — Agentic QA (Lesson 23.9) and AI code review (Lesson 24.8)

# 3. PHPStan runs, is green, and discovers its own config
cd wordpress-headless
docker compose run --rm composer run phpstan
# Expected: "[OK] No errors" and exit 0. Confirm: echo $?  → 0
test -f wp-content/plugins/blame-the-tech-core/phpstan.neon && echo "config in the plugin"
test -f wp-content/plugins/blame-the-tech-core/phpstan-baseline.neon && echo "baseline in the plugin"
# Expected: both lines print

# 4. NEGATIVE — neither PHP tool takes a config path on the command line. A
#    --standard or --configuration flag resolved outside the /app mount, which
#    is the defect Lesson 07.5 fixed and this lesson must not reintroduce.
grep -c -- '--standard\|--configuration' wp-content/plugins/blame-the-tech-core/composer.json
# Expected: 0

# 5. NEGATIVE — the baseline may only shrink. Probe it on a COPY, so nothing in
#    the repository changes and no `git checkout` is needed to undo it.
BL=wp-content/plugins/blame-the-tech-core/phpstan-baseline.neon
total() { awk '/^[[:space:]]+count:/ { s += $2 } END { print s + 0 }'; }
before=$(total < "$BL")
sed 's/^\([[:space:]]*count:\) 1$/\1 2/' "$BL" > /tmp/baseline-probe.neon
after=$(total < /tmp/baseline-probe.neon)
echo "before=$before after=$after"; [ "$after" -gt "$before" ] && echo "GUARD WOULD FAIL — correct"
# Expected: after > before, and "GUARD WOULD FAIL — correct".
#           If after == before your baseline has no `count: 1` entries; bump any
#           count by hand in the copy instead. The point is that the comparison
#           is a comparison, not that this particular sed matched.
rm -f /tmp/baseline-probe.neon

# 6. Patch coverage, on a branch with nothing changed under src/
cd ../next-app
npx vitest run --coverage --coverage.reporter=json --coverage.reporter=text > /tmp/cov-before.txt
grep 'All files' /tmp/cov-before.txt
# Expected: one line with the current TOTAL percentage. Write it down.
node scripts/check-patch-coverage.mjs main
# Expected: "No measurable changed lines. Passing" and exit 0.
#           A gate that failed a docs-only pull request would be off in a week.

# 7. NEGATIVE — the pair that proves the policy is on the PATCH and not the
#    total. Add an untested file, then read BOTH numbers.
git switch -c probe/patch-coverage
mkdir -p src/lib/probe
cat > src/lib/probe/untested.ts <<'TS'
export function neverCalledByAnyTest(a: number, b: number): number {
  if (a > b) return a - b;
  return b - a;
}
TS
git add src/lib/probe/untested.ts
git commit -q -m "test: probe for the patch-coverage gate"
npx vitest run --coverage --coverage.reporter=json --coverage.reporter=text > /tmp/cov-after.txt
grep 'All files' /tmp/cov-after.txt
# Expected: the TOTAL moved by a fraction of a percentage point, and NOTHING
#           reacts to it — there is no total-coverage gate, by Lesson 12.2's
#           decision. That is the first half of the pair.
node scripts/check-patch-coverage.mjs main; echo "exit=$?"
# Expected: "patch coverage: 0/4 measurable lines = 0.0%" (the exact count
#           depends on how v8 maps the statements) and exit=1. That is the
#           second half: the same change is invisible to the total and fatal to
#           the patch. Key Concept 6.

# 8. NEGATIVE — a changed file OUTSIDE coverage.include is reported as not
#    measurable, not as uncovered. Otherwise every route change fails the gate.
mkdir -p src/app/probe
cat > src/app/probe/page.tsx <<'TSX'
export default async function ProbePage(): Promise<React.JSX.Element> {
  return <p>probe</p>;
}
TSX
git add src/app/probe/page.tsx && git commit -q -m "test: probe outside coverage.include"
node scripts/check-patch-coverage.mjs main | grep -A2 'NOT MEASURABLE'
# Expected: src/app/probe/page.tsx listed under NOT MEASURABLE with its line
#           count. It must NOT appear in the numerator or the denominator.

# 9. Clean up the probes without `git checkout` and without touching main
git switch -
git branch -D probe/patch-coverage
git status --short
# Expected: no output. Both probes lived only on the deleted branch.

# 10. NEGATIVE — gitleaks actually fires, and redacts what it finds. The probe
#     is a syntactically-valid AWS access key ID made of one repeated
#     character: it matches gitleaks' `aws-access-token` rule, it authorises
#     nothing anywhere, and it is not a credential that has to be rotated
#     afterwards. Never probe a scanner with a value that is real somewhere.
cd ..
printf 'aws_access_key_id = AKIA%s\n' "$(printf 'Q%.0s' $(seq 16))" > _probe-leak.txt
npx gitleaks detect --no-git --redact --exit-code=1; echo "exit=$?"
# Expected: one finding naming _probe-leak.txt, exit=1, and the reported
#           value is REDACTED. If you can read it in the output, --redact is
#           missing and the tool that found the leak has just republished it
#           into a build log.
#           No finding at all means your gitleaks build applies an entropy
#           filter to that rule — use a value from gitleaks' own test fixtures
#           instead. Reasoned, not executed: rule sets change between minors.
rm _probe-leak.txt
test -f _probe-leak.txt || echo "probe removed"
# Expected: probe removed. The file was never committed, so there is nothing
#           to undo — which is why this probe is a file and not a commit.

# 11. The real history is clean
npx gitleaks detect --no-git --redact; echo "exit=$?"
# Expected: exit=0. `.env` and `.env.*` have been gitignored since Module 01.
docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.21.2 \
  detect --source=/repo --redact --exit-code=1; echo "exit=$?"
# Expected: exit=0 over the WHOLE history. A finding here is real, and the
#           remedy is rotation, not deletion — Key Concept 7.

# 12. NEGATIVE — no gate in the tree can be bypassed silently
grep -rc 'continue-on-error' .github/ | grep -v ':0$'
# Expected: no output. One hit is one gate that reports success while failing.
grep -rn 'if: always()' .github/workflows/ci.yml | head -3
# Expected: the `ci-required` job only. `always()` on a gate job is
#           `continue-on-error` wearing a different hat.

# 13. NEGATIVE — no attacker-controlled text is interpolated into a shell
grep -n 'run:.*${{ github.event' .github/workflows/*.yml
# Expected: no output. A pull request title inside a `run:` block is arbitrary
#           code execution with your workflow's token.
grep -c 'PR_TITLE: ${{ github.event.pull_request.title }}' .github/workflows/ci.yml
# Expected: 1 — the value passed as an environment variable instead.

# 14. The four new jobs are aggregated, so branch protection sees them
grep -A20 '^  ci-required:' .github/workflows/ci.yml | grep -cE 'phpstan-baseline|secrets|licences|commit-format'
# Expected: 4

# 15. NEGATIVE — branch protection requires exactly ONE check
gh api "repos/{owner}/{repo}/branches/main/protection" \
  --jq '.required_status_checks.contexts | length, .[]'
# Expected: 1, then ci-required.
#           A 2 breaks the skipped-as-pass design: with dorny/paths-filter in
#           the pipeline, any second required check sits as "Expected" forever
#           on every pull request that does not touch its paths, and merges
#           stop happening for a reason nobody can see in the diff.

# 16. NEGATIVE — and administrators are not an unwritten escape hatch
gh api "repos/{owner}/{repo}/branches/main/protection" \
  --jq '.enforce_admins.enabled, .required_linear_history.enabled, .allow_force_pushes.enabled'
# Expected: true, true, false. A `false` on the first line is only acceptable
#           if it is written into docs/quality-gates.md as a known gap.

# 17. Licences, both directions, locally
cd next-app && npx license-checker --production --summary | head -5
# Expected: a summary table with no GPL or AGPL row
cd ../wordpress-headless/wp-content/plugins/blame-the-tech-core
composer licenses --format=json | jq -r '.license'
# Expected: ["GPL-2.0-or-later"] — the OPPOSITE rule from next-app, in the same
#           repository. Lesson 24.2 argued the distinction.

# 18. NEGATIVE — commitlint rejects a message the course would not have written
printf 'Update stuff' | npx --yes @commitlint/cli@19 \
  --extends=@commitlint/config-conventional; echo "exit=$?"
# Expected: "subject may not be empty" / "type may not be empty" and exit=1
printf 'ci: aggregate required checks into ci-required' | npx --yes @commitlint/cli@19 \
  --extends=@commitlint/config-conventional; echo "exit=$?"
# Expected: exit=0 — and note that this is the exact line the module README
#           ends with. The convention has been demonstrated for 24 modules.
```

Checks 7 and 8 are the pair that matters, and running them in the wrong order hides the point:
the total-coverage number in check 7 is the one nobody would have noticed, and the patch number
is the one that stops the merge. If check 8 reports the route file as uncovered rather than as not
measurable, fix the script before you enable the gate — a gate that fails every pull request
touching `src/app/` is a gate that is off by next Thursday.

## Control Questions

1. Branch protection requires `ci-required` and nothing else. Suppose a colleague adds
   `php-tests` as a second required check because they want it visible in the merge box. Describe
   what happens to a pull request that changes only `docs/architecture.md`, why nothing in the
   diff explains it, and what you would point at to convince them to revert it.
2. The Trivy gate ignores unfixed vulnerabilities and the PHPStan gate ignores everything in the
   baseline. Both are deliberate, and only one of them has a mechanism that makes the ignored set
   shrink over time. Say which, describe the missing mechanism for the other, and say what you
   would have to build to add it.
3. A pull request changes 40 lines in `src/app/[locale]/incidents/page.tsx` and adds no tests.
   Total coverage moves by 0.2 points; patch coverage reports "0 measurable lines". Explain why
   both numbers are correct, why neither should fail the build, and which gate in the table *is*
   supposed to catch a broken route.
4. `continue-on-error: true` and raising a threshold in the same pull request both make a red gate
   go green. State the difference in terms of what a reader of the repository can reconstruct six
   months later, and then name one thing raising the threshold costs that `continue-on-error`
   does not.
5. gitleaks scans the full history on adoption and the diff thereafter. An engineer force-pushes
   to rewrite a commit that contained a token, the diff scan is green, and the token has been
   rotated. Say which of the three properties — history clean, diff clean, secret worthless —
   actually protects you, and why the other two are not enough on their own.

## Learn More

- [GitHub — about protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
  — read "Require status checks" carefully; it is where the "Expected — waiting for status"
  behaviour that motivates `ci-required` is documented in GitHub's own words. The
  [REST reference](https://docs.github.com/en/rest/branches/branch-protection) documents which
  fields Step 9's payload must send as `null` rather than omit
- [PHPStan — the baseline](https://phpstan.org/user-guide/baseline) — PHPStan's own position on
  baselines, including the warning that a baseline you never shrink is a baseline you should not
  have generated
- [PHPStan — rule levels](https://phpstan.org/user-guide/rule-levels) — what each level from 0 to
  10 adds, so "level 6" is a choice you can defend rather than a number you copied
- [`szepeviktor/phpstan-wordpress`](https://github.com/szepeviktor/phpstan-wordpress) — the
  WordPress extension and stub set; its README explains the `extension.neon` include Step 2 uses
  instead of `phpstan/extension-installer`
- [Codecov — patch status](https://docs.codecov.com/docs/commit-status) — the difference between
  the `project` and `patch` statuses, and the sentence that matters here: a Codecov status is a
  commit status, not a check run
- [gitleaks](https://github.com/gitleaks/gitleaks) — the rule set, `--log-opts` for diff scanning,
  and `--redact`; read the "gitleaks:allow" comment before you invent your own suppression scheme
- [Trivy — filtering vulnerabilities](https://trivy.dev/latest/docs/configuration/filtering/) —
  `--ignore-unfixed` and `.trivyignore`, and why an expiry date on a suppression is worth the
  effort
- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) — the whole spec is
  a short page, and it is what `@commitlint/config-conventional` encodes
- [SPDX licence list](https://spdx.org/licenses/) — the canonical identifiers the `--failOn` list
  in Step 7 has to spell exactly; `GPL-2.0` without a suffix has been deprecated for years and a
  typo here makes the gate pass silently
