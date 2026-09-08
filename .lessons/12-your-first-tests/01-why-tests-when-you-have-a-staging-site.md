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
you about the thing you are looking at.** It has never told you about the routes you did not
open, and this app now has nine of them in front of fifty-eight published nodes. The question a
test suite answers is not "does my
new feature work" — you can see that — it is "did my new feature break something I have no
reason to suspect". That is also why writing your first test at Module 23 would be too late:
by then half the components in the app would have been built without a way to answer it.

Two things staging still does better than any test, and the course keeps using it for both:
telling you whether the page *feels* right, and telling you what real editor-authored content
does to your layout. Neither is automatable, and neither is what this module is for.

---

## Key Concepts

### 1. Four properties made manual QA rational. Three of them are gone

The `## Classic WP Analogy` named the four. Here they are again as a ledger, because the point
is not "Classic WordPress was worse" — it is that each property was doing a specific job, and
three of those jobs are now vacant.

| Property | Classic WordPress | Blame The Tech | Who does that job now |
|---|---|---|---|
| The artifact is the source | the `.php` you edited is the `.php` that ran | TypeScript through a bundler, a `next build`, a Docker image | `npm run type-check` and `npm run build` — a compiler is a test suite you did not have to write |
| A deploy is reversible in seconds | copy the previous file back over FTP | Vercel rolls back the front end; `wp core update-db` cannot be rolled back at all | nothing. This one is **not** replaceable, which is why the gates move left |
| The blast radius is one file | PHP fails per request, so a broken template broke one page | a type error fails the build; a bad `revalidateTag` string breaks every page silently | the unit suite, on the shared code |
| One system holds everything | WordPress was the whole application | two deployables agreeing on a schema, a tag scheme and a signature | nothing yet. Lesson 23.5 adds the contract test |

The one that survives is the third, and only partly: PHP still fails per request, so the
WordPress half of this app retains its old forgiveness. The Next half does not. This is why the
plugin can keep shipping with a light test suite until Module 23 while the front end gets one
now.

> **The most expensive row is the second, and it has no replacement.** `wp core update-db`
> rewrites `wp_postmeta` in place. Module 24 states it plainly: there is no down migration, and
> the only real protection is a restorable backup plus a change that was correct before it ran.
> Every gate this module installs exists because that one cannot.

### 2. Two triangles and a contract

The test pyramid is drawn as one triangle: many unit tests, fewer integration tests, a handful of
end-to-end tests. It is a fine heuristic for one application. You do not have one application.

```
   NEXT.JS                                      WORDPRESS
        ╱╲                                          ╱╲
       ╱  ╲   Playwright  (Lesson 12.3)            ╱  ╲   wp-phpunit   (Lesson 23.5)
      ╱────╲                                      ╱────╲
     ╱      ╲  RTL + MSW  (Lesson 23.2)          ╱      ╲  Pest        (Lesson 23.4)
    ╱────────╲                                  ╱────────╲
   ╱  Vitest  ╲ (Lesson 12.2)                  ╱   Pest    ╲ unit
  ╱────────────╲                              ╱────────────╲
        │                                            │
        └──────────────── THE CONTRACT ──────────────┘
              the GraphQL schema · the cache-tag strings
                     the webhook signature
```

Both triangles can be green while the application is broken, because the thing that broke is the
line between them. Neither suite owns it: a Vitest test asserts what your TypeScript does with a
string, a Pest test asserts what your PHP does with a string, and nothing yet asserts that the
two strings are the same string.

| Contract surface | Fails as | Built in | Covered by |
|---|---|---|---|
| The GraphQL schema | a field your query selects stops existing; codegen still passes because `src/gql/` was generated from a stale `wordpress-headless/schema.graphql` | Lessons 06.3, 10.2 | `npm run codegen:check` today; a real contract test in Lesson 23.5 |
| The cache-tag strings | `incident:dns` in TypeScript, `incident-dns` in PHP. HTTP 200, no log line, permanently stale pages | Lessons 10.3, 18.2, 18.3 | Lesson 12.2 pins `tags.ts`, and nothing else can: WordPress sends identifiers and never builds a tag string (Lesson 18.3 §8), so there is only one side to pin |
| The webhook signature | an HMAC computed over a differently-serialised payload. Every revalidation is rejected as a forgery, which looks exactly like a caching bug | Lesson 18.3 | Lessons 23.3 and 23.4 |

