---
title: 'Testing Strategy & the Pyramid'
module: 23
lesson: 1
teaches: [test-pyramid, rsc-testing-rule, test-boundaries, coverage-policy, five-suites]
produces: ['docs/testing-strategy.md']
requires: [12.1, 18.3]
---

# Lesson 23.1 — Testing Strategy & the Pyramid

## Quick Overview

You have two applications, two languages, one API contract between them and a cache in the
middle. Every one of those seams is a place a bug can live, and none of them is testable by the
same tool. So before writing another test, decide what goes where: five suites, each with a
stated job, a stated cost and a stated thing it is *not* responsible for. Vitest unit tests for
pure functions and sync client components. Vitest with MSW for anything that talks to
WPGraphQL. Pest for PHP logic with WordPress mocked. `wp-phpunit` for anything that needs a real
WordPress and a real database. Playwright for whatever only exists once all of it is running
together. Write it down in `docs/testing-strategy.md`, because a strategy that lives in
somebody's head produces a suite where the same behaviour is tested four times and the
interesting behaviour is tested nowhere.

One rule dominates the whole module and gets stated here first, in full, because it will save
you an afternoon:

> **The RSC testing rule.** If a component is `async`, or reads `cookies()` or `headers()`, do
> **not** unit-test the component. Unit-test the `lib/` function it awaits, and cover the
> rendered output in Playwright. Nobody can render an async Server Component through React
> Testing Library — RTL renders with `react-dom`, which has no server component runtime, no way
> to await a component function, and no request context to read cookies from. This is not a
> configuration gap. It is what those components *are*.

That rule is not a limitation to work around; it is a design instruction. It pushes logic out of
components and into `lib/` functions that are trivial to test, which is where it should have been
anyway. Lesson 23.3 shows what that looks like in practice.

By the end of this lesson you will have:

- `docs/testing-strategy.md` — five suites, each with its job, its tool, its speed and what it
  explicitly does not cover
- The RSC testing rule written down with the reasoning, so nobody re-litigates it in a pull request
- A decision table mapping every kind of code in the repo to exactly one suite
- A coverage policy: patch coverage rather than total, with a threshold and a list of excluded paths
- A flake policy: what quarantining means, where a quarantined test lives, and that the required
  CI set contains none
- The test-command surface — `npm test`, `npm run test:e2e`, `composer test:unit`,
  `composer test:integration` — with one command that runs everything

## Classic WP Analogy

Be honest about the starting point: most Classic WordPress work has no test suite. Not because
WordPress developers do not care, but because the platform makes it expensive. Global state,
`$wpdb` everywhere, plugin code that runs on `init` and touches the network, no dependency
injection, and a template layer where logic and markup are the same file. The pragmatic Classic
testing strategy was: a staging site, a checklist, and a colleague clicking through it.

| Classic WordPress habit | This module's equivalent |
|---|---|
| Click through staging before release | Playwright E2E, on every pull request |
| "It works on my machine" | The Compose stack plus a deterministic seeder |
| A `var_dump()` and a page refresh | A failing unit test that names the expectation |
| `WP_DEBUG` and the error log | Structured assertions, plus Sentry in Lesson 24.3 |
| Manually re-checking after a plugin update | The integration suite in Lesson 23.5 |
| A colleague reviewing the PR by reading it | The same, plus the gates in Lesson 24.5 |

Where the analogy breaks is not the tooling, it is **what changed to make testing worth it**.
The reason Classic WordPress testing felt like ceremony is that the units were not units — you
could not test `the_content()` filtering without a database, a post, and half of core loaded.
Here, the data layer is a typed function that takes variables and returns a shape; a Server
Action is a function that takes a `FormData` and returns a result; a block component is a
function of props. Those are cheap to test, so testing them stops being discipline and starts
being the fastest way to work.

The second break is a genuinely new problem: **the contract between two codebases**. In Classic
WordPress there was no contract, because there was no boundary — a template read post meta
directly and a typo was a blank space on the page. Now a renamed SCF field key in PHP silently
becomes `null` in TypeScript, at runtime, in production. Nothing in Classic testing practice
prepares you for that, and it is why Lesson 23.5 spends its second half on schema and
field-group contract tests rather than on more resolver coverage.

---

## Key Concepts

### 1. Five seams, and no tool spans two of them

Lesson 12.1 drew two triangles with a contract between them. That picture was right and it was
incomplete: there is not one line between the halves, there are **five distinct seams**, and each
one fails differently.

```
   ┌─────────────────────────┐                       ┌──────────────────────────┐
   │  next-app (TypeScript)  │                       │  WordPress (PHP)         │
   │                         │                       │                          │
   │  lib/  ── pure ─────────┼── ① the SCHEMA ───────┼──▶ WPGraphQL types       │
   │  Server Components      │   field names, nullability, enums                │
   │  Server Actions ────────┼── ② the MUTATION ─────┼──▶ createIncident        │
   │  route handlers ────────┼── ③ the SIGNATURE ────┼──▶ Revalidate.php        │
   │  client islands         │   X-BTT-Signature over ts.body                   │
   │                         │                                                  │
   │  Next Data Cache ◀──────┼── ④ the TAG STRING ───┼──  webhook identifiers   │
   │                         │   `incident:incident-01`, built ONLY by tags.ts  │
   │  SCF-derived types ◀────┼── ⑤ the FIELD KEY ────┼──  includes/acf-json/    │
   └─────────────────────────┘   field_incident_occurred_at                     │
                                                     └──────────────────────────┘
```

| Seam | What it is | How it fails | Who can see it |
|---|---|---|---|
| ① Schema | `wordpress-headless/schema.graphql` | a selected field stops existing; codegen still passes because `src/gql/` came from a stale snapshot | only a test that regenerates the snapshot — Lesson 23.5 |
| ② Mutation | `CreateIncidentInput` field names and coercions | an input field is renamed; the action sends a key WordPress ignores; HTTP 200, no error | in-process `graphql()` execution — Lesson 23.5 |
| ③ Signature | `hash_hmac('sha256', "$ts.$body", $secret)` in PHP vs `createHmac` in Node | every revalidation returns 401 and looks exactly like a caching bug | a Vitest test of the route plus a Pest test of the builder — 23.3 and 23.4 |
| ④ Tag string | `incident:incident-01` | one side says `incident-incident-01`; pages are permanently stale, silently | Vitest on `tags.ts` (already, 12.2) — and nothing else, because WordPress never builds a tag string |
| ⑤ Field key | `field_incident_occurred_at` | renamed in wp-admin; TypeScript gets `null` on a field codegen still types as `String` | a real WordPress reading `includes/acf-json/` — Lesson 23.5 |

