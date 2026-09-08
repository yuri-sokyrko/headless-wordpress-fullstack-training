---
title: 'Your First Playwright Test'
module: 12
lesson: 3
teaches: [playwright, e2e-testing, role-based-locators, accessible-name, web-server-config, auto-waiting]
produces: ['next-app/playwright.config.ts', 'next-app/e2e/smoke.spec.ts']
requires: [12.2, 11.4]
---

# Lesson 12.3 — Your First Playwright Test

## Quick Overview

This is the load-bearing lesson of the module. Playwright drives a real browser against a real
Next.js server talking to a real WordPress, which makes it the only tool in the course that can
answer "does the site work?". You will configure it to start `npm run dev` itself, write a smoke
spec that visits every route from the Module 09 inventory, and assert the things that would
matter at 9am on a Monday: the page responds, the `<h1>` is the right one, the nav is present,
and nothing logged a console error.

The part that will change how you write code for the remaining twelve modules is **locators**.
A test has to find elements, and after Lesson 11.1 there are no semantic class names left to
find them by — Tailwind utilities are not identifiers, and `page.locator('.flex.gap-4')` is a
test that breaks the next time someone adjusts spacing. The right answer is
`page.getByRole('button', { name: 'Get Demo' })`: find the element the way an assistive
technology finds it, by its role and its accessible name. That works only if your components
have correct roles and real accessible names — which means from this lesson onward, every
component you write is either accessible or untestable. Lesson 11.4 did the work; this lesson
is what makes it stay done.

By the end of this lesson you will have:

- `next-app/playwright.config.ts` with a `webServer` block, one browser project, retries off locally and on in CI
- `next-app/e2e/smoke.spec.ts` visiting every route in the Module 09 inventory and asserting a stable heading on each
- Role-based locators throughout, and zero CSS-class or `data-testid` selectors
- A console-error assertion that fails the spec if any page logs to `console.error`
- A test broken by deleting a button's accessible name, and the same test passing again once the name is restored

## Classic WP Analogy

Playwright is your pre-deploy click-through, written down:

| Manual ritual | Playwright |
|---|---|
| Open staging and click every nav item | `for (const route of routes) { await page.goto(route) }` |
| "does the incidents archive still list posts?" | `expect(page.getByRole('article')).toHaveCount(…)` |
| Open devtools and check for red console lines | a `page.on('console')` listener asserting none |
| Check a page loads at all | `expect(response.status()).toBe(200)` |
| Do all of that again after every change | `npx playwright test` |
| Ask a colleague to check on their machine | one CI run, same browser, same data |

The value is not that Playwright does anything you cannot do by hand. It is that it does it
every time, in two minutes, on all nine routes, without getting bored on route nine — and
that it does it on somebody else's pull request while you are asleep. This is the "did I break
it?" loop the second half of the course depends on.

The analogy breaks on **how the test finds things**, and this is the whole substance of the
lesson. You find the "Get Demo" button by looking at the screen, using context, colour,
position and text at once. A test has none of that. Every locator strategy is a coupling
decision, and most of them are bad ones:

| Locator | Couples the test to | Verdict |
|---|---|---|
| `.locator('.hobt-cta button')` | your CSS class names | ❌ and after Lesson 11.1 those names do not exist |
| `.locator('[data-testid="cta"]')` | an attribute that exists only for tests | ❌ passes while the button is invisible or unreachable |
| `.locator('div > div > button')` | your DOM structure | ❌ breaks on any refactor |
| `.getByRole('button', { name: 'Get Demo' })` | the accessible name and role | ✅ breaks only when a user would also be broken |

That last row is the one with a consequence beyond testing. A role-and-name locator fails if
the button becomes a `<div onClick>`, if its label becomes an unlabelled icon, or if it ends up
inside `aria-hidden` content. Those are all real accessibility regressions, and CI now catches
them — for free, as a side effect of how the tests are written. It is the cheapest accessibility
enforcement available, and it only works if you never reach for `data-testid` when a locator is
awkward. When a locator is awkward, the component is usually wrong.

The second break is one Classic WordPress developers consistently underestimate: **this test
has state.** A PHP click-through is stateless because you are looking at whatever content
happens to be there. An assertion like "the incidents list shows 40 items" is only true against
a known database, and the moment you or a colleague publishes a draft, the spec goes red for a
reason that has nothing to do with the code. Lesson 12.4 exists entirely to fix that, and
writing this spec first is how you come to want it.

---

## Key Concepts

### 1. What Playwright is, and what it is not

Playwright is two things bolted together, and knowing which one you are configuring saves you a
lot of guessing.

```
   YOUR SPEC (Node process)                    THE BROWSER (separate process)
   ─────────────────────────────               ─────────────────────────────────
   test('…', async ({ page }) => {   CDP /     ┌───────────────────────────┐
     await page.goto('/en');   ◀──── WebSocket │ Chromium · Firefox · WebKit│
     await expect(…).toBeVisible();  ────────▶ │ real layout, real network  │
   });                                          └───────────────────────────┘
        ▲                                                    │
   the RUNNER: collects specs, projects,          the app under test:
   retries, workers, reporters, webServer         next dev on :3000 → WordPress :8080
```

The **library** drives a browser over a protocol connection. The **runner** (`@playwright/test`)
does everything else: finds specs, runs them in workers, applies projects, retries, captures
traces, writes reports and — the part that matters most here — starts your dev server for you.

What it is not:

| Not | Because |
|---|---|
| a unit-test runner | it starts browsers. Lesson 12.2's 53 tests run in under a second; nine Playwright specs take a minute |
| a replacement for Vitest | `expect` here is Playwright's, `test` is Playwright's, and the two runners must never see each other's files — Lesson 12.2 Key Concept 4 |
| an accessibility audit | `getByRole` *uses* the accessibility tree, which catches a lot by accident. Lesson 22.3 adds a real axe run |
| a load test | one browser, one user, one machine |

`devices['Desktop Chrome']` selects Chromium plus a viewport and a user agent. This module runs
Chromium only: a smoke suite's job is "does the site boot", and three engines would triple the
wait for the same answer. Lesson 22.4 adds a second project, and adding WebKit is a two-line
change when someone has a reason.

### 2. Auto-waiting and web-first assertions — the one line that decides flakiness

This is the most important paragraph in the lesson.

```ts
// (illustration) e2e/smoke.spec.ts — the same intent, two very different tests
await expect(page.getByRole('heading', { level: 1 })).toBeVisible();  // ✅ retries
expect(await page.getByRole('heading', { level: 1 }).isVisible()).toBe(true);  // ❌ once
```

The first form passes the **locator** to `expect`. Playwright then re-evaluates it — locate,
check, wait, repeat — until it passes or the timeout expires. The second form resolves a boolean
*first*, at one instant in time, and asserts on that dead value. If the heading arrives 40 ms
later, the first test passes and the second fails.

| | Web-first assertion | Resolved-then-asserted |
|---|---|---|
| Shape | `await expect(locator).toBeVisible()` | `expect(await locator.isVisible()).toBe(true)` |
| Retries | ✅ until the assertion timeout | ❌ never |
| Passes on a slow render | ✅ | flakily |
| Failure message | "expected visible, waited 5000ms" plus the locator | "expected false to be true" |

Two rules follow that cover almost every real spec:

- **`await expect(locator)`, never `expect(await locator.something())`.** If your `await` is
  inside the `expect(...)` parentheses, look again.
- **A locator is a query, not an element.** `page.getByRole(...)` performs no work; it describes
  how to find something. That is why it can be stored in a `const` before the element exists, and
  why passing it to `expect` is what enables retrying.

Actions auto-wait too: `click()` waits for the element to be attached, visible, stable, enabled
and not obscured before it clicks. So `await page.waitForTimeout(1000)` is almost always the
wrong fix for a flaky test — it makes the suite slower *and* still flaky, because the next
machine is slower than yours. There is no `sleep` anywhere in this course's specs.

### 3. Locators are coupling decisions

The `## Classic WP Analogy` table gave the verdict. Here is the full picture, with the cost of
each choice on the right.

| Locator | Couples the test to | Breaks when | Verdict |
|---|---|---|---|
| `.locator('.hobt-cta button')` | class names | any restyle. After Lesson 11.1 those names do not exist | ❌ |
| `.locator('[data-testid="cta"]')` | an attribute that exists only for tests | never — and that is the problem | ❌ |
| `.locator('div > div > button')` | DOM structure | any refactor, including one that changes nothing visible | ❌ |
| `xpath=//button[2]` | position | the moment a button is added | ❌ |
| `.getByText('Get Demo')` | the visible string | a copy change. Fine for prose, wrong for controls | ⚠️ |
| `.getByLabel('Severity')` | the `<label>`–control association | the association breaking, which is a real bug | ✅ |
| `.getByRole('button', { name: 'Get Demo' })` | role + accessible name | a user would also be broken | ✅ **default** |

The `data-testid` row is the one worth arguing about, because it *looks* like the responsible
choice. Its failure mode is silence: a `data-testid` attribute survives the button becoming a
`<div onClick>`, losing its label, being wrapped in `aria-hidden`, or being covered by an
overlay. The test stays green through every one of those, and each one is a user who cannot use
the control.

> **When a locator is awkward, the component is wrong.** That is the whole rule. An icon-only
> button you cannot address by name has no accessible name, which means a screen-reader user
> hears "button". Reaching for `data-testid` at that moment converts an accessibility bug into a
> passing test, which is strictly worse than a failing one. Lesson 11.4 did the work; this lesson
> is the mechanism that keeps it done, and it costs nothing extra.

### 4. Accessible name computation, so you can predict what `getByRole` matches

`getByRole('button', { name: 'X' })` matches when the element's **computed accessible name** is
`X`. The computation is a specification, and this is the short version — first match wins:

| Priority | Source | Example |
|---|---|---|
| 1 | `aria-labelledby` | `<button aria-labelledby="t1">` → the text of `#t1` |
| 2 | `aria-label` | `<button aria-label="Close">✕</button>` → `Close` |
| 3 | native label mechanism | `<label for="q">Search</label>` → the input is named `Search` |
| 4 | contents | `<button>Get Demo</button>` → `Get Demo` |
| 5 | `title` | last resort, and not announced by every screen reader |

Four consequences you will meet in this codebase:

- **`sr-only` text still counts.** `MobileNav`'s trigger is an icon plus
  `<VisuallyHidden>Open main menu</VisuallyHidden>`, so its accessible name is
  `Open main menu` — visually hidden, programmatically present, and locatable. That is the whole
  point of the clip-rect technique from Lesson 11.4.
- **`aria-hidden` decoration is excluded.** The `<Menu aria-hidden="true" />` icon contributes
  nothing to the name, which is why the name is clean rather than `"Open main menu"` prefixed by
  an SVG title.