Two things follow. First, "we have 90% coverage" is not a statement about this application; it is
a statement about one of its halves. Second, the highest-value test in the whole course is the
cheapest one to write — Lesson 12.2 asserting the exact output of eight string functions —
because those eight strings are one side of a contract that nothing else can see.

### 3. Deriving the scope table

The module README hands you the answer. This is where you derive it, because the derivation is
what you will use in Module 23 when the question is about a test that does not exist yet.

Three questions, in order:

1. **Does it need a running system?** If no, it is a unit test. Not "could it be" — if it does
   not need one, it does not get one.
2. **Can it fail without any code changing?** If yes, it depends on data or on a network, and it
   belongs in the suite that owns a known database.
3. **Would a human notice?** If the answer is no, ask whether the assertion is worth keeping at
   all.

| Suite | Runs in | Answers | Does **not** answer |
|---|---|---|---|
| Vitest (`src/**/*.test.ts`) | milliseconds, no server, no database | is this function correct for these inputs | whether anything calls it, and whether the page renders |
| Playwright (`e2e/`) | tens of seconds, real browser, real Next, real WordPress | can a user reach this page and see the right thing | *why* it broke, and anything not on a route you listed |
| `## Verification` blocks | on demand, by you, once | did this lesson land | anything after you stop running them — which is the day after you wrote them |
| Pest / `wp-phpunit` (Module 23) | seconds, WordPress bootstrapped | does the plugin enforce capabilities and sanitise input | anything in a browser, and anything in TypeScript |
| Manual review on the running site | minutes, by a person | does it *feel* right, and what does real editorial content do to the layout | anything you did not think to look at |

The fourth column is the one that stops duplication. A test that could live in two rows belongs
in the cheaper one, and the way you decide "cheaper" is by reading what the expensive one would
*add*: if the Playwright spec would only prove that a pure function returns the right string, it
is a Vitest test wearing a browser.

### 4. What a bug costs, by the stage that catches it

These are this codebase's real numbers, not an industry chart.

| Caught by | Command | Feedback | Who is blocked | What it costs you |
|---|---|---|---|---|
| The compiler | `npm run type-check` | ~2–5 s | you, mid-edit | nothing. You have not even saved a wrong idea |
| The linter | `npm run lint` | ~5–15 s | you | nothing |
| Unit tests | `npm run test:run` | well under a second of test time, plus startup | you | one thought |
| The build | `npm run build` | ~30–60 s | you | a context switch |
| Smoke E2E | `npx playwright test` | 1–3 minutes, and it needs Docker up | you, and CI | a coffee, and the honest risk that you skip it locally |
| CI on a pull request | Module 24's workflow | ~5–10 minutes | the reviewer too | a review round trip |
| A WordPress editor on Monday | none | days | everyone, including the person who has to explain it | the whole reason this module exists |

Read the table as a gradient rather than a hierarchy. Every row costs roughly ten times the row
above, and the multiplier is not compute time — it is **how many people have to be involved**.
The compiler needs nobody. An editor noticing needs you, them, whoever triages, and a deploy.

> **This is also the argument for `npm test` in watch mode.** The stage before "the compiler" is
> "you were already looking at it". A test that reruns on save is not a convenience feature; it
> moves the whole gradient one step left, for free, and Lesson 12.2's watch mode is the cheapest
> thing in this module.

### 5. The do-not-test list, with a reason per line

A test suite grows until somebody deletes it. The way to stop that is to write down what is
deliberately untested, so that "there is no test for this" is a recorded decision rather than an
oversight somebody feels obliged to fix.

