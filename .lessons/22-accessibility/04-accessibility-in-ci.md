---
title: 'Accessibility in CI'
module: 22
lesson: 4
teaches: [a11y-merge-gate, severity-thresholds, playwright-projects, regression-tests, rtl-a11y-payoff]
produces: ['next-app/playwright.config.ts', 'next-app/e2e/a11y.spec.ts']
requires: [22.3, 21.4]
---

# Lesson 22.4 — Accessibility in CI

## Quick Overview

An audit is a snapshot. A gate is a guarantee. This lesson turns Lesson 22.3's spec into a
required check with a threshold chosen so it will still be enabled in six months: **zero
`critical` and zero `serious` axe violations on the six key routes blocks a merge; `moderate`
and `minor` are reported in the job summary and block nothing.** That split is deliberate.
`critical` and `serious` map to "a user cannot complete a task" — no accessible name on the
submit button, a form field with no label, text below 4.5:1. `moderate` includes a long tail of
best-practice findings that are genuinely worth fixing and genuinely not worth blocking a
release for, and a gate that blocks on them gets switched off the first time somebody needs to
ship a hotfix.

The second half of the lesson is the payoff loop, and it is the reason accessibility work
compounds instead of decaying. Module 23 writes component tests with React Testing Library,
whose primary queries are `getByRole`, `getByLabelText` and `getByText` — the accessibility tree,
by design. A button with no accessible name is not findable by `getByRole('button', { name })`,
so the unit test fails. A form field with no label is not findable by `getByLabelText`, so the
unit test fails. Playwright's recommended locators work the same way, and Lesson 23.7 makes that
the enforced selector contract. **Once your tests query the way assistive technology queries,
inaccessible markup fails your test suite before it ever reaches an axe scan** — and
accessibility stops being a separate audit somebody has to schedule.

By the end of this lesson you will have:

- A dedicated `a11y` Playwright project in `playwright.config.ts`, runnable independently and in CI
- `e2e/a11y.spec.ts` finalised: severity-partitioned assertions, per-route and per-locale reporting
- A machine-readable violation report uploaded as a CI artifact, with the count in the job summary
- A regression test for one real finding from Lesson 22.2 — a named failing case, fixed, then pinned
- A written suppression policy: what may be suppressed, where the annotation lives, and that every
  suppression carries a reason and an owner
- The gate registered in the quality-gate table that Lesson 24.5 assembles, and pointed at by
  branch protection in Lesson 24.5

## Classic WP Analogy

**Like Lesson 22.3, this has no classic analogue at all — and here the absence is the entire
point of the lesson.** There is no WordPress equivalent of "the build fails because a form field
lost its label". `wp plugin check` has accessibility sniffs, and they are useful, and they are
not a merge gate on your site. The Theme Review process is a review, performed once, by a person,
before the theme is published. Nothing in the Classic WordPress toolchain re-verifies
accessibility when a developer changes a button three years later.

The closest habit you have is PHPCS, and the comparison holds well enough to be instructive.
PHPCS did not teach anyone the WordPress Coding Standards; it made a class of violation
unmergeable, which changed the *default*. Before PHPCS, correct spacing required someone to care
at the moment of typing. After PHPCS, incorrect spacing required someone to actively fight the
tool. An accessibility gate does the same thing to a category of bug that has, historically,
been fixed only after a complaint or an audit — which is to say, mostly not fixed.

Where the analogy breaks is the shape of the failure. A PHPCS violation is a fact: the line is
either indented correctly or it is not, and the fix is unambiguous. An axe violation is
occasionally arguable — a rule can fire on a construct that is genuinely fine, or fire on
third-party markup you do not control, or fire on editor-authored HTML coming out of `RichText`
where the fix belongs in WordPress rather than in your React tree. So an accessibility gate needs
something PHPCS does not: a suppression mechanism with a written policy, so that "axe is wrong
here" is a recorded, reviewable decision rather than a silently disabled rule. That policy is
the last thing you write in this module, and it is what keeps the gate credible.

---

## Key Concepts

### 1. An audit is a snapshot, a gate is a guarantee, and neither is a promise of accessibility

Lesson 22.3's suite is 23 scans that were green on the day you ran them. Turning it into a
required check changes the tense of the claim, and it is worth being precise about what the new
claim is and what it is not.

| Claim | True after 22.3 | True after 22.4 |
|---|---|---|
| "these routes had no critical or serious axe violations in September" | ✅ | ✅ |
| "these routes have none **right now**" | ❌ nobody re-ran it | ✅ every pull request |
| "a change that introduces one cannot merge" | ❌ | ✅ |
| "a blind user can submit an incident" | ❌ | ❌ — Lesson 22.2's walkthrough, and only that |
| "we conform to WCAG 2.2 AA" | ❌ | ❌ — roughly a third of the criteria are machine-checkable |

The fourth and fifth rows are the reason the module README opens with a warning rather than a
celebration. A gate makes a category of regression unmergeable. It does not make the product
accessible, and a team that believes it does has bought a false certificate — which is worse
than no gate, because it stops the manual work being scheduled.

### 2. The ratchet, applied to a different number

Lesson 21.4 owns this argument and this lesson cites it rather than re-deriving it: **start every
threshold at "no worse than today" and raise it in a dedicated pull request whose only content is
the new number.** A gate introduced at an aspirational number is red on arrival, red for reasons
unrelated to the change in front of it, and disabled within a week — usually with a
`continue-on-error: true` that nobody removes.

Applied here, that means three things:

| Decision | Because of the ratchet |
|---|---|
| `critical` and `serious` at **zero** | Lesson 22.3 fixed the suite to green first. Zero is "no worse than today", not an aspiration |
| `moderate` and `minor` **reported, not enforced** | they are not zero today, and a gate at a number you do not meet is a gate you disable |
| the Lighthouse accessibility floor set in **24.5**, not here | one number, one owner. A threshold set in the same commit as its baseline has been compared to nothing |

