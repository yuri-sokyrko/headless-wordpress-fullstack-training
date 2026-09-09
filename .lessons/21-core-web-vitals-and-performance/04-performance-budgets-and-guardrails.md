---
title: 'Performance Budgets & Guardrails'
module: 21
lesson: 4
teaches: [performance-budgets, lighthouse-ci, bundle-budget, ratchet-philosophy, ci-guardrails]
produces: ['next-app/lighthouserc.json', 'next-app/scripts/check-bundle-budget.mjs', 'docs/perf-baseline.md']
requires: [21.3, 21.2]
---

# Lesson 21.4 — Performance Budgets & Guardrails

## Quick Overview

Performance work that is not defended decays. Not because anyone is careless, but because the
cost of each individual regression is invisible: a new dependency here, a `'use client'` there,
an analytics snippet somebody added on a Friday. Six weeks later the site is 400 KB heavier and
no single change is to blame. A **budget** makes each increment visible at the moment it is
introduced, in the pull request that introduces it, to the person who still remembers why.

This lesson turns Module 21's measurements into two mechanical checks. `lighthouserc.json`
drives Lighthouse CI against the six key routes with assertions on LCP, CLS, TBT and the
category scores — the lab half. A bundle-budget script parses the `next build` output and fails
on two conditions: any route above 180 KB gzip First Load JS, or any route more than 10 KB above
the same route on `main` — the delta half, which is the one that actually catches regressions,
because an absolute ceiling with 40 KB of headroom silently absorbs four bad merges. Both run as
required checks in Lesson 24.5's gate table.

The philosophy matters more than the configuration, so it gets stated plainly and repeated:
**start every threshold at "no worse than today" and raise it in a dedicated pull request.** A
gate introduced at an aspirational number is red on arrival, red for reasons unrelated to the
change in front of it, and disabled within a week — usually with a `continue-on-error: true`
that nobody removes. A gate set at your measured baseline is green on arrival, blocks exactly
the regressions it was built to block, and earns the credibility you need to tighten it later.

By the end of this lesson you will have:

- `next-app/lighthouserc.json` — six URLs, mobile preset, three runs with median aggregation, and
  assertions set from your own baseline
- `next-app/scripts/check-bundle-budget.mjs` — a per-route First Load JS figure computed from the
  build manifests, enforcing both the absolute ceiling and the delta-vs-`main` limit, with a
  readable failure message
- `docs/perf-baseline.md` finalised: current numbers, the thresholds derived from them, and the
  date each threshold was last raised
- A deliberately-broken branch proving both checks fail — an unnecessary `'use client'` and a
  removed `sizes` attribute
- A written ratchet procedure: who raises a threshold, in what kind of pull request, and what
  evidence the PR must contain
- An escape hatch defined honestly: how to ship past a budget on purpose, what must be recorded,
  and why "disable the check" is not on the list

## Classic WP Analogy

There is no real Classic WordPress analogue for an automated performance budget, and that
absence is itself the lesson. The Classic equivalents were all **human rituals**: a pre-launch
GTmetrix screenshot, an agency performance checklist, a senior developer who noticed the page
felt slower, a client complaint that triggered a "speed optimisation" project three months after
the regression landed. All retrospective, all reliant on someone caring on the right day.

The closest mechanical thing you may have used is a PHPCS ruleset — and that comparison is
actually the useful one. PHPCS did not make anyone a better programmer; it made a specific class
of mistake **impossible to merge**, which freed reviewers to talk about design instead of
spacing. A performance budget does the same trick for a different class of mistake. Nobody has to
remember to check the bundle size, and nobody has to be the person who says "this got slower" in
a code review.

Where the comparison breaks: a PHPCS violation is objectively wrong, so a hard failure is always
correct. A budget violation might be **the right trade** — a genuinely valuable feature that
costs 30 KB is a decision, not a defect. So a performance gate needs something a linter does not:
a documented, low-friction, *recorded* way to ship past it. This lesson defines that path, and it
is deliberately not "add `continue-on-error`". It is: raise the budget in the same pull request,
in `docs/perf-baseline.md`, with the reason written down. The gate stays honest, the number stays
true, and six months later someone can read why the site got heavier.

---

## Key Concepts

### 1. The point of a budget is the timing, not the number

A budget's value is not that 180 kB is the correct amount of JavaScript. Nobody knows that. Its
value is **where in time the conversation happens.**

```
   WITHOUT a budget
   week 1  +6 kB   a date library                nobody notices
   week 2  +3 kB   a `'use client'` on a card    nobody notices
   week 4  +18 kB  an analytics snippet          nobody notices
   week 6  +11 kB  a chart on one route          nobody notices
           ──────
           +38 kB  "the site got slow"           six weeks later, nobody remembers which change

   WITH a budget
   week 4  +18 kB  an analytics snippet          the check is red, in the PR, and the author
                                                  can still answer "do we need this?"
```

Each individual increment is defensible. The sum is not, and by the time the sum is visible the
four authors have moved on and the context is gone. A budget converts an archaeology problem into
a code-review question, and a code-review question has somebody's name against it.

Two corollaries worth stating because they are the usual objections:

| Objection | Answer |
|---|---|
| "The number is arbitrary" | Yes, partly. It came from your own measurement plus a margin. Arbitrary and *recorded* beats implicit and forgotten |
| "It will block a legitimate change" | Yes, and Key Concept 8 defines exactly how to ship past it — on the record, in the same pull request |

### 2. An absolute ceiling and a delta, and the delta is the one that works

Two checks, and they fail for different reasons.

| | Absolute ceiling | Delta versus `main` |
|---|---|---|
| Asserts | no route exceeds 180 kB gzip | no route grows by more than 10 kB |
| Catches | the route that has drifted badly | the change in front of you |
| Misses | anything under the ceiling | a change that arrives already over the ceiling |
| Blames | whoever happens to cross the line | the author of the increment |

The failure mode of a ceiling alone is arithmetic. A route measured at 140 kB against a 180 kB
ceiling has **40 kB of headroom**, so it silently absorbs four bad merges before anybody hears
about it — and the fifth author, whose change is 2 kB, gets the red check and the blame.

```
   ceiling 180 kB, route starts at 140 kB

   PR #1  +12 kB → 152   green    ← the change that should have been discussed
   PR #2  +11 kB → 163   green    ← and this one
   PR #3  + 9 kB → 172   green    ← and this one
   PR #4  + 6 kB → 178   green    ← and this one
   PR #5  + 3 kB → 181   RED      ← the person who has to fix all four
```

The delta check would have gone red at PR #1. So the ceiling is the long-term contract and the
delta is the working gate, and you need both because the delta alone permits an unlimited slow
drift of 9 kB per pull request forever.

### 3. Where the numbers come from, and the gate that is red on arrival

Every threshold in this lesson comes from **your own baseline plus a small margin**. Not from a
blog post, not from a competitor, not from what you wish were true.

