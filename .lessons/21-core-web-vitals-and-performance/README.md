# Module 21 — Core Web Vitals & Performance Budgets

## Prerequisites

Before starting this module you should have completed:

- **Module 11** — the design system, because fonts and layout are two of the three CLS causes
- **Module 14** — `next/image` and the `BlockRenderer`, because editor-supplied media is your
  largest LCP risk
- **Module 18** — rendering strategies, because a route's cache mode sets the ceiling on its TTFB
- **Module 20** — i18n, because the client-side message catalogue you may have just shipped is
  now measurable

> ⚠️ **Do not optimise before you measure, and do not measure once.** Every instinct you have
> about what is slow will be wrong at least once in this module, and the two most common
> self-inflicted wounds — `priority` on every image, and `next/dynamic` around components that
> were never the problem — both come from guessing. Lesson 21.1 exists to produce a number you
> can be judged against later.

## Starting State

Module 20 complete: the whole site works in en/uk/de with a switcher and a valid hreflang
cluster.

```bash
# 1. All three locales render
for l in en uk de; do
  curl -s -o /dev/null -w "$l %{http_code}\n" http://localhost:3000/$l/incidents
done
# Expected: en 200, uk 200, de 200

# 2. The hreflang cluster is reciprocal and includes x-default
curl -s http://localhost:3000/de/incidents | grep -c 'rel="alternate"'
# Expected: 4  — en, uk, de and x-default

# 3. A production build succeeds, because everything below is measured on a prod build
cd next-app && npm run build
# Expected: no errors; note the First Load JS column — you will be comparing against it
```

## What You'll Learn

- **The three Core Web Vitals** — LCP, INP and CLS: what each measures, what each is caused by,
  and the thresholds Google actually uses
- **Lab versus field** — why Lighthouse and CrUX disagree, which one is the truth, and which one
  you can put in CI
- **Real-user measurement** — `useReportWebVitals` posting to your own `/api/vitals`, and what to
  do with the data once you have it
- **LCP and CLS mechanics** — image priority and sizing, `next/font` and `font-display`, reserved
  space, and the third-party embed that shifts your layout 400 ms in
- **JavaScript weight** — `@next/bundle-analyzer`, a real client-component audit, `next/dynamic`,
  `next/script` strategies, and why hydration cost is not the same as bundle size
- **INP and long tasks** — what blocks the main thread on a mostly-static site, and why the
  incident filter is the honest suspect
- **Budgets and ratchets** — `lighthouserc.json`, per-route First Load JS limits, and a delta
  check against `main` that makes a regression somebody's problem while they still remember why

## What You'll Build

- `src/components/layout/WebVitals.tsx` and `src/app/api/vitals/route.ts` — field data from real
  sessions, with no PII in the payload
- `docs/perf-baseline.md` — committed, dated, per-route numbers before any optimisation, so every
  later claim is checkable
- `@next/bundle-analyzer` wired behind an env flag, and a client-component inventory with a
  justification per `'use client'`
- Concrete fixes: hero image strategy, `next/font` with correct subsets for Cyrillic, reserved
  space for every dynamic region, `next/script` strategies for analytics and Turnstile
- `lighthouserc.json` with real assertions on the six key routes
- A bundle-budget check that fails a pull request on a First Load JS regression
- The ratchet written down: today's numbers as thresholds, and a documented process for raising them

After this module the key routes pass Core Web Vitals on a production build, the numbers are
recorded in the repository, and a regression fails a check instead of being discovered by a user.

## Lessons

| # | Lesson | New Technology | What You Build |
|---|---|---|---|
| 1 | [Measuring Core Web Vitals](01-measuring-core-web-vitals.md) | Lighthouse, PageSpeed Insights, `web-vitals` | `/api/vitals`, `docs/perf-baseline.md` |
| 2 | [Fixing LCP & CLS](02-fixing-lcp-and-cls.md) | `next/font`, `priority`, `sizes`, aspect ratios | A fast hero and a stable layout |
| 3 | [JavaScript Weight & INP](03-javascript-weight-and-inp.md) | `@next/bundle-analyzer`, `next/dynamic`, `next/script` | A smaller client bundle and a shorter TBT |
| 4 | [Performance Budgets & Guardrails](04-performance-budgets-and-guardrails.md) | Lighthouse CI, bundle budgets | `lighthouserc.json` and a PR-blocking budget |

## The Budgets

Enforced from Lesson 21.4, on a production build, on the six key routes: `/`, `/incidents`,
`/incidents/[slug]`, `/reviews/[slug]`, `/blog/[slug]`, `/hobt`.

| Metric | Budget | Measured by | Why this number |
|---|---|---|---|
| First Load JS per route | ≤ 180 KB gzip | `next build` output | Roughly React + the router + one modest island |
| First Load JS delta vs `main` | ≤ +10 KB gzip | CI comparison job | Catches the accidental barrel import, not the deliberate feature |
| LCP | ≤ 2500 ms | Lighthouse CI, mobile preset | Google's "good" threshold |
| CLS | ≤ 0.10 | Lighthouse CI | Google's "good" threshold |
| TBT | ≤ 200 ms | Lighthouse CI | The lab proxy for INP; INP itself is field-only |
| Lighthouse performance | ≥ 0.90 | Lighthouse CI | Re-stated as a merge gate in Lesson 24.5 |

> **Start every threshold at "no worse than today", then ratchet.** A gate introduced at an
> aspirational number gets disabled within a week — someone needs to ship, the check is red for
> reasons unrelated to their change, and the fastest path is `continue-on-error: true`. Set the
> budget to your measured baseline plus a small margin, make it block, and then **raise it in a
> dedicated pull request whose only content is the new number.** That PR is a conversation about
> performance. A perpetually red check is not.

## How to Work

1. **Work 21.1 completely before touching anything else.** It produces `docs/perf-baseline.md`.
   Every later lesson claims an improvement, and a claim without a before-number is a guess.
2. **Measure on `npm run build && npm start`, never `npm run dev`.** Dev mode has no
   minification, no tree shaking and a live-reload socket. Its numbers are fiction.
3. **Throttle, and use the same throttling every time.** An unthrottled desktop Lighthouse run
   makes every site look good and every change look like it did nothing.
4. **Commit after every lesson**, including the baseline document.
   `git commit -m "perf: record pre-optimisation core web vitals baseline"`
