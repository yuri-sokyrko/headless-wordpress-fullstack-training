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

### 1. Two caches, and how to tell which one you are looking at

Both make repeated `fetch` calls disappear, which is why they get confused. They are separate
mechanisms with separate lifetimes, and every caching question in this module starts with
deciding which one you mean.

```
   ONE HTTP REQUEST TO NEXT
   ┌─────────────────────────────────────────────────────────────────────┐
   │  render pass                                                       │
   │    layout  ──▶ fetchGraphQL(SiteChrome)   ──┐                      │
   │    page    ──▶ fetchGraphQL(SiteChrome)   ──┤ REQUEST MEMOIZATION  │
   │    header  ──▶ fetchGraphQL(SiteChrome)   ──┘ one WP request       │
   │                          │                                         │
   └──────────────────────────┼─────────────────────────────────────────┘
                              ▼
                  ┌───────────────────────────┐
                  │       DATA CACHE          │  survives this request,
                  │  keyed on the whole       │  shared with every other
                  │  request, tagged          │  visitor, cleared by
                  └───────────────────────────┘  revalidate or a tag
                              │
                              ▼
                     WordPress :8080/graphql
```

| | Request memoization | Data cache |
|---|---|---|
| Scope | one render pass | one deployment |
| Lifetime | until the render ends | until `revalidate` elapses or a tag is invalidated |
| Shared between users | no — a render belongs to one request | **yes, and that is the point** |
| Opt in | automatic, always on | `next: { revalidate }` or `cache: 'force-cache'` |
| Opt out | not really | `cache: 'no-store'` |
| Keyed on | method, URL, body, headers | method, URL, body, headers |
| How you observe it | count WordPress requests during **one** page load | count WordPress requests across **two** page loads |
| How you clear it | you do not; it evaporates | `revalidateTag()` — Module 18 |
| Classic WordPress analogue | `wp_cache_get()` | `get_transient()` |

The observation column is the useful one, and both experiments in the Task are built on it: one
page load with three identical calls should produce one WordPress request; two page loads should
also produce one.

### 2. Request memoization, precisely

React memoizes `fetch` for the duration of a render. Two calls with the same method, URL, body
and headers return the same promise; the second one never leaves the process.

This is what makes component-level data fetching sane in an RSC app. In Classic WordPress the
equivalent instinct is fear: a template part that calls `get_post_meta()` is a template part you
have to think about, which is why you prime the meta cache before the loop. Here, a component
that needs site settings simply asks for them, from wherever it sits in the tree, and the ask is
free after the first one.

What it is **not**:

- It is not the data cache. Memoization ends when the render ends. It does not survive to the
  next request and it does not help a second visitor.
- It does **not** apply to `fetchGraphQLAuthed` in any useful way, because `no-store` responses
  are still memoized within one render — but you would rarely make the same authenticated call
  twice in one render anyway.
- It is **not** keyed on your intent. Two calls to the same operation with `{ first: 12 }` and
  `{ first: 13 }` are two different bodies and therefore two requests, even though the first
  twelve results are identical.

> **Memoization is what makes Lesson 10.5's `SiteChrome` split free.** Lesson 10.5 separates
> site settings from the primary menu into two documents, so Module 18 can invalidate a menu
> change without expiring the footer. That is two cache entries and two tags — and, because a
> layout and a header each asking once is memoized to one request per document per render, no
> extra WordPress traffic at all.

### 3. The data cache, and the Next 16 default that broke everyone's notes

Say this part out loud, because it is the single most common piece of stale knowledge in the
ecosystem: **in Next 16, `fetch` is not cached by default.** In Next 14 it was — `force-cache`
was the default and you opted *out* with `no-store`. Next 16 reversed it. Every Next 14 tutorial
you find, and a large fraction of the blog posts you will search for while debugging, describe
the opposite behaviour.

| | Next 14 | **Next 16** |
|---|---|---|
| `fetch` with no options | cached indefinitely | **not cached** |
| To cache | nothing to do | `cache: 'force-cache'` or `next: { revalidate: N }` |
| To not cache | `cache: 'no-store'` | nothing to do |
| Practical effect | you discovered caching by being burned by it | you discover caching by not getting it |