| Threshold | Source | Margin |
|---|---|---|
| 180 kB First Load JS | the module README, sanity-checked against Lesson 21.3's measured table | whatever headroom your worst route actually has |
| +10 kB delta | judgement: big enough for a real feature, small enough that four of them are visible | none — it is the margin |
| LCP 2500 ms / CLS 0.10 | Google's "good" thresholds, and Lesson 21.2's measured numbers must already be inside them | none |
| TBT 200 ms | the lab proxy for INP | none |
| Performance ≥ 0.90 | the module README, and Lesson 24.5 restates it as a merge gate | none |

**If a measured number is outside a threshold, you have a decision to make now and not later.**
Either the lesson is unfinished, or the threshold is wrong for this application. Both are
acceptable answers. Setting the gate anyway is not, and here is what happens when you do:

```
   day 1   gate lands at an aspirational number   →  RED
   day 2   somebody needs to ship a bug fix        →  still RED, for reasons unrelated
   day 3   "just merge it, the check is broken"    →  the check loses authority
   day 6   `continue-on-error: true`               →  the check is now decoration
   month 6 nobody remembers it exists              →  the file is still in the repo
```

Every step is individually reasonable. That is what makes it happen. A gate set at your measured
baseline is **green on arrival**, blocks exactly the regressions it was built to block, and earns
the credibility you need to tighten it later.

### 4. Lab assertions only, and `lighthouserc.json` must not pretend otherwise

Lighthouse CI can assert any Lighthouse audit. It cannot assert a metric Lighthouse does not
produce, and there is exactly one of those that people try to add.

| Metric | Audit id | Assertable |
|---|---|---|
| LCP | `largest-contentful-paint` | yes |
| CLS | `cumulative-layout-shift` | yes |
| TBT | `total-blocking-time` | yes |
| Performance score | `categories:performance` | yes |
| **INP** | — | **no.** A navigation-mode run has no interactions, so there is no audit to assert |

Lesson 21.1 Key Concept 3 has the mechanism: INP is defined over interactions and a synthetic run
has none, so Lighthouse substitutes TBT. Adding an `interaction-to-next-paint` assertion produces
either a config error or — worse, depending on version — a silently-skipped assertion that looks
like a passing check. Verification greps the config for it and expects zero.

The consequence, stated so nobody has to rediscover it: **INP is monitored, not gated.**
`/api/vitals` from Lesson 21.1 is where it comes from, the reading is only real once there is
traffic on a public origin, and that is Module 24.

### 5. Three runs, median aggregation, and `assertions` versus `budgets`

Lighthouse is noisy: the same page, the same build, the same machine, three runs, and TBT can vary
by 30 %. So `numberOfRuns: 3` and `aggregationMethod: "median"`, for the same reason Lesson 21.1
took three readings by hand.

| `aggregationMethod` | Assert against | Use when |
|---|---|---|
| `median` | the median of the runs, per audit | **this course.** The most defensible single number |
| `optimistic` | the best run | you want the gate to be quiet. It will be, including when it should not be |
| `pessimistic` | the worst run | you are chasing a tail latency and can afford the flakes |

And two config sections that look interchangeable and are not:

| | `assert.assertions` | `collect.settings.budgets` |
|---|---|---|
| Written in | Lighthouse CI's own schema | the [performance-budget JSON](https://web.dev/articles/use-lighthouse-for-performance-budgets) format |
| Asserts | any audit, including category scores | resource counts and byte sizes by type |
| Failure | `lhci assert` exits non-zero | surfaces as the `performance-budget` audit |
| Right for | **metrics and scores** | third-party byte weight, image byte weight |

This lesson uses `assertions` only. `budgets` would be the tool for "no more than 40 kB of
third-party script", which is a real budget this application does not need yet — one Turnstile
script, per Lesson 21.3 §7. Named, not built.

### 6. Next 16 stopped printing the number, so the guardrail computes it — and fails loudly

The route table is terminal output. It is not a public API, Next has never promised its shape,
and it has changed: the column headers, the box-drawing characters and the route markers moved
between major versions — and then **Next 16 removed the `Size` and `First Load JS` columns
altogether.** The framework's own reasoning is worth reading: in a server-driven app the numbers
were measuring something the webpack and Turbopack implementations did not even agree on, so
rather than print a figure people budgeted against, Next now prints none.

That leaves a course-shaped hole, because "no number" is not an answer to "did this pull request
add 40 kB". Three ways to fill it:

| | Parse the printed table | Sum `.next/app-build-manifest.json` yourself | Lighthouse `total-byte-weight` |
|---|---|---|---|
| Works on Next 16 | ❌ the columns are gone | ✅ | ✅ |
| Breaks when | the table format changes | the manifest format changes | never — it is a Lighthouse audit |
| Attributes bytes to a route | yes | yes | yes, but includes images, CSS and fonts |
| Fails a PR on +12 kB of JavaScript | yes | yes | no — the signal is buried in everything else |

The middle column is the one left standing, and this lesson takes it. The cost is real and worth
stating: **you are now computing the number, so you own its definition.** "First Load JS" here
means *the gzipped size of the union of the JavaScript chunks the manifest lists for that route,
plus the shared root chunks every route loads*. That is what Next used to print, computed the way
Next used to compute it, but nothing enforces the agreement any more — so Step 3 reconciles it
once against `@next/bundle-analyzer` and writes the reconciliation into
`docs/perf-baseline.md`. A budget nobody can reconcile with something is a budget nobody trusts.

The other half of the lesson is unchanged, and it is the half that matters more: **fail loudly
when you cannot measure.** That is the whole difference between a guardrail and a decoration:

| Situation | A decoration does | A guardrail does |
|---|---|---|
| The manifest is missing | `routes.size === 0`, no failures found, exit 0 | exit 1 with "no `.next/app-build-manifest.json` — did the build run?" |
| The manifest has a shape it did not have | reads `undefined`, sums to 0 kB, passes | exit 1, naming the key it expected |
| A chunk the manifest lists is not on disk | skips it, under-reports | exit 1, naming the file |
| A route in the baseline vanished | ignores it | exit 1 — if you deleted the route, regenerate the baseline in the same pull request |

A check that passes when it is broken is worse than no check, because it launders "we did not
measure" into "we measured and it was fine".

### 7. Getting `main`'s numbers: a committed baseline, and what it costs

The delta check needs to know what `main` measures. Two ways, and neither is free.

| | A committed baseline JSON | Check out `main` and rebuild in CI |
|---|---|---|
| CI time | one build | **two builds**, plus a checkout and an install |
| Always current | **no.** It is as fresh as the last time somebody regenerated it | yes |
| Reviewable | **yes** — a threshold change appears in a diff | no. The comparison is invisible |
| Fails when | somebody forgets to regenerate after a merge | the runner is slow, or `main` does not build |