Read the last column. **No single tool appears twice.** That is the argument for five suites
rather than "more tests": you cannot get to seam ⑤ by writing better Vitest tests, and you cannot
get to seam ④ by writing better Pest tests. Adding coverage inside one suite never reaches
another suite's seam, which is why teams with genuinely high coverage still ship contract bugs.

Seam ④ is the one worth memorising, because it is the cheapest to pin and the most expensive to
diagnose. `tags.ts` is the **only** thing in either codebase that builds a tag string — the
webhook sends `{"type":"post","postType":"incident","slug":"incident-01"}` and the Next route
derives every tag from `tags.ts`. That design decision, made in Lesson 18.2, is what turned a
two-sided contract into a one-sided one that fourteen Vitest assertions already cover.

### 2. Five suites, each with a stated job — and a stated thing it does not do

The fourth column is the one that matters. Without it you get a suite where "an anonymous user
cannot submit an incident" is asserted in Vitest, in Pest, in `wp-phpunit` and in Playwright,
while nobody ever checks that a renamed SCF key breaks the front end.

| # | Suite | Tool | Speed | Its job | It explicitly does **not** cover |
|---|---|---|---|---|---|
| **1** | Unit | Vitest, `environment: 'node'`; jsdom + RTL per file | milliseconds; ~1–3 s for a jsdom file | pure functions — `tags.ts`, `errors.ts`, `content.ts`, `rate-limit.ts`, `nav.ts`, `matchesFilters` — and **sync client components** reached by role and accessible name | whether anything calls them; real layout, focus rings, scrolling; any async Server Component |
| **2** | Networked | Vitest + **MSW v2**, plus `vi.mock` | milliseconds | anything that talks to WPGraphQL or a route: `client.ts`, Server Actions, route handlers, and the one island that fetches | rendering a route; cookie *attributes*, which sit behind `server-only`; whether WordPress would really accept the mutation |
| **3** | PHP unit | Pest + Brain Monkey | under a second, no WordPress | `blameScore` arithmetic, enum mapping in both directions, the signature builder, branching on `get_user_meta` | anything WordPress enforces — capabilities, `map_meta_cap`, schema registration |
| **4** | PHP integration | `wp-phpunit` + real MySQL | ~10–20 s including boot | registration and `graphql_single_name`, real roles and real capabilities, SCF field-group keys, in-process `graphql()` | the browser; TypeScript; anything above the API |
| **5** | E2E | Playwright, real Chromium | 1–5 minutes, whole stack up | journeys across both applications, and everything the first four structurally cannot reach | *why* it broke; any route you did not list |

Suites 1 and 2 share one runner, one config file and one command. The boundary between them is
**"does this test need a fake network"**, and that is a per-file decision rather than a directory:
`tags.test.ts` needs nothing, `client.test.ts` needs MSW, and both are `npm run test:run`. The
same is true of jsdom, which Lesson 23.2 opts into with a per-file docblock instead of flipping
the global default. Two suites, one runner, and the configuration stays honest about which files
paid for what.

Suites 3 and 4 also share one runner — Pest — one `composer.json` and one `vendor/`, split by a
`--testsuite` flag. But they are **invoked differently**, in different containers, and that is
not an accident: suite 3 needs no WordPress and the container that has Composer has no
WordPress, while suite 4 needs a real WordPress and the container that has WordPress has no
Composer. Lesson 23.4 states it plainly and Lesson 23.5 relies on it.

### 3. The RSC testing rule, in full, with its reasoning

State it once, precisely, and then never argue about it again:

> **If a component is `async`, or reads `cookies()`, `headers()` or `draftMode()`, do not
> unit-test the component.** Unit-test the `lib/` function it awaits, and cover the rendered
> output in Playwright.

The reasoning is not "the tooling is immature". React Testing Library renders through
`react-dom`, and `react-dom` is the **client** renderer. Three separate things are missing, and
each one is sufficient on its own:

| Missing | Consequence |
|---|---|
| A server-component runtime | `react-dom` has no `react-server` module resolution condition, so a component in that graph is not even resolved the way the framework resolves it |
| Any mechanism for awaiting a component function | `render(<Page />)` receives a **Promise** where React expects an element. React does not await component functions in the client renderer; there is no hook, flag or adapter that makes it |
| A request context | `cookies()` and `headers()` read from an async-local store that only exists inside a Next request. Outside one they throw, and mocking them well enough to be meaningful means reimplementing the request |

The error you get is worth recognising on sight, because people spend an afternoon on it before
they read it properly:

```
Error: Objects are not valid as a React child (found: [object Promise]).
If you meant to render a collection of children, use an array instead.
```

That is `react-dom` telling you it was handed a Promise. It is not a configuration problem.
Vitest's own Next.js guide says the same thing in one sentence, and Next's testing documentation
says it about every runner: async Server Components are not supported by unit test runners, and
the recommended approach is end-to-end testing.

**The rule is a design instruction, not a limitation.** Read it as: *put nothing in an async
component except awaiting and arranging*. Everything that decides, computes, filters, maps,
clamps or validates belongs in a `lib/` function that takes data and returns data — which is
where it belonged anyway, and which is trivially testable in suite 1. Lesson 23.3 performs the
refactor once, on a real component, so you can see the shape.

### 4. The second boundary nobody warns you about: `server-only`

The RSC rule is well known. This one is not, and it will stop your first server-side test dead.

`src/lib/graphql/client.ts`, `src/lib/auth/cookies.ts`, `src/lib/auth/session.ts` and
`src/lib/auth/guards.ts` all open with `import 'server-only'`. That package's entire job is to
**throw when it is resolved outside React's `react-server` condition** — and a Vitest worker is
not a `react-server` environment. So:

```
import { submitIncident } from '@/actions/incidents';
   → imports @/lib/auth/session
      → imports 'server-only'
         → Error: This module cannot be imported from a Client Component module.
            It should only be used from a Server Component.
```

The test fails at **import time**, before a single assertion runs, with a message about Client
Components in a file that has nothing to do with the client. Three ways out, and the choice is not
obvious:

