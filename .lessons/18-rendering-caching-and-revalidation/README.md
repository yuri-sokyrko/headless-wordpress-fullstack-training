# Module 18 — Rendering, Caching, ISR & Revalidation

## Prerequisites

Before starting this module you should have completed:

- **Module 10** — `fetchGraphQL`, `fetchGraphQLAuthed`, and `src/lib/graphql/tags.ts`
- **Module 16** — the Server Actions whose `revalidateTag` calls have been aspirational until now
- **Module 17** — `draftMode()`, which is the one thing that must *never* be cached
- **Appendix 04 §2** — `BTT_FRONTEND_URL`, `BTT_REVALIDATE_SECRET` and the `host.docker.internal` note

> ⚠️ **One rule outranks everything else in this module: an authenticated response must never
> enter the shared Data Cache.** `fetchGraphQLAuthed` from Lesson 10.1 hard-codes
> `cache: 'no-store'` and accepts no cache options, so the mistake is unrepresentable rather than
> merely discouraged. If you ever "fix" that function to accept a `next` option, you have built the
> highest-severity bug this architecture can produce: one user's account page served to another.

## Starting State

Module 17 complete: editors click Preview in wp-admin and see the draft rendered by Next.js
through `BlockRenderer`, `/api/preview` exchanges a single-use token and enables `draftMode()`,
`PreviewBanner` shows and exits cleanly, `faust-spike/` has been removed and the ADR recording
preview-only adoption is committed, and both suites are green.

```bash
# 1. The spike is gone and nothing depended on it
test ! -d faust-spike && ! grep -rq '@faustwp' next-app/package.json next-app/src/ \
  && echo "clean"
# Expected: clean

# 2. Suites green before you touch caching
npm test -- --run && npx playwright test
# Expected: 0 failures
```

## What You'll Learn

- **The four rendering strategies** — static, ISR, dynamic and `force-dynamic` — chosen per route, with reasons
- **`generateStaticParams`, scoped** — why enumerating everything turns a 40-second build into 25 minutes
- **Next's caches** — Request Memoization, the Data Cache, the Full Route Cache and the Router Cache
- **`revalidateTag`** — on-demand ISR, and one module that owns every tag name so nothing drifts
- **HMAC-signed webhooks** — `X-BTT-Signature`, a ±300 s replay window, `timingSafeEqual`, Zod on the body
- **`blocking: false, timeout: 2`** — never blocking an editor's Publish on a network call
- **CDN behaviour** — `s-maxage`, `stale-while-revalidate`, cookies busting the cache, reading HIT/MISS
- **Surviving a broken origin** — timeouts and a stale-on-error path for when WordPress is mid-deploy

## What You'll Build

- A per-route rendering configuration for every route in the app, written down and justified
- `src/lib/graphql/tags.ts` promoted into the single source of truth for tag names, shared in shape
  with the webhook payload WordPress sends
- `includes/Revalidate.php` — `transition_post_status`, `saved_term` and `acf/save_post` hooks
  posting a signed payload to Next
- `src/app/api/revalidate/route.ts` — timestamp window, constant-time HMAC compare, Zod parse,
  `revalidateTag`
- Cache-header inspection, a documented split between cacheable and personalised routes, and a
  resilience path where a list page renders stale content rather than a `500` when WordPress is down

After this module, publishing in WordPress updates the live site in seconds. The build arc's
promise for Module 18 is one signed HTTP request wide.

## Lessons

| #  | Lesson | New Technology | What You Build |
|----|--------|----------------|----------------|
| 01 | [Rendering Strategies](01-rendering-strategies.md) | `dynamic`, `revalidate`, `generateStaticParams` | The per-route strategy table, applied |
| 02 | [Cache Tags & On-Demand Revalidation](02-cache-tags-and-on-demand-revalidation.md) | `next: { tags }`, `revalidateTag` | `tags.ts` as the single source of tag names |
| 03 | [The WordPress Revalidation Webhook](03-the-wordpress-revalidation-webhook.md) | HMAC-SHA256, `wp_remote_post` | `Revalidate.php` + `/api/revalidate`, end to end |
| 04 | [CDN Caching & Edge Behaviour](04-cdn-caching-and-edge-behaviour.md) | `s-maxage`, `stale-while-revalidate` | Verified cache headers, a resilience path |