- **Matching is trimmed and case-insensitive by default**, and whitespace is collapsed. Pass
  `{ exact: true }` when you mean the whole string exactly.
- **`aria-label` beats contents**, so a button whose visible text and `aria-label` disagree is
  addressable only by the `aria-label` — and a sighted user reading the visible text out loud to
  a screen-reader user is describing a different control. Do not do it.

Landmarks work the same way, and this is what makes Lesson 11.4's work assertable:
`getByRole('banner')` is the page `<header>`, `getByRole('main')` is `<main>`,
`getByRole('contentinfo')` is the page `<footer>`, and `getByRole('navigation', { name:
'Primary' })` is the one `<nav aria-label="Primary">` in the header. Three named `<nav>`
elements — `Primary`, `Mobile`, `Social` — exist precisely so that name filter works.

### 5. `webServer`, and its two traps

The runner can start your application and wait for it:

```ts
// (illustration) playwright.config.ts — the block, with both traps in it
webServer: {
  command: 'npm run dev',
  url: 'http://127.0.0.1:3000/api/health',
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
},
```

**Trap one: `127.0.0.1`, not `localhost`.** Since Node 17, `localhost` resolves according to the
OS resolver order rather than IPv4-first, so on many machines it comes back as `::1`. `next dev`
binds `0.0.0.0` — every IPv4 interface, and *not* the IPv6 loopback. The symptom is
`ECONNREFUSED ::1:3000` against a server you can load in your browser, and the wasted hour goes
on Playwright, Next, and your firewall in that order. Writing the literal IPv4 address removes
the resolver from the question. `baseURL` matches for the same reason.

**Trap two: the readiness probe, and its cost.** `url` is polled until it answers with a 2xx,
3xx or 4xx status. Using `/api/health` from Lesson 09.5 is the right choice, because it answers
200 only when Next *and* WordPress are both up, so a green start means the whole stack is ready
and no spec has to defend itself against a cold WordPress.

The cost, stated plainly: `/api/health` returns **503** when WordPress is unreachable
(Lesson 09.5), and a 5xx is not "ready". So if you forgot `docker compose up`,
Playwright polls for the full 120 seconds and then fails with a message about the *web server*
rather than about WordPress.

```
   WordPress up                        WordPress down
   ────────────────────────────        ────────────────────────────────────
   t=0   npm run dev starts            t=0    npm run dev starts
   t=3   /api/health → 503 (booting)   t=3    /api/health → 503
   t=6   /api/health → 200  ✅          …      503, 503, 503, 503, …
   t=6   specs start                   t=120  Error: Timed out waiting 120000ms
                                              from config.webServer   ❌
```

Pointing `url` at `/en` instead would fail in three seconds — and would start the suite against a
degraded stack, so all nine specs would fail one at a time with nine different messages. Lesson
12.4 takes the third option: keep the strict probe, and add a `globalSetup` that checks
WordPress *first* and fails the whole run in under a second with one sentence of English.

`reuseExistingServer: !process.env.CI` means: locally, if something already answers on that URL,
use it — so `npm run dev` in another terminal makes the suite start instantly. In CI it is
`false`, because reusing a server you did not start is exactly how a stale build gets tested.

### 6. Projects, and why the name `smoke` is a contract

A **project** is a named run of the same specs with different settings — a browser, a viewport, a
different `testMatch`. This config declares exactly one:

```ts
// (illustration) playwright.config.ts
projects: [{ name: 'smoke', use: { ...devices['Desktop Chrome'] } }],
```

The name is not decoration. It is referenced by later modules and by CI:

| Project | Added by | Runs |
|---|---|---|
| `smoke` | **this lesson** | the nine routes; the "did it boot" suite |
| `a11y` | Lesson 22.4 | axe over the same routes, as a separate gate |
| `mutations` | Module 23 | authenticated journeys that write data, serially |

Module 23's Starting State runs `npx playwright test --project=smoke` and appendix 07 §5 lists
`--project=mutations`. Rename this project and both break, with an error message that says the
project does not exist rather than that somebody renamed it. Declaring one project now — rather
than leaving `projects` out, which also works — is what makes the second one additive.

### 7. Retries: one, and the argument for it

`retries: process.env.CI ? 1 : 0`, and both halves are deliberate.

**Zero locally**, because a retry locally hides the thing you were about to fix, and you are
sitting right there.

**One in CI**, and one exactly. The reasoning is about information rather than about passing:

| Retries | A flaky test reports | What the team learns |
|---|---|---|
| 0 | failed | "broken" — and a genuine infrastructure blip blocks a merge |
| **1** | passed on retry, and the report says so | ✅ **"flaky"** — a distinct, actionable signal |
| 3 | passed | nothing. The test is unreliable and the pipeline is green |

One retry distinguishes "broken" from "flaky". Three retries is a way of not knowing: a test that
needs three attempts is failing two thirds of the time and the report says green. Lesson 12.1's
flake policy is what you do with the signal — a test flagged flaky gets fixed or deleted in the
pull request that noticed it.

`trace: 'on-first-retry'` pairs with that number: no tracing overhead on the happy path, and a
full trace of exactly the run that failed. Note the consequence for local work — with `retries:
0` there is never a first retry, so **no trace is captured locally** unless you ask for one with
`--trace on`. Step 6 does.

### 8. The console-error listener, and its honest allowlist