| Option | What it costs |
|---|---|
| `vi.mock` every `server-only` module the subject imports, **with a factory** — so Vitest never loads the original | verbose, and you must mock a module even when you did not want to fake it. But every mock is a spy you probably wanted anyway, and the guard stays intact for anything you forgot |
| Alias `server-only` to an empty module in `vitest.config.ts` | one line, and the guard no longer fires **anywhere in the test run** — including in a test that accidentally imports a module holding `WP_APP_TOKEN` |
| `ssr: { resolve: { conditions: ['react-server'] } }` | the narrow one, and the one you would not guess. It satisfies the guard per-resolution instead of deleting it. **`resolve.conditions` alone does nothing** — `server-only` is externalised, so Node picks the condition and only the `ssr` key reaches it. Measured; do not "simplify" it |

Lesson 23.3 takes the first for Server Actions, because the mocks are the assertions. Lesson 23.2
takes the second, narrowly, to test `client.ts` at all — and pays for it with a `grep` proving no
other test imports a secret-holding module. The third is strictly safer and arrived too late to
rewrite a lesson around; if you are starting fresh, start there. All three are recorded in the
strategy document, because the second one is a hole somebody will otherwise widen.

This is also why 12.2's house rule — *the `server-only` guard names files, not directories* —
was worth the argument. `tags.ts` and `errors.ts` hold no secret and do no I/O, so they carry no
guard, and they are the two most valuable unit tests in the repository.

### 5. The decision table: every kind of code in this repository, mapped to one suite

The question this table answers is not "where does a test go" in the abstract. It is: **I just
wrote this file, which suite owes it a test?**

| Kind of code | Example | Suite | Why not the next one up |
|---|---|---|---|
| Pure TS function | `tags.ts`, `errors.ts`, `content.ts` | **1** — Vitest node | a browser adds nothing; a Playwright spec asserting a string is a unit test wearing Chromium |
| Fail-closed policy object | `rate-limit.ts` | **1** — Vitest node, by injection | `createRateLimiter(backend)` takes its dependency as an argument, so no mocking framework is involved at all |
| Sync client component | `IncidentFilters`, `LocaleSwitcher`, `MobileNav` | **1** — RTL + jsdom | Playwright can do it, in ninety times the time, once the whole stack is up |
| Client component that fetches | `SessionMenu` | **2** — RTL + jsdom + MSW | the interesting cases are the *failures*, and you cannot make WordPress fail on demand |
| Server Action | `submitIncident`, `login` | **2** — Vitest node + `vi.mock` | Playwright cannot count how many times the GraphQL client was called, and that count is the assertion |
| Route handler | `/api/revalidate`, `/api/auth/refresh` | **2** — construct a real `Request`, call the exported `POST` | E2E cannot forge a stale timestamp with a valid signature |
| `async` Server Component | every `page.tsx`, `Header`, `SkipLink` | **5** — Playwright, **never 1 or 2** | the RSC rule. Lift the logic out and the lifted function goes to suite 1 |
| Proxy | `src/proxy.ts` | **5** — Playwright | it is a redirect decision made on a real request; asserting it in isolation asserts your own mock |
| PHP arithmetic and branching | `incident_blame_breakdown`, `normalize_stored_value`, `deny_create_incidents_until_verified` | **3** — Pest + Brain Monkey | needs no WordPress; adding one costs eight seconds per run and buys nothing |
| PHP that asks WordPress a question | `register_post_type` results, `user_can`, `map_meta_cap`, `register_block_type` | **4** — `wp-phpunit` | mocking `current_user_can()` to return `true` tests your `if`, not authorisation |
| A GraphQL resolver | `blameScore`, `createIncident` | **4** — in-process `graphql()` | an HTTP round trip in a test adds a server, a port and a flake source, and asserts the same thing |
| Generated code | `src/gql/**` | none | you cannot fix a failure in it, and regenerating would undo your fix. `npm run codegen:check` asserts *not stale*, which is the only claim available |
| Tailwind class strings | anything | none | `flex gap-4` is not behaviour |

Two rules govern the table, and both are Lesson 12.1's:

- **A test that could live in two rows belongs in the cheaper one**, where cheaper means *fewer
  people are involved when it fails*.
- **The expensive suite only earns the test if it adds something.** Write down what it adds. If
  you cannot, it is a duplicate.

### 6. Coverage on the patch, not on the total

Lesson 12.2 set **no thresholds**, deliberately, and said the policy belonged here. The reason it
waited: a number attached before anyone has read a report is a number people learn to satisfy
rather than a number that means anything.

| | Total coverage | **Patch coverage** |
|---|---|---|
| Measures | the whole repository, every run | only the lines this pull request changed |
| Cheapest way to raise it | test the getters and the barrel re-exports | test the thing you just wrote |
| A reviewer can act on it | no — 61.4% to 61.5% is not a sentence | yes — "these nine lines are untested" is a review comment |
| Fails on | a refactor that moved code you did not write | code you wrote and did not test |

**The policy: ≥ 80% of changed lines, never a total.** Lesson 24.5 turns it into a gate and
applies the ratchet from Lesson 21.4 — start at "no worse than today", raise it in a pull request
whose only content is the new number.

The excluded paths, and a reason on every line, because an exclusion without a reason is how a
coverage gate stops meaning anything:

| Excluded | Reason |
|---|---|
| `src/gql/**` | generated. Twelve thousand lines at 0% drowns every real signal |
| `**/*.test.ts`, `**/*.test.tsx` | the tests are not the subject |
| `tests/mocks/**` | fixtures and handlers. A fixture with 100% coverage tells you a test ran |
| `src/components/ui/**` you have not edited | shadcn shipped it with Radix's suite behind it |
| `src/lib/graphql/client.ts` — **only if the instrumenter cannot load it** | `server-only` throws outside `react-server`. A file the instrumenter cannot open is not a coverage gap; Lesson 23.2 makes it loadable and then this exclusion goes away |
| `e2e/**` | Playwright specs are not measured by Vitest, and `vitest.config.ts` already excludes them |
| `src/app/**/page.tsx`, `layout.tsx` | async Server Components. The RSC rule says the logic moved out; what is left is arranging, and Playwright covers it |

That last row is the one to argue about in your own project. Excluding routes makes the number
honest here — there is nothing in them a unit test could reach — and it would be dishonest in an
application that puts logic in its pages. The exclusion list is a claim about *your* architecture,
so it has to be re-read whenever the architecture changes.