The consequence for this app is direct. A route that fetches without opting in is **dynamic**:
it re-renders per request and hits WordPress every time. That is correct behaviour and terrible
performance, and it is why the previous two lessons left a debt labelled "no cache policy". Every
`fetchGraphQL` call in the app gets a `revalidate` in the Task, and the ones that do not are
listed explicitly in the policy table with a reason.

### 4. Four postures, and what each one actually means

| Written as | Means | Route becomes | Use for |
|---|---|---|---|
| nothing (Next 16 default) | never cached | dynamic | nothing in this app — always be explicit |
| `cache: 'no-store'` | never cached, stated | dynamic | authenticated reads, health checks |
| `next: { revalidate: 300 }` | cached, stale after 300 s | static with ISR | **almost everything here** |
| `next: { revalidate: 0 }` | never cached | dynamic | the same as `no-store`, spelled worse |
| `next: { revalidate: false }` | cached forever, until a tag drops it | static | content that only ever changes by an editorial action |
| `cache: 'force-cache'` | cached forever, until a tag drops it | static | the same as `revalidate: false` |

Two pairs are synonyms and it is worth knowing which. `revalidate: 0` and `no-store` are the
same posture; prefer `no-store`, because "zero seconds of freshness" reads like a tuning value
and "do not store this" reads like a decision. `revalidate: false` and `force-cache` are also
the same posture; prefer `revalidate: false` when the entry is tagged, because it says "the tag
is the only thing that will ever expire this", which is exactly the contract Module 18 relies on.

Note what `revalidate: 300` does **not** mean: it does not mean "re-fetch every five minutes".
It means "an entry older than five minutes is stale". A stale entry is still served — to the
request that discovered the staleness — while a fresh one is fetched in the background. That is
stale-while-revalidate, and it is why an ISR route never makes a user wait for WordPress.

### 5. Route segment config, and the shortest window wins

There is a second place to write `revalidate`: as an export from the route file itself.

```tsx
// next-app/src/app/[locale]/incidents/page.tsx — segment-level, applies to the whole route
export const revalidate = 300;
```

The two interact by taking the **shortest** window. If the segment says `3600` and one `fetch`
inside it says `60`, the route revalidates at 60, because Next cannot serve a route as fresh
while part of its data is stale.

| | Per-`fetch` `next: { revalidate }` | Segment `export const revalidate` |
|---|---|---|
| Granularity | one request | every fetch in the route |
| Lives next to | the query it describes | the route |
| Interaction | **the shortest of the two wins** | same |
| This course uses | **this one, as the default** | only where a route needs a floor |

The verdict: put the number next to the query. The query is what knows how fast its data
changes, and a route that composes three queries with three different volatilities should not be
forced to pick one. The segment export stays available for the case where you genuinely mean "no
part of this page may be older than a minute" — which `/hobt` will want in Lesson 11.5.

### 6. Cache tags are the only handle you get

You did not choose the cache key (Lesson 10.1 Key Concept 5), so you cannot address a written
entry. A **tag** is a label you attach on the way in so you can address it on the way out.

The naming scheme, which is frozen because Module 18 has to reproduce it in PHP:

| Builder | Produces | Shape |
|---|---|---|
| `incidentTag('dns-took-down-checkout')` | `incident:dns-took-down-checkout` | one node |
| `postTag('the-intern-strikes-again')` | `post:the-intern-strikes-again` | one node |
| `reviewTag('acme-cloud')` | `review:acme-cloud` | one node |
| `pageTag('hobt')` | `page:hobt` | one node |
| `listTag('incident')` | `incidents` | every list of that type |
| `termTag('scapegoat', 'the-intern')` | `scapegoat:the-intern` | one term and its archives |
| `siteTag()` | `site-settings` | the SCF options page |
| `menuTag('primary')` | `menu:primary` | one menu location |