| Not tested | Why not | What covers it instead |
|---|---|---|
| `src/components/ui/` you have not edited | shadcn shipped it with Radix's own suite behind it; asserting that a `Dialog` opens is testing somebody else's library | Radix's tests, plus Lesson 22.3's axe run over the composed page |
| Tailwind class strings | `flex gap-4` is not behaviour. A test asserting `className` fails on every design change and catches no bug a human would care about | Lesson 21.2's visual and layout work, and your eyes |
| `src/gql/` | generated from `wordpress-headless/schema.graphql`. You cannot fix a failure in it, and regenerating would undo your fix | `npm run codegen:check` — the assertion is "not stale", not "correct" |
| The exact rendered markup of a page | see below. No snapshot tests of markup anywhere in this codebase | Playwright asserting roles and accessible names, which is what a user gets |
| Third-party plugin behaviour | ACF and WPGraphQL have their own suites, and you cannot fix their bugs from here | pinned versions, plus the schema snapshot that tells you when their output changed |
| WordPress core | `wp_insert_post()` works | the core team, and 20 years |
| `getters` and one-line re-exports | a test that only restates the implementation fails when you rename something and never when you break something | the compiler |

The snapshot rule deserves its own paragraph, because it is the one people argue about. A
snapshot test of rendered markup on this stack produces a 400-line diff of Tailwind utilities
whenever anyone adjusts spacing. Nobody reads a 400-line diff. Everybody presses `u` to update
it. At that point the snapshot is not a test — it is a changelog nobody writes and nobody reads,
and it will absorb a real regression on its way past. **`toMatchSnapshot` on markup is banned in
this codebase**, and Lesson 23.1 restates the ban when component testing arrives and the
temptation gets stronger.

The exception, so the rule stays honest: a snapshot of a small, *stable, meaningful* string is
fine — a generated `robots.txt` in Lesson 19.4, a serialised block comment in Module 14. The
test is whether a human can read the diff and say "yes, that is the change I meant".

### 6. Vitest rather than Jest, and the reason is ESM

Jest is the larger ecosystem, the better-documented one, and `next/jest` exists specifically to
make it work with a Next application. This course picks Vitest anyway, for one structural reason.

This project is native ESM: `package.json` has `"type": "module"` from Lesson 07.1, and the
`tsconfig.json` from Lesson 08.1 emits ES modules and resolves like a bundler. Two dependencies
it is committed to acquiring publish **ESM only**: `next-intl` in Lesson 20.3, and MSW v2 in
Lesson 23.2. Jest's runner is CommonJS at heart; importing an ESM-only package means either the
experimental VM modules flag or a Babel/SWC transform pipeline that you configure, maintain, and
debug forever — and every one of those debugging sessions happens while you are trying to do
something else.

| | Jest | **Vitest** |
|---|---|---|
| ESM-only dependency | needs a transform or `--experimental-vm-modules` | native import |
| Where the TypeScript transform comes from | Babel or SWC, configured by you | Vite's, already understood by the project |
| `@/*` path alias | `moduleNameMapper`, a second copy of your `paths` | `resolve.alias`, one line — Lesson 12.2 §1 |
| Watch mode | good | instant, because it reuses the module graph |
| Ecosystem size | ✅ larger, more Stack Overflow answers | smaller, though the API is deliberately Jest-compatible |
| Next.js integration | ✅ `next/jest` handles a lot for you | you write ~20 lines of config yourself |
| Verdict | the safe choice on a CommonJS codebase | ✅ **this codebase, because of `"type": "module"`** |

Note the fourth row of the "cost" column: you write the config yourself. That is a real cost and
Lesson 12.2 pays it in twenty lines. It is also why the config is worth reading rather than
copying — `next/jest` would have hidden the resolution question, and the resolution question is
the thing that goes wrong.

### 7. Playwright rather than Cypress, with the concession stated