This course commits the JSON, and the honest statement of the trade is: **a stale baseline
understates a regression, and it does so silently.** If `main` has drifted up by 8 kB since the
baseline was written, a pull request that adds 4 kB is compared against an old, smaller number and
reports +12 kB — a false positive, which is the safe direction — or, if the baseline was written
from a *heavier* build, it hides a real 6 kB regression, which is not.

The mitigation is a job on `main` that regenerates the baseline and fails if it drifted, which is
Lesson 24.4's ground and is named here so it is a scheduled task rather than a discovered
surprise. Reversal condition: the day CI has spare minutes and the baseline has gone stale twice,
switch to rebuilding `main`.

### 8. The escape hatch, defined honestly

A budget violation may be the right trade. A genuinely valuable feature that costs 30 kB is a
decision, not a defect, and a gate with no way past it gets removed rather than argued with.

So there is a documented way through, and it is exactly one way:

**Raise the threshold in the same pull request, in `docs/perf-baseline.md`, with the reason
written down.**

| What that buys | Why |
|---|---|
| The gate stays honest | it is never red for a reason nobody has accepted |
| The number stays true | the threshold always describes the site as it actually is |
| The decision is dated and attributed | six months later somebody can read why the site got heavier, and who agreed |
| The next author inherits a real ceiling | not one that four people have quietly stepped over |

And the thing it is deliberately **not**:

```
   # ❌ NEVER. This is how a gate dies.
   - name: Bundle budget
     run: node scripts/check-bundle-budget.mjs
     continue-on-error: true
```

`continue-on-error: true` produces a check that is green when it fails. Nobody reads the log of a
green step. It bypasses the gate with no record, no reviewer, no date and no reason — and it is
indistinguishable, in the pull-request UI, from a check that passed. **A gate that can be
bypassed silently is not a gate. One that is bypassed on the record is a gate people still trust
in a year.** Verification asserts the string appears nowhere in anything this lesson writes, and
Lesson 24.5 asserts it again across the whole workflow.

### 9. Why this is not PHPCS

Lesson 07.5 gave this repository a PHPCS ruleset, and the Classic WP Analogy above draws the
parallel. It is worth being precise about where the parallel stops, because the difference is what
makes Key Concept 8 necessary.

| | A PHPCS violation | A budget violation |
|---|---|---|
| Is it wrong? | **yes, objectively.** The standard says four spaces |
| Is it wrong? | | **unknown.** 30 kB might be an excellent trade |
| Correct response | fix it. `phpcbf` often does it for you | discuss it, then either fix it or raise the number |
| Escape hatch | a `phpcs:ignore` with a reason, rarely | a threshold change with a reason, occasionally |
| What a hard failure costs | nothing. There is no legitimate reason to violate it | a real feature blocked by a number somebody guessed |

So a performance gate needs something a linter does not: a low-friction, *recorded* path through.
A style linter that is impossible to bypass is a good style linter. A performance gate that is
impossible to bypass is a performance gate that will be deleted — and the deletion will be a
one-line diff in a pull request about something else, which is how it happens every time.

---

## Task

### Step 1: Write `lighthouserc.json`

The six URLs are the concrete forms of the module README's six routes. Note that the README writes
them unlocalised (`/`, `/incidents`, …) and `lhci` needs real URLs — and `/` is a 307 to `/en`
because `localePrefix` is `'always'` (Lesson 20.3), so asserting on `/` would measure a redirect.

```json
{
  "ci": {
    "collect": {
      "url": [
        "http://localhost:3000/en",
        "http://localhost:3000/en/incidents",
        "http://localhost:3000/en/incidents/incident-01",
        "http://localhost:3000/en/reviews/review-01",
        "http://localhost:3000/en/blog/blog-01",
        "http://localhost:3000/en/hobt"
      ],
      "numberOfRuns": 3,
      "startServerCommand": "npm start",
      "startServerReadyPattern": "Ready in",
      "startServerReadyTimeout": 60000,
      "settings": {
        "formFactor": "mobile",
        "screenEmulation": {
          "mobile": true,
          "width": 412,
          "height": 823,
          "deviceScaleFactor": 1.75,
          "disabled": false
        },
        "throttlingMethod": "simulate",
        "onlyCategories": ["performance", "accessibility", "seo", "best-practices"]
      }
    },
    "assert": {
      "aggregationMethod": "median",
      "assertions": {
        "categories:performance": ["error", { "minScore": 0.9 }],
        "largest-contentful-paint": ["error", { "maxNumericValue": 2500 }],
        "cumulative-layout-shift": ["error", { "maxNumericValue": 0.1 }],
        "total-blocking-time": ["error", { "maxNumericValue": 200 }]
      }
    },
    "upload": {
      "target": "filesystem",
      "outputDir": ".lighthouseci/reports"
    }
  }
}
```

That file is `next-app/lighthouserc.json`, and it has no comments because it is strict JSON, so
the five decisions in it are recorded here instead:

| Decision | Why |
|---|---|
| `formFactor: "mobile"` plus explicit `screenEmulation` | mobile is Lighthouse's default and CrUX's weighting, and writing the viewport out means a Chrome default change cannot move your numbers |
| `throttlingMethod: "simulate"` | reproducible, and it is what a CI runner can do honestly. `devtools` throttling is more realistic and far noisier |
| **Collect** four categories, **assert** one | Module 22's Starting State reads the accessibility score off this run, and Lessons 22.4 and 24.5 add the accessibility and SEO assertions at ≥ 0.95. Collect broadly, assert narrowly |
| No `interaction-to-next-paint` | there is no such audit in a navigation run. Key Concept 4 |
| `upload.target: "filesystem"` | no server, no token, no third party. The reports land in `.lighthouseci/`, which Step 5 gitignores |

> **`startServerReadyPattern` is coupled to what your Next version prints.** `"Ready in"` matches
> Next 16's startup line. If `lhci` hangs and then times out, run `npm start` by hand, read the
> first three lines, and match one of them. This is reasoned from the observed output rather than
> from a documented contract, so verify it rather than trusting it.

**Verify §1:**

- [ ] `node -e "JSON.parse(require('fs').readFileSync('lighthouserc.json','utf8'))"` exits 0.
      Strict JSON: no trailing commas, no comments.
- [ ] Six URLs, all with a locale prefix, none of them `/`.
- [ ] `grep -c interaction-to-next-paint lighthouserc.json` returns `0`.

### Step 2: Run it, and reconcile it against Lesson 21.1's numbers

```bash
# next-app
cd next-app
npm run build
npx lhci autorun --config=lighthouserc.json
# Expected: 18 runs (six URLs x three), then an assertion summary. `lhci` runs
#           `npm start` itself, so a missing .next is where this fails first.
```

`lhci` and the DevTools panel will not agree, and Lesson 21.1 Key Concept 6 said they would not.
Reconcile rather than average: put the `lhci` medians in a second column beside the DevTools ones,
and pin **`lhci` as the tool of record for the thresholds**, because it is the one CI runs.