### 7. Flake policy, and what quarantine actually means

Lesson 12.1 set the rule: **a flaky test is a broken test**, fixed or deleted in the pull request
that noticed it. That rule is correct and insufficient on its own, because "fix it now" is not
always available at 17:40 on a Thursday and the alternative people reach for is re-running until
green — which is how a suite stops being a signal. So the rule needs one escape hatch, and the
escape hatch needs a shape:

| | Fix it | **Quarantine** | Re-run until green |
|---|---|---|---|
| Where the test lives | where it was | `tests/quarantine/` (Vitest), `e2e/quarantine/` (Playwright) | where it was |
| In the required CI set | yes | **no** | yes |
| Has an owner and a date | n/a | **mandatory, in the file's first comment** | no |
| Visible to a reviewer | yes | yes — the diff moves a file | **no** |
| What it costs | an afternoon | a recorded, expiring debt | the credibility of every other test |

Three properties make quarantine a mechanism rather than an excuse:

1. **It is a directory move, so it appears in a diff.** "We know that one is flaky" is invisible;
   `git mv src/lib/foo.test.ts tests/quarantine/foo.test.ts` is a review conversation.
2. **The required set contains none.** Lesson 24.5's gate table says *zero quarantined tests in
   the required set* — a contract, not an aspiration. `vitest.config.ts`'s `include` is
   `src/**/*.test.{ts,tsx}`, so anything under `tests/quarantine/` is already outside the default
   run with no extra configuration. Lesson 23.6 does the Playwright half with `testIgnore`.
3. **An owner and a date, in the file.** A quarantine with no expiry is a deletion with extra
   steps. If nobody will own it, delete the test and record the gap in the strategy document —
   a written gap is worth more than a disabled test, because somebody reads the document.

> **The counter-intuitive part: deleting a flaky test is usually the right answer.** A test that
> fails one run in forty has already stopped being consulted. Deleting it costs you a signal you
> were not receiving and gains you a suite people believe. Quarantine is for the case where you
> genuinely intend to come back, and the date is how you prove you meant it.

### 8. The command surface — and why there is no one command

Five suites, two languages, two container services and one browser. Nine entry points, and
only one of them is new: `npm test`, `test:run` and `test:coverage` from 12.2, `e2e:reset` from
12.4, `verify` from 07.5, `codegen:check` from 10.2, **`test:e2e` from this lesson**, and the two
Composer scripts 23.4 and 23.5 define. The Task writes them all into §11 with what each one
needs, so this Key Concept can spend its space on the interesting part.

The two PHP entry points are **Composer scripts**, and locally they are invoked differently from
each other: `docker compose run --rm phptest vendor/bin/pest --testsuite=unit` for the unit suite,
`docker compose run --rm phptest vendor/bin/pest --testsuite=integration` for the integration
one. That asymmetry is deliberate and Lesson 23.4 explains it. A Composer script documents a
command; it does not guarantee every host can run it.

**Now the question the module owes you: what is the one command that runs everything?**

The honest answer is that there is not one, and writing one would be worse than admitting it.
A shell script that chains `npm`, `docker compose run`, `docker compose exec` and
`npx playwright test` has to decide what to do when Docker is not running, whether a container's
exit code is the suite's exit code, and what "green" means when three of five suites were skipped.
Every wrapper that answers those questions badly reports success while testing nothing — and a
wrapper is exactly where you stop reading output.

So:

- **In CI, the one command is a workflow.** Lesson 24.4 builds it and Lesson 24.5 aggregates it
  into a single required check, `ci-required`, which is the only status branch protection points
  at. That is a real "one thing is green or it is not", and it works because a runner has PHP,
  Composer, Node and a browser natively.
- **Locally, the one command is a documented four-line sequence**, written into
  `docs/testing-strategy.md` in the Task, that you paste and watch. Four visible commands with
  four visible exit codes beat one command with one opaque one.

If you disagree and write the wrapper anyway, the test of whether it is honest is simple:
`docker compose stop && ./run-all-tests.sh` must exit non-zero. Most do not.

### 9. Extending a document you did not write

`docs/testing-strategy.md` already exists. Lesson 12.1 created it with six sections, and Lesson
24.5 will read it. So this lesson **appends**, and the discipline is worth stating because `docs/`
is the one directory where several lessons write to one file.

| Rule | Why |
|---|---|
| One `## N. Topic (Lesson NN.M)` section per lesson, continuing the existing numbering | `docs/architecture.md` has worked this way for thirty lessons. A reader can date every claim |
| Never rewrite another lesson's section | if 12.1's flake rule is wrong, add a section saying so and why. Silently editing it destroys the record of the change |
| Read the file before appending | the check that catches "I created a file that already existed" — the most common defect in a course this size |

This lesson's sections continue at `## 7.`, and the check that proves you extended rather than
replaced is a `grep` for a heading 12.1 wrote — because "extend the document" and "write the
document" produce the same-looking file until you look for what is *missing*.

### 10. What five suites still do not cover

Lesson 12.1 named three gaps. Four of the five suites did not exist then. Here is the list as it
stands at the end of this module, which is the honest input to Lesson 24.5's "Known gaps".

| Not covered | Closest thing you have |
|---|---|
| Whether the page **feels** right | opening the site. Still the right tool, still not automatable |
| What real editorial content does to your layout | the seeder's deliberately awkward fixtures — a null field group, an empty term connection — which cannot anticipate a newsroom |
| Visual regression | **deliberately not**, per 12.1: no snapshot tests of rendered markup, anywhere. `npx playwright test --update-snapshots` exists and this course never calls it |
| The wp-admin editing experience | Lesson 23.8's agentic exploration, which is advisory and not a gate |
| Email deliverability | Mailpit proves `wp_mail()` was called with the right body, and nothing about a real inbox |
| Third-party behaviour: SCF, WPGraphQL, Polylang, Turnstile | pinned versions, plus the schema snapshot that tells you when their **output** changed |
| `wp core update-db` | nothing. There is no down migration; Lesson 24.7's restorable backup is the only protection, and 12.1 named this as the one property with no replacement |
| Cookie **attributes** in a unit test | `server-only` puts `cookies.ts` out of reach of Vitest. Lesson 23.6 reads them from a real browser context; Lesson 23.3 records the gap |

