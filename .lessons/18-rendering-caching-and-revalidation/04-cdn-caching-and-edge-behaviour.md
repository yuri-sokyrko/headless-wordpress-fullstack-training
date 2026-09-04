---
title: 'CDN Caching & Edge Behaviour'
module: 18
lesson: 4
teaches: [cdn-cache-layers, cache-control-headers, stale-while-revalidate, cookies-bust-cache, stale-on-error]
produces: ['next-app/next.config.ts']
requires: [18.1, 18.3]
---

# Lesson 18.4 — CDN Caching & Edge Behaviour

## Quick Overview

Your cache tags and your webhook control Next's own caches. In production there is another cache in
front of all of them — Vercel's Edge Network — and it obeys HTTP headers rather than
`revalidateTag`. This lesson makes those layers visible: which of them served the response you are
looking at, what `Cache-Control`, `s-maxage` and `stale-while-revalidate` actually instruct a
shared cache to do, and how to read the `x-vercel-cache` and `age` headers to tell a `HIT` from a
`MISS` from a `STALE`. Then it makes the layers deliberate, including the least intuitive rule of
the set: **a response that varies by cookie cannot be shared.** The moment a route reads a session
cookie it becomes personalised, so it must be excluded from the shared cache rather than merely
given a short lifetime. This is the CDN-level restatement of the module's headline rule — an
authenticated response must never enter a shared cache — and it is why `/account` is
`force-dynamic` and why `fetchGraphQLAuthed` accepts no cache options at all. It is the
highest-severity bug this architecture can produce: not an outage, a **disclosure**.

The second half is resilience, and it starts from a fact you will meet in production regardless of
how careful you are: WordPress will be unavailable sometimes — a deploy, a plugin update, a
container restart. Next must survive that without turning a five-second WordPress restart into a
five-second site outage. So every fetch in the data layer gets a timeout, and every list page gets
a stale-on-error path: if the origin fails, serve the last good cached render rather than throwing
into `error.tsx`. `stale-while-revalidate` is the header-level version of the same idea — the CDN
serves stale bytes instantly while it fetches fresh ones behind the request. You will prove it
works the crude way, with `docker compose stop wordpress`, and Module 23 turns that into a
permanent E2E spec: stop WordPress, hit the list page, assert cached content renders instead of a
`500`.

By the end of this lesson you will have:

- A diagram-backed inventory of the four cache layers in play, in order, with the header that
  controls each
- `next.config.ts` `headers()` entries setting explicit `Cache-Control` / `s-maxage` /
  `stale-while-revalidate` for static assets and cacheable routes
- A documented split between cacheable and personalised routes, with the cookie-varies rule stated
  as a rule and not a preference
- A `curl -I` transcript showing `x-vercel-cache: MISS` then `HIT` then `STALE` on the same URL,
  and `age` climbing
- A timeout on every outbound GraphQL fetch, plus a stale-on-error path on the incidents and blog
  list pages
- The manual proof: `docker compose stop wordpress`, reload `/en/incidents`, see cached content
  rather than a `500` — the spec Module 23 automates

## Classic WP Analogy

You have run this exact stack before, with Cloudflare in front of WordPress. The layers are the
same and so are the surprises. Cloudflare caches by URL and honours `Cache-Control` from the
origin. WP Super Cache or W3TC caches rendered pages at the origin. The object cache caches query
results. And the very first thing every WordPress-plus-Cloudflare tutorial tells you is the rule
that matters most here: **bypass the cache when a `wordpress_logged_in_*` cookie is present**, or
you will serve one logged-in user's admin bar — and eventually their private content — to
everybody.

| Classic WordPress + CDN | This stack |
|---|---|
| Cloudflare edge cache | Vercel Edge Network |
| a page-cache plugin at the origin | the Full Route Cache |
| the object cache / transients | the Data Cache |
| "bypass cache if `wordpress_logged_in_*` is set" | uncached authenticated routes, `no-store` on authed fetches |
| Cloudflare "Purge by URL" / "Purge Everything" | `revalidateTag` / `revalidatePath` — Lesson 18.2 |
| `cf-cache-status: HIT` | `x-vercel-cache: HIT` |
| `Cache-Control: s-maxage=…` from PHP | the same header, from `next.config.ts` or the route |
| `Vary: Cookie` making a page uncacheable | the same effect, which is why personalised routes are split out |
| Cloudflare "Always Online" | `stale-while-revalidate` plus your own stale-on-error path |

If you have ever debugged "why does the CDN keep serving the logged-out version of this page to
logged-in users", you already understand why this app separates cacheable routes from personalised
ones at the route level instead of trying to be clever with headers per request. Splitting the
routes is the fix; a `Vary` header is a workaround.

**Where the analogy breaks down:** in WordPress, everything behind the CDN is one origin, so a
`Cache-Control` header is the *only* dial and purging is all-or-nothing per URL. Here there are two
independent invalidation systems that do not know about each other. `revalidateTag` invalidates
Next's caches and does **nothing** to the CDN's copy of a response the CDN is holding under
`s-maxage`. A stale page can therefore be stale at exactly one layer, and finding out which one is
the entire debugging skill. The rule that follows: let Next's ISR and tags own HTML freshness, and
keep long-lived `s-maxage` for immutable assets rather than for pages.

The second break, in your favour: WordPress with a page cache has no concept of "serve this stale
copy because the database is down" — if PHP cannot reach MySQL you get a white screen, and
Cloudflare's Always Online is a best-effort snapshot bolted on from outside. Here the stale render
is a first-class part of the framework's model, and being explicit about timeouts and fallbacks
turns "WordPress is deploying" from an outage into a slightly out-of-date page nobody notices.

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