If an assertion fails here, you have Key Concept 3's decision to make before you write another
line. Either Lessons 21.2 and 21.3 are unfinished, or a threshold is wrong for this application.
Write which one, and why, into `docs/perf-baseline.md` in Step 7.

**Verify §2:**

- [ ] All four assertions pass on all six URLs, or you have written down which one does not and
      which of the two explanations applies.
- [ ] `.lighthouseci/` now exists in `next-app/`. Step 5 deals with it.
- [ ] The `lhci` medians are recorded next to the DevTools medians, with both labelled.

### Step 3: Write the bundle-budget script

Module 22's Starting State runs `node scripts/check-bundle-budget.mjs` after `cd next-app`, so the
path is `next-app/scripts/check-bundle-budget.mjs`, it must exit non-zero on failure, and it must
print a per-route table on success.

```js
#!/usr/bin/env node
// next-app/scripts/check-bundle-budget.mjs
// Enforces two First Load JS budgets, computed from the build manifests:
//   1. an absolute ceiling per route
//   2. a delta against the committed baseline, which represents `main`
//
// Next 16 removed the `Size` and `First Load JS` columns from `next build`
// output, so there is no table left to parse. The numbers still exist — they
// are the chunk lists in `.next/app-build-manifest.json` plus the shared root
// chunks in `.next/build-manifest.json` — and this script gzips them itself.
// Key Concept 6 is the argument for doing it this way and the honest cost.
//
// Usage:
//   node scripts/check-bundle-budget.mjs                  # reads ./.next
//   node scripts/check-bundle-budget.mjs --dist .next     # explicit dist dir
//   node scripts/check-bundle-budget.mjs --write-baseline # regenerate, on `main` ONLY
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, 'bundle-baseline.json');

// THE TWO THRESHOLDS. Raising either is a dedicated pull request whose only
// content is the new number plus the docs/perf-baseline.md row saying why.
// Key Concept 8. Do NOT edit these to make a red check green.
const CEILING_KB = 180;
const DELTA_KB = 10;

/** Exit non-zero with something a human can act on. Never exit 0 on confusion. */
function die(message) {
  console.error(`\ncheck-bundle-budget: ${message}\n`);
  process.exit(1);
}

function distDir() {
  const at = process.argv.indexOf('--dist');

  if (at === -1) return join(HERE, '..', '.next');
  if (process.argv[at + 1] === undefined) die('--dist needs a directory path');

  return process.argv[at + 1];
}

function readManifest(dist, name) {
  const path = join(dist, name);

  if (!existsSync(path)) {
    die(
      `no ${name} at ${path}.\n` +
        '  Run `npm run build` first. In CI, build in the step before this one.\n' +
        '  Failing loudly rather than reporting a green check on no data.'
    );
  }

  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return die(`${name} is not readable JSON. Delete .next and rebuild.`);
  }
}

/** Gzip a chunk once, cached, because routes share most of their chunks. */
const gzipCache = new Map();

function gzippedBytes(dist, file) {
  if (gzipCache.has(file)) return gzipCache.get(file);

  const path = join(dist, file);

  if (!existsSync(path)) {
    die(
      `the manifest lists ${file} but it is not on disk at ${path}.\n` +
        '  A partial build, or a manifest format this script does not understand.'
    );
  }

  // gzip, not raw bytes: gzip is what crosses the network, and the 180 kB
  // budget is a gzip number. Level 9 rather than the default, so the figure
  // does not drift when Node changes its default.
  const bytes = gzipSync(readFileSync(path), { level: 9 }).length;

  gzipCache.set(file, bytes);

  return bytes;
}

/**
 * Build the per-route table.
 *
 * `app-build-manifest.json` keys are file-convention paths — `/[locale]/page`,
 * `/[locale]/incidents/[slug]/page`, `/api/vitals/route`. The `/page` suffix is
 * stripped to get the URL shape a human recognises; `/route` entries are route
 * handlers, which ship no page bundle and do not belong in a table about page
 * weight.
 */
function computeRoutes(dist) {
  const app = readManifest(dist, 'app-build-manifest.json');
  const build = readManifest(dist, 'build-manifest.json');

  if (typeof app.pages !== 'object' || app.pages === null) {
    die('app-build-manifest.json has no `pages` object. The manifest format changed.');
  }

  // Every route pays for these before it pays for anything of its own.
  const shared = Array.isArray(build.rootMainFiles) ? build.rootMainFiles : [];

  if (shared.length === 0) {
    die('build-manifest.json has no `rootMainFiles`. The manifest format changed.');
  }

  const routes = new Map();

  for (const [key, chunks] of Object.entries(app.pages)) {
    if (key.endsWith('/route')) continue;
    if (!Array.isArray(chunks)) die(`app-build-manifest.json: ${key} is not an array of chunks`);

    const route = key.replace(/\/page$/u, '') || '/';

    // A Set, because a chunk shared between the route and the root must be
    // paid for once. Double-counting here is exactly the "quietly wrong
    // number" Key Concept 6 warns about.
    const files = new Set([...shared, ...chunks].filter((f) => f.endsWith('.js')));

    let bytes = 0;

    for (const file of files) bytes += gzippedBytes(dist, file);

    routes.set(route, bytes / 1024);
  }

  if (routes.size === 0) {
    die(
      'the manifests parsed but produced ZERO routes.\n' +
        '  Either the build produced no app routes, or the key shape changed.'
    );
  }

  return routes;
}

const routes = computeRoutes(distDir());

if (process.argv.includes('--write-baseline')) {
  const payload = {
    recordedAt: new Date().toISOString().slice(0, 10),
    note: 'Regenerate on `main` only, in a PR of its own. See docs/perf-baseline.md.',
    ceilingKb: CEILING_KB,
    deltaKb: DELTA_KB,
    routes: Object.fromEntries(
      [...routes].sort(([a], [b]) => a.localeCompare(b)).map(([r, kb]) => [r, Number(kb.toFixed(1))])
    ),
  };

  writeFileSync(BASELINE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`wrote ${BASELINE} — ${routes.size} routes`);
  process.exit(0);
}

let baseline;

try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
} catch {
  die(`no readable baseline at ${BASELINE}.\n  On \`main\`, run with --write-baseline and commit it.`);
}

if (typeof baseline.routes !== 'object' || baseline.routes === null) {
  die('the baseline has no `routes` object. Regenerate it with --write-baseline on `main`.');
}

const failures = [];
const rows = [];