> **The corollary is the same one 12.1 stated and it is worth repeating with five suites in hand.**
> A test suite does not replace looking at your site. It replaces looking at the *other eight
> pages* to check that your change to this one did not break them. Keep opening the site.


---

## Task

This lesson produces a decision, not code — and it produces it by **appending to a document that
already exists.** Lesson 12.1 created `docs/testing-strategy.md` with six sections. You are
adding sections 7 through 11. Nothing in this lesson rewrites a word of what 12.1 wrote, and the
Verification proves it.

Every block below gives you the headers and enough worked rows to make the shape unambiguous.
The rest is yours, and the point is that you disagreed with something and can say why.

### Step 1: Read what Lesson 12.1 wrote, before writing anything

```bash
cd next-app
grep -n '^## ' ../docs/testing-strategy.md
```

**Verify §1:**

- [ ] Six headings, numbered `## 1.` to `## 6.`: Scope, The five most expensive failures,
      Deliberately not tested, Toolchain decisions, What this module's suites will not catch,
      Flake policy.
- [ ] If the file does **not** exist, stop and go back to Lesson 12.1 Step 1. Creating it here
      would silently discard the scope table that Module 22, this module and Lesson 24.5 all read.
- [ ] Read §1 and §6 properly. §1's Playwright row and §6's flake rule are the two things your
      new sections must agree with rather than restate.

### Step 2: Define the one new command this module owes

`npm test`, `test:run`, `test:watch` and `test:coverage` exist from Lesson 12.2. `e2e:reset`
exists from 12.4. The E2E entry point has been `npx playwright test` typed by hand since Lesson
12.3, and appendix 07 §5 already lists it that way — but a suite that only has an `npx`
invocation is a suite CI has to spell out, so give it a name:

```bash
npm pkg set "scripts.test:e2e=playwright test"
npm pkg get scripts
```

**Verify §2:**

- [ ] `npm pkg get scripts.test:e2e` prints `"playwright test"` — the bare binary, no
      `--project` filter. Lesson 23.6 defines the project order (`setup`, `smoke`, `mutations`,
      `a11y`) and a named default here would silently drop three of them.
- [ ] `npm pkg get scripts | grep -c 'test'` is **5 or more**: `test`, `test:run`, `test:watch`,
      `test:coverage`, `test:e2e`.
- [ ] `npm run test:e2e` is the **only** new npm script in Modules 21–24 apart from `analyze`
      (Lesson 21.3). If you find yourself adding a third, check whether appendix 07 already
      names the command you want.

### Step 3: Append §7 — the five suites, with the fourth column filled

```markdown
<!-- docs/testing-strategy.md — append -->
## 7. The five suites (Lesson 23.1)

Extends §1, which named two suites, the verification blocks and the human. This is the same
question answered with all five suites in existence. §1 still stands; nothing here replaces it.

| # | Suite | Command | Its job | It explicitly does NOT cover |
|---|---|---|---|---|
| 1 | Vitest unit (`node`, jsdom per file) | `npm run test:run` | pure `lib/` functions; sync client components by role and accessible name | async Server Components; real layout, focus, scrolling |
| 2 | Vitest + MSW v2 | `npm run test:run` | TODO | TODO |
| 3 | Pest + Brain Monkey | `docker compose run --rm phptest vendor/bin/pest --testsuite=unit` | TODO | TODO |
| 4 | `wp-phpunit` | see §11 — it is not a Composer invocation locally | TODO | TODO |
| 5 | Playwright | `npm run test:e2e` | TODO | TODO |

Rule inherited from §1: a test that could live in two rows belongs in the cheaper one, where
cheaper means fewer people are involved when it fails. New rule: **the expensive suite only
earns the test if you can write down what it adds.**
```

**Verify §3:**

- [ ] The fifth column is filled on **every** row. It is the column that stops the same
      behaviour being asserted four times, and it is the one everyone skips.
- [ ] No two rows claim the same job. If two do, say which one is redundant and delete it.
- [ ] Row 4's command column does not say `composer test:integration`. That script exists and it
      does not run on your machine — §11 explains why, and writing the wrong command here is how
      somebody spends twenty minutes on a missing Composer binary.

### Step 4: Append §8 — the RSC rule and the decision table

This is the section people will actually come back and read, so write the reasoning, not just
the rule. A rule with no reasoning gets relitigated by whoever arrives next.

