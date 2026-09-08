---
title: 'Measuring Core Web Vitals'
module: 21
lesson: 1
teaches: [core-web-vitals, lab-vs-field, lighthouse, report-web-vitals, performance-baseline]
produces: ['next-app/src/components/layout/WebVitals.tsx', 'next-app/src/app/api/vitals/route.ts', 'docs/perf-baseline.md']
requires: [18.2, 20.3]
---

# Lesson 21.1 — Measuring Core Web Vitals

## Quick Overview

Core Web Vitals are three numbers. **LCP** (Largest Contentful Paint) is when the biggest thing
in the viewport finished painting — usually your hero image or headline. **INP** (Interaction to
Next Paint) is how long the slowest interaction of the session took to produce a visible
response. **CLS** (Cumulative Layout Shift) is how much content jumped around without the user
asking. Good is LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1, and "good" means the 75th percentile of
real sessions — not your laptop, not your office wifi.

The distinction that makes this lesson worth its own slot is **lab versus field**. Lighthouse
runs a synthetic page load on a simulated slow device and gives you a reproducible number you
can put in CI. CrUX and PageSpeed Insights report what happened to actual Chrome users over the
last 28 days on actual devices, and that is the number that affects your ranking and your
users' experience. They routinely disagree, and neither is lying. Lighthouse cannot measure INP
at all, because INP requires a human interacting — it substitutes Total Blocking Time as a proxy.
Field data cannot be collected before you have traffic, and it cannot gate a pull request
because it lags by weeks. So you need both, for different jobs: lab for regression prevention,
field for truth. This lesson sets up both and then writes the numbers down, because a
performance module without a committed baseline is a module of unfalsifiable claims.

By the end of this lesson you will have:

- A repeatable Lighthouse procedure — production build, mobile preset, fixed throttling, three
  runs, median reported — for the six key routes
- `src/components/layout/WebVitals.tsx` using `useReportWebVitals` to collect real metrics
- `src/app/api/vitals/route.ts` — accepting them, validating with Zod, rate-limited, storing
  **no PII**: no IP, no user agent string, no URL query parameters
- `docs/perf-baseline.md` — dated, per-route LCP / CLS / TBT / First Load JS, plus the exact
  command and device preset used
- A PageSpeed Insights reading for the deployed origin, or an explicit note that field data does
  not exist yet and why
- The three thresholds understood well enough to explain why TBT is in CI and INP is not

## Classic WP Analogy

You have measured WordPress performance before, and the toolkit you used was almost entirely
**server-side**. Query Monitor for query counts and slow queries. `EXPLAIN` in Adminer — which
this course already made you do in Module 02. New Relic or a slow-log for PHP time. Time to
First Byte in a `curl -w` one-liner. Your mental model of "the site is slow" was: too many
queries, an unindexed `meta_query`, a plugin doing HTTP in `init`, or opcache being off.

All of that still applies — to WordPress. It is now behind an ISR cache, so it affects
regeneration time rather than user-visible latency, and it is exactly one of the four boxes in
the request-flow diagram in [PROJECT.md](../PROJECT.md).

Where the analogy breaks: **Core Web Vitals measure the browser, and your Classic toolkit cannot
see the browser at all.** A WordPress site with a 40 ms TTFB and a perfect Query Monitor report
can have a 4-second LCP because the hero image is a 2 MB PNG with no dimensions and the font
loads late. Nothing in Query Monitor will ever tell you that. The variables that dominate CWV —
image bytes, font loading, JavaScript parse and execute time, layout stability — are on the
client, and in a headless build they are almost entirely **your** code rather than WordPress's.

There is a second, more uncomfortable break. In Classic WordPress you could usually fix
performance by installing something: a page cache, an image optimiser, a "minify and combine"
plugin. That option is gone. There is no plugin you can install into Next.js that fixes LCP,
and the good news is that you no longer need one — `next/image`, `next/font` and RSC do most of
what those plugins did, correctly, at build time. The cost, stated plainly: when it is still
slow after that, the remaining problem is a decision you made, and the only fix is to change it.

---

## Key Concepts

### 1. Three metrics, three different questions

They are usually recited as a list, which hides the fact that each one answers a different
question about a different phase of the page.

| | Question it answers | Phase | Good / poor | What it is *not* |
|---|---|---|---|---|
| **LCP** | when did the biggest thing in the viewport finish painting? | load | ≤ 2.5 s / > 4 s | "when the page loaded". `load` can fire long before or long after |
| **INP** | of every interaction in this visit, how slow was the **worst** one? | whole visit | ≤ 200 ms / > 500 ms | the *first* interaction. That was FID, and it was retired in March 2024 |
| **CLS** | how much did content move, in the worst 5-second window? | whole visit | ≤ 0.1 / > 0.25 | a total. It is a **session window**, not a sum |

**LCP is the paint of an element, and the element changes.** The browser keeps promoting the
largest contentful element it has seen, and the *last* promotion before the first interaction
counts. A page whose hero arrives at 3.8 s has an LCP of 3.8 s even though the headline painted
at 0.4 s — the image displaced it.

**INP measures the worst interaction, and it is field-only.** One click in two hundred taking
900 ms *is* your INP. No synthetic tool can produce it, because there is no human in a synthetic
run; Key Concept 3 is what Lighthouse does instead.

**CLS's session window is the part everyone gets wrong.** Shifts group into windows of at most
5 seconds separated by 1-second gaps of stability, and your CLS is the **largest** window, not
the sum. So a shift 10 seconds in still counts — it opens its own window — and a page that
shifts badly twice scores the worse of the two. "Cumulative" is a name Google has been stuck
with since 2020.

```
   CLS session windows — one page, three shifts

   t=0.4s  0.06 ┐
   t=0.9s  0.03 ├─ window A: 0.09     ← gap < 1s, same window
   t=1.2s  0.00 ┘
             ······ 4.8s of stability ······
   t=6.0s  0.14 ─── window B: 0.14    ← a NEW window, 6s in

   reported CLS = max(0.09, 0.14) = 0.14      not 0.23
```

### 2. Lab versus field, and why neither one is lying

This is the distinction the lesson exists for, and it is the one that stops the arguments.

| | **Lab** (Lighthouse, `lhci`) | **Field** (CrUX, PageSpeed Insights, your own `/api/vitals`) |
|---|---|---|
| What it is | one synthetic load, throttled device, throttled network | real visits, real devices, real networks |
| Sample size | 1 (or 3, if you ask) | thousands, over 28 days |
| Reproducible | **yes** — that is its whole value | no. It moves when your traffic moves |
| Can gate a pull request | **yes** | no. It lags by weeks |
| Measures INP | **no** — see Key Concept 3 | yes |
| Available before launch | yes | **no.** No traffic, no data |
| Affects your ranking | no | yes |
| Best sentence for it | "this change made the site slower" | "the site is slow for a quarter of our users" |