| | Cypress | **Playwright** |
|---|---|---|
| Browser engines | Chromium, Firefox, WebKit — in separate runs, WebKit experimental | Chromium, Firefox and WebKit as first-class projects in one run |
| Starting your dev server | a plugin or a separate process you manage | `webServer` in the config, with a readiness URL — Lesson 12.3 §6 |
| Locators | `cy.get()` with CSS by default; role queries via a plugin | `getByRole` in the core API, so the accessible path is the easy path |
| Test code runs | inside the browser, which is why `async/await` is awkward | in Node, out of process — plain `async/await` |
| Debugging a CI failure | ✅ the time-travel debugger is genuinely better live | the trace viewer, which you can open from a CI artifact afterwards |
| Ecosystem | ✅ larger plugin ecosystem, longer history | smaller, newer |
| Parallelism | paid dashboard for sharding | `workers` and `--shard` in the open-source runner |
| Verdict | excellent, and a defensible choice | ✅ **this course** — for `getByRole`, `webServer` and the trace viewer |

The concession is real: Cypress's interactive runner, watching a test replay step by step with
DOM snapshots at each one, is a better *live* debugging experience than anything Playwright has,
and people who have used it miss it. Playwright's answer is different rather than identical —
`--ui` for local work, and a trace zip you download from a CI run and open with
`npx playwright show-trace`, which is the case Cypress handles worst. If your team already runs
Cypress well, the ESM argument that decided Vitest does not apply here, and switching costs more
than it returns.

### 8. What no test in this module can tell you

Three things, and being clear about them is what keeps the suite trusted.

**Whether the page feels right.** Nothing asserts that the hero has too much whitespace, that the
severity badges are shouting, or that the CTA is below the fold on a laptop. Staging tells you
that in four seconds, and it remains the right tool for it.

**What real editorial content does to your layout.** Your fixtures are polite: every headline is
short, every image is the right aspect ratio, every ACF repeater has three rows. An editor will
paste a 140-character title and one testimonial with no author. Lesson 12.4's seeder deliberately
includes some of that shape — a null field group, an empty term connection — but it cannot
anticipate a real newsroom, and no test suite ever has.

**Whether the feature was worth building.** The HOBT funnel could be perfect, green in every
suite, and pointless. That is not a gap in your tooling.

> **The corollary, which matters more than the list.** A test suite is not a replacement for
> looking at your site. It is a replacement for looking at the *other eight pages* to check that
> your change to this one did not break them. Keep opening the site.

### 9. Flakiness is a category error, not a quality problem

A suite that fails one run in forty is worse than no suite. Not "less good" — worse.

With no suite, a red pipeline means something is broken and you go and look. With a suite that
is 97.5% reliable, a red pipeline means *probably* nothing, so the learned behaviour is to press
re-run. Once re-running is the reflex, the suite has stopped being a signal and has become a
toll: it costs three minutes per push and reports nothing. And the first genuine regression it
catches gets re-run too, twice, and then merged.

```
   trustworthy suite                       flaky suite
   ──────────────────────────────          ──────────────────────────────
   red  ──▶ read the failure               red  ──▶ press re-run
        ──▶ fix the code                        ──▶ green ──▶ merge
   green ──▶ believe it                    green ──▶ believe nothing
```

The three sources of flake on this stack, all of which this module or the next addresses:

| Source | Example | Fixed by |
|---|---|---|
| Shared mutable data | "the incidents list shows 40 items", asserted against a database a colleague published a draft into | Lesson 12.4 — a fixture the run owns |
| Time | "the six most recent incidents", where `post_date` defaulted to `now` at seed time | Lesson 12.4 — one fixed epoch |
| Races in the test itself | reading a locator before the page settled | Lesson 12.3 §2 — web-first assertions that retry |

The policy this course adopts, written into your strategy document in the Task: **a flaky test is
a broken test.** Fix it or delete it in the same pull request that noticed it. Quarantining is a
Lesson 23.1 mechanism with a defined home and an owner; "we know that one is flaky" is not a
mechanism.

---

## Task

This lesson produces a document, not code. That makes it the one lesson in the module where the
deliverable is a judgement — nothing here either compiles or does not, so the verification checks
that you *made* the decisions and wrote them somewhere Modules 22, 23 and 24 can read them.

Every table below gives you the headers and one worked row. **The rest is yours to write.** Copy
the worked rows if you agree with them; the point is that you disagreed with something and can
say why.