```markdown
<!-- docs/testing-strategy.md — append -->
## 8. The RSC testing rule (Lesson 23.1)

**If a component is `async`, or reads `cookies()`, `headers()` or `draftMode()`, do not
unit-test the component.** Unit-test the `lib/` function it awaits; cover the rendered output
in Playwright.

Why, and this is not a tooling gap:

- React Testing Library renders through `react-dom`, the CLIENT renderer.
- `react-dom` cannot await a component function. `render(<Page />)` hands React a Promise, and
  you get `Objects are not valid as a React child (found: [object Promise])`.
- `cookies()` and `headers()` read an async-local store that only exists inside a Next request.

There is no flag, environment or adapter that changes any of the three.

**Read the rule as a design instruction.** An async component should contain awaiting and
arranging and nothing else. Everything that decides, computes, filters, clamps or validates
moves into `lib/`, where it is data in, data out — TODO: name the function this repository
lifted out first, and say whether the component got easier to read.

### The second boundary: `server-only`

`src/lib/graphql/client.ts`, `src/lib/auth/cookies.ts`, `src/lib/auth/session.ts` and
`src/lib/auth/guards.ts` throw on import outside a `react-server` environment, which a Vitest
worker is not. Three ways past it, all recorded here because the second one is a hole:

- `vi.mock('<module>', () => ({ … }))` with a factory — Vitest never loads the original.
  Used by suite 2 for Server Actions, where the mocks are the assertions.
- aliasing `server-only` to an empty module in `vitest.config.ts` — TODO: say which tests need
  this, and what compensating check stops a test importing a module that holds a token.
- `ssr: { resolve: { conditions: ['react-server'] } }` — satisfies the guard rather than
  removing it. TODO: say whether you would migrate to this, and what it would let you delete.

### Decision table

| Kind of code | Suite | Why not the next one up |
|---|---|---|
| Pure TS function | 1 | a browser adds nothing |
| Sync client component | 1 | Playwright can, in ninety times the time |
| Client component that fetches | 2 | the interesting cases are failures you cannot make WordPress produce |
| Server Action / route handler | 2 | TODO |
| `async` Server Component | 5 | TODO |
| `src/proxy.ts` | 5 | TODO |
| PHP arithmetic and branching | 3 | TODO |
| PHP that asks WordPress a question | 4 | TODO |
| A GraphQL resolver | 4 | TODO |
| `src/gql/**` | none | generated; `npm run codegen:check` asserts "not stale", which is the only claim available |
| Tailwind class strings | none | `flex gap-4` is not behaviour |
```

**Verify §4:**

- [ ] Every row of the decision table names exactly **one** suite. A row with two is a row you
      have not decided.
- [ ] The `server-only` subsection names a compensating check for the alias, not just the alias.
      An escape hatch with no counterweight is a policy that decays.

### Step 5: Append §9 — coverage on the patch, with the exclusions argued

Lesson 12.2 set no thresholds on purpose and said the policy belonged here. Write the policy.

```markdown
<!-- docs/testing-strategy.md — append -->
## 9. Coverage policy (Lesson 23.1)

**Patch coverage, never total: at least 80% of the lines a pull request changed.** A total
percentage moves by 0.1% and tells nobody anything; "these nine lines are untested" is a review
comment. Lesson 24.5 turns this into a gate and applies the ratchet from Lesson 21.4 — start at
"no worse than today", raise it in a pull request whose only content is the new number.

`vitest.config.ts` still declares no `thresholds`. That is deliberate: the number lives in the
CI gate, where a reviewer can see it against a diff, not in a config file where a local run
fails for a reason unrelated to the change in front of you.

Excluded from measurement, with a reason on every line:

| Excluded | Reason |
|---|---|
| `src/gql/**` | generated; 12k lines at 0% drowns the signal |
| `**/*.test.ts`, `**/*.test.tsx` | the tests are not the subject |
| `tests/mocks/**` | fixtures and handlers; 100% here only proves a test ran |
| `src/components/ui/**` we have not edited | TODO |
| `e2e/**` | TODO |
| `src/app/**/page.tsx`, `layout.tsx` | TODO — and say what would make you stop excluding these |

TODO: one sentence on what you would do if patch coverage fails on a pull request that is a
pure deletion.
```

**Verify §5:**

- [ ] Every exclusion carries a reason. Verification check 6 counts the lines and the em dashes.
- [ ] The word "total" appears with a **negation** near it. If this section can be read as
      endorsing a total-coverage number, Lesson 24.5 will inherit the wrong gate.

### Step 6: Append §10 — the flake policy, extended with a quarantine mechanism

§6 already says a flaky test is a broken test. Do not restate it; **add the escape hatch it
needs**, because "fix it now" is not always available and the alternative people reach for is
re-running until green.

```markdown
<!-- docs/testing-strategy.md — append -->
## 10. Quarantine (Lesson 23.1)

Extends §6, which stands: a flaky test is a broken test, fixed or deleted in the pull request
that noticed it. This section adds the one permitted escape hatch and its cost.

**Quarantine is a directory move, so it shows up in a diff.**

| | Vitest | Playwright |
|---|---|---|
| Where a quarantined test lives | `tests/quarantine/` | `e2e/quarantine/` |
| Why it is out of the default run | `include` is `src/**/*.test.{ts,tsx}` — anything outside `src/` is never collected | `testIgnore` in `playwright.config.ts` (Lesson 23.6) |

Three conditions, all mandatory:

1. The **required CI set contains none.** Lesson 24.5's gate table says "zero quarantined
   tests in the required set" and that is a contract.
2. An **owner and a date** in the file's first comment. A quarantine with no expiry is a
   deletion with extra steps.
3. TODO: what happens when the date passes and nobody has looked at it.

**Deleting a flaky test is usually the right answer.** A test that fails one run in forty has
already stopped being consulted; deleting it costs a signal you were not receiving and gains
you a suite people believe. If you delete one, record the gap in §5 — a written gap is worth
more than a disabled test, because somebody reads this document.
```

**Verify §6:**

- [ ] `tests/quarantine/` does not exist yet, and nothing in the repository references it as a
      real directory. It is a convention with a home, and today the home is empty. That is the
      correct state.
- [ ] This section does not repeat §6's rule as if it were new. If it reads as first statement,
      it will be read as a second, conflicting policy.

### Step 7: Append §11 — the command surface, and the honest local sequence

```markdown
<!-- docs/testing-strategy.md — append -->
## 11. Commands (Lesson 23.1)

| Command | Runs | Needs |
|---|---|---|
| `npm test` | Vitest, WATCH mode | nothing |
| `npm run test:run` | suites 1 and 2, single pass | nothing |
| `npm run test:coverage` | the same, with the v8 report | nothing |
| `npm run test:e2e` | suite 5, every Playwright project | Docker up; `npm run e2e:reset` first |
| `docker compose run --rm phptest vendor/bin/pest --testsuite=unit` | suite 3 | nothing — no WordPress at all |
| `docker compose run --rm -w /var/www/html/wp-content/plugins/blame-the-tech-core phptest vendor/bin/pest --testsuite=integration` | suite 4 | a real WordPress and the `wp_test` database |
| `npm run verify` | `type-check`, `lint`, `format:check` | nothing |
| `npm run codegen:check` | regenerate types, `git diff --exit-code` | nothing — the schema is a committed file |

`composer test:unit` and `composer test:integration` are both declared as Composer scripts, and
locally **neither runs from the `composer` service**: that image installs on a PHP newer than the
Pest major WordPress core forces on us, so both suites execute in the `phptest` container instead
(Lesson 23.4 §1.1). A Composer script documents a command; it does not guarantee every host can
run it. On a CI runner, which has PHP 8.3 and Composer natively, both forms work verbatim.

### There is no one command, and that is the honest answer

A wrapper spanning two runtimes, two containers and a browser has to decide what to do when
Docker is down, whether a container's exit code is the suite's exit code, and what "green"
means when three of five suites were skipped. A wrapper that answers those badly reports
success while testing nothing, and a wrapper is exactly where you stop reading output.

- **In CI**, the one command is a workflow. Lesson 24.4 builds it; Lesson 24.5 aggregates it
  into a single required check, `ci-required`.
- **Locally**, it is this sequence, pasted, with four visible exit codes:

    cd next-app && npm run verify && npm run test:run
    cd ../wordpress-headless && docker compose run --rm phptest vendor/bin/pest --testsuite=unit
    docker compose run --rm -w /var/www/html/wp-content/plugins/blame-the-tech-core phptest vendor/bin/pest --testsuite=integration
    cd ../next-app && npm run e2e:reset && npm run test:e2e

TODO: if you write the wrapper anyway, the test of whether it is honest is that
`docker compose stop` followed by the wrapper exits non-zero. Say whether yours does.
```