`page.on('console')` fires for every message the page logs, including the ones Chromium itself
writes — a 404 for a subresource arrives as a console error, not just as a failed request. A
listener that fails the test on any `console.error` is the cheapest broad regression detector
available: a React hydration mismatch, a thrown error inside an effect, a missing image and a
CSP violation all announce themselves there.

It will also be noisy on first run, and this is where people go wrong:

```
   ❌ THE WRONG FIX                      ✅ THE RIGHT FIX
   ──────────────────────────────        ──────────────────────────────────────
   filter: /warn|error|Warning/          one named entry per tolerated line,
   → the assertion now catches nothing   with the reason and an expiry in prose
   → and nobody notices for a year
```

The procedure, in order, and it matters that it is this order:

1. Write the listener with **no filter at all**.
2. Run the suite and read every line it prints.
3. For each line, decide: is this a bug I should fix, or noise I will tolerate?
4. Add one allowlist entry per tolerated line, as a **narrow, commented regular expression**.

Candidates you will genuinely see on this stack, and the honest verdict on each:

| Console line | Verdict |
|---|---|
| `Failed to load resource … /favicon.ico` | tolerate. There is no favicon until Lesson 19.4 adds the icon set; middleware already excludes the path |
| React hydration mismatch warnings | **fix**. This is the bug the listener exists to catch |
| `Warning: Each child in a list should have a unique "key"` | **fix**. Lesson 08.2 covered it, and this is the test that notices a regression |
| Next's dev-only fast-refresh chatter | tolerate if it is genuinely `error` type, and name it |

> **A test whose assertion you weakened until it passed is not a test.** The allowlist is a list
> of decisions with reasons attached, so a reviewer can disagree with each one individually. A
> blanket regex is one decision with no reason attached, and it silently covers everything anyone
> adds later.

### 9. This spec has state, and that is why Lesson 12.4 exists

Look at what the table in the Task asserts: `/en/incidents/incident-01` shows
`Deployed on a Friday (#1)`, `/en/hobt` shows `How To Omit Blaming Tech`. Those are statements
about **rows in a MySQL database**, not about your code.

| Assertion | Depends on |
|---|---|
| the route responds 200 | your code |
| the `<h1>` is `Incidents` | your code |
| the banner/main/contentinfo landmarks exist | your code |
| `/en/incidents/incident-01` exists at all | `wp blame seed` having run |
| the heading is `Deployed on a Friday (#1)` | the seeder's fixed titles |
| the primary nav has four top-level items | five menu items somebody created **by hand** in Lesson 05.4 |
| `/en/hobt` shows the ACF headline | an options page and a field group somebody filled in by hand |

The last three rows are the problem, and they are invisible on your machine because your machine
is the one where the hand work happened. Write this spec first anyway. Feeling it go red for a
reason that has nothing to do with your code is what makes Lesson 12.4 read as a fix rather than
as bureaucracy — and it is why the content assertions in this lesson stay deliberately shallow
(one heading per route) and get sharper in 12.4 once the data is a controlled input.

### 10. Debugging: `--ui`, the trace viewer, and `show-trace` on a CI artifact

Three tools, and reaching for the wrong one is most of the frustration people report.

| Tool | Command | Use it for |
|---|---|---|
| UI mode | `npx playwright test --ui` | writing and fixing specs locally. Watch mode, a DOM snapshot per action, a locator picker. **The best debugging tool in this course** |
| Headed run | `npx playwright test --headed` | "what is it actually doing" |
| Inspector | `npx playwright test --debug` | stepping one action at a time |
| Trace viewer | `npx playwright show-trace <trace.zip>` | a failure you cannot reproduce — especially one from CI |
| HTML report | `npx playwright show-report` | reading which specs failed, with the trace linked |

The trace is the one worth understanding, because it makes a CI failure diagnosable without a
rerun. A `trace.zip` holds a screenshot filmstrip, the full DOM at every action, the network log,
the console log and the source line for each step. Module 24 uploads it as a build artifact; you
download it, run `npx playwright show-trace trace.zip`, and you are looking at the exact state of
the page on the machine that failed. For the case that matters most — the failure that only
happens in CI — that beats Cypress's live time-travel, which Lesson 12.1 conceded wins locally.

`npx playwright codegen http://127.0.0.1:3000/en` is worth knowing too: it opens a browser and
writes locators as you click. Treat its output as a first draft — it prefers `getByRole` where it
can and falls back to CSS where your markup gave it nothing better, which is a useful signal about
the markup.

---

## Task

### Step 1: Check the licence, install, and download a browser

```bash
cd next-app

npm view @playwright/test license
# Expected: Apache-2.0
```

**Apache-2.0 is permissive**, so it satisfies the house rule from Lesson 07.1 — MIT, ISC,
Apache-2.0 and BSD are fine in this MIT project; a copyleft licence would be a blocker rather
than a footnote. It is the first non-MIT dependency in the repo, which is exactly why the check
is worth running rather than assuming.

```bash
npm install --save-dev @playwright/test@^1

# Downloads a Chromium build (~150 MB) into a per-user cache, NOT into node_modules.
npx playwright install --with-deps chromium
```

Two honest notes. The browser download is real: Playwright ships its own patched Chromium
because "the browser on this machine" is not a reproducible dependency, and the binary lands in
`~/Library/Caches/ms-playwright` (macOS) or `~/.cache/ms-playwright` (Linux). And `--with-deps`
installs **system** libraries on Linux via `apt-get`, so it will ask for `sudo` there; on macOS
it is effectively a no-op and harmless to leave in the command you copy into CI.

