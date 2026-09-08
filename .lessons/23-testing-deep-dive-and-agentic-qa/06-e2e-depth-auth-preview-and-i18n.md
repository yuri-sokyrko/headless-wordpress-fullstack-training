---
title: 'E2E Depth: Auth, Preview & i18n'
module: 23
lesson: 6
teaches: [playwright-projects, storage-state, mutation-isolation, cache-coherency, test-only-hooks, e2e-preview, e2e-locale-routing]
produces: ['next-app/playwright.config.ts', 'next-app/e2e/auth.setup.ts', 'next-app/e2e/moderation.spec.ts', 'next-app/e2e/preview.spec.ts', 'next-app/e2e/i18n.spec.ts']
requires: [23.5, 18.4, 17.2, 20.3]
---

# Lesson 23.6 — E2E Depth: Auth, Preview & i18n

## Quick Overview

Module 12's smoke suite proved the pages load. This lesson tests the flows that only exist when
both applications, the database, the cache and the webhook are all running together — which is
also why they are the flows nobody tests until they break in production. Three of them matter:
the moderation loop (a reporter submits a pending incident, a moderator publishes it in wp-admin,
the revalidation webhook fires, the public list shows it), draft preview (an editor hits Preview
and Next renders the unpublished draft through `draftMode()`), and locale routing (the same
document reachable in three languages with a switcher that preserves the slug and the query string).

Getting there needs Playwright structured properly. A **setup project** logs in once and writes
`storageState` to disk, so the other projects start authenticated instead of driving the login
form forty times. Then the projects **split by whether they mutate**: reads run `fullyParallel`
because they cannot interfere, mutations run with `workers: 1` and `fullyParallel: false` because
two workers publishing incidents in the same database will interleave and produce failures that
reproduce only in CI. Cleanup runs after, deterministically.