### Step 1: Create the document and state its job

```bash
cd next-app
mkdir -p ../docs
```

`docs/` is yours — the same directory that holds the ADRs from Lesson 01.3 and the API contract
notes from Lesson 10.3. Start the file:

```markdown
<!-- docs/testing-strategy.md -->
# Testing strategy — Blame The Tech

Written in Lesson 12.1. Extended in Lesson 23.1, which adds component and PHP suites, the
RSC testing rule and a coverage threshold. Everything here is a decision, not a description:
if you change one, change it here first.

Two applications, two languages, one GraphQL contract and a cache in between. No single
suite covers that, so this document says which suite owns what — and, more usefully, what
nothing owns.
```

### Step 2: Write the scope table

This is the answer to "where does this test go?" for the rest of the course. Five rows: the two
suites you build in this module, the verification blocks you have been running since Module 01,
the PHP suite Module 23 adds, and the human.

```markdown
<!-- docs/testing-strategy.md — append -->
## 1. Scope: which suite owns what

| Suite | Runs in | Answers | Does not answer |
|---|---|---|---|
| Vitest — `src/**/*.test.ts` | milliseconds, no server, no DB | is this function correct for these inputs | whether anything calls it, or whether the page renders |
| Playwright — `e2e/` | TODO | TODO | TODO |
| `## Verification` blocks | TODO | TODO | TODO |
| Pest / wp-phpunit (Module 23) | TODO | TODO | TODO |
| Manual review on the running site | TODO | TODO | TODO |

Rule: a test that could live in two rows belongs in the cheaper one. "Cheaper" means fewer
people have to be involved when it fails.
```

**Verify §2:**

- [ ] The fourth column is filled on every row. It is the column that stops the same behaviour
      being tested three times, and it is the one people skip.
- [ ] No two rows claim the same "Answers". If two do, one of them is redundant and you should
      say which.

### Step 3: List the five most expensive things that can break

Not the five most likely — the five most expensive. Expense is measured in Key Concept 4's
currency: how many people are involved before it is fixed.

```markdown
<!-- docs/testing-strategy.md — append -->
## 2. The five most expensive failures

| # | Failure | How it presents | Cheapest suite that would catch it | Exists today? |
|---|---|---|---|---|
| 1 | A cache tag built in PHP does not match the one built in TypeScript | HTTP 200, no log line, pages stale for ever | Vitest on `tags.ts` (12.2) pins one side; a contract test (23.5) pins both | 12.2 pins one side |
| 2 | TODO | TODO | TODO | TODO |
| 3 | TODO | TODO | TODO | TODO |
| 4 | TODO | TODO | TODO | TODO |
| 5 | TODO | TODO | TODO | TODO |
```

Candidates worth considering, from the app as it stands at the end of Module 11: the GraphQL
schema drifting from the committed `schema.graphql`; a route that 500s because an ACF field group
returned `null`; a session cookie that stops being `httpOnly` (Module 15); the incident
submission kill switch being ignored (Module 16); `wp core update-db` running against a database
nobody backed up (Module 24).

**Verify §3:**

- [ ] Each row names a **suite**, not a wish. "Better code review" is not a suite.
- [ ] At least one row's answer is "nothing catches this yet". If every row is covered, you have
      chosen five comfortable failures.

### Step 4: Write the do-not-test list

One line per item, and **a reason on every line**. The verification greps for that, because a
do-not-test list without reasons gets overruled by the first person who reads it.

```markdown
<!-- docs/testing-strategy.md — append -->
## 3. Deliberately not tested

- `src/components/ui/` that we have not edited — Radix ships its own suite; asserting a Dialog opens tests somebody else's library
- Tailwind class strings — `flex gap-4` is not behaviour, and the test fails on every design change
- `src/gql/` — generated; a failure there is not fixable here, and `npm run codegen:check` already proves it is not stale
- The exact rendered markup of any page — TODO
- Third-party plugin behaviour (ACF, WPGraphQL) — TODO
- WordPress core — TODO

