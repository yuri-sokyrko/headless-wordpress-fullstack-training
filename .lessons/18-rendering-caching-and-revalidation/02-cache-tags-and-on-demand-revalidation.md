---
title: 'Cache Tags & On-Demand Revalidation'
module: 18
lesson: 2
teaches: [cache-tags, revalidate-tag, tag-naming-contract, data-cache, no-store-for-authed]
produces: ['next-app/src/lib/graphql/tags.ts']
requires: [10.1, 18.1]
---

# Lesson 18.2 — Cache Tags & On-Demand Revalidation

## Quick Overview

A time-based `revalidate` is a guess: too short and you rebuild pages nobody changed, too long and
editors watch a stale page and lose faith in the stack. **Cache tags** replace the guess with a
fact. Every `fetch` in the data layer declares what it depends on — `next: { tags: ['incident:dns',
'incidents'] }` — and when that thing changes, one `revalidateTag('incident:dns')` call invalidates
every cached entry carrying that tag, wherever it was used, without touching anything else. This is
what makes "static and fresh" a real combination rather than a slogan, and it is the capability
Module 17's ADR declined a framework to keep.

The engineering problem is not the API, it is the **strings**. `revalidateTag` takes a string;
`next: { tags }` takes strings; and from Lesson 18.3 onward WordPress sends a payload from which
those strings are derived in PHP. Three places, one vocabulary, no compiler checking any of it. So
tag naming is centralised in `src/lib/graphql/tags.ts` — pure functions like `incidentTag(slug)`
and `listTag('incident')` that every query and every revalidation call must go through — and the
webhook route derives its tags from the same functions rather than concatenating its own. Drift
here is a real and nasty bug class: `incident:dns` versus `incident-dns` invalidates nothing,
returns `200`, logs nothing, and looks exactly like a caching bug for as long as you are willing to
stare at it. The other rule to re-state, because this is the lesson where someone tries it: never
add a tag to an authenticated fetch. `fetchGraphQLAuthed` hard-codes `cache: 'no-store'` and takes
no cache options at all, precisely so that a per-user response cannot be tagged, cached, and then
handed to a different user.

By the end of this lesson you will have:

- `src/lib/graphql/tags.ts` as the single source of tag names, with a documented naming scheme and
  a unit test pinning the exact output strings
- Every read query in `src/graphql/` tagged through those functions, with no inline tag strings
  left anywhere in `src/`
- `revalidateTag` wired into the Server Actions from Module 16, replacing the placeholder calls
- A working manual proof: change a title in wp-admin, call `revalidateTag` from a temporary script,
  and watch only the affected page change
- A grep-based guard — no string literal starting `incident:` outside `tags.ts` — ready to become a
  lint rule in Module 24
- A written note on why `fetchGraphQLAuthed` refuses cache options, and what would break if it
  accepted them

## Classic WP Analogy

You have built this mechanism by hand. A transient key like
`btt_incidents_recent_{$scapegoat_id}` is a cache entry, and the moment you write one you inherit
the invalidation problem: something has to delete it when the underlying posts change, so you hook
`save_post` and call `delete_transient()`. If you have used a persistent object cache you have gone
further and used **cache groups** — `wp_cache_set( $key, $value, 'btt_incidents' )` and then
`wp_cache_delete()` per key, because WordPress has no "flush this group" primitive and you end up
maintaining an index of your own keys just to invalidate them.

| Classic WordPress | This stack |
|---|---|
| `set_transient( 'btt_incident_dns', … , 600 )` | `fetch(…, { next: { tags: ['incident:dns'], revalidate: 600 } })` |
| `delete_transient( 'btt_incident_dns' )` | `revalidateTag('incident:dns')` |
| an object-cache **group** | a **tag** — but a tag can be attached to many entries at once |
| a hand-kept index of transient keys to flush | `tags.ts` — the same idea, finally in one file |
| `save_post` → `delete_transient()` | `transition_post_status` → the webhook (Lesson 18.3) |
| `wp_cache_flush()` | `revalidatePath('/', 'layout')` — the sledgehammer, avoid |
| "don't cache for logged-in users" | `cache: 'no-store'`, hard-coded in `fetchGraphQLAuthed` |

The pain point maps too. Everyone who has written transient-based caching in WordPress has shipped
a bug where the key used to write and the key used to delete were not quite the same string —
usually because one path included the locale and the other did not. Cache tags do not fix that
class of bug; they only move it. Which is exactly why `tags.ts` exists.

**Where the analogy breaks down:** `delete_transient()` runs inside the same WordPress process that
owns the cache, so invalidation is local, synchronous and immediate. `revalidateTag` runs in a
**different application on a different host**, and the thing that knows content changed —
WordPress — cannot call it directly. It has to make a network request, which means it has to be
authenticated, which is why Lesson 18.3 is a whole lesson about an HMAC signature rather than a
one-liner. The invalidation is also *not* immediate in the way a transient delete is: the tag is
marked stale and the page is rebuilt on the next request, so the first visitor after a publish pays
the render cost.

The second break: a transient has one key and one value. A tagged `fetch` result can carry several
tags, and the same tag can be attached to results across dozens of routes — so `revalidateTag('incidents')`
correctly invalidates the archive, the home page's latest-incidents block, the scapegoat page's
count and the sitemap in one call. There is no WordPress equivalent to that fan-out, and it is the
single strongest reason this architecture can be static at all.

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