for (const [route, kb] of [...routes].sort(([a], [b]) => a.localeCompare(b))) {
  const before = baseline.routes[route];
  const delta = typeof before === 'number' ? kb - before : null;

  rows.push([
    route,
    `${kb.toFixed(1)} kB`,
    typeof before === 'number' ? `${before.toFixed(1)} kB` : 'NEW',
    // Round FIRST, then sign. The baseline stores one decimal, so an unchanged
    // route can compute a delta of -0.004 and print `-0.0 kB` — five minutes of
    // wondering what shrank, over four bytes of rounding.
    delta === null ? '—' : `${Math.abs(delta) < 0.05 ? '+' : delta > 0 ? '+' : '-'}${Math.abs(delta).toFixed(1)} kB`,
  ]);

  if (kb > CEILING_KB) {
    failures.push(`${route}: ${kb.toFixed(1)} kB exceeds the ${CEILING_KB} kB ceiling`);
  }

  if (delta !== null && delta > DELTA_KB) {
    failures.push(
      `${route}: +${delta.toFixed(1)} kB against the baseline, over the ${DELTA_KB} kB delta limit`
    );
  }
}

// A route the baseline knows about and the build does not. Legitimate when a
// route was deleted — and then the baseline is regenerated in the SAME pull
// request, which is the point. Silence here would hide a renamed route.
for (const route of Object.keys(baseline.routes)) {
  if (!routes.has(route)) {
    failures.push(`${route}: in the baseline, absent from this build. Deleted? Regenerate the baseline.`);
  }
}

const widths = [0, 1, 2, 3].map((i) => Math.max(...rows.map((r) => r[i].length)));