**Verify §7:**

- [ ] The local sequence is indented as a code block **inside** the markdown you appended, not
      fenced. A nested fence inside a fenced block terminates the outer one, and you end up with
      half a document.
- [ ] The two PHP commands are copied exactly, and neither of them runs `wp` or `composer`
      directly inside the `wordpress` container: the stock image ships neither binary, so
      `docker compose exec` on that service can only ever call `php`.

### Step 8: Cross-check the old sections against the new ones

The last step is the one that catches a real defect, because two sections of one document can
each be reasonable and jointly wrong.

```bash
cd next-app
sed -n '/^## 1\./,/^## 2\./p' ../docs/testing-strategy.md
sed -n '/^## 7\./,/^## 8\./p' ../docs/testing-strategy.md
```

**Verify §8:**

- [ ] §1 gives Playwright a job. §7 gives Playwright a job. They agree, or §7 says explicitly
      that it narrows §1 and why.
- [ ] §2's row 1 says the cache-tag contract is pinned on one side only. That is still true —
      Lesson 23.5 pins the other side, and until you have written it, do not update the row.
- [ ] §5 said "there is no PHP test suite until Lesson 23.4". Leave it. It was true when written
      and §7 now supersedes it; the record of when that changed is worth more than a tidy file.
- [ ] `grep -c 'TODO' ../docs/testing-strategy.md` is `0`. Verification check 12 fails while one
      remains.


---

## Verification

```bash
cd next-app

# 1. The document is where every later lesson looks for it, and it is the one 12.1 wrote
test -f ../docs/testing-strategy.md && echo "present"
# Expected: present

# 2. ELEVEN sections now, numbered 1..11 — 12.1's six plus this lesson's five
grep -c '^## [0-9]' ../docs/testing-strategy.md
# Expected: 11
grep -n '^## ' ../docs/testing-strategy.md
# Expected: 1. Scope … 6. Flake policy (Lesson 12.1), then 7. The five suites,
#           8. The RSC testing rule, 9. Coverage policy, 10. Quarantine,
#           11. Commands — each tagged (Lesson 23.1)

# 3. NEGATIVE — 12.1's own headings are still there, WORD FOR WORD. This is the check
#    that proves you extended the file rather than replacing it, and it is the whole
#    reason this lesson opens by reading the file.
grep -c 'flaky test is a broken test' ../docs/testing-strategy.md
# Expected: 1 — 12.1's §6 sentence, untouched. A 0 means you overwrote the file.
grep -c '^## 3\. Deliberately not tested' ../docs/testing-strategy.md
# Expected: 1
grep -c '^## 4\. Toolchain decisions' ../docs/testing-strategy.md
# Expected: 1

# 4. NEGATIVE — exactly ONE section owns suite-to-job mapping headings. Two "Scope"-
#    shaped sections is the failure mode where a reader gets two answers and no date.
grep -ci '^## [0-9]*\.\{0,1\} *scope' ../docs/testing-strategy.md
# Expected: 1 — only 12.1's "## 1. Scope: which suite owns what". §7 EXTENDS it and is
#           titled "The five suites", not a second Scope.

# 5. The new command exists, spelled the way Lesson 24.4's workflow will spell it
npm pkg get scripts.test:e2e
# Expected: "playwright test"
npm pkg get scripts | grep -c 'test'
# Expected: 5 or more — test, test:run, test:watch, test:coverage, test:e2e

# 6. §7 has one row per suite, and every row filled its LAST column
awk -F'|' '/^## 7\./{f=1;next} /^## 8\./{f=0} f && /^\| [0-9] \|/ { rows++; if ($6 ~ /[A-Za-z]/) covered++ } END { print "rows:" rows, "with a does-not-cover cell:" covered }' ../docs/testing-strategy.md
# Expected: rows:5 with a does-not-cover cell:5
#           A five-column markdown row splits into seven fields on `|`, so $6 is the
#           last cell. An empty $6 is a row missing the only column that stops the same
#           behaviour being asserted in four suites.

# 7. Every coverage exclusion in §9 carries a reason
awk -F'|' '/^## 9\./{f=1;next} /^## 10\./{f=0} f && /^\| `/ { rows++; if ($3 ~ /[A-Za-z]/) reasoned++ } END { print "exclusions:" rows, "with a reason:" reasoned }' ../docs/testing-strategy.md
# Expected: two EQUAL numbers, 7 and 7 if you kept every row. An exclusion with no
#           reason is the line somebody deletes in six months, and then the gate stops
#           meaning anything.

# 8. The coverage policy is patch-based and says so unambiguously
grep -c 'Patch coverage, never total' ../docs/testing-strategy.md
# Expected: 1
grep -n '80' ../docs/testing-strategy.md
# Expected: at least one hit, reading "80% of the lines a pull request changed" —
#           NOT "80% total coverage". Lesson 24.5 inherits whichever you wrote.

# 9. NEGATIVE — vitest.config.ts still declares no thresholds. The number lives in the
#    CI gate (24.5), not in a config where a local run fails for an unrelated reason.
grep -c 'thresholds' vitest.config.ts
# Expected: 0

# 10. The quarantine mechanism names both homes and the required-set contract
grep -c 'tests/quarantine' ../docs/testing-strategy.md
# Expected: 1 or more
grep -c 'e2e/quarantine' ../docs/testing-strategy.md
# Expected: 1 or more
grep -ci 'zero quarantined tests in the required set' ../docs/testing-strategy.md
# Expected: 1 — the exact phrase from Lesson 24.5's gate table, so the two documents
#           can be diffed against each other rather than compared by vibe.

# 11. NEGATIVE — the quarantine directories do not exist, and the required set is
#     therefore empty by construction rather than by discipline.
test ! -d tests/quarantine && echo "no quarantined unit tests today"
# Expected: no quarantined unit tests today
test ! -d e2e/quarantine && echo "no quarantined specs today"
# Expected: no quarantined specs today
npx vitest run tests/quarantine; echo "exit=$?"
# Expected: "No test files found" and exit=1. `include` is src/**/*.test.{ts,tsx}, so
#           anything outside src/ can never be collected — the exclusion is structural.