**No snapshot tests of markup, anywhere in this codebase.** A 400-line diff of Tailwind
utilities is a changelog nobody reads, and everybody approves it. Snapshots of small, stable,
human-readable strings are fine.
```

### Step 5: Record the two toolchain decisions

Write these down properly, with the reasoning, because Lesson 23.1 inherits both and a decision
with no recorded reason gets relitigated by whoever arrives next.

```markdown
<!-- docs/testing-strategy.md — append -->
## 4. Toolchain decisions

### Vitest, not Jest

This project is native ESM — `package.json` declares `"type": "module"` (07.1) and
`tsconfig.json` resolves like a bundler (08.1). `next-intl` (20.3) and MSW v2 (23.2) publish
ESM only. Jest would need a Babel or SWC transform pipeline to import them, configured and
maintained by us for ever. Vitest shares Vite's transform pipeline and imports ESM natively.

Conceded: Jest is the larger ecosystem and `next/jest` exists. The cost we accept is writing
~20 lines of `vitest.config.ts` ourselves — TODO: say whether you think that is a fair trade
and why.

### Playwright, not Cypress

TODO — three reasons, and one thing Cypress does better.
```

**Verify §5:**

- [ ] Both decisions name a **cost**, not only a benefit. A comparison with no downside listed is
      marketing.
- [ ] The Playwright section concedes something specific. If you cannot name one thing Cypress
      does better, you have not evaluated it.

### Step 6: State what these suites will not catch

The last section is the honest one, and it is the reason Module 23 exists as a module rather than
as an afterthought.

```markdown
<!-- docs/testing-strategy.md — append -->
## 5. What this module's suites will not catch

- Anything about the PHP half. There is no PHP test suite until Lesson 23.4
- Contract drift between the two halves — see §2 row 1; Lesson 23.5 owns it
- TODO: two more, from the list in 12.1 Key Concept 8

## 6. Flake policy

A flaky test is a broken test. It gets fixed or deleted in the pull request that noticed it —
never re-run until green, and never left with a comment saying it is known to be flaky. A
suite that fails one run in forty teaches people to ignore red, which is worse than having no
suite at all.
```

**Verify §6:**

- [ ] Every `TODO` in the file is now replaced. Verification check 9 fails while one remains.
- [ ] Read §1 and §2 back and check they agree. If the scope table gives Playwright a job that
      §2 says nothing covers, one of the two is wrong.

---

## Verification

```bash
cd next-app

# 1. The document exists where every later lesson will look for it
test -f ../docs/testing-strategy.md && echo "present"
# Expected: present

# 2. All six sections are there, in order
grep -n '^## ' ../docs/testing-strategy.md
# Expected: six headings — Scope, The five most expensive failures, Deliberately not
#           tested, Toolchain decisions, What this module's suites will not catch,
#           Flake policy

# 3. The scope table has five suites and the fourth column exists
grep -c '^| .* | .* | .* | .* |$' ../docs/testing-strategy.md
# Expected: 7 or more — 5 data rows plus a header and separator, plus the §2 table

# 4. Every do-not-test line carries a reason. Count the lines, count the em dashes.
awk '/^## 3\./{f=1;next} /^## 4\./{f=0} f&&/^- /' ../docs/testing-strategy.md | wc -l
awk '/^## 3\./{f=1;next} /^## 4\./{f=0} f&&/^- / && / — /' ../docs/testing-strategy.md | wc -l
# Expected: the two numbers are EQUAL. A line without " — " is an assertion with no
#           argument, and it will be overruled by the first person who disagrees.

# 5. Both toolchain decisions are named explicitly, so Modules 22 and 23 inherit an answer
grep -c 'Vitest' ../docs/testing-strategy.md
# Expected: 2 or more
grep -c 'Playwright' ../docs/testing-strategy.md
# Expected: 3 or more

# 6. The flake policy is a rule, not a feeling
grep -c 'flaky test is a broken test' ../docs/testing-strategy.md
# Expected: 1