And the escape hatch, defined honestly rather than left to be invented at 6pm on a Friday: the
way to ship past this gate is a **suppression with a reason, an owner and a review date**
(Key Concept 7), not `continue-on-error`.

### 3. The severity split, argued

**Zero `critical` and zero `serious` blocks a merge. `moderate` and `minor` are reported in the
job summary and block nothing.**

| | `critical` / `serious` | `moderate` / `minor` |
|---|---|---|
| What it means to a user | the task is impossible, or very hard | degraded, still possible |
| Typical example | a submit button with no accessible name; text at 2.0:1 | a skipped heading level; an unnamed `<section>` |
| Is it arguable? | almost never | sometimes, and sometimes unfixable by you |
| Count today | **0**, after Lesson 22.3 | near zero — see below |
| Blocks a merge | **yes** | no |

**And here is the uncomfortable part, which Verification check 7 makes you confront.** The five
tags select **70 rules**, and their impacts are 20 `critical`, 44 `serious`, 4 `moderate` and 2
`minor` — the whole long tail is six rules. `moderate` and `minor` are mostly carried by
**best-practice** rules, which Lesson 22.3's `withTags` already excludes. So this suite's
`moderate` reporting path is real, correct, and almost never exercised. The findings it was built for — `heading-order`, `region`, `landmark-one-main` — come
out of the DevTools extension's default rule set instead, which is precisely why Lesson 22.3
Step 2 is a manual run and not a formality. A documented threshold that never fires is a
threshold nobody has tested, and pretending otherwise is how a policy quietly becomes decoration.

The argument for the split is not that `moderate` findings do not matter — a skipped heading
level is a real irritation for a screen-reader user navigating by heading. It is that the
`moderate` bucket contains a long tail whose members are individually worth fixing and
collectively **not worth blocking a release for**, including findings you cannot fix at all:
Lesson 14.3 established that heading levels inside editor content are not controllable from
React, and a gate that blocks a hotfix because an editor used an `h4` is a gate that gets
switched off the first time somebody needs to ship.

The mechanism that stops "reported" meaning "ignored" is the job summary in Key Concept 6. A
number that appears on every pull request gets noticed when it moves; a number in a log file
does not.

### 4. A project name is a cross-module contract, and the order is frozen

`playwright.config.ts` is edited by three lessons across three modules, so the array's final
contents are frozen and each lesson writes exactly one entry.

```
   FINAL ORDER, frozen                    written by
   ──────────────────────────────         ───────────────────────────────
   setup        auth storageState         Lesson 23.6
   smoke        every read-only spec      Lesson 12.3
   mutations    specs that write          Lesson 23.6
   a11y         e2e/a11y.spec.ts          THIS LESSON — last in the array
```

Two names are already load-bearing outside this file. **Module 23's Starting State runs
`--project=smoke` and `--project=a11y`**, so renaming either breaks a module you have not read
yet. And this lesson adds **no `dependencies` key**, because the `setup` project does not exist:
Lesson 23.6 creates it and gives `a11y` `dependencies: ['setup']` then, along with
`fullyParallel: false` and `workers: 1` scoped to `mutations` only.

There is one consequence of adding a second project that the brief for this file does not cover
and that you cannot avoid. Lesson 12.3's `smoke` project has no `testMatch`, so it matches every
`e2e/**/*.spec.ts` — including `a11y.spec.ts`. Adding `a11y` without excluding it from `smoke`
runs all 23 scans **twice**. Step 1 adds a `testIgnore` to `smoke` for exactly that reason.

With two projects and one excluded file that is the right shape, because a new read-only spec
then joins `smoke` by **existing** rather than by being listed. Lesson 23.6 **replaces** the line
with an explicit `testMatch` allowlist, and it is worth knowing why the answer inverts: it adds
two projects whose specs must *leave* `smoke`, so the ignore list would grow to five negated
names on one line, where a typo silently readmits a mutation spec into the parallel read project.
Once the excluded set grows faster than the included one, invert the rule.

### 5. A project, not a `--grep`

Both would let you run the scans on their own. They are not equivalent, and the difference is
what makes a project the right unit for a gate.

| | `--project=a11y` | `--grep @a11y` |
|---|---|---|
| Its own `use` block (viewport, colour scheme, timeouts) | ✅ | ❌ shares the caller's |
| Its own `dependencies` | ✅ — Lesson 23.6 needs this | ❌ |
| Appears in `--list` and in the HTML report as a unit | ✅ | ❌ |
| Survives someone renaming a test title | ✅ | ❌ |
| A stable name a CI job and another module can reference | ✅ | a tag in a string |

The fourth row is the one that decides it. A gate addressed by a substring of a test title is a
gate that silently stops covering anything the moment somebody rewords a test — and it fails
*open*, reporting zero scans and zero violations, which is the worst possible failure mode for a
check whose whole job is to say "no".

### 6. The machine-readable report, and why the count belongs in the summary

Two outputs, two audiences, and conflating them is why accessibility reports go unread.

| Output | Audience | Where |
|---|---|---|
| the full violation JSON | the person fixing it | a CI artifact, per scan, downloadable |
| **one line with the counts** | everybody else, on every pull request | the job summary |

The full JSON has to be per-scan and written by the test itself, because with `fullyParallel:
true` the scans run in several worker processes and there is no shared memory to aggregate in.
One file per scan under `test-results/a11y/` is worker-safe by construction — the directory is
already gitignored — and aggregating it afterwards is a `jq` one-liner rather than a custom
Playwright reporter.

The summary line is the part that makes "reported" mean something. `12 moderate, 3 minor` on
every pull request is a number people watch drift; the same information in a 4 MB JSON attachment
is a number nobody has ever read.