Lowercase, colon-separated, **singular for a node and plural for a list**. Note the deliberate
asymmetry in `listTag`: it takes the **singular** type name and returns the plural string, so
the call site reads `listTag('incident')` — "the list of incidents" — while the tag itself stays
`incidents`. One vocabulary at the call site, and `listTag('incidents')` is a compile error.

Every builder takes an optional trailing `locale`, and this app never passes it. Module 20 adds
`uk` and `de` and needs `incident:de:dns-ausfall` and `incidents:de`; leaving room now makes
that change additive instead of a signature break across nineteen call sites. It is the same
habit as Lesson 09.1's `[locale]` segment: the cheapest insurance in the course is a parameter
you do not use yet.

### 7. The tag is a contract between two systems

`revalidateTag()` is a Next function. It runs in Next. The content it invalidates lives in
WordPress, in another container, and in production on another host entirely.

```
   editor clicks Publish
        │
        ▼
   WordPress  save_post hook
        │  builds the SAME strings, in PHP:  "incident:dns" and "incidents"
        │  signs the payload with BTT_REVALIDATE_SECRET
        ▼
   POST http://host.docker.internal:3000/api/revalidate      (Module 18)
        │
        ▼
   Next route handler → revalidateTag('incident:dns')
                        revalidateTag('incidents')
```

There is no hook. WordPress cannot reach into Next's cache; it can only make an authenticated
HTTP call and name a string. So the tag is not an implementation detail — it is an **interface
between two codebases written in two languages**, and the failure mode when they disagree is
the worst kind:

> **`incident:dns` in TypeScript and `incident-dns` in PHP invalidates nothing, returns HTTP
> 200, logs nothing, and looks exactly like a caching bug for as long as you are willing to
> stare at it.** That is why the strings are built by typed functions in one file rather than
> typed out where they are used, why Module 12 unit-tests the exact output, and why Module 18
> starts by reading `tags.ts` rather than by writing PHP.

Nothing in `tags.ts` invalidates anything yet. That debt is deliberate and it is paid in Module
18 — this lesson's job is to make sure every cached entry is *addressable* by the time the
webhook exists.

### 8. `unstable_cache` and `React.cache`, mentioned and deferred

Both caches above are `fetch` caches. Two other tools exist for work that is not a `fetch`, and
this app does not need them yet.

| Tool | Caches | Scope | This course |
|---|---|---|---|
| `next: { revalidate, tags }` | one `fetch` | across requests | everywhere |
| `unstable_cache(fn, keys, opts)` | any async function's result | across requests, taggable | Module 18, if a non-`fetch` read appears |
| `cache(fn)` from React | any function's result | **one render pass** | not needed — every read here is a `fetch`, and `fetch` is already memoized |
| `'use cache'` | a function or component | across requests | needs `cacheComponents: true` on Next 16; not used here |

`React.cache` is the memoization of Key Concept 2 applied to something that is not `fetch`. If
this app ever reads a file, hits the REST base at `WP_REST_BASE`, or computes something
expensive per render, that is the tool. Today, every WordPress read goes through `fetchGraphQL`,
so the mechanism you already have covers it.

The name `unstable_cache` is doing real work — the API is expected to change, and the course
prefers a tagged `fetch` for exactly that reason. Next 16 is where some of that change landed:
`cacheLife` and `cacheTag` dropped their `unstable_` prefixes and became stable, the
`experimental.dynamicIO` and `experimental.useCache` flags were removed in favour of one
top-level `cacheComponents: true`, and `revalidateTag` grew a required second argument
(Lesson 18.2 §3). None of that is enabled here — `cacheComponents` is not a rename, it is an
opt-in to a different caching model that makes uncached data outside `<Suspense>` a build error —
but knowing the flag exists is what stops you reading a 2025 blog post as current.

### 9. An authenticated response must never be cached

This is Lesson 10.1 Key Concept 6, restated because this is the lesson where you are handing out
cache options and it would be easy to hand one to the wrong function.

`fetchGraphQLAuthed` hard-codes `cache: 'no-store'` and **has no options parameter**. There is
no `revalidate` for a caller to pass and no `tags` array to attach. That is not a convention, a
comment, or a lint rule — it is the shape of the function, and Verification check 9 proves it by
grepping the file.