# 7. NEGATIVE — snapshots appear only on the do-not side. This prints the surrounding
#    lines so you read the sentence rather than trusting a count.
grep -in -B1 'snapshot' ../docs/testing-strategy.md
# Expected: every hit sits under "## 3. Deliberately not tested" or names the narrow
#           stable-string exception. A hit under "## 1. Scope" that gives a suite
#           responsibility for snapshots contradicts Key Concept 5 — delete it.

# 8. NEGATIVE — no suite is claimed to cover the contract. Nothing does, until 23.5.
grep -in 'contract' ../docs/testing-strategy.md
# Expected: hits say the contract is NOT covered, or point at Lesson 23.5. If a line
#           reads "Playwright covers the contract", that is the single most expensive
#           wrong sentence you could leave in this file — a smoke spec cannot see a tag
#           string, and believing it can is how the Module 18 debugging session starts.

# 9. NEGATIVE — nothing is left unfinished
grep -c 'TODO' ../docs/testing-strategy.md
# Expected: 0

# 10. The compiler and linter are unaffected — this lesson wrote no code
npm run type-check && npm run lint
# Expected: no output from either

# 11. The file is new to git and staged for the module commit
git status --short ../docs/testing-strategy.md
# Expected: ?? docs/testing-strategy.md   (or A/M if you have already added it)
```

If check 4's two numbers differ, do not "fix" it by deleting the line without a reason — write
the reason. The line is there because you thought of it, and the reason is the part your future
self needs.

## Control Questions

1. Three of the four properties that made Classic WordPress manual QA rational are gone. Name
   the one that survives, say for which half of Blame The Tech it still holds, and explain what
   that implies about when the PHP test suite becomes urgent.
2. Both triangles are green and the site is serving week-old content on every incident page.
   Name the contract surface that broke, state the HTTP status the webhook returned, and say
   which lesson adds the test that would have caught it.
3. A colleague proposes a Playwright spec asserting that `listTag('incident')` produces
   `incidents`. Using the scope table's fourth column, say what is wrong with that and where the
   test belongs — then name the one thing the Playwright version would genuinely add.
4. The Vitest decision rests on `"type": "module"` and two ESM-only dependencies. Suppose neither
   `next-intl` nor MSW were in the plan. Argue the Jest side of that decision as strongly as you
   can, and say what would still tip it.
5. A suite fails roughly one run in forty. Explain why that is worse than having no suite, in
   terms of what people do rather than in terms of correctness — then say what your written flake
   policy obliges you to do the next time it happens.

## Learn More

- [Vitest — why Vitest](https://vitest.dev/guide/why.html) — the project's own argument, which
  is the ESM and transform-pipeline case from Key Concept 6 in its authors' words
- [Jest — ECMAScript modules](https://jestjs.io/docs/ecmascript-modules) — read this before
  disagreeing with Key Concept 6; the "experimental" banner and the caveat list *are* the argument
- [Playwright](https://playwright.dev/) — the multi-engine pitch and where `getByRole` comes from.
  The dedicated "why Playwright" page was folded into the homepage, so the out-of-process argument
  now lives in [the architecture docs](https://playwright.dev/docs/test-webserver)
- [Cypress — Playwright comparison](https://docs.cypress.io/app/references/trade-offs) — the
  trade-offs from the other side, so Key Concept 7's concession is not just this course being
  polite
- [Martin Fowler — Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html) —
  the canonical article, worth reading specifically to notice that it assumes one deployable
- [Google Testing Blog — Just Say No to More End-to-End Tests](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html)
  — the flakiness argument from Key Concept 9, with numbers from a very large suite
- [Testing Library — guiding principles](https://testing-library.com/docs/guiding-principles) —
  "the more your tests resemble the way your software is used", which is why Lesson 12.3's
  locators are roles and names rather than classes
- [Kent C. Dodds — Effective snapshot testing](https://kentcdodds.com/blog/effective-snapshot-testing)
  — the case *for* snapshots, from someone careful about it; read it and notice that every safe
  example is a small, readable string
- [WordPress — automated testing handbook](https://make.wordpress.org/core/handbook/testing/automated-testing/)
  — what the WordPress side of the pyramid looks like natively, before Lesson 23.4 replaces it
  with Pest