# 12. NEGATIVE — no snapshot testing is recommended anywhere in the document. 12.1
#     ruled it out and appendix 07 annotates --update-snapshots as "only if you add
#     them; this course does not". Read the surrounding lines rather than trusting a count.
grep -in -B1 'snapshot' ../docs/testing-strategy.md
# Expected: every hit sits under "## 3. Deliberately not tested", or names the narrow
#           small-stable-string exception, or refers to the SCHEMA snapshot (a committed
#           file, not toMatchSnapshot). A hit under §7 or §8 giving a suite
#           responsibility for snapshotting markup contradicts 12.1 — delete it.

# 13. NEGATIVE — nothing claims one command runs everything
grep -ci 'one command' ../docs/testing-strategy.md
# Expected: 1 or more, and every hit is a DENIAL — "There is no one command". A line
#           promising a single local command is the sentence that gets a wrapper written,
#           and a wrapper that swallows a container's exit code reports green on a
#           stopped Docker daemon.

# 14. NEGATIVE — the document never names an impossible invocation
grep -n 'exec wordpress' ../docs/testing-strategy.md
# Expected: no output. Every WordPress-container command in §11 reads
#           `exec -T -w <plugin dir> wordpress php …`. The stock image ships no `wp`
#           binary and no Composer, so `exec` on that service can never invoke either
#           of them directly — WP-CLI is the `wpcli` service, Composer is `composer`.

# 15. NEGATIVE — §2 has not been quietly "fixed" to claim the contract is covered
grep -in 'contract' ../docs/testing-strategy.md
# Expected: hits say the contract is not covered YET, or point at Lesson 23.5. If a line
#           now reads "Playwright covers the contract", that is the single most expensive
#           wrong sentence in the file — a smoke spec cannot see a tag string.

# 16. NEGATIVE — nothing is left unfinished
grep -c 'TODO' ../docs/testing-strategy.md
# Expected: 0

# 17. The toolchain is unaffected — this lesson wrote prose and one npm script
npm run type-check && npm run lint
# Expected: no output from either
npm run test:run
# Expected: the Lesson 12.2 suite, still green, still five files

# 18. The change is one modified document and one modified package.json
git status --short ../docs/testing-strategy.md package.json
# Expected:  M docs/testing-strategy.md
#            M next-app/package.json
#           NOT "?? docs/testing-strategy.md" — a `??` here means you created a new
#           file and Lesson 12.1's six sections are gone.
```

Check 3 and check 18 are the two to read rather than skim. Both catch the same defect from
opposite directions — a file created instead of extended — and it is the defect that costs the
most, because everything Lesson 12.1 decided disappears without an error anywhere.


## Control Questions

1. A colleague reports that every incident page has served week-old content since Tuesday, the
   webhook returns HTTP 200, and both PHP and TypeScript suites are green at 91% total coverage.
   Using Key Concept 1's seam table, name the two seams that can produce exactly that symptom,
   say which suite would catch each, and explain why raising total coverage in either half by ten
   points would not have helped.
2. `src/lib/auth/cookies.ts` carries `import 'server-only'`, so its `httpOnly`, `SameSite` and
   `Path` values cannot be asserted by any Vitest test. Argue the case for deleting that guard so
   the file becomes testable, then argue the case against — and say which of the five suites you
   would make responsible for the cookie contract instead, and what that suite cannot tell you
   that a unit test could.
3. Your decision table sends `src/proxy.ts` to Playwright. A reviewer proposes a Vitest test
   that constructs a `NextRequest`, calls the exported `proxy`, and asserts the `Location`
   header. Say what that test would genuinely prove, name the specific thing it would fail to
   prove that made you choose Playwright, and decide whether you would accept it as a *second*
   test rather than a replacement.
4. Patch coverage is 80% of changed lines. Describe a pull request that legitimately scores 0%
   patch coverage and should still be merged, then describe one that scores 100% and should be
   rejected on review — and say what that pair tells you about what the gate is actually for.
5. Lesson 12.1 wrote "a flaky test is a broken test — fix it or delete it in the same pull
   request". This lesson adds a quarantine directory. Explain how quarantine can be added
   *without* weakening 12.1's rule, identify which of the three mandatory conditions is doing
   that work, and describe the concrete failure that occurs if you drop that one condition and
   keep the other two.


## Learn More

- [Next.js — Testing](https://nextjs.org/docs/app/guides/testing) — the framework's own position,
  and the sentence that settles Key Concept 3: async Server Components are not supported by unit
  test runners, and end-to-end testing is the recommended approach for them
- [Next.js — Testing with Vitest](https://nextjs.org/docs/app/guides/testing/vitest) — the
  official setup, worth reading against Lesson 12.2's hand-written config to see exactly which
  twenty lines you already own
- [Martin Fowler — The Test Pyramid](https://martinfowler.com/bliki/TestPyramid.html) — the
  original bliki entry. Read it noticing what it assumes: one deployable, one language, one
  process
- [Martin Fowler — On the Diverse and Fantastical Shapes of Testing](https://martinfowler.com/articles/2021-test-shapes.html)
  — the honest answer to "is the pyramid still right", and the argument that the shape follows
  from your architecture rather than from a diagram
- [Kent C. Dodds — Write tests. Not too many. Mostly integration.](https://kentcdodds.com/blog/write-tests)
  — the "testing trophy" counter-position. Read it and notice that its "integration" is this
  course's suite 1 with jsdom, not `wp-phpunit`; the disagreement is mostly vocabulary
- [Google Testing Blog — Flaky Tests at Google and How We Mitigate Them](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html)
  — quarantine as a mechanism, with real numbers, from a suite large enough that the policy had
  to be written down
- [Codecov — patch status](https://docs.codecov.com/docs/commit-status) — how patch coverage is
  computed against a base commit, which is the mechanism Lesson 24.5's gate uses
- [Vitest — coverage configuration](https://vitest.dev/guide/coverage.html) — `include`,
  `exclude` and `thresholds`; skim the thresholds section specifically so Key Concept 6's
  decision to leave them unset is a decision rather than an omission
- [Playwright — Retries and flaky tests](https://playwright.dev/docs/test-retries) — how
  Playwright classifies a test that failed and then passed, and why `retries: 1` in CI is a
  reporting decision rather than a fix