The reason bears repeating in the language of consequences rather than of caching: the data
cache is keyed on the request and shared across visitors, so an `Authorization` header on a
cacheable fetch means the second person to ask the same question gets the first person's answer.
Two ordinary 200s in the log. No error anywhere.

### 10. What you can observe in `npm run dev`, and what you cannot

Getting this wrong makes the rest of the lesson unreproducible, so here it is explicitly.

| Observation | `npm run dev` | `npm run build && npm run start` |
|---|---|---|
| Request memoization within one render | ✅ works | ✅ works |
| The data cache across two requests | ❌ do not trust it | ✅ **this is where you measure it** |
| The build's static/dynamic classification | not printed | ✅ printed by `npm run build` |
| A `no-store` fetch hitting WordPress every time | ✅ | ✅ |
| An error boundary in production mode | ❌ dev shows the real message | ✅ Lesson 10.4 |

The development server reloads server code between requests, disables the full route cache, and
in Next 16 keeps its own short-lived cache for hot-module reloads. None of that is production
behaviour, and none of it is a bug — dev is optimised for seeing your edits, not for observing
caches. **Every data-cache measurement in this lesson runs against a production build.**
Memoization is a per-render mechanism, so it behaves the same in both.

---

## Task

### Step 1: Write `src/lib/graphql/tags.ts`

```ts
// next-app/src/lib/graphql/tags.ts
// The ONLY place cache tag strings are constructed. Two call sites have to agree
// on every string: the `fetch` that ATTACHES the tag, and the revalidation route
// Module 18 builds that EXPIRES it. `incident:dns` in one and `incident-dns` in
// the other invalidates nothing, returns 200 and logs nothing — a bug that looks
// exactly like a caching problem for as long as you are willing to stare at it.
// Module 12 unit-tests the exact output of every function below.
//
// WordPress never builds a tag string. Module 18's webhook sends IDENTIFIERS —
// type, post type, slug, locale — and the Next route turns them into tags with
// the functions here. That is deliberate: the cross-language contract is then a
// short enumerated vocabulary that Zod validates, so a drifted identifier is a
// loud 400 rather than a silent success.
//
// No `import 'server-only'` here, deliberately: this file is pure string manipulation
// with no secret and no I/O, and Module 12 runs its tests in a plain Node process where
// the `server-only` module throws on purpose.

/** The four content types that get their own tags. Singular — see `listTag`. */
export type ContentType = 'incident' | 'post' | 'review' | 'page';

/** Taxonomy prefixes. `stack` is shortened from `tech_stack`; the tag is not the slug. */
export type TaxonomyName = 'scapegoat' | 'severity' | 'stack';

const PLURAL: Record<ContentType, string> = {
  incident: 'incidents',
  post: 'posts',
  review: 'reviews',
  page: 'pages',
};

/** English plurals, spelled out rather than derived — `severitys` is not a word. */
const TAXONOMY_PLURAL: Record<TaxonomyName, string> = {
  scapegoat: 'scapegoats',
  severity: 'severities',
  stack: 'stacks',
};

/**
 * A slug is editorial input, so normalise it rather than trusting it. No ASCII
 * allowlist: WordPress slugs may be non-Latin, and Module 20 adds locales where they
 * are. The only forbidden character is the separator itself.
 */
function segment(slug: string): string {
  const value = slug.trim().toLowerCase();
  if (value === '') {
    throw new Error('cache tag: empty slug — the caller has nothing to tag with');
  }
  if (value.includes(':')) {
    throw new Error(`cache tag: slug "${slug}" contains ":", which is the separator`);
  }
  return value;
}

/** `type[:locale]:slug`. The locale segment exists for Module 20 and is omitted here. */
function nodeTag(type: ContentType, slug: string, locale: string | undefined): string {
  const parts = locale === undefined ? [type, slug] : [type, locale, slug];
  return parts.map(segment).join(':');
}

export function incidentTag(slug: string, locale?: string): string {
  return nodeTag('incident', slug, locale);
}

export function postTag(slug: string, locale?: string): string {
  return nodeTag('post', slug, locale);
}

export function reviewTag(slug: string, locale?: string): string {
  return nodeTag('review', slug, locale);
}

export function pageTag(slug: string, locale?: string): string {
  return nodeTag('page', slug, locale);
}

/**
 * Takes the SINGULAR type name and returns the plural tag: `listTag('incident')` reads
 * as "the list of incidents" at the call site, and produces `incidents`. Passing
 * `'incidents'` is a compile error, which is the whole reason for the asymmetry.
 */
export function listTag(type: ContentType, locale?: string): string {
  const plural = PLURAL[type];
  return locale === undefined ? plural : `${plural}:${segment(locale)}`;
}

/** `scapegoat:the-intern`, `severity:s1-catastrophic`, `stack:react`. */
export function termTag(taxonomy: TaxonomyName, slug: string): string {
  return `${taxonomy}:${segment(slug)}`;
}

/**
 * The LIST of terms in a taxonomy: `scapegoats`, `severities`, `stacks`.
 *
 * Separate from `listTag` on purpose. `listTag` takes a `ContentType` and
 * `taxonomyListTag` takes a `TaxonomyName`, so `listTag('scapegoat')` is a
 * compile error rather than the string `undefined` — and the two vocabularies
 * are genuinely different: a scapegoat is a term, not a post, and the thing
 * that changes it is `saved_term` rather than `transition_post_status`.
 *
 * Locale is APPENDED here, matching `listTag`, not infixed as it is for a node.
 */
export function taxonomyListTag(taxonomy: TaxonomyName, locale?: string): string {
  const plural = TAXONOMY_PLURAL[taxonomy];

  return locale === undefined ? plural : `${plural}:${segment(locale)}`;
}

/** The SCF options page from appendix 03 section 4.5. One entry, one tag. */
export function siteTag(): string {
  return 'site-settings';
}

/** `menu:primary`. Lesson 11.3 uses `menuTag('primary')` for the header nav. */
export function menuTag(location: string): string {
  return `menu:${segment(location)}`;
}
```