console.log('');
for (const row of rows) {
  console.log(row.map((cell, i) => cell.padEnd(widths[i])).join('  '));
}
console.log(`\nceiling ${CEILING_KB} kB · delta ${DELTA_KB} kB · baseline ${baseline.recordedAt}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} budget failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    '\nTo ship past this deliberately: raise the threshold IN THIS PULL REQUEST,\n' +
      'in docs/perf-baseline.md, with the reason. Never by disabling the step.\n'
  );
  process.exit(1);
}

console.log('\nall routes within budget');
```

> **The manifests are not a public API either, and that is the deal you accepted in Key Concept
> 6.** `app-build-manifest.json` and `build-manifest.json` are internal build artifacts; Next may
> reshape them in a minor. Every path in this script that cannot find what it expects exits `1`
> naming the key or the file, so a format change presents as a red check with a readable message
> rather than a green check on a 0 kB route table. That is the property being bought, and it is
> worth more than the exact figure.

**Reconcile the number, once.** You are computing First Load JS now rather than reading it, so
prove your definition against something independent before you budget against it:

```bash
# next-app
npm install --save-dev @next/bundle-analyzer
ANALYZE=true npm run build
# Opens a treemap per bundle. Compare the analyzer's gzip total for one route
# with this script's figure for the same route.
```

They will not match to the byte — the analyzer counts a different set of files, and the treemap
is per-bundle rather than per-route. Agreement within a few kB is the bar. Write both numbers and
the date into `docs/perf-baseline.md` under a "how First Load JS is computed here" heading, so the
next person to distrust the budget has somewhere to look.

**Verify §3:**

- [ ] `node --check scripts/check-bundle-budget.mjs` exits 0.
- [ ] `npm run lint` is clean. The script is inside `src/`-adjacent tooling that
      `eslint.config.mjs` covers, and `--max-warnings=0` means a warning is a failure.
- [ ] Running it with no baseline present exits **1** with a message naming `--write-baseline`,
      not a stack trace.
- [ ] Running it against an empty directory (`--dist /tmp/nope`) exits **1** naming
      `app-build-manifest.json`, not a stack trace.
- [ ] `docs/perf-baseline.md` records the analyzer reconciliation and its date.

### Step 4: Record `main`'s numbers

```bash
# next-app — on `main`, with a clean tree
git switch main
npm run build
node scripts/check-bundle-budget.mjs --write-baseline
cat scripts/bundle-baseline.json
```

Then read the numbers against the thresholds before you commit them. If any route is already over
180 kB, Key Concept 3 applies and you have the decision to make in this step rather than in three
months.

```bash
# next-app
cd ..
git add next-app/scripts/bundle-baseline.json
git commit -m "perf: commit main's First Load JS baseline"
cd next-app
```

**Verify §4:**

- [ ] `scripts/bundle-baseline.json` exists, is committed, carries a `recordedAt` date, and has
      one entry per app route.
- [ ] `node scripts/check-bundle-budget.mjs` now exits **0** and prints a per-route table with a
      `+0.0 kB` delta column. That is what Module 22's Starting State runs.
- [ ] The baseline was generated on `main`. A baseline generated on a feature branch bakes that
      branch's regression in as the reference, and nothing will ever tell you.

### Step 5: Ignore `.lighthouseci/`

`lhci` writes a `.lighthouseci/` directory in whatever it runs from, which is `next-app/`. Nothing
ignores it yet — one line, an edit to a file that has existed since Module 01, not a new product.

```
# .gitignore — added to the "Test output" block, beside next-app/e2e/.auth/
# lhci writes here on every run, from next-app/. Anchored rather than bare,
# because `lhci` only ever runs from that directory in this repository.
next-app/.lighthouseci/
```

```bash
# next-app — ask git from where lhci actually runs, so the path is relative
git check-ignore -v .lighthouseci/reports
# Expected: a rule from the root .gitignore with a line number, e.g.
#           ../.gitignore:30:next-app/.lighthouseci/   .lighthouseci/reports
git status --short | grep -c lighthouseci
# Expected: 0
```

**Verify §5:**

- [ ] `git check-ignore -v` names a rule **with a line number**. Never confirm an ignore rule by
      eye — `git status` looking clean can mean "ignored" or "the directory does not exist yet",
      and the appendix 04 §1 discipline is to ask git rather than to look.
- [ ] `git status --short` in the repository root shows no `.lighthouseci` entry.

### Step 6: Break both checks on purpose

A gate you have never seen fail is a gate you are hoping about. Two deliberate regressions, one
per check, on a branch you throw away.

```bash
# next-app
cd ..
git switch -c perf/deliberate-break
cd next-app
```

**Break one — the bundle check.** Add `'use client'` to `src/components/blocks/RichText.tsx`. This
is the realistic version of the accident: somebody wants a copy-to-clipboard button on a code
block, adds the directive to the nearest component, and drags `isomorphic-dompurify` into the
client graph of every content route.

```tsx
// next-app/src/components/blocks/RichText.tsx — DELIBERATELY WRONG, reverted in Step 7
// This is the break. It compiles, it renders identically, it passes type-check
// and lint, and it moves the sanitizer into the browser — which is a bundle
// regression AND a security one, because server-side sanitisation stops being
// the thing that happened.
'use client';
```

```bash
# next-app
npm run build > /tmp/btt-break.log 2>&1
node scripts/check-bundle-budget.mjs
# Expected: exit 1, and a named failure on every content route — the three
#           [slug] routes and [...slug] — each over the +10 kB delta limit.
echo "exit=$?"
```

**Break two — the Lighthouse check.** Remove the `sizes` attribute from `CoreImage`. `next/image`
then defaults to `100vw`, so a 720 px prose column downloads a full-viewport variant.

```tsx
// next-app/src/components/blocks/CoreImage.tsx — DELIBERATELY WRONG, reverted in Step 7
// `sizes` removed from BOTH <Image> calls. Nothing warns. The page looks
// identical. Lesson 14.5 Key Concept 4 is the whole argument.
        <Image src={src} alt={alt} width={width} height={height} className="h-auto w-full rounded-md" />
```

```bash
# next-app
npm run build
npx lhci autorun --config=lighthouserc.json
echo "exit=$?"
# Expected: a non-zero exit, with `categories:performance` below 0.90 on
#           /en/blog/blog-01. The failing audit is `uses-responsive-images`,
#           which feeds the score.
```

> **If the Lighthouse check stays green, that is a finding about the assertion and not about the
> fix.** On a loopback connection a 1920 px image can still paint inside 2500 ms, and the
> performance score may absorb one failed opportunity. Do not lower a threshold to make the demo
> work. The two honest responses are: accept that the bundle check is the deterministic gate and
> Lighthouse is the probabilistic one, or add `"uses-responsive-images": ["warn", {}]` to
> `assertions` so the audit is reported by name. Write down which you chose.

Then commit the breaks. This matters: `git switch` **carries uncommitted changes across
branches** when the branches are otherwise identical, so switching back to `main` with the two
edits unstaged would deposit them on `main` and `git branch -D` would delete an empty branch while
the damage stayed behind.

```bash
# next-app
cd ..
git add -A
git commit -m "TEMP: deliberate budget break. This branch is deleted in Step 7."
git status --short
# Expected: no output. Everything is on the throwaway branch and nothing is
#           loose in the working tree.
cd next-app
```

**Verify §6:**

- [ ] `node scripts/check-bundle-budget.mjs` exits **1** with the routes named. This is the pair
      of failures the lesson exists to produce.
- [ ] `echo "exit=$?"` printed a non-zero value after `lhci`, or you recorded why it did not.
- [ ] Neither break was caught by `npm run type-check`, `npm run lint` or `npm test -- --run`. Run
      all three to confirm — that is *why* these two checks exist.
- [ ] `git status --short` is empty and both edits are committed to
      `perf/deliberate-break`. Uncommitted, they follow you back to `main`.

### Step 7: Throw the branch away and finalise the baseline

Never revert a deliberate break by restoring individual files — you will miss one. Throw the whole
branch away, which is only safe because Step 6 committed the breaks to it.

```bash
# next-app
cd ..
git switch main
git branch -D perf/deliberate-break
cd next-app
git status --short
# Expected: no output. The break is gone with the branch.
grep -c "'use client'" src/components/blocks/RichText.tsx
# Expected: 0
grep -c 'sizes={SIZES}' src/components/blocks/CoreImage.tsx
# Expected: 2 — both <Image> branches, back where Lesson 14.5 put them
node scripts/check-bundle-budget.mjs
# Expected: exit 0, and a table of +0.0 kB deltas
```

```markdown
<!-- docs/perf-baseline.md — append -->
## Budgets and the ratchet (Lesson 21.4)

Enforced by `next-app/lighthouserc.json` and `next-app/scripts/check-bundle-budget.mjs`.
Tool of record: **`lhci`**, because it is the one CI runs. DevTools medians are recorded in the
Lesson 21.1 section and will not match.

| Threshold | Value | Enforced by | Blocks merge | Last raised | Reason |
|---|---|---|---|---|---|
| First Load JS per route | ≤ 180 kB gzip | `check-bundle-budget.mjs` | yes | ______ | initial |
| First Load JS delta vs `main` | ≤ +10 kB gzip | `check-bundle-budget.mjs` | yes | ______ | initial |
| LCP | ≤ 2500 ms | `lighthouserc.json` | yes | ______ | Google "good" |
| CLS | ≤ 0.10 | `lighthouserc.json` | yes | ______ | Google "good" |
| TBT | ≤ 200 ms | `lighthouserc.json` | yes | ______ | lab proxy for INP |
| Lighthouse performance | ≥ 0.90 | `lighthouserc.json` | yes | ______ | module README; Lesson 24.5 restates it |
| INP | ≤ 200 ms | **nothing.** Monitored via `/api/vitals` | no | — | field-only; not assertable in a lab run |

Accessibility ≥ 0.95 and SEO ≥ 0.95 are collected by this config and asserted by Lessons 22.4
and 24.5.

### The ratchet procedure

1. **Who** — anyone. A threshold is not owned by a person.
2. **In what kind of pull request** — a dedicated one, whose only content is the new number, the
   table row above, and the reason. Not bundled with a feature.
3. **What evidence it must contain** — the measurement that motivated it (three runs, median,
   device preset and tool version), the number before and after, and one sentence on why the
   site is allowed to be that much heavier or slower.
4. **Direction** — down is a celebration and needs the same PR shape, because a threshold set
   below what the site does is a gate that is red on arrival. Key Concept 3.
5. **Cadence** — when a measurement justifies it, not on a schedule. A calendar-driven ratchet
   produces numbers nobody measured.

### Shipping past a budget, on purpose

Raise the threshold **in the same pull request**, in the table above, with the reason. That is
the only route.

Explicitly not on the list: `continue-on-error: true`, commenting the step out, deleting a URL
from `lighthouserc.json`, or editing `CEILING_KB` without touching this table. Each of those
produces a check that is green when it fails, and nobody reads the log of a green step.

### Proven to fail

| Regression | Caught by | Caught by type-check / lint / unit tests |
|---|---|---|
| `'use client'` on `blocks/RichText.tsx` | `check-bundle-budget.mjs`, +______ kB on ______ routes | no |
| `sizes` removed from `CoreImage` | `lighthouserc.json`, `categories:performance` ______ | no |

### Known gaps

- The baseline JSON is as fresh as the last time somebody ran `--write-baseline` on `main`. A
  stale baseline can hide a regression. Mitigation is a `main` job that regenerates and fails on
  drift — Lesson 24.4.
- The parser reads terminal output that Next has never promised to keep stable. It fails loudly
  rather than silently, which converts a breakage into a red check instead of a false green.
- No third-party byte budget. There is one third-party script (Lesson 21.3 §7), so
  `collect.settings.budgets` is named and not built.
- `lhci` runs against `localhost`, so TTFB is unrealistically good. The public-origin reading is
  Module 24.
```

**Verify §7:**

- [ ] The branch is deleted and `git status --short` is empty.
- [ ] `node scripts/check-bundle-budget.mjs` exits 0.
- [ ] Every threshold in the table matches the value in the file that enforces it. Two numbers
      that disagree means the document or the gate is lying, and you cannot tell which by reading
      either.
- [ ] The "Proven to fail" table has real numbers, from Step 6.

### Step 8: Hand the row to Lesson 24.5

Lesson 24.5 builds the full merge-gate table for the whole repository and cites this lesson's
argument rather than re-deriving it. What it needs from here is four columns per gate — name,
tool, threshold, blocks merge — and they are the table you just wrote.

```bash
# next-app
cd ..
git add -A
git commit -m "perf: lighthouse CI, bundle budget, and the ratchet procedure"
cd next-app
```

**Verify §8:**

- [ ] `docs/perf-baseline.md` now has four `## … (Lesson 21.N)` sections, one per lesson in this
      module, and none of them has rewritten another.
- [ ] `grep -c 'continue-on-error' lighthouserc.json scripts/check-bundle-budget.mjs` returns `0`
      for both. Lesson 24.5 asserts the same string across the whole workflow directory.
- [ ] Module 22's Starting State runs green: `test -f lighthouserc.json`, then
      `npm run build && node scripts/check-bundle-budget.mjs`, then
      `npx lhci autorun --config=lighthouserc.json`. Run it now, from this directory, exactly as
      written there. It is the next module's first impression of your work.

---

## Verification

```bash
cd next-app

# 1. The gate
npm run verify
# Expected: exit 0, silent

# 2. Both products exist where the front matter says, and the script is valid JS
test -f lighthouserc.json && test -f scripts/check-bundle-budget.mjs && echo ok
# Expected: ok
node --check scripts/check-bundle-budget.mjs && echo parses
# Expected: parses
node -e "JSON.parse(require('fs').readFileSync('lighthouserc.json','utf8'));console.log('valid')"
# Expected: valid — strict JSON, so a trailing comma or a comment fails here

# 3. Six URLs, locale-prefixed, and none of them is the redirecting root
node -e "const c=require('./lighthouserc.json');console.log(c.ci.collect.url.length)"
# Expected: 6
grep -c "http://localhost:3000/en" lighthouserc.json
# Expected: 6 — every URL carries a locale. `/` is a 307 to /en (Lesson 20.3),
#           so asserting on it would measure a redirect.

# 4. NEGATIVE — no INP assertion, in any spelling. There is no such audit in a
#    navigation-mode run: Lighthouse has no interactions to measure, which is
#    why TBT is the number in CI (Lesson 21.1 Key Concept 3). Depending on
#    version, an INP assertion is either a config error or a silently-skipped
#    assertion that LOOKS like a passing check — the second is the dangerous one.
grep -ci 'interaction-to-next-paint\|"inp"' lighthouserc.json
# Expected: 0

# 5. The four assertions that ARE assertable, at the frozen values
grep -c '"minScore": 0.9' lighthouserc.json
# Expected: 1 — categories:performance
grep -c '"maxNumericValue": 2500 }' lighthouserc.json
# Expected: 1 — LCP
grep -c '"maxNumericValue": 0.1 }' lighthouserc.json
# Expected: 1 — CLS
grep -c '"maxNumericValue": 200 }' lighthouserc.json
# Expected: 1 — TBT. The closing brace matters: `200` is a prefix of `2500`, so
#           without it this also counts the LCP assertion and returns 2.
grep -c '"aggregationMethod": "median"' lighthouserc.json
# Expected: 1 — three runs, median. `optimistic` asserts the best run, which is
#           a gate that is quiet including when it should not be.
grep -c '"numberOfRuns": 3' lighthouserc.json
# Expected: 1

# 6. Accessibility and SEO are COLLECTED but not yet asserted. Module 22's
#    Starting State reads the accessibility score off this run.
grep -c 'accessibility' lighthouserc.json
# Expected: 1 — in onlyCategories
grep -c 'categories:accessibility' lighthouserc.json
# Expected: 0 — Lessons 22.4 and 24.5 add it at >= 0.95

# 7. The thresholds in the document match the thresholds in the files that
#    enforce them. Two numbers that disagree means one of them is lying and you
#    cannot tell which by reading either.
for n in 180 10 2500 0.10 200 0.90; do
  printf '%-6s doc=%s\n' "$n" "$(grep -c "$n" ../docs/perf-baseline.md)"
done
# Expected: a non-zero count for every threshold
grep -c 'CEILING_KB = 180' scripts/check-bundle-budget.mjs
# Expected: 1
grep -c 'DELTA_KB = 10' scripts/check-bundle-budget.mjs
# Expected: 1

# 8. The committed baseline exists, is dated, and the script agrees with it
test -f scripts/bundle-baseline.json && echo ok
# Expected: ok
node -e "const b=require('./scripts/bundle-baseline.json');console.log(b.recordedAt, Object.keys(b.routes).length)"
# Expected: a date, and one entry per app route

# 9. The happy path: a table on stdout and exit 0. This is the exact pair of
#    commands Module 22's Starting State runs.
npm run build >/dev/null 2>&1
node scripts/check-bundle-budget.mjs
echo "exit=$?"
# Expected: a per-route table, "all routes within budget", exit=0

# 10. NEGATIVE — no build output FAILS. This is the difference between a
#     guardrail and a decoration: a check that passes when it is broken
#     launders "we did not measure" into "we measured and it was fine".
node scripts/check-bundle-budget.mjs --dist /tmp/btt-no-such-dist
echo "exit=$?"
# Expected: exit=1, naming app-build-manifest.json, not a stack trace

# 11. NEGATIVE — a manifest with the right NAME and the wrong SHAPE also fails.
#     This is the sneakier format change: the file survives, the key does not.
mkdir -p /tmp/btt-bad-dist
printf '{"notPages":{}}\n' > /tmp/btt-bad-dist/app-build-manifest.json
printf '{"rootMainFiles":["static/chunks/x.js"]}\n' > /tmp/btt-bad-dist/build-manifest.json
node scripts/check-bundle-budget.mjs --dist /tmp/btt-bad-dist
echo "exit=$?"
# Expected: exit=1, naming the missing `pages` object. A script that summed
#           `undefined` to 0 kB and passed would be the worst outcome here.

# 12. NEGATIVE — a chunk the manifest promises and the disk does not have fails
#     rather than under-reporting.
printf '{"pages":{"/[locale]/page":["static/chunks/ghost.js"]}}\n' \
  > /tmp/btt-bad-dist/app-build-manifest.json
node scripts/check-bundle-budget.mjs --dist /tmp/btt-bad-dist
echo "exit=$?"
# Expected: exit=1, naming the first file it could not read — the shared chunk
#           from build-manifest.json, since that is checked before the route's
#           own. Note there is no synthetic "over the ceiling" case any more: the
#           ceiling is computed from real bytes, so faking it means faking a build.
rm -rf /tmp/btt-bad-dist

# 13. NEGATIVE — nothing this lesson wrote can be bypassed silently
grep -rc 'continue-on-error' lighthouserc.json scripts/check-bundle-budget.mjs
# Expected: 0 for both files
grep -rn 'continue-on-error' ../docs/perf-baseline.md
# Expected: one hit only, in the "Explicitly not on the list" sentence — naming
#           it in order to forbid it. Lesson 24.5 asserts the same string
#           across .github/workflows/.

# 14. `.lighthouseci/` is ignored, and asked of git rather than eyeballed
git check-ignore -v .lighthouseci/reports
# Expected: a rule from the root .gitignore, WITH a line number
git status --short | grep -c lighthouseci
# Expected: 0

# 15. NEGATIVE — the deliberate break is gone, branch and all
cd .. && git branch --list 'perf/deliberate-break' | wc -l
# Expected: 0
cd next-app
grep -c "'use client'" src/components/blocks/RichText.tsx
# Expected: 0
grep -rl "'use client'" src/components/blocks/ | wc -l
# Expected: 0 — Lesson 21.3 emptied this directory of client boundaries and
#           Step 6's break did not survive
grep -c 'sizes={SIZES}' src/components/blocks/CoreImage.tsx
# Expected: 2 — both <Image> branches, exactly as Lesson 14.5 left them

# 16. NEGATIVE — and dangerouslySetInnerHTML is still in exactly one file, and
#     still on the server. The break moved the sanitizer into the browser,
#     which is a security regression a bundle check happened to catch.
grep -rl 'dangerouslySetInnerHTML' src/ | wc -l
# Expected: 1

# 17. Lighthouse CI runs and every assertion passes on the real build
npx lhci autorun --config=lighthouserc.json
echo "exit=$?"
# Expected: 18 runs, all assertions pass, exit=0

# 18. NEGATIVE — no new npm script beyond Lesson 21.3's `analyze`. The budget
#     check is invoked as `node scripts/...` because that is what Module 22's
#     Starting State runs, and a second spelling is a second thing to keep true.
node -e "const s=require('./package.json').scripts;console.log(Object.keys(s).filter(k=>/budget|lhci|lighthouse/.test(k)).length)"
# Expected: 0
grep -c '"analyze"' package.json
# Expected: 1 — Lesson 21.3's, still the only new one in this module

# 19. NEGATIVE — no route changed rendering strategy. Every threshold above is
#     comparable only while Lesson 18.1's table holds.
npm run build 2>&1 | sed -n '/Route (app)/,$p' > /tmp/btt-routes-214.txt
grep -cE '^[┌├└│] *ƒ +/\[locale\]' /tmp/btt-routes-214.txt
# Expected: 1 — /[locale]/incidents only
grep -c 'ƒ /\[locale\]/hobt' /tmp/btt-routes-214.txt
# Expected: 0

# 20. The four sections of the module's document, one per lesson, none
#     overwriting another
for s in 'Baseline (Lesson 21.1)' 'LCP and CLS, before and after (Lesson 21.2)' \
         'JavaScript weight and INP (Lesson 21.3)' 'Budgets and the ratchet (Lesson 21.4)'; do
  printf '%-46s %s\n' "$s" "$(grep -c "$s" ../docs/perf-baseline.md)"
done
# Expected: 1 for each
grep -c 'The ratchet procedure' ../docs/perf-baseline.md
# Expected: 1 — five numbered points: who, what PR, what evidence, direction, cadence

# 21. Module 22's Starting State, run verbatim from here
test -f lighthouserc.json && test -f ../docs/perf-baseline.md && echo ok
# Expected: ok

# 22. Both suites green
npm test -- --run
# Expected: 0 failures
npx playwright test
# Expected: 0 failures
```

If check 17 fails on a machine where Lesson 21.2's and 21.3's measurements were inside every
threshold, suspect the throttling before you suspect the site: `throttlingMethod: "simulate"` on a
loaded CI runner is measurably noisier than on an idle laptop. Re-run once. If it fails twice,
Key Concept 3 applies and the answer is in `docs/perf-baseline.md`, not in a lowered number.

## Control Questions

1. A route sits at 140 kB against a 180 kB ceiling and four pull requests take it to 178 kB, all
   green. Explain what the delta check would have done differently at each of the four, then
   describe the one circumstance in which the ceiling catches something the delta cannot.
2. The bundle script reads build manifests that Next has never promised to keep stable, and it
   would once have parsed the `First Load JS` column instead. Reconstruct why the column was the
   better answer while it existed, why its removal in Next 16 settles the question, and name the
   one property the script must keep now that nobody can reconcile its number against a printed
   table.
3. `continue-on-error: true` and "raise the threshold in the same pull request" both let a change
   ship past a red budget. Both are one line. Explain precisely what the second one buys that the
   first does not, in terms of what a reader can discover six months later.
4. Your `lighthouserc.json` asserts TBT at 200 ms and nothing at all about INP, while
   `docs/perf-baseline.md` lists an INP target of 200 ms with "monitored, not gated" against it.
   Defend that asymmetry to a colleague who wants the gate to assert the metric Google actually
   ranks on, and say what would have to exist for them to be right.
5. Lesson 12.2 cited this lesson's argument for coverage thresholds, and Lesson 24.5 will cite it
   for PHPStan levels and Trivy severities. Pick **one** of those three and identify where the
   analogy breaks — that is, name a property of a performance budget that the other gate does not
   share, and say what that means for its escape hatch.

## Learn More

- [Lighthouse CI — configuration](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md)
  — every key in Task §1, including `aggregationMethod` and the `collect.settings` passthrough
- [Lighthouse CI — assertions](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md#assertions)
  — the `["error", { … }]` tuple form, the presets, and how `median` aggregation is computed
- [Lighthouse CI — getting started](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/getting-started.md)
  — `startServerCommand` and the ready-pattern behaviour Task §1 hedges about
- [web.dev — performance budgets](https://web.dev/articles/performance-budgets-101) — the
  three kinds of budget (milestone, quantity, rule-based) and which of them this lesson built
- [web.dev — using Lighthouse for performance budgets](https://web.dev/articles/use-lighthouse-for-performance-budgets)
  — the `budgets` JSON format from Key Concept 5, which is the tool for the third-party byte
  budget this application does not need yet
- [Next.js — `next build` output](https://nextjs.org/docs/app/api-reference/cli/next#build) —
  what the framework documents about the table the script parses, which is the measure of how
  brittle Key Concept 6 says it is
- [The Performance Inequality Gap](https://infrequently.org/2024/01/performance-inequality-gap-2024/)
  — Alex Russell's device-and-network baseline argument, and the best available answer to
  "where should the number be?"
- [web.dev — Speed at Scale](https://web.dev/articles/incorporate-performance-budgets-into-your-build-tools)
  — budgets as a build-tool concern rather than a review-time one, and the trade against a gate
- [GitHub — `continue-on-error`](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions#jobsjob_idstepscontinue-on-error)
  — read what it actually does to a check's conclusion, which is the mechanism behind Key
  Concept 8's refusal