They disagree routinely and by large margins, and neither is broken. A lab run is a *single
sample of a distribution you chose* — a mid-range Android on a simulated slow 4G link. Field data
is the *actual* distribution, where half your visitors are on a desktop on office wifi and a
fifth are on a five-year-old phone on a train. Comparing one number from the first against the
75th percentile of the second is comparing a die roll to a histogram.

The rule this course follows, stated once so the next three lessons need not re-litigate it:

> **Lab for regression prevention, field for truth.** A lab number tells you whether *your
> change* made things worse, because everything else about the run was held constant. A field
> number tells you whether the *site* is fast, because it is measured on the machines that
> matter. Using either one for the other job produces confident nonsense.

### 3. Lighthouse cannot measure INP, so it measures TBT instead

There is no human in a Lighthouse run. Nothing clicks, nothing types, nothing scrolls. INP is
defined over interactions, so Lighthouse has no interactions to measure and reports **no INP at
all** — not a zero, not an estimate: the metric is absent.

What it reports instead is **Total Blocking Time**: for every long task during page load, the
number of milliseconds beyond 50 ms, summed.

```
   main thread during load          long task = a task > 50ms
   ────────────────────────────────────────────────────────
   ██ 30ms                          not a long task            → 0 blocking
   ████████████ 180ms               long task                  → 130ms blocking
   ██████ 70ms                      long task                  →  20ms blocking
   ████ 45ms                        not a long task            → 0 blocking
                                                        TBT = 150ms
```

TBT and INP correlate because they share a cause — a main thread that is busy cannot respond to
anything — but they are not the same measurement:

| | TBT | INP |
|---|---|---|
| Window | page load only | the whole visit |
| Trigger | tasks, whether or not anyone interacted | an actual interaction |
| Source | lab | field only |
| Assertable in CI | **yes** | **no** |

That last row is why the module README's budget table has a TBT row and no INP row, why Lesson
21.4's `lighthouserc.json` asserts TBT, and why any config that claims to assert INP is asserting
something that does not exist. Lesson 21.3 makes the argument the other way round — a long task
found in a profile is a TBT problem *and* an INP suspect.

### 4. The 75th percentile, and the average that hides the people you are failing

Core Web Vitals thresholds are evaluated at the **75th percentile of page loads**, per metric,
per form factor. Not the mean, not the median.

| Visitor | LCP |
|---|---|
| 70 fast visits | 1.2 s |
| 20 middling visits | 2.4 s |
| 10 slow visits | 6.8 s |

The mean is 2.0 s and looks fine. The median is 1.2 s and looks excellent. The 75th percentile is
2.4 s, is the number Google uses, and is the only one of the three that notices the ten people
having a bad time. Push the slow tail to 5.2 s and the mean moves 160 ms while a tenth of your
visitors stop waiting.

The consequence here: **one Lighthouse run is a sample of size one from a distribution you have
not characterised.** Key Concept 5 turns that into a procedure.

### 5. `npm run dev` numbers are fiction, and it is worth knowing exactly why

Four separate reasons, and each one alone would invalidate the measurement:

| In `npm run dev` | Effect on your numbers |
|---|---|
| No minification, no tree shaking | the JavaScript is several times larger than what ships |
| Modules compiled **per request**, on first hit | a route's first load includes compiler work no user ever pays for |
| A live-reload WebSocket and the dev overlay | extra connections and extra client JavaScript that do not exist in production |
| React in development mode | extra warnings, extra checks, `StrictMode` double-invocation |

So every number in this module comes from `npm run build` followed by `npm start`. A dev-mode LCP
can be three times the production one, which makes a dev-mode "improvement" a coin flip.

The half of the rule people skip: **the same throttling every time.** An unthrottled run on a
laptop plugged into fibre makes every site look good and every change look like it did nothing.
Lesson 14.5 already picked this course's settings — CPU **4× slowdown**, network **Fast 4G** —
and this lesson keeps them so the numbers are comparable with the one 14.5 recorded.

### 6. A procedure, because a measurement you cannot repeat is an anecdote

| Step | Why it is in the list |
|---|---|
| `npm run build && npm start` | Key Concept 5 |
| Mobile preset, not desktop | it is the form factor CrUX weights, and the one where CPU matters |
| CPU 4× / Fast 4G, fixed | the same die, rolled the same way |
| A **fresh** profile or an incognito window | extensions inject scripts and change the numbers |
| **Three** runs per route | one run is noise |
| Report the **median**, not the best | the best run is the run you would like to have |
| Record the tool, its version and the date | Lighthouse changes its scoring between versions |

The last row matters more than it sounds. Lighthouse has re-weighted its performance score
several times: a 0.87 in one version is a 0.93 in another with no change to the site. A number
with no version attached is comparable to nothing, including itself six months later.

> **The DevTools panel and `lhci` will not agree, and you must pick one.** Same audits, different
> defaults — a different throttling implementation, a different Chrome instance, a different set
> of enabled categories. This lesson uses the **DevTools** panel for the baseline, because that is
> where you can also read the LCP element and the long-task track; Lesson 21.4 pins `lhci` for
> CI. Where both were run, record both and say which is which. No averaging.

### 7. `useReportWebVitals`, where it must live, and the one thing it must never do

Next ships the hook. `next/web-vitals` exports `useReportWebVitals`, which wraps the `web-vitals`
library that is already inside the framework — so there is **no dependency to install** for what
this lesson does. Task §3 states the condition under which you would reverse that.

Three placement constraints, and the third is the one that protects two modules of earlier work:

1. **It must be a Client Component.** The metrics are browser events. A Server Component has no
   `PerformanceObserver` and no `visibilitychange`.
2. **It must be mounted somewhere every route renders**, which here is
   `src/app/[locale]/layout.tsx` — the only root layout this app has. There is no
   `src/app/layout.tsx`.
