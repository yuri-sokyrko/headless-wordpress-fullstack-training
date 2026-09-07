---
title: 'Rendering Strategies'
module: 18
lesson: 1
teaches: [static-vs-isr-vs-dynamic, generate-static-params, force-dynamic, next-cache-layers, per-route-strategy]
produces: ['next-app/src/app/[locale]/hobt/page.tsx', 'next-app/src/app/[locale]/incidents/page.tsx', 'next-app/src/app/[locale]/incidents/[slug]/page.tsx', 'next-app/src/app/[locale]/scapegoats/[slug]/page.tsx']
requires: [10.1, 14.2]
---

# Lesson 18.1 — Rendering Strategies

## Quick Overview

Every route in this app has been rendering however Next.js happened to infer it should. That
inference is usually right, and "usually" is not a strategy. In this lesson you decide, per route,
which of four modes it uses — fully static, ISR with a time window, dynamic, or `force-dynamic`
and uncached — and you write the reason next to each one. Some of the reasons are technical:
`/incidents` reads `searchParams` for its facets, so it *cannot* be static, though its inner
GraphQL fetch is still cached per variable-set, which is the distinction most people miss. Some
are commercial: `/hobt` is fully static with `revalidate: false` because conversion is measured on
that page, and a page whose numbers you are tracking should not be quietly regenerating on a
timer — it changes when an editor changes it, via the webhook in Lesson 18.3, and at no other
time. And some are absolute: `/account` and `/incidents/submit` are `force-dynamic` and uncached
because they are authenticated, and an authenticated response must never enter a shared cache.

The other half of the lesson is `generateStaticParams`, and the trap inside it. The obvious
implementation asks WordPress for every incident slug and pre-renders all of them. With 40 seeded
incidents that is fine; with 10,000 it turns a 40-second build into a 25-minute one, burns build
minutes on pages nobody will ever request, and makes every deploy slower forever. So the function
is **scoped** — the newest 50 per content type — and the long tail is served by on-demand ISR: the
first request for an old incident renders it, caches it, and every subsequent request is static.
You will measure both, because the difference between "I read that this is slow" and "I watched my
own build go from 40 seconds to 25 minutes" is the difference between a guideline and a habit.

By the end of this lesson you will have:

- A written per-route strategy table covering every route in the app, each row justified, matching
  the table in the module README
- Explicit `export const dynamic` / `export const revalidate` / `generateStaticParams` on every
  route rather than relying on inference
- `/hobt` fully static with `revalidate: false`, and a note on what that commits you to
- `generateStaticParams` scoped to the newest 50 per type, with a build-time log line proving how
  many pages it emitted
- Two `npm run build` transcripts — unscoped versus scoped — with wall-clock times, kept as
  evidence
- `/account` and `/incidents/submit` proven uncached: a `curl` with two different sessions returns
  two different pages

## Classic WP Analogy

The rendering-strategy question exists in Classic WordPress too; it is just spelled differently.
A vanilla WordPress page is **dynamic** — PHP runs, `WP_Query` hits MySQL, HTML is assembled per
request. Bolt on WP Super Cache or W3 Total Cache in page-cache mode and you have **static**: the
first visitor generates an HTML file, everyone after that gets served the file by Apache without
PHP running at all. Set that cache to expire after five minutes and you have re-invented **ISR**.
Add a "don't cache pages for logged-in users" rule — which every page-cache plugin has, and which
is on by default for a reason — and you have re-invented `force-dynamic` for authenticated routes.

| Classic WordPress | This stack |
|---|---|
| plain PHP rendering per request | `export const dynamic = 'force-dynamic'` |
| WP Super Cache page cache, no expiry | static, `revalidate: false` |
| page cache with a 300-second expiry | ISR, `export const revalidate = 300` |
| "never cache for logged-in users" | uncached authenticated routes + `fetchGraphQLAuthed` |
| the object cache / transients | Next's Data Cache |
| `wp_cache_flush()` | `revalidateTag()` — Lesson 18.2, and far more surgical |
| pre-generating the cache with a crawler | `generateStaticParams` at build time |

That last row is a genuinely useful mapping. Cache-warming crawlers exist because the first
visitor to an uncached page pays for everyone else. `generateStaticParams` is a build-time warmer,
and the reason to scope it is exactly why nobody warms their entire archive: the tail is not worth
the time.

**Where the analogy breaks down:** a WordPress page cache is a **whole-page** cache, all or
nothing, and the plugin decides for the entire site. Next caches at four levels at once — Request
Memoization inside one render, the Data Cache for `fetch` results across requests, the Full Route
Cache for rendered HTML, and the Router Cache in the browser — and each has its own lifetime and
its own invalidation. That is why a page can be `dynamic` while the query inside it is still
cached, a combination WP Super Cache cannot express and the one that makes `/incidents` fast
despite reading `searchParams`. It is also why "I cleared the cache and it is still stale" has four
possible explanations here instead of one.

The second break, and it is a cost worth naming: a WordPress page cache is invisible to your code.
You install it and your theme is unchanged. Next's caching is expressed *in* your code, per route,
so it is your responsibility on every new file — and a route that forgets to declare its strategy
gets whatever the framework infers, which is fine right up until the day the inference changes on
a minor upgrade.

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
