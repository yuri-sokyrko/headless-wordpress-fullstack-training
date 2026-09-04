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

<!-- TODO: Phase B -->

---

## Task

<!-- TODO: Phase B -->

---

## Verification

<!-- TODO: Phase B -->

## Control Questions

<!-- TODO: Phase B -->

## Learn More

<!-- TODO: Phase B -->