3. **It must not read `cookies()` or `headers()`.** It cannot, being a Client Component, but the
   rule is worth writing down anyway, because the temptation ("just tag each beacon with the
   user") would mean moving the read into the layout — and Lesson 18.1 moved the session read
   *out* of that file precisely because reading `cookies()` there makes every route below it
   dynamic. That would forfeit every static route in the app, undo Lesson 18.1, and break Lesson
   21.4's budgets before they are written. Verification greps for it.

A client component in the root layout is not free: it adds a module to the client graph of every
route and hydrates on every page load. It renders `null`, so it costs no markup and no layout —
but it is a real entry in Lesson 21.3's inventory, and Task §4 measures its First Load JS cost
rather than assuming it is zero.

Next also reports three of its own timings through the same hook — `Next.js-hydration`,
`Next.js-route-change-to-render` and `Next.js-render`. Useful, not Core Web Vitals, and letting
them through roughly doubles beacon volume for numbers nothing here budgets. Task §3 filters
them out and names the reversal condition.

### 8. A vitals endpoint is a public write endpoint, and it gets treated like one

`/api/vitals` accepts unauthenticated writes from anybody on the internet, forever. That is not a
design flaw — a beacon from a real visitor has no credential to present — so the controls come
from somewhere other than authentication. Lesson 15.5's entry-point matrix has a row for this
shape and Lesson 16.3's `submitLead` is the precedent.

| Control | Here | Why |
|---|---|---|
| Method | `POST` only | a `GET` with a query string puts the payload in every access log |
| Authentication | **none, and named as none** | there is no subject to authorise. The substitute controls are the rest of this table |
| Rate limit | `src/lib/rate-limit.ts` (Lesson 16.2), key `vitals:<ip>` | fail-closed, per-IP, its own key namespace |
| Validation | Zod `safeParse` at the boundary, `400` on failure | the house pattern from Lesson 18.3 |
| Response | `204`, empty | there is nothing to tell the caller, and a body is bytes on an unload path |
| Payload size | bounded by the schema | `metrics` is `.max(5)`; a 4 MB array is not a metric |

And then the design decision rather than the control: **the payload carries no PII.** Not
"stripped later" — never collected.

| Stored | Not stored, and why |
|---|---|
| metric name (an enum of five) | the resolved URL — see below |
| value and `rating` | the IP address — a rate-limit key, written nowhere |
| `navigationType` — a reload and a cold navigation are different populations | the user-agent string — high-entropy, a fingerprint by accident |
| the route **pattern**, an enum member | the query string — where tracking parameters and search terms live |
| | a session or user id — there is nothing to join it to, and joining is the harm |

> **Why the route *pattern* and never the URL.** A slug can carry a person's name. This is a site
> where the public files incident reports; a real one would have slugs naming people. Storing
> `/en/incidents/dave-from-ops-deleted-the-database` in a telemetry table converts a performance
> metric into a record of who filed what. `/[locale]/incidents/[slug]` answers every question a
> budget asks and none of the questions a subject-access request is about.

The mechanism matters as much as the intention: the pattern is a **Zod enum** on the server, not
a string the client is trusted to have cleaned. A crafted request carrying a real URL is not
stripped — it is a `400`. That is the difference between a privacy property and a privacy
aspiration.

### 9. Transport: buffer, then one beacon

`useReportWebVitals` fires once per metric, and late for two of them on purpose: CLS and INP are
not final until the page is hiding, because another shift or another slow click can still happen.
The naive implementation therefore sends up to five requests per page view, two of them during
unload — which is where `fetch` gets cancelled.

| | `fetch()` during unload | `navigator.sendBeacon()` |
|---|---|---|
| Survives the page being discarded | no, unless `keepalive: true` | **yes** — the browser owns the request |
| Body | anything | `Blob` / string / form data, `POST` only |
| Response | readable | **not readable.** You get a boolean: queued or not |
| Availability | universal | universal in practice; check before calling |

So: **accumulate metrics in a ref, flush once with `sendBeacon` when the page hides.** One
request, five metrics, on the one event that reliably fires — `visibilitychange` to `hidden`,
with `pagehide` as the belt-and-braces second listener because Safari has historically been
inconsistent about the first.

Batching also settles a constraint you would otherwise fight. `src/lib/rate-limit.ts` is tuned at
**five writes per ten minutes per IP** — right for a form a human fills in, absurd for five
beacons per page view. One batch per page view turns that limit into five page views per ten
minutes per IP, which is a sensible shape for what it protects.

The cost: **you lose the batch if the browser is killed without firing either event** — a
force-quit, a crash, an OOM kill. Those are the slowest sessions, so the lost data is biased
towards the users you most want to hear about. There is no fix at this layer. The honest
mitigations are client-side sampling (Task §3) and accepting that RUM is a survey, not a census.

### 10. What a baseline is actually for

`docs/perf-baseline.md` is a number you can be judged against later. That is uncomfortable, and
it is the entire point.

Without it, every sentence in the next three lessons is unfalsifiable. "I added `next/font` and
the site feels snappier" cannot be wrong. "LCP on `/en/hobt` went from 2 810 ms to 1 940 ms,
median of three, 4× CPU, Fast 4G, on this date" can be wrong, which is what makes it worth
writing.

Four earlier lessons knew this file was coming and parked their measurements in
`docs/architecture.md` rather than inventing it early — 14.5's LCP row, 18.1's per-page build
cost, 18.4's cache-header transcript and 17.3's two First Load JS figures. Lesson 18.4 even ships
a check asserting the file does **not** exist yet. Task §7 collects all four, which is why this
lesson is first in the module.

> **You will be tempted to measure after you optimise.** Do not. A number recorded after the fix
> has nothing to compare against, and the module then consists of four lessons of claims.

---

## Task

### Step 1: Build the rig, and capture the route table you will be compared against

Everything below is measured on a production build. Start by recording what the build currently
says, because Step 4 has to prove that mounting a client component did not change it.

```bash
# next-app — run from the next-app directory
cd next-app
npm run build 2>&1 | tee /tmp/btt-build-before.txt | sed -n '/Route (app)/,$p' | head -40
```

Three things to read out of that table: the marker before each route (`○` static, `●` prerendered
from `generateStaticParams`, `ƒ` dynamic), `Size` (the route's own JavaScript) and
`First Load JS` (the route's JavaScript **plus** the shared chunks — the budgeted number).

The markers should match Lesson 18.1's table: `/[locale]/hobt` static, `/[locale]/incidents`
dynamic, the three `[slug]` routes prerendered. If they do not, stop. Something after Module 18
reintroduced a dynamic read, and there is no point measuring a build you cannot explain.

```bash
# next-app
npm start &
sleep 6
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/hobt
```

**Verify §1:**

- [ ] `npm run build` exits 0 and prints a `Route (app)` table.
- [ ] `/tmp/btt-build-before.txt` exists and contains `First Load JS`. You need it in Step 4.
- [ ] The markers match Lesson 18.1's rendering-strategy table, route for route.
- [ ] `curl` returns `200`, so `npm start` is serving the build and not a stale `.next`.

### Step 2: Run the procedure on the six routes

The six budgeted routes, concrete, in the `en` locale — these are the same six Lesson 21.4 puts
in `lighthouserc.json`:

| # | URL | Rendering strategy (Lesson 18.1) |
|---|---|---|
| 1 | `http://localhost:3000/en` | ISR, `revalidate = 300` |
| 2 | `http://localhost:3000/en/incidents` | dynamic |
| 3 | `http://localhost:3000/en/incidents/incident-01` | ISR + tags, prerendered |
| 4 | `http://localhost:3000/en/reviews/review-01` | ISR + tags, prerendered |
| 5 | `http://localhost:3000/en/blog/blog-01` | ISR + tags, prerendered |
| 6 | `http://localhost:3000/en/hobt` | static, `revalidate = false` |

Two of those slugs are not pinned by any appendix — [appendix 03](../appendix/03-content-model-reference.md)
§9 fixes the incident slugs (`incident-01` … `incident-40` in English) and does not enumerate the
review or blog slugs — so confirm them instead of trusting this table:

```bash
# wordpress-headless
cd ../wordpress-headless
docker compose run --rm -T wpcli wp post list --post_type=tech_review \
  --posts_per_page=3 --field=post_name
docker compose run --rm -T wpcli wp post list --post_type=post \
  --posts_per_page=3 --field=post_name
cd ../next-app
```

Substitute whatever those commands print. A budget pinned to a slug that does not exist fails on
a `404`, which is a confusing way to learn that your seed data moved.

Then, per route, in a **fresh incognito window** with extensions disabled:

1. DevTools → **Lighthouse** panel.
2. Mode **Navigation**, device **Mobile**, categories **Performance** only for now.
3. Run it. Then run it twice more.
4. Record LCP, CLS, TBT and the Performance score per run, then take the **median of each metric
   independently** — not the median run.
5. Switch to the **Performance** panel, set CPU **4× slowdown** and network **Fast 4G**, record a
   reload, and click the **LCP** marker in the Timings track. Write down the element it names.

That last item is the one people skip and it is the most useful thing on the page. A budget tells
you a number is too big; the LCP element tells you which of your decisions produced it. Lesson
21.2 cannot start without it.

> **PageSpeed Insights cannot help you yet.** It fetches a **public URL** and yours is
> `http://localhost:3000`. There is no field data for this site because there is no deployed site
> and no traffic; CrUX needs a 28-day window and a minimum sample before it reports anything. Do
> not tunnel localhost to the internet for a number — a tunnel adds its own latency and TLS
> handshake, so you would be measuring the tunnel. Record "no field data — no public origin" and
> read the real thing against the Vercel preview URL in Module 24. Your own `/api/vitals` is the
> field instrument you *can* have today, and Step 5 builds it.

**Verify §2:**

- [ ] Three runs per route, eighteen runs total, all on the same build.
- [ ] You have a median LCP, CLS, TBT and Performance score per route.
- [ ] You have the LCP **element** for `/en/hobt` and for `/en/blog/blog-01`, by name.
- [ ] The Lighthouse version is written down. It is at the bottom of the report.

### Step 3: Write `WebVitals.tsx`

First the dependency decision, made explicitly. `useReportWebVitals` is exported from
`next/web-vitals` and wraps the copy of `web-vitals` already inside Next, so **this lesson
installs nothing.**

| You would install `web-vitals` yourself if | Because |
|---|---|
| you want **attribution** — `lcpEntry`, `loadState`, the element selector, the interaction target | the attribution build reports *why* a metric was bad, not just how bad. Next's bundled hook does not expose it |
| you want to report metrics from outside React | the hook is a hook |

Neither applies yet, and a dependency added "so it is there" is one nobody removes. Lesson 21.3
revisits it if the treemap says the attribution build is worth its weight.

```tsx
// next-app/src/components/layout/WebVitals.tsx
'use client';
// Renders null. It observes, batches, and sends ONE beacon per page view.
//
// It must never read a request-scoped API: no cookie read, no header read. It
// cannot — it is a Client Component — but the rule is written here because the
// tempting "just tag each beacon with the user" fix means moving that read into
// the root layout, and Lesson 18.1 moved the session read OUT of that file
// precisely because a cookie read there makes every route below it dynamic.
// Verification greps this file for both call names and expects neither.
import { usePathname } from 'next/navigation';
import { useReportWebVitals } from 'next/web-vitals';
import { useEffect, useRef } from 'react';

/**
 * The five Core Web Vitals plus the two supporting load metrics. Next reports
 * three of its own through the same hook — `Next.js-hydration`,
 * `Next.js-route-change-to-render` and `Next.js-render` — which are useful and
 * are not budgeted anywhere in this module. Letting them through roughly
 * doubles the beacon volume for numbers nothing asserts. Reversal condition:
 * a hydration regression you cannot see in TBT.
 */
const REPORTED = new Set(['LCP', 'INP', 'CLS', 'FCP', 'TTFB']);

/** Beacons per session. 1 locally, so you can see your own data. */
const SAMPLE_RATE = 1;

/** Bounded by the server's Zod schema at `.max(5)`. Keep the two in step. */
const MAX_METRICS = 5;

type Beaconable = { readonly name: string; readonly value: number; readonly rating: string };

/**
 * A route PATTERN, never a resolved URL, and never a slug. Key Concept 8: a
 * slug on this site can carry a person's name. The server re-checks the result
 * against a Zod enum, so this function is a convenience and not the control —
 * a crafted body carrying a real URL gets a 400, not a scrub.
 *
 * Deliberately dumb: anything it does not recognise becomes `(other)` rather
 * than being guessed into the nearest budgeted pattern. `/en/incidents/submit`
 * is the case that proves it — it is one segment deep under `incidents` and it
 * is NOT the incident detail route.
 *
 * Exported so Module 23 can unit-test it without rendering anything.
 */
export function routePattern(pathname: string): string {
  const OTHER = '/[locale]/(other)';
  const segments = pathname.split('/').filter((segment) => segment !== '');

  // `/` never reaches a page — middleware redirects it, localePrefix is
  // 'always' (Lesson 20.3) — but a beacon can still be queued mid-redirect.
  if (segments.length === 0) return OTHER;

  const rest = segments.slice(1);
  if (rest.length === 0) return '/[locale]';

  const [collection, ...tail] = rest;

  if (tail.length === 0) {
    if (collection === 'incidents') return '/[locale]/incidents';
    if (collection === 'hobt') return '/[locale]/hobt';

    return OTHER;
  }

  if (tail.length === 1 && tail[0] !== 'submit') {
    if (collection === 'incidents') return '/[locale]/incidents/[slug]';
    if (collection === 'reviews') return '/[locale]/reviews/[slug]';
    if (collection === 'blog') return '/[locale]/blog/[slug]';
  }

  return OTHER;
}

export function WebVitals() {
  const pathname = usePathname();
  const buffer = useRef<Beaconable[]>([]);
  const sampled = useRef<boolean | null>(null);
  const sent = useRef(false);

  // Decided ONCE per mount, not per metric: sampling half the metrics of every
  // session gives you five broken half-sessions instead of one whole one.
  if (sampled.current === null) sampled.current = Math.random() < SAMPLE_RATE;

  useReportWebVitals((metric) => {
    if (sampled.current !== true) return;
    if (!REPORTED.has(metric.name)) return;
    if (buffer.current.length >= MAX_METRICS) return;

    buffer.current.push({
      name: metric.name,
      // CLS is unitless and small; everything else is milliseconds. Three
      // decimals keeps a CLS of 0.083 from rounding to 0.
      value: Math.round(metric.value * 1000) / 1000,
      rating: metric.rating,
    });
  });

  useEffect(() => {
    // `route` and `navigationType` are read at FLUSH time, not at metric time,
    // because CLS and INP are finalised during unload.
    function flush() {
      if (sent.current || buffer.current.length === 0) return;
      sent.current = true;

      const entry = performance.getEntriesByType('navigation')[0];
      const body = JSON.stringify({
        route: routePattern(pathname),
        navigationType: entry instanceof PerformanceNavigationTiming ? entry.type : 'navigate',
        metrics: buffer.current,
      });

      // sendBeacon: the browser owns the request, so it survives the document
      // being discarded. `fetch` on this path is cancelled. Key Concept 9.
      // The fallback is `keepalive`, which is the same promise with a weaker
      // guarantee and a 64 KB cap we are nowhere near.
      if (typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon('/api/vitals', new Blob([body], { type: 'application/json' }));
      } else {
        void fetch('/api/vitals', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body,
        }).catch(() => {
          // Deliberately silent. Lesson 12.3's smoke suite fails a spec on any
          // browser log output, on every route, and a dropped beacon is not a
          // user-visible fault. Verification greps this file to prove it.
        });
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') flush();
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    // Safari has been inconsistent about visibilitychange on unload for years.
    // Two listeners, one `sent` guard, at most one beacon.
    window.addEventListener('pagehide', flush);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flush);
    };
  }, [pathname]);

  return null;
}
```

> **`sent` is a one-shot guard, and losing a soft navigation's metrics is a decision, not a bug.**
> A client-side route change does not re-mount a component in the root layout, so `buffer` and
> `sent` persist across it. Doing it properly means resetting both on a `pathname` change and
> flushing the previous route's buffer first — real work, whose only consumer would be a
> soft-navigation metric nothing in this module budgets. Named, declined, recorded in Task §8.

### Step 4: Mount it, then prove the route table did not move

One anchored line in the root layout, which already holds the `metadata` export from Lesson 09.1,
`generateStaticParams` / `setRequestLocale` / `getMessages` from 20.3, the `draftMode()` read from
17.2, the JSON-LD script from 19.3 and the `Suspense`-wrapped notice from 20.4. None of them
changes.

```tsx
// next-app/src/app/[locale]/layout.tsx — the import, added to the `@/` group
import { WebVitals } from '@/components/layout/WebVitals';
```

```tsx
// next-app/src/app/[locale]/layout.tsx — one element, added as the last child
// of <body>, after Lesson 19.3's JSON-LD <script>. Position is not load-
// bearing: it renders null. Last is where a null-rendering observer belongs so
// nobody reading the tree wonders what it wraps.
        <WebVitals />
```

```bash
# next-app
npm run build 2>&1 | tee /tmp/btt-build-after.txt | sed -n '/Route (app)/,$p' | head -40
diff <(grep -oE '^[┌├└│] *[○●ƒ] +/[^ ]*' /tmp/btt-build-before.txt) \
     <(grep -oE '^[┌├└│] *[○●ƒ] +/[^ ]*' /tmp/btt-build-after.txt)
# Expected: no output. Same routes, same markers. A route that changed from ○ or
#           ● to ƒ means something in this step reads a request-scoped API.
```

**Verify §4:**

- [ ] The `diff` is empty: every route kept its static/prerendered/dynamic marker.
- [ ] `First Load JS` moved by a small, positive amount on every route. Write the delta down —
      it is the honest cost of the instrument, and Lesson 21.3 will see this module in its own
      inventory.
- [ ] `grep -c 'WebVitals' 'src/app/[locale]/layout.tsx'` returns `2` — the import and the
      element.
- [ ] `npm run verify` is clean.

### Step 5: Write the endpoint

The house shape for a route handler, from Lesson 18.3: plain `Request`, an annotated
`Promise<Response>` return type, `Response.json` for a body and `new Response(null, …)` for a
bare status, only the method you implement exported.

```ts
// next-app/src/app/api/vitals/route.ts
// A PUBLIC, UNAUTHENTICATED write endpoint. There is no subject to authorise —
// a beacon from a real visitor has no credential — so the controls are the
// method, the limiter, the schema and the size bound. Key Concept 8, and the
// same shape as `submitLead` in the Lesson 15.5 entry-point matrix.
import { z } from 'zod';

import { limit } from '@/lib/rate-limit';

// Never cached, never prerendered. A cached write endpoint is not an endpoint.
export const dynamic = 'force-dynamic';

/**
 * The route patterns this endpoint will accept, as an ENUM. This is the privacy
 * control, not the client's `routePattern()` helper: a crafted body carrying
 * `/en/incidents/dave-deleted-the-database` fails validation with a 400 rather
 * than being sanitised. A slug cannot get in here.
 *
 * These six are the budgeted routes from the module README. Everything else is
 * `(other)` on purpose — an unbudgeted route's metrics are noise in a table
 * whose only job is to feed Lesson 21.4's thresholds.
 */
const ROUTES = [
  '/[locale]',
  '/[locale]/incidents',
  '/[locale]/incidents/[slug]',
  '/[locale]/reviews/[slug]',
  '/[locale]/blog/[slug]',
  '/[locale]/hobt',
  '/[locale]/(other)',
] as const;

const MetricSchema = z.object({
  // LCP, INP and CLS are the budgeted three. FCP and TTFB are here because they
  // decompose LCP (Lesson 21.2 Key Concept 2) and cost nothing extra to carry.
  // An unlisted name — including Next's own `Next.js-hydration` — is a 400.
  name: z.enum(['LCP', 'INP', 'CLS', 'FCP', 'TTFB']),
  // `nonnegative`, and a ceiling: a 30-minute LCP is a broken clock or a liar,
  // and either way it poisons a percentile.
  value: z.number().nonnegative().finite().max(600_000),
  rating: z.enum(['good', 'needs-improvement', 'poor']),
});

const PayloadSchema = z
  .object({
    route: z.enum(ROUTES),
    navigationType: z.enum(['navigate', 'reload', 'back_forward', 'prerender']),
    // Bounded. Five metrics is the whole vocabulary; an array of 40 000 is an
    // attempt to fill a log, not a page view.
    metrics: z.array(MetricSchema).min(1).max(5),
  })
  // Zod 3 strips unknown keys by default, which would SILENTLY accept a body
  // carrying an `ip` or `ua` field. Strict mode makes it a 400 instead, so the
  // no-PII property is enforced rather than hoped for.
  .strict();

export async function POST(request: Request): Promise<Response> {
  // ── 1. RATE LIMIT ────────────────────────────────────────────────────
  // Its own key namespace, so one page's beacons cannot spend the incident
  // form's budget. Fails CLOSED: when Upstash is unreachable the beacon is
  // refused, which loses telemetry and never opens the endpoint. That is the
  // right way round — Lesson 16.2 §5.
  //
  // The IP is a load-shedding key. It is read here and written NOWHERE.
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? '0.0.0.0';

  const verdict = await limit(`vitals:${ip}`);

  if (!verdict.ok) {
    // 429 with no Retry-After body: there is nothing useful to tell a beacon,
    // and `sendBeacon` cannot read a response anyway.
    return new Response(null, { status: 429 });
  }

  // ── 2. BODY ──────────────────────────────────────────────────────────
  // sendBeacon sends a Blob, so the Content-Type is whatever we set on it and
  // is not worth asserting. The bytes are what matter.
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'body is not JSON' }, { status: 400 });
  }

  const parsed = PayloadSchema.safeParse(body);

  if (!parsed.success) {
    // Deliberately terse. The sender is a browser that will not read this, and
    // a field-by-field error report on a public endpoint is a schema oracle.
    return Response.json({ error: 'payload failed validation' }, { status: 400 });
  }

  // ── 3. RECORD ────────────────────────────────────────────────────────
  // One structured line per page view, to stdout. There is no database in this
  // module and adding one to hold five numbers would be the wrong trade; Lesson
  // 24.3 gives this line a real sink alongside the rest of the app's logging.
  //
  // Every field below is in the schema above, so this line CANNOT contain an
  // IP, a user agent, a query string, a slug or a session identifier. That is
  // a property of the enum, not of this comment.
  for (const metric of parsed.data.metrics) {
    console.log(
      JSON.stringify({
        kind: 'web-vital',
        route: parsed.data.route,
        navigationType: parsed.data.navigationType,
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
      })
    );
  }

  // Nothing to say, and bytes on an unload path are bytes wasted.
  return new Response(null, { status: 204 });
}
```

> **`GET` is a `405` and you did not write it.** Next returns `405` for any method a route file
> does not export, so there is no `GET` handler to forget to remove — and Verification asserts it
> anyway, because "the framework handles this" is a claim worth testing once.

Middleware does not touch this route: `config.matcher` has excluded `api` since Lesson 09.5 and no
lesson may edit it, so the `POST` arrives without a locale redirect. That is why the client posts
to `/api/vitals` and not `/en/api/vitals`.

**Verify §5:**

- [ ] `npm run type-check` is clean. If Zod complains about `z.enum(ROUTES)`, the array is
      missing its `as const` — `z.enum` needs a readonly tuple of literals.
- [ ] `grep -c 'export async function' src/app/api/vitals/route.ts` returns `1`.
- [ ] `grep -cE "cookies\(|headers\(\)" src/app/api/vitals/route.ts` returns `0`. The IP comes
      off `request.headers`, which is request-scoped and free; `headers()` from `next/headers`
      would work here too and is the habit that leaks into a layout.

### Step 6: Prove it end to end, including every refusal

```bash
# next-app
npm run build && npm start &
sleep 6

# A well-formed beacon, exactly as the client sends it
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/vitals \
  -H 'Content-Type: application/json' \
  -d '{"route":"/[locale]/hobt","navigationType":"navigate","metrics":[{"name":"LCP","value":1943.2,"rating":"good"}]}'
# Expected: 204 — and one JSON line in the `npm start` terminal
```

Then load `http://localhost:3000/en/hobt`, click something, and **navigate away or close the
tab** — the beacon fires on hide, not on load. Watch the server terminal: one line per metric, all
carrying `"route":"/[locale]/hobt"`. If nothing arrives, open the Network panel with "preserve
log" enabled, filter for `vitals`, and look for a `429` — an unreachable Upstash produces one,
because the limiter fails closed.

**Verify §6:**

- [ ] A hand-rolled `curl` gets `204` and produces exactly one log line per metric.
- [ ] A real page view produces a beacon with `"route"` set to the **pattern**, never a slug.
- [ ] `CLS` arrives with a value like `0.041`, not `0`. A rounded-to-zero CLS means the `* 1000`
      in the client is missing.
- [ ] Reloading the page produces `"navigationType":"reload"`.

### Step 7: Collect the four measurements earlier lessons parked for you

They are in `docs/architecture.md` under four headings, because `docs/perf-baseline.md` did not
exist when they were taken.

```bash
# next-app — the four sections you are collecting
for h in 'Image delivery (Lesson 14.5)' \
         'generateStaticParams` measurements (Lesson 18.1)' \
         'Cache layers and the cacheable/personalised split (Lesson 18.4)' \
         'The same incident, rendered three ways (Lesson 17.3)'; do
  printf '%-64s %s\n' "$h" "$(grep -c "$h" ../docs/architecture.md)"
done
# Expected: 1 for each of the four. A 0 means you skipped that lesson's Step 7,
#           and there is nothing to collect — go and measure it now rather than
#           leaving a blank row in the baseline.
```

What to carry across: 14.5's `/en/hobt` LCP element and time plus the throttling used; 18.1's
per-page prerender cost in ms and its page/query counts; 18.4's `curl -I` header transcript with
its date and Next version; and 17.3's two First Load JS figures for `/en/incidents/incident-01`.

**Copy, do not move.** Those sections belong to the lessons that wrote them, and deleting Lesson
14.5's row would break its own Verification grep. The baseline gets a copy and a pointer.

### Step 8: Create `docs/perf-baseline.md`

This lesson creates it; Lessons 21.2, 21.3 and 21.4 each append one section. The
section-per-lesson shape is the one `docs/architecture.md` has used since Lesson 01.2, so appends
never collide.

```markdown
<!-- docs/perf-baseline.md — NEW FILE, created by Lesson 21.1 -->
# Blame The Tech — performance baseline

Every number here is reproducible or it is worthless. Replace every `______` with something you
measured, and never edit a recorded number — add a new dated row underneath it.

## Baseline (Lesson 21.1)

Recorded: ______  ·  Next: ______  ·  Chrome: ______  ·  Lighthouse: ______
Build: `npm run build && npm start`  ·  Device: **Mobile** preset  ·  Throttling: CPU **4×**,
network **Fast 4G**  ·  Runs per route: **3**, median of each metric reported independently
Tool of record: **Chrome DevTools Lighthouse panel.** `lhci` is pinned separately in Lesson 21.4
and will not agree; where both were run, both are recorded.

| Route | Strategy | LCP (ms) | CLS | TBT (ms) | Perf score | First Load JS (kB) | LCP element |
|---|---|---|---|---|---|---|---|
| `/en` | ISR 300 | ______ | ______ | ______ | ______ | ______ | ______ |
| `/en/incidents` | dynamic | ______ | ______ | ______ | ______ | ______ | ______ |
| `/en/incidents/incident-01` | ISR + tags | ______ | ______ | ______ | ______ | ______ | ______ |
| `/en/reviews/review-01` | ISR + tags | ______ | ______ | ______ | ______ | ______ | ______ |
| `/en/blog/blog-01` | ISR + tags | ______ | ______ | ______ | ______ | ______ | ______ |
| `/en/hobt` | static | ______ | ______ | ______ | ______ | ______ | ______ |

**Targets, for reference only — nothing is enforced until Lesson 21.4.** LCP ≤ 2500 ms,
CLS ≤ 0.10, TBT ≤ 200 ms, Performance ≥ 0.90, First Load JS ≤ 180 kB gzip per route and
≤ +10 kB against `main`.

### Field data: none yet, and why

PageSpeed Insights and CrUX need a **public URL** and 28 days of real traffic. This site is on
`http://localhost:3000`. No tunnel was set up, deliberately: a tunnel adds its own latency and
TLS handshake, so it measures the tunnel. The first real field reading is taken against the
Vercel preview URL in Module 24.

`GET`-free, PII-free RUM is collected locally by `src/app/api/vitals/route.ts`: metric name,
value, rating, `navigationType` and the route **pattern**. No IP, no user agent, no query string,
no session identifier — enforced by a Zod enum, not by discipline.

### The instrument's own cost

`WebVitals.tsx` is a Client Component in the root layout, so it is on every route.

| | Before | After | Delta |
|---|---|---|---|
| First Load JS, `/en` | ______ | ______ | ______ |
| Static/dynamic markers | unchanged | unchanged | — |

### Collected from `docs/architecture.md`

| Parked by | Measurement | Value |
|---|---|---|
| 14.5 | `/en/hobt` LCP element / time | ______ |
| 18.1 | per-page prerender cost | ______ ms |
| 18.4 | `x-nextjs-cache` MISS→HIT on `/en/incidents/incident-01` | ______ |
| 17.3 | First Load JS, App Router vs Faust template | ______ / ______ |

### Known gaps

- No field data. Module 24.
- No soft-navigation metrics: `WebVitals.tsx` flushes once per document, and a client-side route
  change reuses the same mount. Named and declined in Lesson 21.1 Task §3.
- Beacons are lost when a browser is killed without firing `pagehide` — which biases the sample
  away from the slowest sessions.
- `/en/incidents` is `dynamic`, so its TTFB is not comparable with the five cached routes.
```

```bash
# next-app
cd ..
git add docs/perf-baseline.md
git commit -m "perf: record pre-optimisation core web vitals baseline"
cd next-app
```

**Verify §8:**

- [ ] `docs/perf-baseline.md` exists, is committed, and carries a date.
- [ ] Six route rows, each with a real number in every column. A `______` left in the table is a
      measurement you did not take, and Lesson 21.2's before/after has nothing to subtract from.
- [ ] The field-data section says explicitly that there is none, and why.
- [ ] `npm run verify` and `npm test -- --run` are both clean.

---

## Verification

```bash
cd next-app
# A production build is running: `npm run build && npm start`.

# 1. The gate
npm run verify
# Expected: exit 0, silent

# 2. Both artifacts exist where the front matter says they do
test -f src/components/layout/WebVitals.tsx && test -f src/app/api/vitals/route.ts && echo ok
# Expected: ok

# 3. The baseline document exists, is dated, and has six route rows
test -f ../docs/perf-baseline.md && echo ok
# Expected: ok
grep -c 'Recorded:' ../docs/perf-baseline.md
# Expected: 1
grep -cE '^\| `/en(/[a-z0-9-]+)*` \|' ../docs/perf-baseline.md
# Expected: 6 — one row per budgeted route. Fewer means a route went unmeasured.
grep '^| `/en' ../docs/perf-baseline.md | grep -c '______'
# Expected: 0 — no blank left in a route row. Blanks elsewhere are fine while
#           Lessons 21.2-21.4 are still ahead of you; a blank here means
#           Lesson 21.2 has nothing to beat.

# 4. NEGATIVE — WebVitals.tsx reads no request-scoped API. THIS IS THE CHECK
#    THAT PROTECTS MODULE 18. A cookies() or headers() read reachable from the
#    root layout makes every route dynamic, with no error and no warning: the
#    build simply stops printing ○ and ● and starts printing ƒ.
grep -cE 'cookies\(|headers\(\)|next/headers' src/components/layout/WebVitals.tsx
# Expected: 0

# 5. NEGATIVE — and neither does the route handler use the next/headers form
grep -cE 'cookies\(|next/headers' src/app/api/vitals/route.ts
# Expected: 0

# 6. NEGATIVE — the client component does not import the limiter. Lesson 16.2
#    asserts no component imports it at all, and a limiter in a client bundle
#    would ship the Upstash SDK to every visitor.
grep -rl 'rate-limit' src/components/ | wc -l
# Expected: 0

# 7. NEGATIVE — nothing in the handler stores an IP or a user agent. The IP is
#    read for the rate-limit key on ONE line and written nowhere.
grep -cE "user-agent|userAgent|'ua'|\"ua\"" src/app/api/vitals/route.ts
# Expected: 0
grep -c 'x-forwarded-for' src/app/api/vitals/route.ts
# Expected: 1 — the limiter key, and only the limiter key.
grep -c 'console.log' src/app/api/vitals/route.ts
# Expected: 1 — one structured line, whose every field is in the Zod schema.

# 8. NEGATIVE — the schema is closed, so an extra key is a refusal and not a
#    silent strip. Without .strict(), Zod 3 drops unknown keys and a body
#    carrying `"ip"` would be accepted and quietly discarded — which makes the
#    "no PII" claim depend on Zod's default rather than on your schema.
grep -c '.strict()' src/app/api/vitals/route.ts
# Expected: 1
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/vitals \
  -H 'Content-Type: application/json' \
  -d '{"route":"/[locale]/hobt","navigationType":"navigate","ip":"203.0.113.7","metrics":[{"name":"LCP","value":10,"rating":"good"}]}'
# Expected: 400

# 9. NEGATIVE — a resolved URL cannot pass as a route. This is the privacy
#    control: it is an enum, not a sanitiser.
curl -s -X POST http://localhost:3000/api/vitals \
  -H 'Content-Type: application/json' \
  -d '{"route":"/en/incidents/dave-deleted-the-database","navigationType":"navigate","metrics":[{"name":"LCP","value":10,"rating":"good"}]}'
# Expected: {"error":"payload failed validation"}  — and a 400 status

# 10. NEGATIVE — a malformed body is a 400 with a DIFFERENT message, so a JSON
#     parse failure and a schema failure are distinguishable in a log
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/vitals \
  -H 'Content-Type: application/json' --data-binary 'not json at all'
# Expected: 400
curl -s -X POST http://localhost:3000/api/vitals \
  -H 'Content-Type: application/json' --data-binary '{'
# Expected: {"error":"body is not JSON"}

# 11. NEGATIVE — an unrated metric name is refused, including Next's own
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/vitals \
  -H 'Content-Type: application/json' \
  -d '{"route":"/[locale]","navigationType":"navigate","metrics":[{"name":"Next.js-hydration","value":40,"rating":"good"}]}'
# Expected: 400
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/vitals \
  -H 'Content-Type: application/json' \
  -d '{"route":"/[locale]","navigationType":"navigate","metrics":[{"name":"LCP","value":10,"rating":"quite-good"}]}'
# Expected: 400 — `rating` is an enum too. web-vitals emits exactly three values.

# 12. NEGATIVE — the payload is bounded. Six metrics is not a page view.
python3 -c 'import json;print(json.dumps({"route":"/[locale]","navigationType":"navigate","metrics":[{"name":"LCP","value":1,"rating":"good"}]*6}))' > /tmp/btt-vitals-big.json
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/vitals \
  -H 'Content-Type: application/json' --data-binary @/tmp/btt-vitals-big.json
# Expected: 400
rm /tmp/btt-vitals-big.json

# 13. NEGATIVE — GET is refused. You did not write a GET handler; Next returns
#     405 for a method a route file does not export. Asserted because "the
#     framework handles it" is a claim, and this is the test of it.
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/vitals
# Expected: 405
curl -s -o /dev/null -w '%{http_code}\n' -X PUT http://localhost:3000/api/vitals
# Expected: 405

# 14. A well-formed beacon is accepted, with no body
curl -s -D - -o /dev/null -X POST http://localhost:3000/api/vitals \
  -H 'Content-Type: application/json' \
  -d '{"route":"/[locale]/hobt","navigationType":"navigate","metrics":[{"name":"CLS","value":0.041,"rating":"good"}]}' \
  | grep -iE '^HTTP|^content-length'
# Expected: 204, and either no content-length or 0

# 15. NEGATIVE — mounting the instrument did NOT make any route dynamic. This is
#     the same comparison Task §4 made, re-run so it is part of the gate.
npm run build 2>&1 | sed -n '/Route (app)/,$p' > /tmp/btt-routes.txt
grep -cE '^[┌├└│] *ƒ +/\[locale\]' /tmp/btt-routes.txt
# Expected: 1 — `/[locale]/incidents` only, exactly as Lesson 18.1 left it.
#           A 2 or more means a request-scoped read reached the root layout.
grep -c 'ƒ /\[locale\]/hobt' /tmp/btt-routes.txt
# Expected: 0 — /hobt is `revalidate = false` and must stay static.

# 16. The instrument is mounted exactly once, in the one root layout there is
grep -c 'WebVitals' 'src/app/[locale]/layout.tsx'
# Expected: 2 — the import and the element
test -f src/app/layout.tsx && echo 'WRONG — there is no src/app/layout.tsx' || echo ok
# Expected: ok

# 17. NEGATIVE — no new dependency. useReportWebVitals ships with Next.
grep -c '"web-vitals"' package.json
# Expected: 0
grep -c "from 'next/web-vitals'" src/components/layout/WebVitals.tsx
# Expected: 1

# 18. NEGATIVE — the client component is silent. Lesson 12.3's smoke suite fails
#     a spec on any console output on any of its routes, and this component is
#     on all of them.
grep -c 'console' src/components/layout/WebVitals.tsx
# Expected: 0

# 19. The route pattern list is duplicated in two files ON PURPOSE — the client
#     computes it, the server is the trust boundary. Two places must agree, so
#     the gate asserts they do rather than trusting a comment.
for p in '/\[locale\]' 'incidents/\[slug\]' 'reviews/\[slug\]' 'blog/\[slug\]' 'hobt'; do
  printf '%s client=%s server=%s\n' "$p" \
    "$(grep -c "$p" src/components/layout/WebVitals.tsx)" \
    "$(grep -c "$p" src/app/api/vitals/route.ts)"
done
# Expected: a non-zero count on BOTH sides of every line. A zero on the server
#           side is a pattern the client will send and the server will 400.

# 20. NEGATIVE — the seeded corpus is untouched. Nothing in this lesson writes
#     to WordPress, and a drifted corpus invalidates every number above.
cd ../wordpress-headless
docker compose run --rm -T wpcli wp post list --post_type=incident --format=count
# Expected: 55
docker compose run --rm -T wpcli wp post list --post_type=post --format=count
# Expected: 12
cd ../next-app

# 21. Both suites still green
npm test -- --run
# Expected: 0 failures
npx playwright test
# Expected: 0 failures
```

If check 15 shows more than one `ƒ` under `/[locale]`, stop and read Lesson 18.1 Key Concept 4
before going further. Every budget in this module assumes the routes Lesson 18.1 made static are
still static, and a `ƒ` there is not a performance problem you can optimise your way out of.

## Control Questions

1. Your Lighthouse run reports LCP 1 900 ms and a Performance score of 0.94. CrUX, a month after
   launch, reports a 75th-percentile LCP of 4 100 ms. Explain how both can be correct
   simultaneously, then name the one change to your **measurement procedure** — not to the site —
   that would have predicted the field number.
2. `lighthouserc.json` in Lesson 21.4 will assert TBT and not INP. Give the mechanical reason,
   then describe a concrete regression this app could ship that would move INP badly while
   leaving TBT inside its budget.
3. The endpoint stores the route *pattern* rather than the resolved URL, and the pattern is a Zod
   enum rather than a regex or a string the client is trusted to have cleaned. Explain what the
   enum buys that a server-side sanitiser would not, and name the cost you accepted by choosing
   an enum.
4. `src/lib/rate-limit.ts` fails closed, so an unreachable Upstash means every beacon is refused
   with a `429`. Argue the case for failing *open* on this specific endpoint, then say why this
   course still refuses to — and identify what would have to be true about `/api/vitals` for you
   to change your mind.
5. `WebVitals.tsx` is mounted in `src/app/[locale]/layout.tsx` and renders `null`. Describe the
   full sequence of consequences if a colleague "improved" it by adding
   `const session = await getSession()` to the layout so beacons could be attributed to a user —
   naming which build output changes, which four earlier lessons stop being true, and why nothing
   would fail at compile time.

## Learn More

- [web.dev — Core Web Vitals](https://web.dev/articles/vitals) — the current definitions and
  thresholds, and the page to re-read whenever the metric set changes, as it did in 2024
- [web.dev — Largest Contentful Paint](https://web.dev/articles/lcp) — the element-promotion rule
  in Key Concept 1, and the list of element types that can even be the LCP element
- [web.dev — Cumulative Layout Shift](https://web.dev/articles/cls) — the session-window
  definition, with the worked example this lesson's ASCII diagram compresses
- [web.dev — Interaction to Next Paint](https://web.dev/articles/inp) — why INP replaced FID, and
  the three phases of an interaction, which is what Lesson 21.3 profiles
- [Lighthouse performance scoring](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring)
  — the metric weights, and the version-to-version changes that are the reason Key Concept 6
  insists you record the tool version
- [Next.js — `useReportWebVitals`](https://nextjs.org/docs/app/api-reference/functions/use-report-web-vitals)
  — the hook, the metric object it hands you, and the three Next-specific timings Task §3 filters
- [`web-vitals` attribution build](https://github.com/GoogleChrome/web-vitals#send-attribution-data)
  — what you would gain by installing the library yourself, which is the decision Task §3 defers
- [MDN — `navigator.sendBeacon()`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon)
  — including the "you cannot read the response" constraint that shapes the endpoint's `204`
- [CrUX documentation](https://developer.chrome.com/docs/crux) — the eligibility rules that
  explain, concretely, why a localhost origin has no field data and never will