And then the gotcha that will cost you an afternoon if nobody warns you. **After
`wp db reset && wp db import`, Next.js still serves the previous data**, because ISR does not know
the database changed — the cache entry is still fresh and the tag was never purged. Your test
passes alone and fails in the suite, or passes locally and fails in CI, which is the worst
possible failure signature. The fix is a test-only route handler that purges the cache after a
reset — and the fix is itself the lesson, because **a test hook is an unauthenticated endpoint
unless you make it not one.** It 404s unless `E2E_MODE=1`, and 401s if the `X-BTT-E2E-Secret` header does
not match — the four status codes are Lesson 18.3 §10's, and the difference between them is the
lesson. See [appendix 04 §3.1](../appendix/04-env-reference.md#31-server-only-no-prefix).

By the end of this lesson you will have:

- `playwright.config.ts` with the `setup` project plus `smoke`, `mutations` and `a11y`,
  dependencies declared,
  and mutation isolation configured
- `e2e/auth.setup.ts` — one login per role, `storageState` per role, credentials from the
  environment and never from a literal
- `e2e/moderation.spec.ts` — submit as reporter, publish as moderator, assert the public list,
  through the real webhook
- `e2e/preview.spec.ts` — an editor previewing a draft, and the negative: no preview cookie means
  the draft is not visible
- `e2e/i18n.spec.ts` — all three locales, the switcher preserving the translated slug and the
  query string
- A hardened test-only cache-reset hook with a spec proving it 404s without the secret, and a
  reset-and-reseed fixture that leaves the suite reproducible in any order

## Classic WP Analogy

Your Classic equivalent was a staging site and a written test plan — and if the plan was good, it
looked a lot like these specs: log in as a contributor, submit a post, log in as an editor,
publish it, check the archive, check the RSS feed. Same scenarios. The difference is that a human
did it, once per release, and quietly skipped steps four through nine when the release was urgent.

| Classic WordPress | Playwright |
|---|---|
| A staging site plus a checklist | `e2e/*.spec.ts`, on every pull request |
| Log in through `wp-login.php` each time | A setup project and `storageState` |
| A database snapshot before testing | `wp db reset && wp blame seed --fresh` per run |
| "Clear the cache" as a checklist step | An authenticated, gated cache-purge hook |
| Preview verified by clicking Preview | `e2e/preview.spec.ts`, including the negative case |
| Someone forgets the German page | Parameterised over three locales |

The break is genuinely new and it is the cache one, so it is worth stating in full. In a Classic
WordPress stack, the database *is* the state. Reset it and the next request renders from the
reset data, because rendering happens on every request from the current database — that is the
whole reason page caching was something you bolted on. Any page cache you did add lived in
WordPress, so `wp cache flush` cleared it and your checklist had a line for that.

Here, **the cache lives in a different application, on a different host, in a different runtime,
and it has no idea your database moved.** Next's ISR entries are still valid, their revalidation
windows have not elapsed, and nothing purged their tags — so the front end will confidently serve
data that no longer exists for the next ten minutes. There is no `wp cache flush` that reaches it,
and there is no way to make ISR "notice", because not noticing is precisely what makes it fast.
Every headless test suite eventually hits this, usually as a flake nobody can reproduce. The
lasting takeaway is broader than the fix: in a decoupled architecture, **resetting state means
resetting state in every tier**, and any tier you forget becomes intermittent.

---

## Key Concepts

### 1. The flows that only exist when everything is running

Module 12's smoke suite proves nine pages answer 200 with the right `<h1>`. That is a real and
cheap guarantee, and it is a guarantee about **one** application. Every interesting failure in a
headless stack lives in a seam between two of them, and a seam has no page to visit.

| Flow | Applications, systems and credentials involved |
|---|---|
| Moderation | Next form → Server Action → WPGraphQL mutation → MySQL → wp-admin → `transition_post_status` → HMAC webhook → `revalidateTag` → the public archive |
| Draft preview | wp-admin → `preview_post_link` → `/api/preview` → `/wp-json/btt/v1/preview/verify` → a preview JWT in an httpOnly cookie → `draftMode()` → `asPreview: true` |
| Locale routing | Polylang's translation table → WPGraphQL Polylang → a Server Component's redirect decision → next-intl's middleware → the `hreflang` cluster → a client island reading it after hydration |

Nobody unit-tests those, because there is nothing there to unit-test: the logic is correct in
every file and the *composition* is what breaks. Nobody clicks through them by hand every release
either, because each takes three minutes and two accounts. So they are exactly the flows that
break in production, quietly, on the day somebody changes something adjacent.

> **The rule of thumb worth carrying out of this lesson.** The cheapest bugs to catch are inside
> one function; the most expensive are between two systems. Your test budget should be shaped like
> the inverse of that, not like the pyramid's silhouette — which is why Lesson 23.1's pyramid has
> a *widening* top layer in this stack rather than the textbook's single sliver.

### 2. `storageState`: one login per role, and the thing it hides

A Playwright browser context can be serialised — cookies plus `localStorage`, per origin — into a
JSON file and restored into a fresh context later. So instead of thirty specs each driving
`/en/login`, one **setup project** logs in once per role and writes a file, and every other
project starts already authenticated.

```
   WITHOUT storageState                    WITH storageState
   ──────────────────────────────────      ──────────────────────────────────────────
   spec 1  → fill login form (4 s)         setup  → fill login form ONCE per role
   spec 2  → fill login form (4 s)                  write e2e/.auth/<role>.json
   spec 3  → fill login form (4 s)         spec 1  → context restored (≈0 s)
   …                                        spec 2  → context restored (≈0 s)
   30 specs → 120 s of typing               30 specs → 8 s of typing, once
```

The cost is not the disk file. The cost is that **the login path is no longer under test**, and
every spec that used to exercise it silently stops. That is why Lesson 16.4's `funnel.spec.ts`
deliberately drives the form and **stays as it is** in this lesson: its entire subject is the
journey from anonymous visitor to published incident, and a journey that starts already logged in
is a different journey. You get the speed everywhere and keep one spec paying full price.

| | Drive the form per spec | `storageState` from a setup project |
|---|---|---|
| Login path covered | by every spec, redundantly | by `auth.setup.ts` and `funnel.spec.ts` only |
| Cost per authenticated spec | ~4 s and a flake surface | ~0 s |
| Fails when the login page changes | every spec, with the same message | `setup`, once, before anything else runs |
| Order dependence | none | the state file must exist first — hence `dependencies` |
| Secret handling | the password is in the spec's process | the password is in `setup`'s process only |

That last row is a genuine security improvement and rarely mentioned: with a setup project the
credential is read in exactly one file, and the thirty specs that need a session never see it.

### 3. Projects split by whether they mutate

Playwright parallelises by **file** across workers by default. Two workers running two specs that
each publish an incident into one MySQL database will interleave their writes, and the failure
looks like this: green on your machine with one worker, red in CI with four, and green again on
the retry. That signature — *reproduces only under concurrency, only sometimes* — is the most
expensive kind of test failure there is, because the first four hours go on reading the diff.

The fix is not `--workers=1` for the whole suite. Read specs cannot interfere with each other and
there is no reason to make forty of them serial to protect three. Split by what the spec does:

| Project | Contains | Parallelism | Session |
|---|---|---|---|
| `setup` | `*.setup.ts` — the cache purge and one login per role | irrelevant, it is three tests | mints them |
| `smoke` | `smoke.spec.ts`, `i18n.spec.ts` | `fullyParallel` — reads only | anonymous, on purpose |
| `mutations` | `moderation.spec.ts`, `preview.spec.ts`, `funnel.spec.ts` | **serial** | `storageState` |
| `a11y` | `a11y.spec.ts` (Lesson 22.4) | `fullyParallel` | `storageState`, for the gated submit route |

`smoke` stays **anonymous** deliberately, even though a state file is now sitting there: the
public archive rendered for a logged-in reporter is not the artefact the public receives, and a
smoke suite that silently tests the authenticated variant of every page has stopped testing the
site.

**One honest correction to make here, because it is a type error waiting to happen.**
Playwright's per-project options do **not** include `workers`. `TestProject` has `fullyParallel`,
`retries`, `timeout`, `testMatch`, `dependencies`, `teardown` and `use`, and nothing that limits
worker count for one project. So "one worker for mutations" is expressed with the two mechanisms
that do exist, plus one documented invocation:

| Goal | Mechanism | Scope it actually covers |
|---|---|---|
| tests inside one file never overlap | `fullyParallel: false` on the project | that file |
| tests inside one file stop at the first failure | `test.describe.configure({ mode: 'serial' })` | that describe |
| two *different* mutation files never overlap | the top-level `workers` | the whole run |

`fullyParallel: false` plus `mode: 'serial'` covers everything inside a file. Two mutation files
in two workers is the remaining hole, and it is closed by the config's existing
`...(process.env.CI ? { workers: 1 } : {})` in CI and by `--workers=1` locally, which Step 8
puts in the command you type. Writing `workers: 1` inside a project object would not compile, and
a config that does not compile is worse than one that is honest about its limit.

### 4. `dependencies`, teardown, and why every project needs the root

`dependencies: ['setup']` means: run every test in `setup` to completion, and only then start this
project. If a `setup` test fails, the dependent projects are **skipped**, not failed — which is
the right report, because a spec that never ran did not fail.

```
                    ┌──────────┐
                    │  setup   │   1. purge the Next cache after globalSetup's import
                    │ 3 tests  │   2. log in as reporter → e2e/.auth/reporter.json
                    └────┬─────┘   3. log in as editor   → e2e/.auth/editor.json
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
     ┌─────────┐   ┌───────────┐   ┌─────────┐
     │  smoke  │   │ mutations │   │  a11y   │
     │ 4 wkrs  │   │  serial   │   │ 4 wkrs  │
     └─────────┘   └───────────┘   └─────────┘
```

`smoke` is anonymous and needs no state file, so its dependency looks decorative. It is not, and
the reason is Key Concept 5: **`setup`'s first test purges the Next cache**, and a read spec that
starts before that purge is reading the pre-import content. Every project depends on `setup`
because every project depends on the cache being coherent with the database, which is a thing
`globalSetup` cannot do — it runs before `webServer` and there is no server to call yet.

Playwright also supports a `teardown` project — a project that runs *after* everything that
depends on the project naming it. **This suite deliberately does not use one**, and the argument
generalises: cleanup that runs at the end of a successful run does not run at the end of a
crashed one, so a suite that relies on teardown for correctness is a suite that is correct only
when it passes. Lesson 12.4's fixture import is stronger, because it restores state at the
**start** and therefore does not care how the previous run ended.

The cost, stated plainly: between runs your development database holds every probe incident and
probe user the suite created. `wp post list --post_type=incident --format=count` on your machine
will read higher than 55 until the next armed run, and that is expected rather than broken.

### 5. The cache-coherency gotcha, which is the real lesson of this lesson

You reset the database. Next serves the old data anyway.

```
   t=0   wp blame fixture load          MySQL now holds the fixture
   t=0   Next's ISR entry for /en/incidents:  still fresh, revalidate window 300 s
   t=1   spec: goto /en/incidents        ← served from the cache. PRE-IMPORT CONTENT.
   t=1   assertion: 12 cards             ← passes or fails depending on what was
                                            in the cache when the previous run ended
```

There is no `wp cache flush` that reaches it. The cache is in a different application, in a
different runtime, on a different port, and it does not know your database moved. Its entries are
valid, their revalidation windows have not elapsed, and nothing purged their tags. **There is
also no way to make ISR "notice", because not noticing is exactly what makes it fast.**

The failure signature this produces is the worst one available:

| Symptom | Why it happens |
|---|---|
| passes alone, fails in the suite | run alone, the cache was cold; in the suite, an earlier spec warmed it |
| passes locally, fails in CI | your cache holds your last manual browse; CI's holds the previous job's |
| fails once, then passes for an hour | the `revalidate` window elapsed between the two runs |
| passes on the retry, so CI reports "flaky" | which sends you looking for a race in your code |

The fix is one HTTP request, and it is **not** the interesting part. Lesson 18.3 already built
the endpoint: `POST /api/revalidate` with an `X-BTT-E2E-Secret` header and the body
`{"type":"all"}` calls `revalidatePath('/', 'layout')`. That sledgehammer is wrong everywhere else
in the course and correct here, because a database import replaced the entire content universe and
no set of tags describes that.

The interesting part is the generalisation, and it applies to every decoupled architecture you
will ever test:

> **Resetting state means resetting state in every tier, and any tier you forget becomes
> intermittent.** Count your tiers before you write the reset. Here there are four — MySQL, the
> WordPress object cache, Next's Data Cache and Next's Full Route Cache — and the last two are
> in a process the reset script cannot see.

### 6. A test hook is an unauthenticated endpoint unless you make it not one

The purge endpoint is a route handler that discards the cache of the whole application on
request. If you write one carelessly you have shipped a denial-of-service primitive with a
convenient name. Lesson 18.3 wrote it carefully and this lesson only *uses* it — but you must be
able to state its guard set from memory, because the next test hook is one you will write:

| Condition | Response | Reasoning |
|---|---|---|
| **no `X-BTT-E2E-Secret` header at all** | 400 | it is not a test-hook request. Step 4 of Lesson 18.3 dispatches on the header's *presence*, so an absent header falls through to the signed path, where the missing `X-BTT-Timestamp` is a 400 |
| header present, `E2E_MODE !== '1'` | **404** | in production the branch does not exist, and the response says so |
| header present, `E2E_SECRET` unset | **404** | an unconfigured hook is an absent hook — fail closed |
| header present and wrong | 401 | the hook exists and you are not authorised. No body, no reason |
| right secret, body not `{"type":"all"}` | 400 | a credential is not a schema |

Read that first row twice: it is the one people get wrong, and predicting `404` for it is the
symptom of not having read the branch order. **The four statuses are per condition, not per
request.**

**404 rather than 401 for the disabled case is the decision worth internalising.** A 401 answers
the question "does this deployment have a test hook?" — and that question should not have an
answer. The comparison is `timingSafeEqual` over equal-length buffers, so the endpoint does not
leak the secret one byte at a time either.

Your job in this lesson is to *prove* both polarities from a spec rather than trust the lesson
that wrote it. Verification does the 404 and the 401.

### 7. `E2E_MODE` and `E2E_SECRET` reach Playwright from the shell, and only from the shell

[Appendix 04 §3.1](../appendix/04-env-reference.md#31-server-only-no-prefix) lists both under
`next-app/.env.local`, and that is right about **one** of the two readers.

```
   .env.local ──▶ next dev / next build ──▶ the app's process.env
                                            Lesson 18.3's hook reads
                                            E2E_MODE and E2E_SECRET HERE

   your shell ──▶ npx playwright test   ──▶ playwright.config.ts
                                            e2e/global-setup.ts
                                            e2e/auth.setup.ts
                                            THE ONLY SOURCE for these three
```

Lesson 12.4 §9 settled this. What is worth restating is the argument, because the obvious "fix"
is to add `dotenv` to `playwright.config.ts` and it is the wrong move: **a destructive global
setup that arms itself from a dotfile is one `git pull` away from dropping a colleague's
database.** The file is on disk, invisible at the moment of invocation, and nobody typed anything.
An interlock armed only from the invoking shell cannot fire by accident. Verification asserts the
absence of a `dotenv` import as a negative — because "we decided not to" survives only if
something checks.

The same rule covers the three fixture passwords. `BTT_REPORTER_PASSWORD`,
`BTT_EDITOR_PASSWORD` and `BTT_E2E_PASSWORD` are session variables per
[appendix 04 §2](../appendix/04-env-reference.md#2-wordpress--wordpress-headlessenv), read with
`process.env` and never written to a file, and `auth.setup.ts` fails with one sentence naming the
variable when one is missing rather than driving a login form with an empty string.

### 8. Locale routing in a spec: three slug conventions and two correct 307s

Lesson 20.1's seeder produces three slug shapes, and a spec that assumes one of them is wrong on
two thirds of the corpus:

| Locale | Slugs | Count |
|---|---|---|
| `en` | `incident-01` … `incident-40` | 40 |
| `de` | `incident-01-de` … `incident-10-de` | 10 |
| `uk` | `відмова-01` … `відмова-05` (Cyrillic) | 5 |

So `/de/incidents/incident-01` does not 404 and does not render English. It **307s to the German
URL**, because a German sibling exists. And `/de/incidents/incident-40` — English-only, since
only the first ten are translated — 307s to `/en/incidents/incident-40?from=de`. Both are
correct, they come from the same helper in Lesson 20.2, and a spec that asserts only one of them
tests half a policy:

```
   /de/incidents/incident-01   →  307  /de/incidents/incident-01-de
                                        the RIGHT German URL, not a bounce to English

   /de/incidents/incident-40   →  307  /en/incidents/incident-40?from=de
                                        the English article, plus a role="status" notice
                                        saying why, and NO hreflang="de" claim anywhere
```

The `?from=de` half matters for a second reason. Lesson 20.4 renders a dismissible
`role="status"` notice when that parameter is present and nothing when it is absent, so the
parameter is assertable through the accessibility tree rather than by reading the URL — which is
the better assertion, because it is the thing a user experiences.

**And the one that will catch you: the switcher's disabled state resolves after hydration.**
A layout cannot see its child route's data (Lesson 20.3 §8 spends a decision table on this), so
`LocaleSwitcher` server-renders every locale as available and then corrects itself in an effect
by reading the `hreflang` cluster out of the document — Lesson 20.4 re-pointed it at
`link[rel="alternate"][hreflang]` so there is one source of truth for that claim. Consequences
for your spec:

- `curl` on `/en/incidents/incident-40` will show German as a **link**. That is the
  server-rendered HTML and it is not a bug.
- `await expect(page.getByRole('button', { name: /Deutsch/ })).toBeDisabled()` passes, because a
  web-first assertion retries until hydration has happened.
- `expect(await page.getByRole('button', …).isDisabled()).toBe(true)` fails, intermittently, for
  the reason Lesson 12.3 §2 gives. The distinction stops being academic exactly here.

### 9. Locators for authenticated flows, and two hostnames that are both right

Three things in this lesson's specs look like exceptions to house rules and are not.

**`getByLabel` for password fields.** `<input type="password">` exposes no ARIA role — not
`textbox`, not anything — so `getByRole('textbox', { name: 'Password' })` cannot match it in any
browser. `getByLabel` resolves through the same accessible-name computation and is the one
documented exception in the selector contract. It is a platform limitation, not a shortcut, and
Lesson 23.7 writes it into the contract as priority 2.

**Two hostnames, deliberately.** `127.0.0.1:3000` for Next, because since Node 17 `localhost` may
resolve to `::1` while `next dev` binds IPv4 and the symptom is `ECONNREFUSED` against a server
your browser loads fine. `localhost:8080` for WordPress, because `WP_HOME` is
`http://localhost:8080` and WordPress canonical-redirects anything else — including
`127.0.0.1:8080`, which would send your wp-admin login through a redirect that drops the POST.

**`serverActions.allowedOrigins` already contains both spellings**, from Lesson 15.5 Step 5:
`['localhost:3000', '127.0.0.1:3000']`. You verify it rather than add it. Miss the second entry
and every Server Action in the suite fails with `Invalid Server Actions request`, which reads
like a test bug and is a config bug — the browser's `Origin` header says `127.0.0.1:3000` because
`baseURL` does, and Next's Origin/Host check rejects it.

### 10. What this suite still cannot tell you

Stating the gaps is what stops the suite being oversold in a pull request six months from now.

| Not covered | Why not, and where it would go |
|---|---|
| A second browser engine | Chromium only. WebKit is two lines in `projects` and triples the wall clock for the same answer; add it when a WebKit bug has cost you something |
| Real CDN behaviour | Lesson 18.4's `s-maxage` and `stale-while-revalidate` are asserted with `curl` against `next start`, not an edge network. Only a deployment can test that |
| Concurrency in WordPress | one browser, one user. Two moderators approving the same incident is a race this suite cannot create, and Mailpit proves a mail was sent, not that it renders in Outlook |
| Anything after the redirect off-site | the HOBT funnel's `Start Now` leaves the origin; Lesson 16.4 asserts the URL parameters and stops there, correctly |

---

## Task

### Step 1: Confirm the preconditions, before you write a spec that assumes them

Four facts this lesson builds on already exist. Check them rather than discover them.

```bash
cd next-app

# 1. The state directory is already gitignored — Module 01, not this lesson.
git check-ignore -v e2e/.auth/reporter.json

# 2. Both spellings of the dev origin are already allowed — Lesson 15.5 Step 5.
grep -n "allowedOrigins" next.config.ts

# 3. The test-only hook exists and is armed in the Next runtime — Lesson 18.3 Step 5.
grep -c 'E2E_MODE' .env.local

# 4. The three fixture passwords and the purge secret are in THIS shell, not in a file.
for v in BTT_REPORTER_PASSWORD BTT_EDITOR_PASSWORD E2E_SECRET; do
  [ -n "${!v}" ] && echo "$v present" || echo "$v MISSING — appendix 04 §2"
done
```

**Verify §1:**

- [ ] Check 1 names a rule from the **root** `.gitignore`, around line 29
      (`next-app/e2e/.auth/`). If there is no output, stop and fix the ignore rule before any
      state file exists — a `storageState` file contains a live session cookie.
- [ ] Check 2 prints one line containing both `'localhost:3000'` and `'127.0.0.1:3000'`. If the
      second is absent, every Server Action in the suite will fail with
      `Invalid Server Actions request` and the message will not mention origins.
- [ ] Check 3 prints `2` — `E2E_MODE` and `E2E_SECRET`, in the Next runtime's `.env.local`.
- [ ] Check 4 prints three `present` lines. A `MISSING` here is a `setup` failure in thirty
      seconds' time with a clearer message; fix it now.

### Step 2: Write `e2e/auth.setup.ts`

Three setup tests, in a deliberate order: purge, then reporter, then editor. The purge goes first
because everything downstream reads pages.

```ts
// next-app/e2e/auth.setup.ts
// The root of the project graph. Runs in the `setup` project, before smoke,
// mutations and a11y — see playwright.config.ts.
//
// THREE jobs, in this order:
//   1. purge Next's caches, because e2e/global-setup.ts replaced the database
//      and Next has no idea (Key Concept 5). globalSetup cannot do this: it runs
//      BEFORE webServer, so there is no server to call yet.
//   2. log in as `reporter`   → e2e/.auth/reporter.json
//   3. log in as `editor`     → e2e/.auth/editor.json
//
// Credentials come from the INVOKING SHELL and nowhere else. Playwright does not
// read .env.local (Lesson 12.4 §9), and that is the safety property rather than a
// limitation. No dotenv import in this file, ever.
import { expect, test as setup } from '@playwright/test';

/** Written into a gitignored directory — root .gitignore, since Module 01. */
const REPORTER_STATE = 'e2e/.auth/reporter.json';
const EDITOR_STATE = 'e2e/.auth/editor.json';

const WP = 'http://localhost:8080';

/**
 * Read a required session variable, or fail with the variable's name.
 *
 * An empty string driven into a login form produces "invalid username or
 * password", which sends you to WordPress. Naming the missing variable sends you
 * to your shell, which is where the problem is.
 */
function fromShell(name: string): string {
  const value = process.env[name] ?? '';

  if (value === '') {
    throw new Error(
      `${name} is not set in the shell that ran Playwright. ` +
        `Export it for this session only — appendix 04 §2. Never write it to a file.`
    );
  }

  return value;
}

setup('purge the Next cache after the fixture import', async ({ request }) => {
  // Lesson 18.3's test-only branch. It 404s unless E2E_MODE=1 in the NEXT
  // runtime, then compares this header with timingSafeEqual. We do not rebuild
  // it; we use it, and Verification proves both refusals.
  const response = await request.post('/api/revalidate', {
    headers: { 'X-BTT-E2E-Secret': fromShell('E2E_SECRET') },
    // The only body this branch accepts. `revalidatePath('/', 'layout')` is the
    // sledgehammer, and a database import is the one event that justifies it.
    data: { type: 'all' },
  });

  // A 404 here means E2E_MODE is not '1' in .env.local — the Next runtime's
  // copy, not your shell's. A 401 means the two E2E_SECRET values disagree.
  expect(
    response.status(),
    '404 = E2E_MODE is not 1 in next-app/.env.local. 401 = E2E_SECRET differs between ' +
      '.env.local (read by Next) and this shell (read by Playwright).'
  ).toBe(200);

  expect(await response.json()).toEqual({ revalidated: ['*'] });
});

setup('authenticate as reporter', async ({ page }) => {
  const password = fromShell('BTT_REPORTER_PASSWORD');

  await page.goto('/en/login');

  await page.getByRole('textbox', { name: /username|email/i }).fill('reporter');
  // The documented exception: <input type="password"> exposes no ARIA role, so
  // getByRole('textbox') cannot match it in any browser. Key Concept 9.
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  // Assert the SESSION, not the navigation. Lesson 15.5 gates /en/account, so
  // reaching it without a redirect is proof that btt_at was set and accepted.
  // Asserting "we left /en/login" would also pass on an error page.
  await page.goto('/en/account');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/en/account');

  await page.context().storageState({ path: REPORTER_STATE });
});

setup('authenticate as editor, in wp-admin', async ({ page }) => {
  const password = fromShell('BTT_EDITOR_PASSWORD');

  // localhost:8080, NOT 127.0.0.1:8080. WP_HOME is http://localhost:8080 and
  // WordPress canonical-redirects anything else — through a redirect that would
  // drop this POST. Key Concept 9.
  await page.goto(`${WP}/wp-login.php`);

  await page.getByRole('textbox', { name: /username or email/i }).fill('editor');
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole('button', { name: /log in/i }).click();

  // The incident list screen exists only for a user who can edit incidents, so
  // this asserts the capability as well as the session.
  await page.goto(`${WP}/wp-admin/edit.php?post_type=incident`);
  await expect(page.getByRole('heading', { level: 1, name: /Incidents/i })).toBeVisible();

  await page.context().storageState({ path: EDITOR_STATE });
});
```

**Verify §2:**

- [ ] `npm run type-check` is silent, and `grep -c dotenv e2e/auth.setup.ts` returns `0`.
- [ ] No literal credential: `grep -nE "(password|secret)\s*[:=]\s*['\"][^'\"$]{8,}" e2e/auth.setup.ts`
      prints nothing.

### Step 3: Insert `setup` and `mutations` into `playwright.config.ts`

The file already holds `testDir`, `fullyParallel`, `forbidOnly`, `retries`, the conditional
`workers` spread, `reporter`, `use`, `globalSetup` and `webServer` from Lessons 12.3 and 12.4 —
**leave all of that exactly as it is.** The `a11y` project arrived in Lesson 22.4. Your edit is
the `projects` array and one constant above it.

**One thing here reverses an earlier decision, so it gets said out loud rather than slipped in.**
Lesson 22.4 gave `smoke` a `testIgnore: /a11y\.spec\.ts/` and spent a Control Question defending
that over an explicit allowlist — with two projects and one excluded file, an ignore list lets a
new read-only spec join `smoke` by existing rather than by being listed. **That was correct for a
two-project config and it stops being correct here.** Two of the projects you are adding hold
specs that must *leave* `smoke`, so the ignore list would grow to
`/a11y|funnel|moderation|preview|incident-leakage/`: five names, negated, on one line, where a
typo silently un-excludes a mutation spec into the parallel read project and produces exactly the
interleaving failure Key Concept 3 is about. An allowlist fails the other way — a forgotten spec
matches no project and `--list` shows it missing, loudly. **When the excluded set grows faster
than the included set, invert the rule.** That is the same argument in the other direction, not a
contradiction of it, and Verification check 4 asserts `testIgnore` is gone rather than leaving two
mechanisms free to disagree.

```ts
// next-app/playwright.config.ts — add above `export default defineConfig({`
/**
 * Written by e2e/auth.setup.ts, read by every authenticated project. The
 * directory is gitignored in the ROOT .gitignore (Module 01) because these files
 * hold live session cookies.
 */
const REPORTER_STATE = 'e2e/.auth/reporter.json';
```

```ts
// next-app/playwright.config.ts — REPLACE the `projects` array
  //
  // FROZEN ORDER: setup, smoke, mutations, a11y. `a11y` arrived in Lesson 22.4
  // with no `dependencies` key, because `setup` did not exist yet; this lesson
  // adds the key and the storage state it needs for /en/incidents/submit.
  //
  // The NAMES are a contract. Module 23's Starting State runs --project=smoke
  // and --project=a11y; appendix 07 §5 lists --project=mutations.
  projects: [
    {
      // The root of the graph. Purges the cache, then mints one state file per
      // role. Every other project depends on it.
      name: 'setup',
      testMatch: /.*\.setup\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // READ-ONLY, and ANONYMOUS on purpose. The public archive rendered for a
      // logged-in reporter is not the artefact the public receives. It still
      // depends on `setup`, because `setup` is what purges the cache.
      //
      // testMatch REPLACES Lesson 22.4's `testIgnore: /a11y\.spec\.ts/`. With
      // two projects an ignore list was the right call and 22.4 argued it well;
      // with four it would need five names in a negative, and a typo there
      // silently un-excludes a mutation spec into this parallel project. An
      // allowlist fails loudly instead. See the prose above Step 3.
      name: 'smoke',
      testMatch: ['**/smoke.spec.ts', '**/i18n.spec.ts'],
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // WRITES. Two workers publishing incidents into one database interleave,
      // and the failure reproduces only under concurrency — the most expensive
      // signature there is. Key Concept 3.
      //
      // `fullyParallel: false` serialises tests WITHIN a file. There is no
      // per-project `workers` option in Playwright's TestProject, so the
      // cross-FILE guarantee comes from the top-level `workers` (1 in CI, and
      // `--workers=1` locally). Each mutation spec also opens with
      // test.describe.configure({ mode: 'serial' }).
      name: 'mutations',
      testMatch: [
        '**/moderation.spec.ts',
        '**/preview.spec.ts',
        // Lesson 16.4's funnel spec, moved here from `smoke` exactly as that
        // lesson promised. The FILE is not edited — see Step 7.
        '**/funnel.spec.ts',
        // Lesson 23.9 writes this one. Listing the glob now costs nothing and
        // is cheaper than the alternative: a spec that matches no project is
        // silently never run, and `--list` is the only thing that would notice.
        '**/incident-leakage.spec.ts',
      ],
      dependencies: ['setup'],
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'], storageState: REPORTER_STATE },
    },
    {
      // Lesson 22.4's project. Its `testMatch` regex is left EXACTLY as that
      // lesson wrote it — normalising it to a glob for cosmetic consistency
      // would change bytes in somebody else's project to match no new
      // behaviour. The only additions here are `dependencies` and the storage
      // state, which /en/incidents/submit needs because Lesson 15.5 gates it.
      name: 'a11y',
      testMatch: /a11y\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: REPORTER_STATE },
    },
  ],
```

> **A debt recorded rather than paid.** With `storageState` set on `a11y`, the in-spec login that
> Lesson 22.3 wrote into `a11y.spec.ts` is now redundant. It is harmless — logging in while
> already logged in is idempotent — and this lesson does **not** delete it, because that file
> belongs to Lesson 22.4 and reaching into another lesson's deliverable to tidy it is how two
> lessons come to disagree about the same file. Delete it in the pull request that next touches
> `a11y.spec.ts`, and note that its removal is what makes the `a11y` project's dependency
> load-bearing rather than merely correct.

**Verify §3:**

- [ ] `npm run type-check` is silent. If it complains about `workers` inside a project object,
      you wrote the brief's shorthand rather than Key Concept 3's mechanism.
- [ ] `npx playwright test --list --project=setup` prints **3** tests.
- [ ] `npx playwright test --list --project=smoke` and `--project=a11y` both resolve. Those two
      names are in Module 23's Starting State; a "project not found" here breaks the module you
      are standing in.
- [ ] `grep -c 'testIgnore' playwright.config.ts` is now **0** and
      `npx playwright test --list | grep -c 'a11y.spec.ts'` is still **25**. Lesson 22.4 asserted
      `1` and `25`; the second is the property that mattered, and the allowlist preserves it.
- [ ] `a11y`'s `testMatch` still reads `/a11y\.spec\.ts/` — Lesson 22.4's regex, unchanged. You
      added two keys to that object and altered none.

### Step 4: Write `e2e/moderation.spec.ts`

The full loop, plus the resilience case Lesson 18.4 Step 8 handed forward.

```ts
// next-app/e2e/moderation.spec.ts
// The moderation loop, end to end: a reporter submits (pending) → a moderator
// publishes in real wp-admin → the real HMAC webhook fires → the PUBLIC ARCHIVE
// shows it.
//
// This spec runs in the `mutations` project, so it starts authenticated as
// `reporter` from e2e/.auth/reporter.json. The editor arrives as a SECOND browser
// context, because one test needs two sessions and storageState is per context.
//
// Locators: getByRole + accessible name. No data-testid, no CSS chain, no
// nth-child, no XPath — Lesson 23.7 turns that into an ESLint rule.
import { execFileSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

const WP = 'http://localhost:8080';
const EDITOR_STATE = 'e2e/.auth/editor.json';

/** Serial: these tests share one database and must not interleave. */
test.describe.configure({ mode: 'serial' });

/** Purge Next's caches through Lesson 18.3's test-only branch. */
async function purge(request: import('@playwright/test').APIRequestContext): Promise<void> {
  const response = await request.post('/api/revalidate', {
    headers: { 'X-BTT-E2E-Secret': process.env.E2E_SECRET ?? '' },
    data: { type: 'all' },
  });

  expect(response.status(), 'the test-only purge branch must answer 200').toBe(200);
}

test.describe('moderation reaches the public archive', () => {
  test('a pending submission becomes visible only after a moderator publishes it', async ({
    page,
    request,
    browser,
  }) => {
    // Two applications, two sessions, a webhook and a cache. Slow on purpose
    // rather than flaky on purpose.
    test.setTimeout(150_000);

    // Derived from what the spec types, not guessed, and unique so WordPress
    // never appends `-2` and the assertion cannot drift.
    const runId = Date.now().toString(36);
    const title = `Moderation probe ${runId}`;
    const slug = `moderation-probe-${runId}`;

    // ── 1. SUBMIT, as the reporter the storage state logged in ────────
    await page.goto('/en/incidents/submit');
    await expect(page.getByRole('heading', { level: 1, name: 'Submit an incident' })).toBeVisible();

    await page.getByRole('textbox', { name: 'What happened' }).fill(title);
    await page
      .getByRole('textbox', { name: 'The full story' })
      .fill('Reproduced by e2e/moderation.spec.ts.');

    await page.getByRole('combobox', { name: 'Who is to blame' }).click();
    await page.getByRole('option', { name: 'The Intern' }).click();
    await page.getByRole('combobox', { name: 'How bad' }).click();
    await page.getByRole('option', { name: 'S2 — Major' }).click();

    await page.getByRole('textbox', { name: 'When it happened' }).fill('2024-06-01T09:00');
    await page.getByRole('spinbutton', { name: 'Downtime (minutes)' }).fill('42');

    await page.getByRole('button', { name: 'Submit for review' }).click();
    await expect(page.getByRole('heading', { name: 'Queued for review' })).toBeVisible();

    // ── 2. NEGATIVE: pending is invisible, to everyone, everywhere ────
    // Purge FIRST. Without it a stale archive entry would make this pass for
    // the wrong reason — and passing for the wrong reason is how a negative
    // assertion rots. Key Concept 5.
    await purge(request);

    const anonymous = await browser.newContext();

    try {
      const anonymousPage = await anonymous.newPage();

      // WPGraphQL's model layer restricts a non-published node to a user who can
      // read it, so the detail route resolves null and Next answers 404.
      const detail = await anonymousPage.goto(`/en/incidents/${slug}`);
      expect(detail?.status(), 'a pending incident must 404 for the public').toBe(404);

      await anonymousPage.goto('/en/incidents');
      await expect(anonymousPage.getByRole('link', { name: title })).toHaveCount(0);
    } finally {
      await anonymous.close();
    }

    // ── 3. PUBLISH, as a real editor, in real wp-admin ────────────────
    const editor = await browser.newContext({ storageState: EDITOR_STATE });

    try {
      const editorPage = await editor.newPage();

      // The queue defaults to post_status=pending for anyone who can publish
      // (Lesson 03.4), so no query string is needed — which is itself an
      // assertion about step 1.
      await editorPage.goto(`${WP}/wp-admin/edit.php?post_type=incident`);

      const row = editorPage.getByRole('row', { name: new RegExp(title) });
      await expect(row).toBeVisible();

      // WordPress hides .row-actions until the row is hovered or focused, so a
      // bare click times out waiting for a visible element. Hover is a
      // user-facing interaction; a CSS locator would not be.
      await row.hover();
      await row.getByRole('link', { name: 'Approve' }).click();

      await expect(editorPage.getByRole('row', { name: new RegExp(title) })).toHaveCount(0);
    } finally {
      await editor.close();
    }

    // ── 4. THE PUBLIC ARCHIVE, through the REAL webhook ───────────────
    // No purge here, and that is the point of the assertion. Publishing fired
    // Lesson 18.3's HMAC-signed webhook, which called revalidateTag('incidents')
    // — the tag /en/incidents carries. If this fails while step 5 passes, the
    // webhook did not arrive, and the first thing to check is
    // `extra_hosts: host.docker.internal` (Lesson 02.2 §7).
    await page.goto('/en/incidents');
    await expect(page.getByRole('link', { name: title })).toBeVisible();

    // ── 5. And the detail route, which now resolves for anyone ────────
    const published = await page.goto(`/en/incidents/${slug}`);
    expect(published?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  });
});

test.describe('resilience: the front end survives WordPress being down', () => {
  // Lesson 18.4 Step 8 promised this spec to Lesson 23.6 and named the reason it
  // belongs here: it manipulates shared infrastructure, so it cannot run beside
  // the read specs. It lives in THIS file rather than its own because it needs
  // exactly the same isolation for exactly the same reason; give it its own file
  // the moment there is a second resilience case.
  test('a cached route still renders with WordPress stopped, and never 500s', async ({
    page,
    request,
  }) => {
    test.slow();

    const compose = (args: readonly string[]): void => {
      execFileSync('docker', ['compose', ...args], {
        cwd: '../wordpress-headless',
        stdio: 'inherit',
      });
    };

    // Warm the entry first. A cold route with no upstream is a 503 from
    // /api/health and a degraded render — which is also correct behaviour, and a
    // different test.
    await page.goto('/en/incidents');
    await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).toBeVisible();

    compose(['stop', 'wordpress']);

    try {
      const response = await page.goto('/en/incidents');

      // 200 from the cache. NOT a 500, and not an exception page: Lesson 18.4's
      // stale-on-error behaviour is what a real outage looks like from outside.
      expect(response?.status(), 'a warm route must not 500 when WordPress is down').toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).toBeVisible();

      // And the honest half: the health endpoint tells the truth about it.
      const health = await request.get('/api/health');
      expect(health.status(), '/api/health reports degraded upstreams — Lesson 09.5').toBe(503);
    } finally {
      // In `finally`, so a failed assertion does not leave the container
      // stopped and every later spec failing for an unrelated reason.
      compose(['start', 'wordpress']);
    }
  });
});
```

**Verify §4:**

- [ ] `npx playwright test --list --project=mutations e2e/moderation.spec.ts` prints **2** tests.
- [ ] The `finally` block restarting `wordpress` is present. Without it, one failed assertion
      leaves your stack down and the next twenty specs fail with messages about GraphQL.
- [ ] `grep -c 'waitForTimeout' e2e/moderation.spec.ts` returns `0`.

### Step 5: Write `e2e/preview.spec.ts`

```ts
// next-app/e2e/preview.spec.ts
// Draft preview, and its negative. Lesson 17.2 built the mechanism; this spec is
// the proof that the whole chain still works: wp-admin → preview_post_link →
// /api/preview → /wp-json/btt/v1/preview/verify → a preview JWT in an httpOnly
// cookie → draftMode() → asPreview: true → the same BlockRenderer.
//
// Runs in `mutations`: it creates a draft, which is a write.
import { execFileSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

const WP = 'http://localhost:8080';
const EDITOR_STATE = 'e2e/.auth/editor.json';

test.describe.configure({ mode: 'serial' });

/** One WP-CLI call through the `wpcli` service. The stock image has no `wp`. */
function wp(args: readonly string[]): string {
  return execFileSync('docker', ['compose', 'run', '--rm', '-T', 'wpcli', 'wp', ...args], {
    cwd: '../wordpress-headless',
    encoding: 'utf8',
  })
    .replace(/\r/g, '')
    .trim();
}

/**
 * Create a draft incident and return its numeric ID.
 *
 * WP-CLI rather than the block editor. The subject of this spec is PREVIEW, not
 * Gutenberg, and driving the editor to save a draft would make a preview failure
 * indistinguishable from an editor failure. `--porcelain` prints the ID alone.
 *
 * The author is resolved from the LOGIN, never written as an ID: auto-increment
 * values differ between two runs of the seeder, and Lesson 12.4's determinism
 * rules are "reference content by slug, never by ID" for exactly this reason.
 */
function createDraft(title: string): string {
  const authorId = wp(['user', 'get', 'editor', '--field=ID']);

  return wp([
    'post',
    'create',
    `--post_title=${title}`,
    '--post_type=incident',
    '--post_status=draft',
    `--post_author=${authorId}`,
    '--porcelain',
  ]);
}

test.describe('an editor previews an unpublished draft', () => {
  test.use({ storageState: EDITOR_STATE });

  test('Preview renders the draft, and Exit preview puts it back', async ({ page }) => {
    test.setTimeout(120_000);

    const runId = Date.now().toString(36);
    const title = `Preview probe ${runId}`;
    const postId = createDraft(title);

    // The edit screen's Preview control points at whatever the
    // preview_post_link filter returned — Lesson 17.2 Step 3 rewrote it to
    // /api/preview on the Next origin with a single-use token.
    await page.goto(`${WP}/wp-admin/post.php?post=${postId}&action=edit`);

    // waitForEvent BEFORE the click: attach the listener first or the tab has
    // already opened by the time you listen. Same ordering rule as Lesson 12.3's
    // console listener.
    const opened = page.context().waitForEvent('page');

    // `incident` supports `editor` and `show_in_rest` (appendix 03 §1), so this
    // is the BLOCK editor, where Preview is a button that opens a menu. The
    // classic editor renders the same accessible name as a link. Match either,
    // then take the menu item only if a menu appeared — count(), not click(),
    // because on the classic editor there is nothing to click.
    //
    // Reasoned against Gutenberg's current markup rather than executed here. If
    // neither locator resolves, read the href instead:
    //   wp post get <id> --field=id  then  wp eval 'echo get_preview_post_link(<id>);'
    await page
      .getByRole('button', { name: /^preview$/i })
      .or(page.getByRole('link', { name: /^preview$/i }))
      .first()
      .click();

    const inNewTab = page.getByRole('menuitem', { name: /preview in new tab/i });

    if ((await inNewTab.count()) > 0) {
      await inNewTab.click();
    }

    const previewPage = await opened;

    await previewPage.waitForLoadState();

    // The draft's own content, from a post that has no published version at all.
    await expect(previewPage.getByRole('heading', { level: 1, name: title })).toBeVisible();

    // Unmissable state, as Lesson 17.2 requires. role="complementary" is what
    // <aside> exposes, and the banner is the only one on the page.
    const banner = previewPage.getByRole('complementary').filter({ hasText: 'Draft preview' });
    await expect(banner).toBeVisible();

    // Next's own cookie, set by draftMode().enable(). Asserted by NAME rather
    // than by value: the value is Next's preview-mode id and is none of our
    // business (Lesson 17.2 §2).
    const cookies = await previewPage.context().cookies();
    expect(cookies.map((c) => c.name)).toContain('__prerender_bypass');

    // A preview response must never be cached, by us or by anything in front.
    const headers = (await previewPage.reload())?.headers() ?? {};
    expect(headers['cache-control'] ?? '').toContain('no-store');

    // The way out. A real document request, because the route handler's
    // Set-Cookie has to be applied — which is why Lesson 17.2 used a plain <a>.
    await banner.getByRole('link', { name: 'Exit preview' }).click();
    await expect(previewPage.getByRole('complementary').filter({ hasText: 'Draft preview' })).toHaveCount(0);
  });
});

test.describe('without a preview cookie the draft does not exist', () => {
  // A DELIBERATELY EMPTY context. `mutations` sets storageState on the project,
  // so a spec that wants anonymity has to say so — and this negative is
  // worthless run with a session.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('NEGATIVE: an anonymous visitor gets 404 for a draft, and no preview cookie', async ({
    page,
  }) => {
    const runId = Date.now().toString(36);
    const title = `Preview negative ${runId}`;

    // The draft's ID is not needed: the negative is about the PUBLIC route, and
    // the public route is addressed by slug.
    createDraft(title);

    // Derived from the title the way WordPress derives it, so the URL is the one
    // an editor would share.
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const response = await page.goto(`/en/incidents/${slug}`);

    // 404, not 403 and not an empty 200. WordPress's own edit_post capability
    // check is the authority here — Next never decides who may see a draft
    // (Lesson 17.2 §9) — and an unauthorised reader is told the node does not
    // exist, which is the only answer that leaks nothing.
    expect(response?.status(), 'a draft must not be readable without a preview session').toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'No such incident.' })).toBeVisible();

    const cookies = await page.context().cookies();
    expect(cookies.map((c) => c.name)).not.toContain('__prerender_bypass');
    expect(cookies.map((c) => c.name)).not.toContain('btt_preview_jwt');

    // And the entry point itself refuses an unauthenticated caller.
    const bare = await page.goto('/api/preview');
    expect(bare?.status(), '/api/preview with no token must not enable draft mode').toBe(401);
  });
});
```

**Verify §5:**

- [ ] `npx playwright test --list e2e/preview.spec.ts` prints **2** tests.
- [ ] The negative describe carries `test.use({ storageState: { cookies: [], origins: [] } })`.
      Without it the project's reporter session applies and the negative proves nothing.
- [ ] `grep -c 'getByLabel' e2e/preview.spec.ts` returns `0` — there is no password field in this
      file, because both sessions arrive as state.

### Step 6: Write `e2e/i18n.spec.ts`

```ts
// next-app/e2e/i18n.spec.ts
// Three locales, two correct 307s, and a switcher whose disabled state only
// exists after hydration.
//
// Runs in `smoke`: reads only, anonymous, fullyParallel.
import { expect, test } from '@playwright/test';

/**
 * Seeded slugs, from Lesson 20.1's translation matrix (appendix 03 §9).
 * 40 English, the first 10 translated to German, the first 5 to Ukrainian.
 */
const TRANSLATED = { en: 'incident-01', de: 'incident-01-de', uk: 'відмова-01' } as const;

/** English-only: number 40 is outside the translated range, on purpose. */
const ENGLISH_ONLY = 'incident-40';

test.describe('every locale serves its own list', () => {
  for (const [locale, heading] of [
    ['en', 'Incidents'],
    ['de', 'Vorfälle'],
    ['uk', 'Інциденти'],
  ] as const) {
    test(`/${locale}/incidents renders in ${locale} and does not redirect`, async ({ page }) => {
      const response = await page.goto(`/${locale}/incidents`);

      expect(response?.status(), `/${locale}/incidents must be a 200, not a redirect`).toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();

      // Lesson 09.1 set lang; Lesson 20.3 added dir. Both are per-locale facts
      // that regress silently the first time somebody hard-codes one.
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
    });
  }
});

test.describe('the untranslated-content policy, both branches', () => {
  test('a translated node 307s to the GERMAN url, not to English', async ({ request }) => {
    const response = await request.get(`/de/incidents/${TRANSLATED.en}`, { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    expect(response.headers()['location'] ?? '').toContain(`/de/incidents/${TRANSLATED.de}`);
  });

  test('an untranslated node 307s to English and says why', async ({ page, request }) => {
    const response = await request.get(`/de/incidents/${ENGLISH_ONLY}`, { maxRedirects: 0 });

    // 307 to the DEFAULT locale with ?from=de. Lesson 20.2 §8 chose this over a
    // 404 and over rendering English under a German URL, because it is the only
    // one of the three where the URL and the content agree.
    expect(response.status()).toBe(307);
    expect(response.headers()['location'] ?? '').toContain(
      `/en/incidents/${ENGLISH_ONLY}?from=de`
    );

    // The visible half. role="status", not role="alert": the notice is advisory
    // and must not interrupt a screen reader mid-sentence (Lesson 11.4's rule).
    await page.goto(`/en/incidents/${ENGLISH_ONLY}?from=de`);
    await expect(page.getByRole('status')).toContainText(/Deutsch/);
  });

  test('NEGATIVE: the same page without ?from= shows no notice at all', async ({
    page,
    request,
  }) => {
    await page.goto(`/en/incidents/${ENGLISH_ONLY}`);
    await expect(page.getByRole('status')).toHaveCount(0);

    // And it claims no German alternate, because there is no German URL to
    // point at. Two mechanisms making one claim is how they drift.
    //
    // Asserted on the SERVER HTML rather than through a DOM query. <link> is
    // not in the accessibility tree, so there is no role-based locator for it —
    // and `page.locator('link[rel=…]')` is exactly the CSS-attribute chain
    // Lesson 23.7's rule bans. Reading the response body needs no exception.
    const html = await (await request.get(`/en/incidents/${ENGLISH_ONLY}`)).text();
    expect(html).not.toContain('hreflang="de"');
  });
});

test.describe('the locale switcher', () => {
  test('preserves the translated slug AND the query string', async ({ page }) => {
    // The filtered list is the case that matters: a switcher that resets the
    // filter sends a German reader back to page one of everything.
    await page.goto('/en/incidents?scapegoat=the-intern');

    const nav = page.getByRole('navigation', { name: 'Language' });
    await expect(nav).toBeVisible();

    await nav.getByRole('link', { name: 'Deutsch' }).click();

    await expect(page).toHaveURL(/\/de\/incidents\?scapegoat=the-intern$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Vorfälle' })).toBeVisible();
  });

  test('marks the current locale with aria-current, not with a colour', async ({ page }) => {
    await page.goto('/en/incidents');

    const nav = page.getByRole('navigation', { name: 'Language' });

    // The current locale is a <span aria-current="true">, not a link — there is
    // nowhere to navigate to. So it is NOT addressable as a link, and that is
    // the assertion.
    await expect(nav.getByRole('link', { name: 'English' })).toHaveCount(0);
    await expect(nav.getByText('English')).toHaveAttribute('aria-current', 'true');
  });

  test('renders an unavailable locale as a DISABLED button, after hydration', async ({ page }) => {
    await page.goto(`/en/incidents/${ENGLISH_ONLY}`);

    const nav = page.getByRole('navigation', { name: 'Language' });

    // A web-first assertion, and here that is not a style preference. A layout
    // cannot see its child route's data (Lesson 20.3 §8), so the switcher
    // server-renders every locale as AVAILABLE and corrects itself in an effect
    // by reading the hreflang cluster out of the document (Lesson 20.4). The
    // server HTML therefore shows Deutsch as a link. `expect(locator)` retries
    // until hydration lands; `expect(await locator.isDisabled())` would resolve
    // one boolean too early and fail on a fast machine.
    const german = nav.getByRole('button', { name: /Deutsch/ });
    await expect(german).toBeDisabled();

    // DISABLED, never hidden: a missing option is indistinguishable from a bug,
    // and the accessible name carries the reason.
    await expect(german).toHaveAccessibleName(/not available/i);
  });
});
```

**Verify §6:**

- [ ] `npx playwright test --project=smoke e2e/i18n.spec.ts` is 9 passed.
- [ ] `grep -c 'isDisabled()' e2e/i18n.spec.ts` returns `0`. If you reached for it, reread the
      comment in the last test.
- [ ] The Cyrillic slug in `TRANSLATED.uk` survived your editor. `grep -c 'відмова' e2e/i18n.spec.ts`
      returns `1`.

### Step 7: Move `funnel.spec.ts` into `mutations`, without editing it

Lesson 16.4 promised this and Step 3 already delivered it: `funnel.spec.ts` is in the
`mutations` project's `testMatch` and therefore no longer runs under `smoke`. **The spec file
itself is not edited.** It keeps driving the login form, because its subject is the journey from
anonymous visitor to published incident, and Key Concept 2 is why that is worth its four seconds.

```bash
cd next-app

# It moved projects, and it moved exactly once.
npx playwright test --list e2e/funnel.spec.ts

# And the file is untouched by this lesson.
git diff --stat e2e/funnel.spec.ts
```

**Verify §7:**

- [ ] The listing shows `funnel.spec.ts` under `[mutations]` and under no other project. Two
      entries means a `testMatch` glob overlaps — most likely `smoke`'s.
- [ ] `git diff --stat e2e/funnel.spec.ts` prints nothing.
- [ ] `grep -c 'BTT_REPORTER_PASSWORD' e2e/funnel.spec.ts` still returns `1`. That spec reads the
      credential itself, and it is now the only spec that does besides `auth.setup.ts`.

### Step 8: Run all four projects, in order, and commit

```bash
cd next-app

# The reset first: fixture import, then the cache purge that `setup` performs.
npm run e2e:reset

# --workers=1 is the cross-file half of Key Concept 3's isolation, and it is in
# the command rather than in the config because Playwright has no per-project
# workers option. In CI the top-level `workers: 1` already covers it.
E2E_MODE=1 \
E2E_SECRET="$E2E_SECRET" \
BTT_REPORTER_PASSWORD="$BTT_REPORTER_PASSWORD" \
BTT_EDITOR_PASSWORD="$BTT_EDITOR_PASSWORD" \
  npx playwright test --workers=1

npm run type-check && npm run lint
git add -A
git commit -m "test(e2e): storage-state auth, mutation isolation, preview and locale routing"
```

**Verify §8:**

- [ ] The `setup` project runs first and reports 3 passed, then the other three run.
- [ ] `git status --short` shows **no** `e2e/.auth/` entries. Those files hold live session
      cookies; if they appear, the root ignore rule is broken and Step 1 lied to you.
- [ ] `npx playwright show-report` lists four projects. Every test names the project it ran in,
      which is what makes a failure in `mutations` diagnosable.

---

## Verification

```bash
cd next-app

# 1. Types and lint, including e2e/
npm run type-check && npm run lint
# Expected: no output

# 2. The four projects exist, in the FROZEN order
grep -n "name: '" playwright.config.ts
# Expected: setup, smoke, mutations, a11y — in that order, and nothing else

# 3. NEGATIVE — no `workers` key inside a project object. TestProject has no such
#    option, so this would be a type error, not a slow suite.
sed -n '/projects: \[/,/^  \],/p' playwright.config.ts | grep -c 'workers'
# Expected: 0

# 4. NEGATIVE — Lesson 22.4's `testIgnore` on `smoke` is GONE, replaced by the
#    allowlist. Leaving both would leave two mechanisms free to disagree, and
#    the one that loses is the negative — 22.4's Verification asserted this
#    count was 1, and this lesson is where it becomes 0. See the prose at Step 3.
grep -c 'testIgnore' playwright.config.ts
# Expected: 0

# 4b. ...and the a11y scans still run exactly ONCE, which is what `testIgnore`
#     was protecting. An allowlist protects it structurally: a11y.spec.ts is not
#     in `smoke`'s testMatch, so it cannot match twice.
npx playwright test --list | grep -c 'a11y.spec.ts'
# Expected: 25 — Lesson 22.4's 23 scans plus its 2 regression tests, each listed
#           once. 50 means a11y.spec.ts is matching `smoke` as well.

# 4c. NEGATIVE — and no spec matches TWO projects. This is the failure mode the
#     allowlist trades for: a forgotten spec matches NONE and shows up missing,
#     which is loud, rather than matching an extra one, which is silent.
npx playwright test --list | grep -oE '\[(setup|smoke|mutations|a11y)\] › [^ ]+' \
  | awk '{print $3}' | sort | uniq -d
# Expected: no output — every spec file belongs to exactly one project

# 4d. NEGATIVE — nor does any spec match NONE. Count the files on disk against
#     the files the four projects between them collect.
ls -1 e2e/*.spec.ts | wc -l
# Expected: the same number as the unique filenames in check 4c's listing.
#           A mismatch names a spec that is silently never run.

# 5. Mutation isolation is configured on `mutations` and NOWHERE else
grep -c 'fullyParallel: false' playwright.config.ts
# Expected: 1
grep -c "mode: 'serial'" e2e/moderation.spec.ts e2e/preview.spec.ts
# Expected: 1 for each file

# 5b. Every project except `setup` depends on it
grep -c "dependencies: \['setup'\]" playwright.config.ts
# Expected: 3 — smoke, mutations, a11y. Lesson 22.4 asserted this count was 0,
#           because `setup` did not exist yet and a dangling dependency fails
#           with "project setup not found".

# 6. The Starting State contract still holds. Both of these names are run by
#    Module 23's own Starting State; a rename breaks the module you are in.
npx playwright test --list --project=smoke > /dev/null && echo 'smoke resolves'
npx playwright test --list --project=a11y  > /dev/null && echo 'a11y resolves'
# Expected: smoke resolves / a11y resolves

# 7. The setup project is three tests, and the first one is the purge
npx playwright test --list --project=setup
# Expected: 3 tests — purge, reporter, editor

# 8. NEGATIVE — no dotenv anywhere in the harness. The interlock is armed from
#    the shell you typed in, and a destructive setup that arms itself from a
#    dotfile is one `git pull` away from dropping a colleague's database.
grep -c 'dotenv' playwright.config.ts e2e/global-setup.ts e2e/auth.setup.ts
# Expected: 0 for all three files

# 9. NEGATIVE — no credential literal in any spec or in the config
grep -rnE "(pass(word)?|secret|token)[[:space:]]*[:=][[:space:]]*['\"][^'\"$]{8,}" e2e/ playwright.config.ts \
  || echo 'no literal credential — correct'
# Expected: no literal credential — correct

# 10. NEGATIVE — not one fragile locator in the whole suite
grep -rn 'data-testid\|nth-child\|xpath=' e2e/ ; echo "exit=$?"
# Expected: no output, exit=1

# 11. NEGATIVE — and not one sleep
grep -rc 'waitForTimeout' e2e/ | grep -v ':0$' || echo 'no waitForTimeout — correct'
# Expected: no waitForTimeout — correct

# 12. getByLabel appears ONLY for password fields
grep -rn 'getByLabel' e2e/
# Expected: three hits in funnel.spec.ts (Lesson 16.4) and two in auth.setup.ts.
#           Anything else means a locator that should have been getByRole.

# 13. The state files were written, and they are IGNORED
ls -1 e2e/.auth/
# Expected: editor.json  reporter.json
git check-ignore -v e2e/.auth/reporter.json
# Expected: a rule from the root .gitignore, around line 29
git status --short | grep -c '\.auth/'
# Expected: 0

# 14. NEGATIVE — a request with NO test header is not a test-hook request at
#     all. It falls through to the SIGNED path (Lesson 18.3 Step 4 reads the
#     header first and dispatches on its presence), where the missing
#     X-BTT-Timestamp is a 400. Read the branch order before predicting 404.
npm run dev > /tmp/btt-dev.log 2>&1 & DEV_PID=$!
until curl -sf -o /dev/null http://127.0.0.1:3000/api/health; do :; done
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/api/revalidate \
  -H 'Content-Type: application/json' -d '{"type":"all"}'
# Expected: 400 — and NOT 404. The four statuses are per condition, not per
#           request: 404 when the branch is disabled, 401 for a bad secret,
#           400 for a bad payload. Lesson 18.3 §10's table.

# 15. NEGATIVE — the header is present and WRONG: 401, with no body. The hook
#     exists and you are not authorised, and the response says nothing else.
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/api/revalidate \
  -H 'Content-Type: application/json' -H 'X-BTT-E2E-Secret: wrong' \
  -d '{"type":"all"}'
# Expected: 401

# 16. ...and the RIGHT secret works, which is what makes 15 and 17 meaningful
curl -s -X POST http://127.0.0.1:3000/api/revalidate \
  -H 'Content-Type: application/json' -H "X-BTT-E2E-Secret: $E2E_SECRET" \
  -d '{"type":"all"}'
# Expected: {"revalidated":["*"]}

# 17. NEGATIVE — a wrong BODY with a right secret is a 400. A credential is not
#     a schema, and the two failures must not share a status code.
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/api/revalidate \
  -H 'Content-Type: application/json' -H "X-BTT-E2E-Secret: $E2E_SECRET" \
  -d '{"type":"everything"}'
# Expected: 400
kill "$DEV_PID"

# 17b. NEGATIVE, AND THE ONE THAT MATTERS — with the branch DISABLED, the
#      endpoint 404s even for the correct secret. In production this code path
#      does not exist and the response is indistinguishable from one that was
#      never written; a 401 would answer "does this deployment have a test
#      hook?", and that question should not have an answer.
sed -i.bak '/^E2E_MODE=/d' .env.local
npm run dev > /tmp/btt-dev-disarmed.log 2>&1 & DEV_PID=$!
until curl -sf -o /dev/null http://127.0.0.1:3000/api/health; do :; done
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/api/revalidate \
  -H 'Content-Type: application/json' -H "X-BTT-E2E-Secret: $E2E_SECRET" \
  -d '{"type":"all"}'
# Expected: 404
kill "$DEV_PID"
mv .env.local.bak .env.local
grep -c 'E2E_MODE' .env.local
# Expected: 1 — restored from the .bak, never with git

# 18. Both spellings of the dev origin are allowed — Lesson 15.5, verified not added
grep -o "'127.0.0.1:3000'" next.config.ts
# Expected: '127.0.0.1:3000'
grep -c 'allowedOrigins' next.config.ts
# Expected: 1

# 19. The locale policy, both branches, without a browser
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/de/incidents/incident-01
# Expected: 307 http://localhost:3000/de/incidents/incident-01-de
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/de/incidents/incident-40
# Expected: 307 http://localhost:3000/en/incidents/incident-40?from=de

# 20. NEGATIVE — no hreflang="de" is claimed for an English-only node
curl -s http://localhost:3000/en/incidents/incident-40 | grep -c 'hreflang="de"'
# Expected: 0

# 21. The fixture is the one the seeder produces, and the count is 55
npm run e2e:reset
# Expected: restored: 55 incidents.
docker compose -f ../wordpress-headless/docker-compose.yml run --rm -T wpcli \
  wp eval 'echo (int) wp_count_posts("incident")->publish, PHP_EOL;'
# Expected: 55 — 40 en + 10 de + 5 uk. `wp post list` would answer per Polylang's
#           context rules, which is why global-setup asks wp_count_posts instead.

# 22. The whole suite, four projects, one worker
E2E_MODE=1 E2E_SECRET="$E2E_SECRET" \
BTT_REPORTER_PASSWORD="$BTT_REPORTER_PASSWORD" \
BTT_EDITOR_PASSWORD="$BTT_EDITOR_PASSWORD" \
  npx playwright test --workers=1
# Expected: all passed. `setup` reports 3, then smoke, mutations and a11y run.

# 23. NEGATIVE — with E2E_MODE unset, nothing is reset and the run says so
npx playwright test --project=smoke 2>&1 | grep -c 'E2E_MODE is not "1"'
# Expected: 1. The database was NOT touched, and that is the correct default —
#           silence plus destruction is the worst pairing in tooling.

# 24. NEGATIVE — the specs never reach for the WordPress origin with the wrong
#     spelling. 127.0.0.1:8080 would be canonical-redirected by WordPress.
grep -rc '127.0.0.1:8080' e2e/ | grep -v ':0$' || echo 'no 127.0.0.1:8080 — correct'
# Expected: no 127.0.0.1:8080 — correct
```

If check 3 prints anything other than `0`, you have written a config that does not type-check, and
the error message will talk about an object literal rather than about parallelism. If check 14
returns `401` instead of `404`, the test hook is answering a question that should not have an
answer — fix Lesson 18.3's branch order before shipping anything.

## Control Questions

1. `smoke` is anonymous and needs no `storageState`, yet it still declares
   `dependencies: ['setup']`. Give the reason, then describe the exact failure you would see if
   you removed that dependency — including why it would look like a data bug rather than an
   ordering bug.
2. The brief for this lesson said to put `workers: 1` on the `mutations` project. Explain what is
   wrong with that instruction, name the two mechanisms that do exist, and say precisely which
   interleaving neither of them prevents and what closes that gap instead.
3. Lesson 16.4's `funnel.spec.ts` drives the login form and this lesson does not change it, even
   though `storageState` would make it four seconds faster. Justify keeping it, then name the
   circumstance under which you would reverse that decision.
4. `auth.setup.ts` asserts that `/en/account` renders rather than that the browser left
   `/en/login`. Both look like "the login worked". Describe a state of the application in which
   the second assertion passes and the first fails, and say which of the two you would rather
   have wake you up.
5. A colleague fixes an intermittently failing `i18n.spec.ts` by adding
   `await page.waitForTimeout(500)` before the disabled-button assertion, and the suite goes
   green. Explain what they have actually done to the test, what the underlying cause is, and why
   the correct fix makes the test *faster* rather than slower.

## Learn More

- [Playwright — authentication](https://playwright.dev/docs/auth) — the `storageState` pattern in
  the project's own words, including the per-role variant this lesson uses and the "reuse signed-in
  state" caveats
- [Playwright — test projects and dependencies](https://playwright.dev/docs/test-projects) — the
  full `TestProject` option list. Read it once and you will see for yourself that `workers` is not
  on it, which is Key Concept 3's whole point
- [Playwright — parallelism and sharding](https://playwright.dev/docs/test-parallel) —
  `fullyParallel`, `describe.configure({ mode: 'serial' })` and where the worker boundary actually
  falls; the section on serial mode's failure propagation is the part people miss
- [Playwright — global setup and teardown](https://playwright.dev/docs/test-global-setup-teardown) —
  both mechanisms, and why a setup *project* can do things `globalSetup` cannot, such as call a
  server that `webServer` has not started yet
- [Playwright — `APIRequestContext`](https://playwright.dev/docs/api/class-apirequestcontext) —
  the `request` fixture used for the purge and for the redirect assertions, with `maxRedirects: 0`
  documented
- [Playwright — assertions](https://playwright.dev/docs/test-assertions) — which matchers retry.
  `toBeDisabled`, `toHaveAccessibleName` and `toHaveURL` all do, which is what makes the
  after-hydration assertions in `i18n.spec.ts` sound
- [Next.js — `draftMode()`](https://nextjs.org/docs/app/api-reference/functions/draft-mode) — the
  cookie Next owns, why reading it does not force dynamic rendering, and what `enable()` actually
  sets
- [Next.js — `revalidatePath`](https://nextjs.org/docs/app/api-reference/functions/revalidatePath) —
  read the `'layout'` type note; it is what makes `revalidatePath('/', 'layout')` a whole-app purge
  rather than a one-page one
- [MDN — `Origin` request header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Origin) —
  why `127.0.0.1:3000` and `localhost:3000` are different origins, which is the whole of the
  `allowedOrigins` problem and reappears in Lesson 23.7's `--allowed-origins`