**Verify §1:**

- [ ] `npx playwright --version` prints a `1.x` version.
- [ ] `npm pkg get devDependencies` lists `@playwright/test`, and `dependencies` does not.
- [ ] `npx playwright install --dry-run chromium` reports the browser is already installed.

### Step 2: Write `playwright.config.ts`

```ts
// next-app/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // Vitest owns src/**/*.test.ts; Playwright owns e2e/**/*.spec.ts. Two runners,
  // two extensions, no overlap — Lesson 12.2 Key Concept 4.
  testDir: './e2e',

  fullyParallel: true,

  // A committed `test.only` silently skips the rest of the suite. Locally it is a
  // convenience; in CI it is a green pipeline that ran one test.
  forbidOnly: !!process.env.CI,

  // ONE retry in CI, none locally. One distinguishes "flaky" from "broken";
  // three is a way of not knowing. Key Concept 7.
  retries: process.env.CI ? 1 : 0,

  // `workers` is spread conditionally rather than set to `undefined`: with
  // `exactOptionalPropertyTypes` (Lesson 07.3), assigning undefined to an
  // optional property is a type error, and "absent" means "use the default".
  ...(process.env.CI ? { workers: 1 } : {}),

  // `list` for the terminal, `html` for the clickable report. `open: 'never'`
  // because a report that launches a browser mid-CI-run is not helpful.
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    // 127.0.0.1, NOT localhost. Node may resolve `localhost` to ::1 while
    // `next dev` binds 0.0.0.0 (IPv4), and the symptom is ECONNREFUSED against
    // a server your browser can load. Key Concept 5.
    baseURL: 'http://127.0.0.1:3000',

    // No tracing on the happy path; a full trace of the run that failed. With
    // retries: 0 there is no first retry locally — use `--trace on` (Step 6).
    trace: 'on-first-retry',
  },

  // The name is a CONTRACT. Module 22 adds `a11y`, Module 23 adds `mutations`,
  // and Module 23's Starting State runs `--project=smoke`. Key Concept 6.
  projects: [{ name: 'smoke', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'npm run dev',
    // The Lesson 09.5 health endpoint: 200 only when Next AND WordPress answer.
    // The cost is in Key Concept 5 — a 503 means Playwright waits out the whole
    // 120 s. Lesson 12.4's global-setup is what turns that into one sentence.
    url: 'http://127.0.0.1:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

**Verify §2:**

- [ ] `npm run type-check` is silent. If it complains about `workers`, you assigned `undefined`
      instead of spreading — reread the comment above it.
- [ ] `npx playwright test --list --project=smoke` exits without "project not found", even though
      no spec exists yet.

### Step 3: Write the smoke spec over the nine routes

Nine page routes exist at the end of Module 11 and there is no tenth. Table-driven, so adding
Module 16's `/en/incidents/submit` later is one line rather than one more copied test.

```ts
// next-app/e2e/smoke.spec.ts
// The "did it boot" suite. One assertion set per route, table-driven.
//
// Locators are getByRole + accessible name ONLY. No CSS classes, no data-testid,
// no nth-child, no XPath — Key Concept 3. Verification proves their absence.
import { expect, test } from '@playwright/test';

type Route = {
  readonly path: string;
  /** The level-1 heading. Static strings are ours; the rest come from `wp blame seed`. */
  readonly heading: string;
};

const ROUTES: readonly Route[] = [
  { path: '/en', heading: 'Blame The Tech' },
  { path: '/en/incidents', heading: 'Incidents' },
  // Seeded content (appendix 03 §9): fixed slugs, fixed titles. Lesson 12.4 is
  // what makes these three rows true on a machine that is not yours.
  { path: '/en/incidents/incident-01', heading: 'Deployed on a Friday (#1)' },
  { path: '/en/blog', heading: 'Blog' },
  { path: '/en/blog/blog-01', heading: 'Blaming the tech, part 1' },
  { path: '/en/reviews', heading: 'Tech Reviews' },
  { path: '/en/reviews/review-01', heading: 'Hyperscale Cloud Co' },
  { path: '/en/scapegoats', heading: 'The Blame Leaderboard' },
  // The ACF `headline` field on the HOBT page, not a hard-coded string.
  { path: '/en/hobt', heading: 'How To Omit Blaming Tech' },
];

test.describe('every route boots', () => {
  for (const route of ROUTES) {
    test(`${route.path} answers 200 with its own h1`, async ({ page }) => {
      const response = await page.goto(route.path);

      // The second argument is the failure message. With nine near-identical
      // tests, a message naming the route is worth the six characters.
      expect(response?.status(), `${route.path} must answer 200`).toBe(200);

      // Web-first: the locator goes INTO expect, so this retries. Key Concept 2.
      await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
    });
  }
});
```

```bash
npx playwright test
```

**Verify §3:**

- [ ] 9 tests, 9 passed. Playwright started the dev server itself — you did not.
- [ ] If a *seeded* route fails on `/en/incidents/incident-01`, run
      `docker compose -f ../wordpress-headless/docker-compose.yml run --rm wpcli wp post list --post_type=incident --format=count`
      first. `40` means the app is at fault; anything else means your database has drifted, which
      is Lesson 12.4's subject.

### Step 4: Add the structural assertions Lesson 11.4 earned

Landmarks, one `<h1>`, and the skip link. These are the assertions that make accessibility work
stay done, and they cost one block.

```ts
// next-app/e2e/smoke.spec.ts — inside the `for` loop, after the heading assertion
      // The three landmarks from Lesson 11.4, addressed by role. `banner` is the
      // page <header>, `contentinfo` the page <footer> — both are only landmarks
      // when they are not nested inside <article>/<section>/<main>/<aside>.
      await expect(page.getByRole('banner')).toBeVisible();
      await expect(page.getByRole('contentinfo')).toBeVisible();

      // EXACTLY ONE main landmark, and exactly one level-1 heading. Both are
      // promises Lesson 11.4 made in its Key Concepts 2 and 3, and both regress
      // silently the first time somebody copies a route file.
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

      // The header nav, addressed by its accessible name. Three <nav> elements
      // exist — Primary, Mobile, Social — which is why the name filter is not
      // optional. On the Desktop Chrome viewport the mobile drawer is hidden, and
      // hidden elements are excluded from role queries by default.
      await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