### 7. The suppression policy, which is the thing PHPCS never needed

A PHPCS violation is a fact: the line is indented correctly or it is not. An axe violation is
occasionally arguable — a rule can fire on a construct that is genuinely fine, on third-party
markup you do not control, or on editor-authored HTML coming out of `RichText` where the fix
belongs in WordPress. So an accessibility gate needs something a style linter does not: a way to
say "axe is wrong here" that is **recorded, reviewable and expiring**.

| Mechanism | Reviewable in a diff | Scoped | Expires | Verdict |
|---|---|---|---|---|
| `AxeBuilder.disableRules(['x'])` | yes | ❌ every scan in the suite | ❌ | too blunt |
| `.exclude('#some-selector')` | yes | a DOM subtree | ❌ | a CSS locator, which the house rules ban |
| `test.fixme()` on the whole scan | yes | ❌ the whole route | ❌ | loses all coverage of a route |
| **a typed allowlist keyed on `{ scan, rule }` with a reason, an owner and a `reviewBy` date** | yes | one rule, one scan | **yes** | ✅ **this course** |

The expiry is what keeps it credible. Every suppression mechanism in the industry accumulates
entries nobody remembers adding; a `reviewBy` date that **fails the suite when it passes** turns
"we will look at that later" into a calendar entry with a name on it. The cost, named: somebody's
pull request will go red for a suppression they did not write, on a date they did not choose. That
is the mechanism working, and the fix is a two-line diff that either removes the entry or moves
the date with a new reason.

### 8. A regression test is a finding with a date on it, and it is not always an axe scan

Lesson 22.2 found four things. Only some of them are things a rules engine can see, and choosing
the wrong tool for a regression test produces a test that is green on the broken code.

| 22.2 finding | Detectable by axe? | Pinned by |
|---|---|---|
| Two live regions announcing one fact | ❌ two well-formed regions are two well-formed regions | a Playwright assertion — **Step 4** |
| A live region populated in the server HTML | ❌ well-formed either way | the same assertion |
| Focus falls to `<body>` when a form unmounts on success | ❌ focus position is not a rule | Lesson 23.6, in `mutations` — it needs a successful submit |
| `ui/dialog.tsx` animating under `prefers-reduced-motion` | ❌ axe has no motion rule | Lesson 22.2's `grep`, and a DevTools check |

So the regression test this lesson adds is a **focus and live-region assertion inside the `a11y`
project**, not an axe scan. That is not a compromise — it is the point of Key Concept 1's fourth
row. The project is named for the concern, not for the tool.

### 9. The payoff loop, which is why accessibility work compounds instead of decaying

This is the reason Module 22 sits before Module 23 rather than after it.

```
   YOU give a control a real accessible name
        │
        ├──▶ getByRole('button', { name }) can find it        Playwright, 12.3
        ├──▶ getByRole / getByLabelText can find it           RTL, Lesson 23.2
        ├──▶ axe stops reporting button-name                  Lesson 22.3
        └──▶ a screen-reader user can operate it              the actual point

   YOU delete it
        │
        └──▶ the UNIT TEST fails first, before any axe scan runs
```

React Testing Library's primary queries are `getByRole`, `getByLabelText` and `getByText` — the
accessibility tree, by design. Playwright's recommended locators are the same. Lesson **23.7**
makes it an enforced ESLint rule scoped to `e2e/**`, so reaching for a CSS selector when a
locator is awkward becomes a lint error rather than a habit. And Lesson **23.2** is where it
cashes in: `IncidentFilters.test.tsx` finds the two selects by their label text, so Lesson 22.2's
`useId()` fix and its real `<label htmlFor>` bindings are what make that test writable at all.

The consequence, stated as a rule you can act on: **when a locator is awkward, the component is
usually wrong.** That is the sentence that turns a test-suite convention into an accessibility
mechanism.

### 10. What this lesson defines, and what Module 24 does with it

This lesson writes **no workflow file**, and being explicit about that boundary is what stops two
modules writing the same YAML differently.

| Artifact | Owner |
|---|---|
| the `a11y` Playwright project | **22.4** |
| the command: `npx playwright test --project=a11y` | **22.4** (already frozen in appendix 07) |
| the threshold: 0 `critical`, 0 `serious`; `moderate`/`minor` reported | **22.4** |
| the per-scan JSON under `test-results/a11y/` and the summary one-liner | **22.4** |
| the GitHub Actions job that runs it, uploads the artifact and writes the summary | Lesson **24.4** |
| the required-check list and branch protection | Lesson **24.5** |
| the Lighthouse `accessibility >= 0.95` assertion | Lesson **24.5** |
| `BTT_REPORTER_PASSWORD` as a repository secret | Lesson **24.4** |

Step 8 writes the row Lesson 24.5's gate table needs, so that module can cite it rather than
re-decide it.

---

## Task

### Step 1: Append the `a11y` project, and exclude it from `smoke`

An **edit** to the file Lesson 12.3 created and Lesson 12.4 extended. The file already holds
`testDir`, `fullyParallel`, `forbidOnly`, `retries`, the conditional `workers` spread, `reporter`,
`use` with the `127.0.0.1` `baseURL`, `webServer` and `globalSetup`. Do not reprint it; this
lesson's key is the `projects` array and nothing else.