## Per-Route Rendering

Built in Lesson 18.1 and defended there. Every row is a decision, not a default.

| Route | Strategy | Why |
|---|---|---|
| `/[locale]` | ISR, `revalidate: 300` | Mostly editorial, cheap to keep warm |
| `/[locale]/hobt` | SSG, `revalidate: false` | **Webhook-only.** Conversion is measured here — it must be static and never mid-rebuild |
| `/[locale]/incidents` | dynamic | Reads `searchParams` for facets; the inner GraphQL fetch is still cached per variable-set |
| `/[locale]/incidents/[slug]` | ISR + tags, newest 100 pre-rendered | On-demand ISR covers the long tail |
| `/[locale]/blog/[slug]`, `/reviews/[slug]`, `/scapegoats/[slug]` | ISR + tags, newest 50 / 20 / 20 | Term counts and posts both change on publish |
| `/[locale]/account`, `/incidents/submit` | `force-dynamic`, uncached | Authenticated. **Never** in the shared Data Cache |
| `/[locale]/[...slug]` | ISR + tags | Editor-composed WP pages |

`generateStaticParams` is **bounded per content type** — a window sized to how fast that type
grows, never the whole archive. Lesson 09.4 already set those bounds (100 incidents, 50 posts, 20
reviews) and Lesson 18.1 defends the asymmetry. Enumerating 10,000 incidents turns a 40-second
build into a 25-minute one and pre-renders pages nobody will request. On-demand ISR is the correct
answer for the tail, and Lesson 18.1 measures the per-page cost the projection is built from.

## The Revalidation Path

```
Editor clicks Update in wp-admin
        │
        │ transition_post_status | saved_term | acf/save_post
        ▼
 includes/Revalidate.php
        │  body = {"type":"post","postType":"incident","slug":"dns","locale":"en"}
        │  ts   = time()
        │  sig  = hash_hmac('sha256', ts . '.' . body, BTT_REVALIDATE_SECRET)
        │
        │  wp_remote_post( BTT_FRONTEND_URL . '/api/revalidate', [
        │     headers  => [ 'X-BTT-Timestamp' => ts,
        │                   'X-BTT-Signature' => 'sha256=' . sig ],
        │     blocking => false,     ← the editor's Publish never waits
        │     timeout  => 2 ] )      ← a slow Vercel is not an editorial outage
        ▼
 Next  POST /api/revalidate      (no cookies — CSRF is structurally impossible)
        │  1. |now - ts| <= 300 s ................ else 400   replay guard
        │  2. timingSafeEqual(sig, expected) ..... else 401   no reason echoed
        │  3. Zod.parse(body) .................... else 400
        │  4. revalidateTag('incident:dns'); revalidateTag('incidents')
        │  5. 200 {"revalidated":["incident:dns","incidents"]}
        ▼
 Next rebuilds the affected pages on the next request. Public sees the change in seconds.
```

> ⚠️ **`localhost:3000` will not work from inside the container.** Next runs on the host, so
> WordPress in Compose must post to `host.docker.internal:3000` — and on Linux that needs
> `extra_hosts: ["host.docker.internal:host-gateway"]`. Combined with `blocking: false`, which
> discards the response, this is the number-one cause of "my webhook silently does nothing".

## How to Work

1. **Read `## Quick Overview` and `## Classic WP Analogy`.** Lesson 18.2's analogy — transient keys
   and `wp_cache_delete()` group invalidation — is what makes cache tags click.
2. **Work `## Task` in order.** Strategies, then tags, then the webhook, then the CDN. Building the
   webhook before the tags exist means signing a payload that invalidates nothing.
3. **Run `## Verification`, negatives first.** A revalidation endpoint must reject an unsigned
   request, a wrong signature, and a correctly-signed request with a stale timestamp. Prove all
   three before you celebrate the happy path.
4. **Commit after every lesson.** `git commit -m "feat(cache): revalidate incident tags from a signed webhook"`