```

> ⚠️ **If `getByRole('main')` reports 2 on a route, that route file still opens with its own
> `<main>` wrapper.** Lesson 11.4 Step 4 moved the landmark into
> `src/app/[locale]/layout.tsx`; the Module 09 route files, and `not-found.tsx` and `error.tsx`
> from Lesson 10.4, each wrapped their body in one. Delete the wrapper in the page and return a
> fragment. Nested `<main>` is invalid HTML and it gives a screen-reader user two "main content"
> landmarks to choose between — which is precisely the class of regression a role-based locator
> catches for free.

Then two tests that are about the shell rather than about a route:

```ts
// next-app/e2e/smoke.spec.ts — append
test.describe('the app shell', () => {
  test('the skip link is the first focusable element', async ({ page }) => {
    await page.goto('/en');

    // One Tab from a fresh load. Anything above SkipLink in <body> makes it
    // useless, and this is the assertion that notices.
    await page.keyboard.press('Tab');

    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  });

  test('/ redirects to /en with a 307, not a 302', async ({ request }) => {
    // The `request` fixture is an HTTP client with the same baseURL and no
    // browser. maxRedirects: 0 is how you see the redirect rather than its target.
    const response = await request.get('/', { maxRedirects: 0 });

    // 307 preserves the method and body. Lesson 09.5 chose it because Module 16
    // POSTs Server Actions through paths this middleware touches, and a 302 turns
    // a POST into a GET and loses the submission with no error anywhere.
    expect(response.status()).toBe(307);
    expect(response.headers()['location'] ?? '').toContain('/en');
  });

  test('/en/hobt shows both CTAs, with the demo button inert but announced', async ({ page }) => {
    await page.goto('/en/hobt');

    // Two CTA bands, so two of each control — Lesson 11.5 uses the component
    // twice on purpose. toHaveCount on the multi-element locator rather than
    // .first(), because the count IS the fact worth asserting.
    await expect(page.getByRole('link', { name: 'Start Now' })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Get Demo' })).toHaveCount(2);

    // aria-disabled, NOT disabled: an inert control must stay in the tab order,
    // or a keyboard user never reaches the sentence explaining why it does
    // nothing. Lesson 11.5's `aria-*` inventory records the reasoning.
    await expect(page.getByRole('button', { name: 'Get Demo' }).first()).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  test('an unknown incident slug answers 404 and renders not-found.tsx', async ({ page }) => {
    // NEGATIVE. A route that 200s on nonsense is a route that will happily serve
    // a typo, and Module 19 would put it in your sitemap.
    const response = await page.goto('/en/incidents/no-such-incident-ever');

    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'No such incident.' })).toBeVisible();
  });
});
```

**Verify §4:**

- [ ] 13 tests, all green.
- [ ] Comment out `<SkipLink />` in `src/app/[locale]/layout.tsx`, rerun, and watch the skip-link
      test fail with `expected focused` and a locator that resolved to nothing. Put it back.

### Step 5: Add the console listener, run it, then write the allowlist

Order matters here: **no filter first**, then read, then allow. Add the collector and the
assertion:

```ts
// next-app/e2e/smoke.spec.ts — add the import and the helper near the top
import type { Page } from '@playwright/test';

/**
 * Every tolerated console line gets ONE narrow entry, with the reason and the
 * lesson that removes it. A blanket /warn|error/ regex is one decision with no
 * reason attached, and it silently covers everything anyone adds later.
 *
 * Start this array EMPTY. Run the suite. Read what comes out. Only then add.
 */
const CONSOLE_ALLOWLIST: readonly RegExp[] = [
  // Chromium reports a missing subresource as a console error. There is no
  // favicon until Lesson 19.4 adds `src/app/icon.svg`, and middleware already excludes
  // the path from the locale redirect. Delete this entry in Module 19.
  /favicon\.ico/,
];

/** Collects console errors and uncaught page exceptions for one page. */
function collectPageErrors(page: Page): string[] {
  const problems: string[] = [];

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (CONSOLE_ALLOWLIST.some((pattern) => pattern.test(text))) return;
    problems.push(`console.error: ${text}`);
  });

  // A different channel: an uncaught exception in the page never reaches
  // console.error, so a listener on only one of the two misses half the bugs.
  page.on('pageerror', (error) => {
    problems.push(`pageerror: ${error.message}`);
  });

  return problems;
}
```

```ts
// next-app/e2e/smoke.spec.ts — inside the `for` loop, FIRST line of the test body
      // Attach BEFORE goto. A listener added afterwards misses everything the
      // page logged while loading, which is where hydration errors live.
      const problems = collectPageErrors(page);