**Verify §1:**

- [ ] `npm run type-check` is silent.
- [ ] `listTag('incidents')` is a compile error. Try it, read the message, remove it.
- [ ] `incidentTag('')` throws rather than producing the tag `incident:`, which would match
      nothing and look like it worked.

### Step 2: Learn to watch WordPress's access log

Both experiments need one number: how many GraphQL requests WordPress received. Apache in the
`wordpress` container logs to stdout, so Compose has it.

```bash
# Paste this into your shell. `gqlog 60s` counts GraphQL POSTs in the last minute.
gqlog() {
  docker compose -f ../wordpress-headless/docker-compose.yml \
    logs --since="${1:-60s}" wordpress | grep -c 'POST /graphql'
}

# Prove the instrument works before you trust it
curl -s -o /dev/null -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' -d '{"query":"{ generalSettings { title } }"}'
gqlog 10s
```

**Verify §2:**

- [ ] `gqlog 10s` printed `1` immediately after that `curl`.
- [ ] `gqlog 10s` again, a minute later, prints `0`. The window is doing what it says.
- [ ] If you get `0` both times, `grep` is not finding the line: run
      `docker compose -f ../wordpress-headless/docker-compose.yml logs --tail=5 wordpress`
      and adjust the pattern to what your Apache log format actually prints. Fix the instrument
      before you measure anything with it.

### Step 3: Apply `revalidate` and `tags` to every query

Every `fetchGraphQL` call in the app gets a third argument. Two representative edits; the rest
follow the table in Step 4.

```tsx
// next-app/src/app/[locale]/incidents/page.tsx — the list route
import { fetchGraphQL } from '@/lib/graphql/client';
import { listTag } from '@/lib/graphql/tags';
import { IncidentsListDocument } from '@/gql/graphql';

// …inside the component:
//   const data = await fetchGraphQL(
//     IncidentsListDocument,
//     { first: 12 },
//     { revalidate: 300, tags: [listTag('incident')] }
//   );
```