```ts
// next-app/playwright.config.ts — the projects array, replacing 12.3's one-liner
  projects: [
    {
      name: 'smoke',
      // 12.3's project had no testMatch, so it matched every e2e/**/*.spec.ts —
      // which, the moment a second project exists, means every a11y scan runs
      // TWICE. testIgnore rather than an explicit testMatch allowlist, so a new
      // read-only spec joins `smoke` by existing rather than by being listed.
      // Lesson 23.6 extends this same regex when it moves the mutation specs into
      // its own project; establishing the pattern here is cheaper than inventing
      // it twice. Lesson 22.4 §4.
      testIgnore: /a11y\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // The NAME is a contract: Module 23's Starting State runs
      // `--project=a11y`, Lesson 24.4 puts it in `ci-required`'s `needs:` list,
      // and Lesson 24.5 decides that it blocks a merge.
      name: 'a11y',
      testMatch: /a11y\.spec\.ts/,
      // NO `dependencies` key. The `setup` project does not exist yet — Lesson
      // 23.6 creates it for storageState auth and adds
      // `dependencies: ['setup']` here at the same time. Until then the six
      // authenticated scans drive the login form themselves (Lesson 22.3 §7).
      use: { ...devices['Desktop Chrome'] },
    },
  ],
```

**Verify §1:**

- [ ] `npx playwright test --list` prints each `smoke` test once and each `a11y` test once. A
      doubled a11y test means `testIgnore` is missing or misspelled.
- [ ] `npx playwright test --list --project=a11y | tail -1` reports 23 tests, not 36.
- [ ] `npm run type-check` is silent. A complaint here is usually `devices` — it is already
      imported by 12.3's file and importing it twice is the mistake.

### Step 2: Partition the assertion, and make the run self-reporting

Lesson 22.3's `scan()` already returns `{ blocking, reported }`. Turn `reported` from a
`console.log` into a structured count, because Step 3 has to aggregate it.

```ts
// next-app/e2e/a11y.spec.ts — replace the return type and the reported handling
type Partitioned = {
  readonly blocking: readonly string[];
  readonly reported: readonly string[];
  /** Counts by impact, for the job summary. Lesson 22.4 §6. */
  readonly counts: Readonly<Record<'critical' | 'serious' | 'moderate' | 'minor', number>>;
};

// …inside scan(), after `describe` is defined:
  const count = (impact: string): number =>
    results.violations.filter((violation) => (violation.impact ?? 'minor') === impact).length;

  const counts = {
    critical: count('critical'),
    serious: count('serious'),
    moderate: count('moderate'),
    minor: count('minor'),
  } as const;
```

### Step 3: Write the machine-readable report, and the summary one-liner

One file per scan, written by the test that produced it. With `fullyParallel: true` the scans run
across several worker processes, so there is no shared array to push into — and a directory of
small files is worker-safe by construction (§6).

```ts
// next-app/e2e/a11y.spec.ts — add to the imports, then to scan()
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** `test-results/` is already gitignored (root .gitignore, Module 01). */
const REPORT_DIR = path.join('test-results', 'a11y');

// …at the end of scan(), replacing Lesson 22.3's attach()-only version:
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(
    // The scan id contains spaces and an arrow; make it a filename without
    // losing which scan it was.
    path.join(REPORT_DIR, `${id.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`),
    JSON.stringify({ id, counts, violations: results.violations }, null, 2),
    'utf8'
  );

  // Keep the attachment too: the JSON file is for CI, the attachment is for the
  // HTML report a developer opens locally. Two audiences, §6.
  await test.info().attach(`axe-${id}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });
```

The summary is then a `jq` one-liner, which is what Lesson 24.4 pipes into
`$GITHUB_STEP_SUMMARY`. No custom reporter, no new script file:

```bash
cd next-app