```

```ts
// next-app/e2e/smoke.spec.ts — inside the `for` loop, LAST line of the test body
      // toEqual([]) rather than toHaveLength(0): an empty-array diff PRINTS the
      // offending lines, and a length mismatch does not.
      expect(problems, `${route.path} logged to the console`).toEqual([]);
```

Now do the reading, with the allowlist temporarily emptied:

```bash
# Empty the allowlist, so you see everything the pages really log. The pattern
# anchors on the indented regex line, so it removes exactly one entry.
sed -i.bak '/^  \/favicon/d' e2e/smoke.spec.ts
npx playwright test --project=smoke --reporter=list
```

**Verify §5:**

- [ ] Read every line in the failure output. For each one, decide: bug, or tolerated?
- [ ] A hydration mismatch or a React `key` warning is a **bug**. Fix the component; do not add
      it to the allowlist.
- [ ] Restore the allowlist and add one commented entry per line you chose to tolerate:
      `mv e2e/smoke.spec.ts.bak e2e/smoke.spec.ts`, then edit.
- [ ] `npx playwright test` is green again, and the allowlist has a comment per entry naming the
      reason and the lesson that will delete it.

### Step 6: Break a locator on purpose and read the trace

Delete the accessible name of the inert CTA — the exact regression a `data-testid` would have
hidden:

```bash
# Prettier put the label on its own line, so the capture group takes whatever
# indentation your file has. `{null}` renders nothing: the button is still there,
# still focusable, and now has no accessible name at all.
sed -i.bak 's/^\( *\)Get Demo$/\1{null}/' src/components/hobt/HobtCtaBand.tsx
npx playwright test --trace on
```

`--trace on` is required locally: `trace: 'on-first-retry'` plus `retries: 0` means there is
never a first retry, so nothing is recorded unless you ask.

```bash
npx playwright show-report
```

**Verify §6:**

- [ ] The HOBT test fails on `toHaveCount(2)` with `Received: 0`, and the message shows the
      locator `getByRole('button', { name: 'Get Demo' })` — the failure names the *user-visible*
      property that broke.
- [ ] In the report, open the failed test and click the trace. Step through the actions: the
      filmstrip, the DOM snapshot at the failing step, the network log, the console tab. Find the
      button in the DOM snapshot and confirm it is still there, with no name.
- [ ] That is the point of the whole locator argument: the button renders, it is clickable, and it
      is now unusable by anyone who cannot see it. A `data-testid` locator would still be green.

Restore the code — never the assertion, and never with git:

```bash
mv src/components/hobt/HobtCtaBand.tsx.bak src/components/hobt/HobtCtaBand.tsx
npx playwright test
```

### Step 7: Re-prove the two runners cannot see each other

`e2e/smoke.spec.ts` now exists, which is the condition Lesson 12.2's `include`/`exclude` pair was
written for. Prove it rather than trusting it:

```bash
npm run test:run
npm run type-check && npm run lint
```

**Verify §7:**

- [ ] `npm run test:run` still reports 5 files and 53 tests, exactly as in Lesson 12.2. If it
      reports 6 files, or fails with `Playwright Test did not expect test() to be called here`,
      your `include` is wrong — fix `vitest.config.ts`, not the spec.
- [ ] `npm run lint` is clean on `e2e/`. The flat config lints `**/*.ts` project-wide, so the
      spec is held to the same type-aware rules as `src/`.
- [ ] `git status --short` shows `playwright-report/` and `test-results/` as **absent** —
      both are gitignored, and a committed HTML report is 30 MB of noise in every diff.

---

## Verification

```bash
cd next-app

# 1. The runner is installed and the browser is downloaded
npx playwright --version
# Expected: Version 1.x.y
npx playwright install --dry-run chromium | head -3
# Expected: a chromium entry with an "Install location" that already exists

# 2. The project name is a contract Modules 22 and 23 depend on
npx playwright test --list --project=smoke | tail -3
# Expected: a list of tests ending in "Total: 13 tests in 1 file".
#           NOT "Project(s) 'smoke' not found" — that message means a later
#           module's Starting State will fail rather than your code.

# 3. The whole suite, green, with Playwright starting the dev server itself
npx playwright test
# Expected: 13 passed. If it took ~6 s to start, `webServer` reused a dev server
#           you already had running; if ~15 s, it started one.

# 4. The HTML report was written and is readable
test -f playwright-report/index.html && echo "report present"
# Expected: report present

# 5. NEGATIVE — not one fragile locator in the whole suite
grep -rn 'data-testid\|\.locator(.\.\|nth-child\|xpath=' e2e/ ; echo "exit=$?"
# Expected: no output, exit=1. Every locator is getByRole plus an accessible
#           name, so every one of them fails when a user would also be broken.

# 6. Every locator really is role-based — count them
grep -rc 'getByRole' e2e/smoke.spec.ts
# Expected: 10 or more

# 7. NEGATIVE — the 404 route is asserted, not assumed
grep -c 'toBe(404)' e2e/smoke.spec.ts
# Expected: 1
grep -c 'toBe(307)' e2e/smoke.spec.ts
# Expected: 1 — Lesson 09.5's redirect status, pinned. A 302 would silently turn
#           Module 16's POSTs into GETs.

# 8. The console guard exists, listens on BOTH channels, and is not a blanket filter
grep -c "page.on('console'\|page.on('pageerror'" e2e/smoke.spec.ts
# Expected: 2
grep -c 'CONSOLE_ALLOWLIST' e2e/smoke.spec.ts
# Expected: 2 — the declaration and the one place it is consulted
grep -c '//' e2e/smoke.spec.ts
# Expected: 15 or more. Every allowlist entry carries a reason; a bare regex in
#           that array is the failure mode Key Concept 8 describes.

# 9. NEGATIVE — Vitest still collects nothing from e2e/, now that a spec exists
npm run test:run
# Expected: Test Files 5 passed (5), Tests 53 passed (53) — the same five files as
#           Lesson 12.2. A sixth file,
#           or "Playwright Test did not expect test() to be called here", means
#           vitest.config.ts's include/exclude pair is broken.
npx vitest run e2e; echo "exit=$?"
# Expected: "No test files found" and exit=1

# 10. Types and lint are clean, including e2e/
npm run type-check && npm run lint
# Expected: no output
npx tsc --noEmit --listFiles | grep -c 'e2e/smoke.spec.ts'
# Expected: 1 — the spec is type-checked like any other source file

# 11. NEGATIVE — test output never enters git
git check-ignore -v playwright-report test-results
# Expected: two rules from the root .gitignore
git status --short | grep -cE 'playwright-report|test-results'
# Expected: 0

# 12. NEGATIVE, and the honest one — with WordPress down, the readiness probe
#     never goes green. This is the cost of pointing `webServer.url` at
#     /api/health, stated rather than hidden.
docker compose -f ../wordpress-headless/docker-compose.yml stop wordpress
npm run dev > /tmp/btt-dev.log 2>&1 & DEV_PID=$!
sleep 10
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health
# Expected: 503. Playwright's webServer treats any 5xx as "not ready", so
#           `npx playwright test` would now poll for the full 120 seconds and
#           fail with a message about config.webServer — never mentioning
#           WordPress. Lesson 12.4's global-setup turns that into one sentence
#           in under a second.
kill "$DEV_PID"
docker compose -f ../wordpress-headless/docker-compose.yml start wordpress
sleep 8
# If check 13 complains that :3000 is busy, `kill` left a `next dev` child behind:
# find it with `lsof -ti tcp:3000` and kill that pid. Playwright would reuse it
# anyway, because reuseExistingServer is true outside CI.
docker compose -f ../wordpress-headless/docker-compose.yml run --rm wpcli wp post list --post_type=incident --format=count
# Expected: 40 — the stack is back and the data is untouched

# 13. And green again from a cold start, to prove check 12 changed nothing
npx playwright test
# Expected: 13 passed
```

If check 5 prints anything, do not add an ESLint exception for it — replace the locator. Lesson
23.7 adds a lint rule that makes this grep unnecessary; until then the grep is the rule.

## Control Questions

1. `await expect(locator).toBeVisible()` and `expect(await locator.isVisible()).toBe(true)` look
   equivalent. Explain what each one actually does, say which of the two can pass on a slow
   machine and fail on a fast one, and name the fix that people reach for instead and why it is
   worse.
2. `webServer.url` is `http://127.0.0.1:3000/api/health`. Give the reason for the IP literal
   rather than `localhost`, then describe exactly what a learner sees when they run the suite
   with Docker stopped — including which component the error message blames.
3. A colleague replaces `getByRole('button', { name: 'Get Demo' })` with
   `locator('[data-testid="demo-cta"]')` because the first one was failing. Name three distinct
   real regressions the second locator would stay green through, and say what the failing test
   was actually telling them.
4. The project is named `smoke` and there is only one. Name the two projects later modules add,
   say which command in Module 23's Starting State breaks if you rename this one, and explain why
   declaring one project now is better than omitting `projects` entirely.
5. The console listener has one allowlist entry. Describe the procedure that produced it, then
   explain why `if (/warn|error/i.test(text)) return;` would technically make the suite green and
   what it would cost you six months later.

## Learn More

- [Playwright — locators](https://playwright.dev/docs/locators) — the recommended-locator order
  from Key Concept 3, in the project's own priority
- [Playwright — assertions](https://playwright.dev/docs/test-assertions) — which matchers retry
  and which do not, which is the whole of Key Concept 2
- [Playwright — `webServer`](https://playwright.dev/docs/test-webserver) — every field of the
  block from Key Concept 5, including the documented "2xx, 3xx or 4xx" readiness rule
- [Playwright — trace viewer](https://playwright.dev/docs/trace-viewer) — read this before your
  first CI-only failure, not after it
- [Playwright — UI mode](https://playwright.dev/docs/test-ui-mode) — the tool you will use most
  and are least likely to discover on your own
- [Playwright — test projects](https://playwright.dev/docs/test-projects) — projects, dependencies
  between them, and `--project`, which is how Modules 22 and 23 extend this config
- [Playwright — `Page.on('console')`](https://playwright.dev/docs/api/class-page#page-event-console)
  — the event Key Concept 8 hangs the guard on, plus `pageerror` next to it
- [W3C — Accessible Name and Description Computation](https://www.w3.org/TR/accname-1.2/) — the
  specification behind Key Concept 4; skim §5.2 and you will be able to predict `getByRole`
- [MDN — ARIA landmark roles](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles#landmark_roles)
  — `banner`, `main`, `contentinfo`, `navigation` and the nesting rules that decide when a
  `<header>` stops being a landmark
