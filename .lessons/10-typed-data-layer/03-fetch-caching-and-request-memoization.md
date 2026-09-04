---
title: 'Fetch Caching & Request Memoization'
module: 10
lesson: 3
teaches: [fetch-cache, cache-tags, request-memoization, revalidate, no-store, cache-tag-naming]
produces: ['next-app/src/lib/graphql/tags.ts']
requires: [10.1, 10.2]
---

# Lesson 10.3 — Fetch Caching & Request Memoization

## Quick Overview

A Server Component that fetches on every request is a PHP page without a page cache: correct,
and slow. Next.js layers two different caching mechanisms over `fetch`, and they are easy to
confuse because both make repeated calls disappear. **Request memoization** dedupes identical
calls within a single render pass — the layout and the page can both ask for site settings and
WordPress is hit once. The **data cache** persists results across requests and across users,
until a `revalidate` window expires or a tag is invalidated. This lesson separates them, shows
you how to observe each one, and gives every route in the app an explicit cache policy.

The lasting artifact is `src/lib/graphql/tags.ts`, the one place cache tag strings are
constructed. Tags are how Module 18 makes publishing in WordPress update the live site in
seconds: the editor's save fires a signed webhook, the webhook calls `revalidateTag('incident:dns')`,
and every cached response carrying that tag is dropped. That only works if the tag WordPress
sends and the tag Next attached are the same string — so they get built by a typed function,
not typed out by hand in twelve files. Getting the naming scheme right now is what makes
Module 18 a short module.

By the end of this lesson you will have:

- `next-app/src/lib/graphql/tags.ts` — typed tag builders for content nodes, taxonomy terms, lists and site settings
- An explicit `revalidate` and `tags` policy on every query in the app, written down in one table
- `/hobt` on a shorter revalidate window than the rest of the site, because `seatsLeft` drives a live badge
- Proof of request memoization: two identical calls in one render, one entry in the WordPress access log
- Proof of the data cache: two page loads, one WordPress request, and the cache indicator in the `npm run dev` output

## Classic WP Analogy

WordPress gives you both of these caches, and you have used both, probably without naming
them:

| Classic WordPress | Next.js |
|---|---|
| `wp_cache_get()` / `wp_cache_set()` — non-persistent object cache | request memoization, within one render |
| `get_transient()` / `set_transient($k, $v, 600)` | the data cache, with `next: { revalidate: 600 }` |
| `delete_transient($k)` | `revalidateTag(tag)` |
| `clean_post_cache($id)` invalidating a group | one `revalidateTag('incident:dns')` dropping many entries |
| A page-cache plugin storing whole HTML documents | the full route cache and ISR (Module 18) |
| `wp_suspend_cache_addition()` for a bulk job | `cache: 'no-store'` |

The default object cache in WordPress lives for exactly one request and then evaporates; that
is request memoization. A transient survives between requests and has an expiry; that is the
data cache with `revalidate`. If you have ever wrapped an expensive `WP_Query` in
`get_transient()` and then had to remember to `delete_transient()` in a `save_post` hook, you
have already built, by hand, the thing this lesson configures declaratively.

The analogy breaks in three ways, and each one is a trap.

**You do not choose the cache key.** A transient key is yours to name, which means you can
collide two different queries under one key, and it also means you can invalidate precisely.
Next keys entries on the whole request — method, URL, body, headers — so collisions are
impossible and precise invalidation is impossible too. Tags exist because of that: they are the
only handle you get on a cached entry after it is written. Note the corollary that catches
people out: two GraphQL calls with the same query and the same variables are the *same* cache
entry, so adding a variable you do not use is enough to split them.

**A transient is per-site; the data cache is per-deployment and shared across every visitor.**
Cache a response that varies by user and you have built a data leak. This is precisely why
`fetchGraphQLAuthed` in Lesson 10.1 hard-codes `cache: 'no-store'` rather than accepting a
cache option, and why that constraint is enforced by the type signature rather than by a
comment.

**Nothing in WordPress invalidates itself from the outside.** `delete_transient()` runs inside
WordPress, in the same process that owns the cache. Here the cache lives in Next and the
content lives in WordPress, in a different container, on a different host in production. There
is no hook. The only way WordPress can invalidate a Next cache entry is to make an authenticated
HTTP call and say so — which is the signed webhook in Module 18, and the reason the tag naming
scheme you write today is a contract between two systems rather than a private implementation
detail.

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