jq -s '{
  scans: length,
  critical: (map(.counts.critical) | add),
  serious:  (map(.counts.serious)  | add),
  moderate: (map(.counts.moderate) | add),
  minor:    (map(.counts.minor)    | add)
}' test-results/a11y/*.json
# Expected: {"scans":23,"critical":0,"serious":0,"moderate":N,"minor":M}
#
# THIS is the line that makes "reported" mean something. A moderate count on
# every pull request is a number people notice moving; the same information in a
# 4 MB attachment is a number nobody has read. Lesson 24.4 turns it into a
# markdown row in the job summary.
```

**Verify §3:**

- [ ] `ls test-results/a11y/*.json | wc -l` is 23 after a full run, 17 without a password.
- [ ] The `critical` and `serious` totals are `0`. If they are not, the run failed and Step 2's
      assertion is what told you — the JSON is evidence, not the gate.
- [ ] `git status --short` is clean. `test-results/` is gitignored; if it is not, stop and fix the
      root `.gitignore` before you commit.

### Step 4: The regression test for one real finding from Lesson 22.2

Read Key Concept 8 before choosing a subject: axe cannot see the finding you most want to pin.
The one that is both real and deterministic in a read-only project is the **live region**, and it
pins two separate defects at once — Lesson 20.3's always-populated region, and the duplicate that
consolidating it removed.

```ts
// next-app/e2e/a11y.spec.ts — append. Not an axe scan: axe cannot tell a useful
// announcement from a useless one, and two well-formed regions are two
// well-formed regions. Lesson 22.4 §8.
test.describe('regressions', () => {
  test('exactly one live region on /incidents, empty until the user changes something', async ({
    page,
  }) => {
    const response = await page.goto('/en/incidents');
    expect(response?.status()).toBe(200);

    // 1. EXACTLY ONE. Lesson 20.3 put an aria-live on the visible count in
    //    IncidentBrowser; Lesson 22.2 moved it into IncidentFilters as an
    //    sr-only role="status" region and made the visible count plain text.
    //    Two regions announcing one fact means the screen reader says it twice,
    //    and the second reading arrives while the user is already acting on the
    //    first.
    //
    //    getByRole('status'), NOT page.locator('[aria-live="polite"]'). That is
    //    the whole reason Lesson 22.2 chose the role over the attribute pair:
    //    an attribute needs a CSS selector and a role does not, so this
    //    assertion stays inside the selector contract Lesson 23.7 enforces.
    //    On a healthy origin there is exactly one; Lesson 18.4's degraded-list
    //    notice is a second role="status" that appears only when WordPress is
    //    unreachable, and Lesson 23.6 owns that state.
    const live = page.getByRole('status');
    await expect(live).toHaveCount(1);

    // 2. EMPTY on arrival. Announcing "40 incidents found" to a user who has
    //    just loaded the page is noise they did not ask for, and a region
    //    created BY the update it announces is unreliable (Lesson 16.1 §7).
    await expect(live).toHaveText('');

    // 3. POPULATED after a change the user made. The label comes from the
    //    catalogues, so match on the count rather than on the sentence.
    await page
      .getByRole('combobox', { name: /severity/i })
      .selectOption('s1-catastrophic');

    await expect(live).not.toHaveText('');
  });
});
```

> **`getByRole('combobox')` for a native `<select>` is correct and surprises people.** A
> `<select>` without `multiple` and without `size` maps to role `combobox`, not `listbox` —
> `listbox` is the popup. That mapping is exactly why Lesson 22.2's `<label htmlFor>` fix matters:
> without an accessible name there is no `{ name: /severity/i }` filter to be had, and this test
> could not be written.

**Verify §4 — red before, green after. Two probes, because the test makes two claims:**

```bash
cd next-app

# PROBE 1 — populate the region on the server, which is the half of Lesson 20.3's
# behaviour that this spec catches. `sed -i.bak` plus `mv`, never `git checkout --`.
sed -i.bak "s|useState('')|useState('probe')|" \
  src/components/incidents/IncidentFilters.tsx
npx playwright test --project=a11y --grep 'exactly one live region'; echo "exit=$?"
# Expected: exit=1, failing on `toHaveText('')` with received "probe"
mv src/components/incidents/IncidentFilters.tsx.bak \
   src/components/incidents/IncidentFilters.tsx

# PROBE 2 — add a second region announcing the same fact, which is the other
# half. Give the VISIBLE count a role="status" as well.
sed -i.bak 's|<p>{t(.resultCount.|<p role="status">{t('"'"'resultCount'"'"'|' \
  src/components/incidents/IncidentBrowser.tsx
grep -c 'role="status"' src/components/incidents/IncidentBrowser.tsx
# Expected: 1 — the probe
npx playwright test --project=a11y --grep 'exactly one live region'; echo "exit=$?"
# Expected: exit=1, failing on `toHaveCount(1)` with received 2
mv src/components/incidents/IncidentBrowser.tsx.bak \
   src/components/incidents/IncidentBrowser.tsx

npx playwright test --project=a11y --grep 'exactly one live region'
# Expected: 1 passed
```

> **What this test does NOT catch, stated because it matters.** Lesson 20.3 wrote the duplicate as
> `aria-live="polite"`, not `role="status"`, and `aria-live` alone confers no role — so
> `getByRole('status')` would not see it and the spec would stay green on the exact code Lesson
> 22.2 removed. The spelling is pinned by a different mechanism: Lesson 22.2's Verification greps
> `src/components/` for `aria-live` and expects no output, and Lesson 24.2 is where that grep could
> become a `no-restricted-syntax` rule. **One finding, two enforcement mechanisms, because neither
> alone covers it** — which is a more useful thing to have learned than a test that catches
> everything, because no test does.

The other three findings from Lesson 22.2 are not pinned here, and the reason is written into
`docs/accessibility.md` in Step 7 rather than left implicit: the success-state focus loss needs a
successful form submit, which is a mutation, which belongs in Lesson 23.6's `mutations` project.

### Step 5: The suppression mechanism

A typed allowlist, in the spec, keyed on one rule and one scan, carrying a reason, an owner and an
expiry. Empty today — every entry is a decision somebody signed.

```ts
// next-app/e2e/a11y.spec.ts — above scan()
type Suppression = {
  /** A scan id from the matrix, or '*' for every scan. Prefer the narrow one. */
  readonly scan: string;
  /** An axe rule id, exactly as it appears in the violation. */
  readonly rule: string;
  /** Why axe is wrong here, or why the fix is not ours. One sentence. */
  readonly reason: string;
  /** A person or a team. Not "the team". */
  readonly owner: string;
  /** ISO date. The suite FAILS when this passes — Lesson 22.4 §7. */
  readonly reviewBy: string;
};

/**
 * EMPTY ON PURPOSE. Lesson 22.3 fixed every critical and serious violation
 * rather than suppressing any of them, which is why the gate can open at zero
 * (the ratchet, Lesson 21.4). The mechanism exists so that the first genuinely
 * arguable violation is a recorded decision with a name and a date on it,
 * instead of a `continue-on-error: true` nobody removes.
 *
 * An example of the shape, commented out rather than active:
 *   {
 *     scan: 'B en incident detail',
 *     rule: 'color-contrast',
 *     reason: 'Fires on editor-authored inline styles inside RichText; the fix is in WordPress.',
 *     owner: 'ada@example.test',
 *     reviewBy: '2026-03-01',
 *   },
 */
const SUPPRESSIONS: readonly Suppression[] = [];

function isSuppressed(scanId: string, ruleId: string): boolean {
  return SUPPRESSIONS.some(
    (entry) => (entry.scan === '*' || entry.scan === scanId) && entry.rule === ruleId
  );
}
```

Two wirings. The filter, inside `scan()`:

```ts
// next-app/e2e/a11y.spec.ts — inside scan(): `describe` gains a second parameter
  const describe = (
    impacts: readonly string[],
    // Suppressions apply to the BLOCKING partition only. A suppressed rule is
    // still counted in `counts` and still appears in the job summary — the
    // decision was "do not block on this", not "pretend it is not there".
    honourSuppressions: boolean
  ): readonly string[] =>
    results.violations
      .filter((violation) => impacts.includes(violation.impact ?? 'minor'))
      .filter((violation) => !(honourSuppressions && isSuppressed(id, violation.id)))
      .map(
        (violation) =>
          `[${violation.impact}] ${violation.id} × ${violation.nodes.length} — ` +
          `${violation.help} (${violation.helpUrl})`
      );

  // …and the two call sites, replacing Lesson 22.3's:
  //   blocking: describe(['critical', 'serious'], true),
  //   reported: describe(['moderate', 'minor'], false),