```tsx
// next-app/src/app/[locale]/incidents/[slug]/page.tsx — the detail route
import { fetchGraphQL } from '@/lib/graphql/client';
import { incidentTag, listTag } from '@/lib/graphql/tags';
import { IncidentBySlugDocument } from '@/gql/graphql';

// …inside the component:
//   const data = await fetchGraphQL(
//     IncidentBySlugDocument,
//     { slug },
//     { revalidate: 3600, tags: [incidentTag(slug), listTag('incident')] }
//   );
```

Note the detail route carries **two** tags. Publishing one incident should drop that incident's
page and every list it appears on, and the cheapest way to express that is to tag the entry with
both. A tag costs nothing to attach and cannot be added retroactively.

**Verify §3:**

- [ ] `grep -rn "fetchGraphQL(" src/app/ | wc -l` and
      `grep -rn "revalidate" src/app/ | wc -l` agree, or you can name the exception.
- [ ] No string literal starting `'incident:` or `'post:` appears anywhere in `src/app/`.
- [ ] `npm run type-check` is silent.

### Step 4: Write the policy into `docs/api-contract.md`

An implicit cache policy is not a policy. Append the block below to `docs/api-contract.md`
under a new `## Cache policy (Lesson 10.3)` heading, next to the note Lesson 09.3 asked you for.
Module 18 reads it to decide what its webhook has to invalidate.

```markdown
Tags are built by `src/lib/graphql/tags.ts`. Never write a tag string by hand — Module 18's
WordPress webhook constructs the same strings in PHP, and a mismatch fails silently.

| Route | `revalidate` | Tags |
|---|---|---|
| `/[locale]` | 300 | `incidents`, `site-settings` |
| `/[locale]/incidents` | 300 | `incidents` |
| `/[locale]/incidents/[slug]` | 3600 | `incident:<slug>`, `incidents` |
| `/[locale]/blog` | 3600 | `posts` |
| `/[locale]/blog/[slug]` | 3600 | `post:<slug>`, `posts` |
| `/[locale]/reviews` | 3600 | `reviews` |
| `/[locale]/reviews/[slug]` | 3600 | `review:<slug>`, `reviews` |
| `/[locale]/scapegoats` | 600 | `scapegoats`, `incidents` |
| `/[locale]/hobt` | **60** | `page:hobt` |
| root layout — `SiteChrome` | 3600 | `site-settings` |
| root layout — `PrimaryMenu` (arrives in Lesson 11.3) | 3600 | `menu:primary` |
| `/api/health` | `no-store` | none |

Why the outliers:

- `/scapegoats` is 600, not 3600, because the leaderboard reads `count`, which WordPress
  updates whenever an incident is published. It carries `incidents` for the same reason.
- `/hobt` is 60 because `seats_left` drives a live urgency badge — see the content model
  contract, HOBT Promo. The route itself arrives in Lesson 11.5; the policy row exists now
  so the route is built against it rather than retrofitted.
- `/api/health` is `no-store` because a cached health check is not a health check.
- The root layout has **two** rows because Lesson 10.5 splits Lesson 05.4's `SiteChrome`
  into a settings document and a menu document. Two documents means two tags, so an editor
  reordering the menu does not expire the footer.
- Authenticated reads have no row. `fetchGraphQLAuthed` cannot be cached at all.
```