```

And the expiry, as a test of its own so it fails loudly rather than in a log line:

```ts
// next-app/e2e/a11y.spec.ts — append to the `regressions` describe
  test('no accessibility suppression has passed its review date', () => {
    const today = new Date().toISOString().slice(0, 10);
    const stale = SUPPRESSIONS.filter((entry) => entry.reviewBy < today).map(
      (entry) => `${entry.rule} on "${entry.scan}" — owner ${entry.owner}, due ${entry.reviewBy}`
    );

    // An ISO date compares correctly as a string, which is the one good reason
    // to store a date as text.
    expect(stale, `expired suppressions:\n${stale.join('\n')}`).toEqual([]);
  });
```

> **Yes, this will turn somebody's unrelated pull request red.** That is the mechanism working,
> and it is the difference between a suppression list and a graveyard. The fix is a two-line diff
> that either deletes the entry because the violation is gone, or moves the date **with a new
> reason** — and a reviewer who sees the second form twice in a row has learned something about
> the finding that no dashboard would have told them.

**One thing this mechanism deliberately does not do.** It does not fail on an *unused*
suppression, the way Lesson 24.2's `reportUnusedDisableDirectives` does for ESLint. Knowing a
suppression went unused requires aggregating across all 23 scans and all workers, which means a
custom reporter. The honest substitute is the `reviewBy` date: an obsolete entry is caught the
day it expires rather than the day it becomes obsolete. If that gap ever matters, the aggregation
belongs in the `jq` step from Step 3, not in the spec.

### Step 6: Run it the way CI will

```bash
cd next-app
npm run build

# The exact command Lesson 24.4's job runs, and the one appendix 07 froze.
BTT_REPORTER_PASSWORD="$BTT_REPORTER_PASSWORD" npx playwright test --project=a11y
# Expected: 25 passed — the 23 scans plus the two regression tests

# The summary, from the files the run just wrote.
jq -s '{scans: length, critical: (map(.counts.critical)|add), serious: (map(.counts.serious)|add), moderate: (map(.counts.moderate)|add), minor: (map(.counts.minor)|add)}' \
  test-results/a11y/*.json
# Expected: critical 0, serious 0, and whatever moderate/minor are today
```

### Step 7: Write the gate down, in both places it belongs

`docs/quality-gates.md` is Lesson 15.5's file, appended by 16.4, 17.2 and 18.3, and **extended in
full** by Lesson 24.5. Append one section in the established shape and do not touch anyone else's.

```markdown
<!-- docs/quality-gates.md — append one section -->
## Accessibility (Lesson 22.4)

| | |
|---|---|
| Command | `npx playwright test --project=a11y` |
| Blocks a merge | **zero `critical`, zero `serious`** axe violations across 23 scans |
| Reported only | `moderate` and `minor`, as a count in the job summary |
| Rule set | `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`. **Not** `best-practice` |
| Artifact | `test-results/a11y/*.json`, one file per scan, uploaded by Lesson 24.4's job |
| Summary line | the `jq -s` aggregation in Lesson 22.4 Step 3 |
| Secret required | `BTT_REPORTER_PASSWORD`; six authenticated scans **skip** without it |
| Escape hatch | a `SUPPRESSIONS` entry with a reason, an owner and a `reviewBy` date. **Not** `continue-on-error` |
| Owner of the CI job | Lesson 24.4 |
| Owner of branch protection | Lesson 24.5 |

**Why `moderate` does not block.** The bucket is a long tail that is individually worth fixing
and collectively not worth blocking a release for, and part of it is unfixable from React:
Lesson 14.3 established that heading levels inside editor-composed content are not controllable
here. A gate that blocks a hotfix because an editor used an `h4` is a gate that gets switched
off. This is Lesson 21.4's ratchet applied to a different number, and 21.4 owns the argument.

**Known gap 1.** Automated rules cover roughly a third of real accessibility issues (Lesson 22.3
§1). The manual checks in `docs/accessibility.md` — the keyboard walkthrough and the
VoiceOver/NVDA smoke script — are the majority of the audit and nothing enforces that they were
run. That is a process gap, honestly, and no gate closes it.

**Known gap 2.** Of the 70 rules these five tags select, 64 are `critical` or `serious` and six
are not. The `moderate`/`minor` reporting path above is therefore correct and rarely exercised:
`heading-order`, `region` and `landmark-one-main` are best-practice rules and this suite does not
run them. They are covered by the manual extension run in Lesson 22.3 Step 2, and
the number in the job summary is usually zero. Do not read a zero there as "there is nothing in
the long tail".
```

```markdown
<!-- docs/accessibility.md — append one section -->
## The merge gate (Lesson 22.4)

`playwright.config.ts` project order is frozen: `setup` (23.6), `smoke` (12.3), `mutations`
(23.6), `a11y` (22.4). `a11y` has no `dependencies` yet; 23.6 adds `dependencies: ['setup']`
when the `setup` project exists.

| Regression | Pinned by |
|---|---|
| Two live regions on `/incidents`, or one populated on arrival | `e2e/a11y.spec.ts`, the `regressions` block |
| A suppression outliving its review date | the same block |
| Focus falls to `<body>` when a form unmounts on success | **not pinned here** — it needs a successful submit, so Lesson 23.6 pins it in `mutations` |
| `ui/dialog.tsx` animating under `prefers-reduced-motion` | a `grep` in Lesson 22.2's Verification, and a DevTools check. axe has no motion rule |

**The payoff loop.** RTL's primary queries and Playwright's recommended locators are both the
accessibility tree, so a control with no accessible name fails a unit test before any axe scan
runs. Lesson 23.2 cashes this in for `IncidentFilters`, and Lesson 23.7 makes the selector
contract an ESLint rule scoped to `e2e/**`. When a locator is awkward, the component is usually
wrong.
```

### Step 8: Hand over, explicitly

This lesson writes **no workflow file**. `.github/workflows/` belongs to Lesson 24.4, and a
second module writing the same job differently is exactly the failure mode Key Concept 10's table
exists to prevent.

What Lesson 24.4 needs, in one place so it can be lifted:

| It needs | It is |
|---|---|
| the command | `npx playwright test --project=a11y` |
| the working directory | `next-app` |
| the prerequisite | `npm run build`, plus the seeded stack the `webServer` health probe waits on |
| the secret | `BTT_REPORTER_PASSWORD` — without it, six scans skip and the job still passes |
| the artifact path | `next-app/test-results/a11y/` |
| the summary command | the `jq -s` line from Step 3, piped to `$GITHUB_STEP_SUMMARY` |
| the failure semantics | non-zero exit **is** the gate. No `continue-on-error` |

And the row Lesson 24.5's gate table needs, verbatim: **`a11y` — `npx playwright test
--project=a11y` — blocks on zero `critical` and zero `serious` — required check — escape hatch is
a dated `SUPPRESSIONS` entry, never `continue-on-error`.**

---

## Verification

```bash
cd next-app

# 1. The gate, and the two suites this lesson could have broken.
npm run verify
# Expected: exit 0, silent
npm run build
# Expected: success

# 2. The project list is EXACTLY smoke and a11y, in that order, at this point in
#    the course. This is the check that proves the frozen order is being built
#    up rather than guessed at.
npx playwright test --list --project=a11y > /dev/null && echo "a11y exists"
# Expected: a11y exists
grep -oE "name: '[a-z0-9]+'" playwright.config.ts
# Expected: name: 'smoke' then name: 'a11y' — two lines, in that order

# 3. NEGATIVE — neither of Lesson 23.6's projects exists yet, and `a11y` has no
#    dependencies. A `dependencies: ['setup']` here today fails with "project
#    setup not found", which is a confusing error for the next reader to inherit.
grep -cE "name: '(setup|mutations)'" playwright.config.ts
# Expected: 0
grep -c 'dependencies' playwright.config.ts
# Expected: 0

# 4. NEGATIVE — the a11y scans run ONCE, not twice. Without `testIgnore` on the
#    `smoke` project, 12.3's untargeted project matches a11y.spec.ts as well.
npx playwright test --list | grep -c 'a11y.spec.ts'
# Expected: 25 — the 23 scans plus the two regression tests, each listed once.
#           50 means `testIgnore` is missing from `smoke` and every scan runs in
#           both projects.
grep -c 'testIgnore' playwright.config.ts
# Expected: 1

# 5. The suite runs standalone, and the count is the one the docs claim.
BTT_REPORTER_PASSWORD="$BTT_REPORTER_PASSWORD" npx playwright test --project=a11y
# Expected: 25 passed
env -u BTT_REPORTER_PASSWORD npx playwright test --project=a11y
# Expected: 19 passed, 6 skipped, 0 failed

# 6. The artifact is written: one file per scan, with counts.
ls test-results/a11y/*.json | wc -l
# Expected: 23
jq -s '{scans: length, critical: (map(.counts.critical)|add), serious: (map(.counts.serious)|add), moderate: (map(.counts.moderate)|add), minor: (map(.counts.minor)|add)}' \
  test-results/a11y/*.json
# Expected: {"scans":23,"critical":0,"serious":0,"moderate":N,"minor":M}
#           This is the line Lesson 24.4 pipes into $GITHUB_STEP_SUMMARY.

# 7. NEGATIVE — a finding that is NOT critical or serious does not fail the run.
#    This is the check that proves the threshold is the one you documented, and
#    a gate whose behaviour differs from its written policy is worse than no
#    policy. The canonical example is a skipped heading level, so skip one.
sed -i.bak 's|<h2>{t(.filters.)}</h2>|<h4>{t('"'"'filters'"'"')}</h4>|' \
  src/components/incidents/IncidentFilters.tsx
grep -c '<h4>' src/components/incidents/IncidentFilters.tsx
# Expected: 1 — the probe
npx playwright test --project=a11y --grep 'incidents'; echo "exit=$?"
# Expected: exit=0. The run PASSES, which is the documented behaviour.
mv src/components/incidents/IncidentFilters.tsx.bak \
   src/components/incidents/IncidentFilters.tsx
#
#    READ THE REASON, because it is not the one you expect and it is a real
#    finding about the policy. `heading-order` is tagged `best-practice` in
#    axe-core, so `withTags` excluded it BEFORE the impact partition ever ran
#    (Lesson 22.3 §4). The run passed for the right outcome and the wrong
#    reason. Now go further: within the WCAG 2.2 A/AA tag set, axe's impacts are
#    overwhelmingly `critical` and `serious` — `moderate` and `minor` are mostly
#    carried by best-practice rules, which this suite does not run.
grep -o 'moderate\|minor' test-results/a11y/*.json | sort | uniq -c
# Expected: the `counts` keys, with values of 0 or close to it.
#
#    So the honest conclusion, and Step 7 writes it into docs/quality-gates.md:
#    the `moderate`/`minor` reporting path is real, correct and almost never
#    exercised by THIS suite. It is exercised by the DevTools extension's
#    default rule set, which is why Lesson 22.3 Step 2 is a manual run and not
#    an afterthought. A documented threshold that never fires is a threshold
#    nobody has tested — write that down rather than manufacturing a violation
#    to make the check look decisive.

# 8. NEGATIVE — the regression test fails when the fix is reverted on a probe
#    copy. Step 4's Verify block is the full form, with both probes; this is the
#    assertion that neither probe left anything behind.
git status --short src/
# Expected: no output
ls src/components/incidents/*.bak 2>/dev/null | wc -l
# Expected: 0
grep -rn 'aria-live' src/components/
# Expected: no output — the second enforcement mechanism for the same finding,
#           because getByRole('status') cannot see an aria-live attribute (Step 4)

# 9. The suppression list is empty, and its expiry check runs.
grep -c 'const SUPPRESSIONS' e2e/a11y.spec.ts
# Expected: 1
grep -A1 'const SUPPRESSIONS' e2e/a11y.spec.ts | grep -c '\[\];'
# Expected: 1 — empty. Lesson 22.3 FIXED every critical and serious rather than
#           suppressing any, which is why the gate can open at zero.
npx playwright test --project=a11y --grep 'review date'
# Expected: 1 passed

# 10. NEGATIVE — no escape hatch other than the documented one.
grep -rn 'continue-on-error\|disableRules\|test.fixme\|test.skip(true' \
  e2e/ playwright.config.ts
# Expected: no output. The one `test.skip` in the suite is conditional on an
#           absent password, which is a different thing: it removes coverage
#           honestly rather than hiding a failure.

# 11. NEGATIVE — this lesson wrote no workflow file. That is Lesson 24.4's.
git status --short ../.github/
# Expected: no output
ls ../.github/workflows/ 2>/dev/null | wc -l
# Expected: 0 — nothing in .github/workflows/ exists until Module 24

# 12. NEGATIVE — no CSS, attribute or positional locator anywhere, including in
#     the regression test. Lesson 22.2 chose `role="status"` over the
#     aria-live/aria-atomic pair precisely so this stays true: a role is
#     addressable by getByRole and an attribute is not (Step 4).
grep -rnE 'data-testid|nth-child|xpath=' e2e/
# Expected: no output
grep -c 'page.locator(' e2e/a11y.spec.ts
# Expected: 0
grep -c "getByRole('status')" e2e/a11y.spec.ts
# Expected: 1 — the live-region regression test

# 13. Both documents carry the gate, and neither was created by this lesson.
grep -c 'Accessibility (Lesson 22.4)' ../docs/quality-gates.md
# Expected: 1
grep -c 'The merge gate (Lesson 22.4)' ../docs/accessibility.md
# Expected: 1
git status --short ../docs/
# Expected: two MODIFIED files, not two new ones. `docs/quality-gates.md` is
#           Lesson 15.5's and `docs/accessibility.md` is Lesson 11.4's.
```

Checks 4, 7 and 10 are the three that define this lesson: the scans run once rather than twice, a
`moderate` violation genuinely does not fail the run, and there is no way past the gate other
than a dated suppression.

## Control Questions

1. Adding the `a11y` project required a `testIgnore` on Lesson 12.3's `smoke` project, which the
   frozen configuration contract did not anticipate. Explain what goes wrong without it, say why
   `testIgnore` is the right choice *here*, and then describe what Lesson 23.6 does to the same
   line and why the correct answer inverts once a third read-only spec arrives.
2. Verification check 7 skips a heading level, expects the run to pass, and then tells you the run
   passed for the wrong reason. State the wrong reason and the right one, and say what that
   implies about the sentence "moderate violations are reported in the job summary" as a
   description of *this* suite.
3. The suppression list is empty and its expiry test still ships. Give the argument for shipping a
   mechanism with no entries, then give the strongest argument against it, and say what you would
   need to observe over six months to conclude the second argument was right.
4. The regression test for Lesson 22.2's live-region work is a Playwright assertion and not an axe
   scan, and the lesson claims axe could not have caught the defect. Prove that claim: describe
   the DOM before and after the fix, and explain why every axe rule returns the same verdict on
   both.
5. The payoff loop says a control with no accessible name fails a unit test before any axe scan
   runs. Trace one concrete regression — deleting the `<label htmlFor>` binding that Lesson 22.2
   added to `IncidentFilters` — through every check in the course that would catch it, in the
   order they would run in CI, and name the one that gives the most useful failure message.

## Learn More

- [Playwright: projects](https://playwright.dev/docs/test-projects) — `testMatch`, `testIgnore`,
  `dependencies` and per-project `use`; Key Concept 5's table is a summary of this page
- [Playwright: annotations and conditional skipping](https://playwright.dev/docs/test-annotations)
  — the difference between `test.skip` on a missing secret and `test.fixme` on a known bug
- [axe-core rule descriptions, with tags and impact](https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md)
  — the table to check before you claim a rule is `moderate`, or that it is WCAG at all
- [GitHub Actions: job summaries](https://github.blog/news-insights/product-news/supercharging-github-actions-with-job-summaries/)
  — `$GITHUB_STEP_SUMMARY`, which is where Step 3's `jq` line is going in Lesson 24.4
- [GitHub Docs: about protected branches and required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
  — what "required check" actually enforces, and the ways it can be bypassed
- [Testing Library: which query should I use?](https://testing-library.com/docs/queries/about/#priority)
  — the priority list is the accessibility tree, which is the whole of Key Concept 9
- [Deque: shifting accessibility left](https://www.deque.com/blog/transform-digital-accessibility-from-a-reactive-break-fix-to-a-proactive-shift-left/) — the
  argument for a gate, read critically: note what it claims a gate proves and compare with §1
- [WAI: planning and managing web accessibility](https://www.w3.org/WAI/planning/) — the process
  side that no CI check covers, and the reason `docs/quality-gates.md` records a known gap
- [`eslint-plugin-playwright`](https://github.com/playwright-community/eslint-plugin-playwright)
  — the rules Lesson 23.7 draws on when it turns the selector contract into a lint error