`seatsLeft` and the reason it is volatile are in
[the content model contract](../appendix/03-content-model-reference.md#44-hobt-promo) — link it
rather than copying the field list, so there is one place to change it.

### Step 5: Experiment 1 — see request memoization

Two identical calls in one render must produce one WordPress request. Add a temporary second
call to the incidents route and count.

```tsx
// next-app/src/app/[locale]/incidents/page.tsx — TEMPORARY, reverted at the end of this step
async function MemoizationProbe() {
  const again = await fetchGraphQL(
    IncidentsListDocument,
    { first: 12 },
    { revalidate: 300, tags: [listTag('incident')] }
  );
  return <p>probe saw {again.incidents?.nodes?.length ?? 0} incidents</p>;
}
```

Render `<MemoizationProbe />` somewhere in the page, then:

```bash
npm run build
npm run start & SERVER_PID=$!
sleep 6
curl -s -o /dev/null "http://localhost:3000/en/incidents?probe=$RANDOM"
gqlog 20s
kill "$SERVER_PID"
```

**Verify §5:**

- [ ] `gqlog 20s` prints `1`, not `2`. Same document, same variables, same headers — one entry,
      one request.
- [ ] Change the probe's variables to `{ first: 13 }`, rebuild, repeat. Now it prints `2`. The
      key is the whole request body, so a different variable is a different call.
- [ ] Revert both the probe component and its render. `git diff` on the route file is empty.

If the count is `0`, the build already prerendered the page and the request happened during
`npm run build` rather than during your `curl`. That is the data cache doing its job and it is
Experiment 2's subject — add `?probe=$RANDOM` to force an on-demand render, as the command
above does.

### Step 6: Experiment 2 — see the data cache

One page, loaded twice, must produce one WordPress request.

```bash
npm run build
npm run start & SERVER_PID=$!
sleep 6

curl -s -o /dev/null http://localhost:3000/en/incidents
curl -s -o /dev/null http://localhost:3000/en/incidents
gqlog 20s
kill "$SERVER_PID"
```

**Verify §6:**

- [ ] `gqlog 20s` prints `0`. Both loads were served from the build's prerender, and WordPress
      was not consulted at all. That is the strongest possible version of the result.
- [ ] Now do it the other way: `docker compose ... stop wordpress`, load the page again, and it
      still returns 200 from the cached render. Start WordPress again afterwards.
- [ ] Repeat with `npm run dev` instead. The numbers will not match, and Key Concept 10 says
      why. Do not chase it.

### Step 7: Typecheck, lint, commit

```bash
npm run verify
git add -A
git commit -m "feat(next): typed cache tags and an explicit per-route revalidate policy"
```

---

## Verification

```bash
cd next-app

# Re-paste the counter if this is a new shell
gqlog() {
  docker compose -f ../wordpress-headless/docker-compose.yml \
    logs --since="${1:-60s}" wordpress | grep -c 'POST /graphql'
}

# 1. The tag builders exist and are the only place tags are made
grep -c '^export function' src/lib/graphql/tags.ts
# Expected: 8  (incidentTag postTag reviewTag pageTag listTag termTag siteTag menuTag)

# 2. Types and lint clean
npm run type-check && npm run lint
# Expected: no output

# 3. The build classifies the routes and prints their revalidate windows
npm run build
# Expected: a route table. /en/incidents and /en is prerendered with ISR; /api/health
#           is dynamic. The exact columns move between Next minor releases — read the
#           symbol and the number, not the layout.

# 4. Data cache: two loads, no WordPress traffic
npm run start & SERVER_PID=$!
sleep 6
curl -s -o /dev/null http://localhost:3000/en/incidents
curl -s -o /dev/null http://localhost:3000/en/incidents
gqlog 20s
# Expected: 0 — both served from the prerender written during `npm run build`

# 5. Request memoization: one on-demand render, one WordPress request per document
curl -s -o /dev/null "http://localhost:3000/en/incidents?bust=$RANDOM"
gqlog 15s
# Expected: 1 — even though the layout and the page both fetch during that render
kill "$SERVER_PID"

# 6. NEGATIVE — an opted-out fetch hits WordPress on every request.
#    Flip one route to revalidate: 0, rebuild, load twice, count TWO.
sed -i.bak 's/revalidate: 300/revalidate: 0/' 'src/app/[locale]/incidents/page.tsx'
npm run build
npm run start & SERVER_PID=$!
sleep 6
curl -s -o /dev/null http://localhost:3000/en/incidents
curl -s -o /dev/null http://localhost:3000/en/incidents
gqlog 20s
# Expected: 2 — the opt-out works, and this is what "no cache policy" cost you in Module 09
kill "$SERVER_PID"
mv 'src/app/[locale]/incidents/page.tsx.bak' 'src/app/[locale]/incidents/page.tsx'

# 7. NEGATIVE — no hand-typed tag string anywhere outside tags.ts
grep -rn "tags: \['" src/ ; echo "exit=$?"
# Expected: no matches, exit=1. Every tags array is built from imported functions.
grep -rn "'incident:\|'post:\|'review:\|'page:\|'menu:" src/ --include='*.tsx' ; echo "exit=$?"
# Expected: no matches, exit=1

# 8. NEGATIVE — the singular/plural rule is enforced by the compiler.
#    Probe from a throwaway file. `git checkout -- tags.ts` would fail anyway:
#    you created that file in this lesson, so git has never heard of it.
cat > src/lib/graphql/_tag-probe.ts <<'EOF'
// next-app/src/lib/graphql/_tag-probe.ts
// TEMPORARY — proves listTag rejects an already-plural argument. Deleted below.
import { listTag } from '@/lib/graphql/tags';
export const wrong = listTag('incidents');
EOF
npm run type-check 2>&1 | grep -c "not assignable"
# Expected: 1 or more
rm src/lib/graphql/_tag-probe.ts
npm run type-check
# Expected: no output — clean again

# 9. NEGATIVE — fetchGraphQLAuthed has no cache option at all
grep -n 'revalidate' src/lib/graphql/client.ts
# Expected: hits inside FetchGraphQLOptions, nextOptions and fetchGraphQL only.
#           fetchGraphQLAuthed's signature is (document, variables, token) — three
#           parameters, none of them an options bag. Nothing to pass, nothing to forget.

# 10. The policy is written down where Module 18 will look for it
grep -c 'Cache policy' ../docs/api-contract.md
# Expected: 1
```

If check 6 prints `1`, the `sed` did not match — open the route file and confirm the literal
`revalidate: 300` is there before concluding anything about the cache.

## Control Questions

1. A layout and three components all call `fetchGraphQL(SiteChromeDocument)` during one page
   render, and the page is loaded a hundred times in five minutes with `revalidate: 300`. State
   the number of WordPress requests and attribute each saving to the correct cache.
2. `revalidate: 0` and `cache: 'no-store'` are the same posture, and `revalidate: false` and
   `cache: 'force-cache'` are the same posture. Say which spelling this course prefers in each
   pair and give the reason, which is not a technical one.
3. `listTag` takes `'incident'` and returns `'incidents'`. Explain why the asymmetry is
   deliberate, and describe the failure that would follow from letting callers pass the plural
   directly.
4. Module 18's webhook builds tag strings in PHP. Describe precisely what a learner observes
   when the PHP builds `incident-dns` and the TypeScript built `incident:dns` — the HTTP status,
   the log output, and the page.
5. Every data-cache measurement in this lesson requires `npm run build && npm run start`.
   Explain what the development server does differently, and name one observation from this
   lesson that **is** valid in dev.

## Learn More

- [Next.js — `fetch` API reference](https://nextjs.org/docs/app/api-reference/functions/fetch) —
  `cache` and `next.revalidate` in the framework's own words, including the Next 16 default
- [Next.js — `revalidateTag`](https://nextjs.org/docs/app/api-reference/functions/revalidateTag)
  — the function Module 18 calls with the strings you just made constructible
- [Next.js — route segment config](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config)
  — `export const revalidate`, `dynamic` and the rest of the segment-level knobs from Key
  Concept 5
- [Next.js — `unstable_cache`](https://nextjs.org/docs/app/api-reference/functions/unstable_cache)
  — read this when you first need to cache something that is not a `fetch`
- [React — `cache`](https://react.dev/reference/react/cache) — per-render memoization for
  functions, which is what request memoization is under the hood
- [MDN — `Request.cache`](https://developer.mozilla.org/en-US/docs/Web/API/Request/cache) — the
  standard `cache` values Next extends, so you can see which parts are web platform and which
  are framework
- [WordPress — Transients API](https://developer.wordpress.org/apis/transients/) — worth
  rereading with the two-cache distinction in mind; the analogy holds better than you expect
