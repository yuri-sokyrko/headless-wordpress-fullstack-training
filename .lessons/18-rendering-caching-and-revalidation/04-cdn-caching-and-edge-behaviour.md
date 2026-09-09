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

### 1. Five layers now, and the one that ignores your tags

Lesson 18.1 counted four caches. In production there is a fifth in front of all of them, and it is
the only one `revalidateTag` cannot touch.

```
  browser              CDN / edge            Next server              WordPress
  ┌────────────┐   ┌──────────────────┐  ┌──────────────────────┐   ┌──────────┐
  │ HTTP cache │   │ shared cache     │  │ FULL ROUTE CACHE     │   │ WPGraphQL│
  │ + ROUTER   │──▶│ keyed on the URL │─▶│ rendered HTML        │──▶│          │
  │   CACHE    │   │ (and Vary)       │  │ DATA CACHE           │   │          │
  └────────────┘   └──────────────────┘  │ REQUEST MEMOIZATION  │   │          │
                                          └──────────────────────┘   └──────────┘
   max-age          s-maxage               revalidate / tags
   no-store         stale-while-revalidate  revalidateTag
   ▲                ▲                       ▲
   │                │                       └── revalidateTag reaches HERE
   │                └── ...and NOWHERE further left. Nothing in your code
   └── ...or here.       invalidates a copy the CDN is already holding.
```

| Layer | Controlled by | Invalidated by | Lifetime you chose |
|---|---|---|---|
| Router Cache (browser) | `Cache-Control` on the RSC payload | `router.refresh()`, a hard reload | Next's default: ~30 s dynamic, ~5 min static |
| Browser HTTP cache | `max-age` | the user, effectively never | `max-age=31536000, immutable` on hashed assets |
| **CDN / shared cache** | **`s-maxage`, `stale-while-revalidate`** | **an explicit purge API call. Not `revalidateTag`** | whatever you set — and you own the consequence |
| Full Route Cache | `export const revalidate`, tags | `revalidateTag`, `revalidatePath` | per route, Lesson 18.1 |
| Data Cache | per-`fetch` `revalidate`, tags | `revalidateTag` | per query, Lesson 10.3 |

**The asymmetry is the whole lesson.** `revalidateTag('incident:incident-01')` drops the Data
Cache entry and the Full Route Cache entry, and the CDN — which is holding a perfectly good copy of
the old HTML under `s-maxage=3600` — keeps serving it for the rest of the hour. Your logs show a
successful revalidation. Your `curl` to the origin shows the new page. Your users see the old one.

So a stale page can be stale at **exactly one layer**, and finding out which one is the entire
debugging skill:

| Symptom | Stale layer |
|---|---|
| stale in the browser, fresh in `curl` | Router Cache or browser HTTP cache |
| stale in `curl` from anywhere, fresh in `curl --resolve` to the origin | **CDN** |
| stale in `curl` to the origin, fresh in GraphiQL | Full Route Cache or Data Cache |
| fresh everywhere, stale in wp-admin | you are looking at a draft |

### 2. The rule that follows: ISR owns pages, `s-maxage` owns assets

Given that asymmetry, there is one defensible split and this course takes it.

| | Long `s-maxage` on HTML | ISR + tags on HTML |
|---|---|---|
| Freshness after a publish | up to `s-maxage`, and no way to shorten it | seconds |
| Purging | a CDN API call your webhook does not make | `revalidateTag`, which it does |
| Bytes served from the edge | more | fewer, on a cache miss |
| Number of systems that must agree | **two** | one |

**The verdict: no HTML route in this application gets an `s-maxage` from `next.config.ts`.** Next
already emits an appropriate `Cache-Control` for an ISR route derived from its `revalidate`, and
that number is the one your tags can actually override. Long `s-maxage` is reserved for responses
whose bytes at a URL **never change** — content-hashed build output — where a year is correct
because a change is a new URL.

The reversal condition, stated so the decision is auditable: if you put a CDN you control in front
of this app **and** you are willing to make Lesson 18.3's webhook purge two systems instead of one,
then HTML at the edge becomes correct. Until then, the second system is a cache nothing can
invalidate, and the cost of forgetting is measured in hours of stale pages.

The cost of this choice, stated plainly: a cache miss reaches your Next server rather than being
absorbed at the edge, so a traffic spike on a cold route is your problem rather than the CDN's.
That is the trade, and it is worth it because the alternative is a freshness bug you cannot fix
without a deploy.

### 3. `max-age`, `s-maxage`, `stale-while-revalidate`, and who each one is talking to

Four directives, and the useful distinction is **which cache is being addressed**.

| Directive | Addresses | Means |
|---|---|---|
| `max-age=N` | every cache, including the browser | fresh for N seconds |
| `s-maxage=N` | **shared caches only** — CDN, proxy. Browsers ignore it | fresh for N seconds at the edge, overriding `max-age` there |
| `stale-while-revalidate=N` | shared caches | for N seconds past expiry, **serve the stale copy immediately** and refresh in the background |
| `private` | shared caches | **you may not store this at all.** The browser still may |
| `no-store` | every cache | store nothing, anywhere, ever |
| `immutable` | every cache | do not even send a revalidation request |

Two combinations that come up constantly:

```
# A hashed asset. The URL changes when the bytes change, so a year is correct.
Cache-Control: public, max-age=31536000, immutable

# A shared-cacheable response the BROWSER must always recheck.
Cache-Control: public, max-age=0, s-maxage=2678400, stale-while-revalidate=86400
#              ▲            ▲               ▲                      ▲
#              │            │               │                      └ a day of
#              │            │               └ 31 days at the edge     instant
#              │            └ browser rechecks every time            stale bytes
#              └ shared caches may store it
```

`private, no-store` is the pair this module cares most about, and it is two statements rather than
one: `private` says "not in a shared cache" and `no-store` says "not anywhere". Writing both is not
redundant — an old proxy that does not understand one may understand the other, and stating the
intent twice costs nothing.

`stale-while-revalidate` is the header-level version of exactly what ISR does inside Next. Same
idea, different layer: serve the copy you have, fetch a fresh one behind the request, and never make
a user wait for an origin.

### 4. Reading the layer, locally and in production

You cannot see `x-vercel-cache` on your laptop, because you have no Vercel in front of you. Say so
rather than pretending, and assert on what is actually there.

| Header | Where it comes from | What it tells you |
|---|---|---|
| `x-nextjs-cache: HIT \| MISS \| STALE` | `next start`, on an ISR route | **the Full Route Cache**, locally. The header this lesson asserts on |
| `x-vercel-cache: HIT \| MISS \| STALE \| PRERENDER` | Vercel's edge, in production only | the **CDN**. Absent locally, and faking it would teach you nothing |
| `age: N` | any shared cache | seconds since the shared copy was stored. Usually absent locally |
| `cache-control` | your origin — Next, or `next.config.ts` | what you *asked* for, which is the thing to check first |

> **The ground truth is not a header.** Count WordPress requests. `gqlog` from Lesson 10.3 Step 2
> is version-independent and cannot be wrong: if two page loads produce zero GraphQL POSTs, the
> response came from a cache, whatever any header says. Every header above is a report; the
> request count is the observation. When they disagree, believe the count.

In production, the sequence to expect on a fresh ISR route is `x-vercel-cache: MISS`, then `HIT`
with `age` climbing, then `STALE` once the window passes, then `HIT` again with `age` reset. A
`PRERENDER` means you are being served the build-time render and nothing has revalidated yet.

### 5. A response that varies by cookie cannot be shared

This is the module's headline rule, restated at the CDN layer, and it is the one with the
worst-case outcome.

A shared cache keys on the URL. If your response depends on something that is *not* in the URL — a
session cookie — then two users asking for the same URL are asking for different documents, and a
cache that does not know that will hand the first user's document to the second.

```
   ❌  GET /en/account         Cookie: btt_at=<sam's jwt>     → Sam's submissions
       cached at the edge under the key "/en/account"
   ❌  GET /en/account         Cookie: btt_at=<dana's jwt>    → SAM'S SUBMISSIONS
       HTTP 200. No error. Two happy log lines.
```

The instinct is `Vary: Cookie`. Do not reach for it, and the reason is not that it fails to work:

| | `Vary: Cookie` | Splitting the routes |
|---|---|---|
| Correctness | correct in principle | correct |
| Cache hit rate | ~zero — **every** cookie value is a separate key, including `NEXT_LOCALE` | full, on the routes that are shareable |
| Failure mode if somebody forgets | a leak | a slower page |
| Where the decision is visible | one header, in one config file | the route's own segment config |
| Reviewable | you have to know to look | `export const dynamic = 'force-dynamic'` is in the diff |

**The verdict: split the routes.** `/account` and `/incidents/submit` are `force-dynamic` and
carry `private, no-store`; everything else has no reason to read a cookie at all. This is the same
conclusion every WordPress-plus-Cloudflare guide reaches from the other direction — "bypass the
cache when `wordpress_logged_in_*` is present" — except that here the bypass is a property of the
route rather than a rule in a dashboard somebody can edit.

Note the second-order rule that falls out: **a response carrying `Set-Cookie` must never be
shared.** Next will not put one in a static render, but a route handler can, and Lesson 17.2's
`/api/preview` does exactly that.

### 6. This is a disclosure, not an outage

Worth its own section, because it changes how you triage it.

| | An outage | This |
|---|---|---|
| Who notices | everyone, immediately | nobody |
| In the logs | 500s, alerts, a pager | HTTP 200 |
| Time to detection | minutes | a user support ticket, weeks later |
| Blast radius | requests during the incident | every request served from the poisoned entry |
| Remediation | fix and deploy | fix, deploy, purge, **and disclose** |

**A cached authenticated response is the highest-severity bug this architecture can produce**, and
the reason is entirely about detection. An outage announces itself. A cache that serves one user's
account page to another produces no signal at all — the response is a valid 200, the page renders,
and the only person who could notice is a stranger looking at somebody else's name.

Which is why the defence is structural rather than procedural, and why it is repeated at four
layers: `fetchGraphQLAuthed` has no cache options, the route is `force-dynamic`, middleware sets
`private, no-store`, and `next.config.ts` sets it again for the paths middleware's matcher excludes.
Any one of them would probably be enough. "Probably enough" is not a standard you want for a bug
whose detection time is measured in weeks.

### 7. `draftMode()`'s cookies must never enter a shared cache

Lesson 17.2 enables draft mode by setting `__prerender_bypass` and `__next_preview_data`. Both are
Next-managed, both are httpOnly, and both make the bearer's render **different from everybody
else's**.

The rule, which is Key Concept 5 applied to preview: a preview response varies by cookie, so it
cannot be shared. Concretely, in this application:

- `draftMode().isEnabled` makes the route dynamic for that request, so there is no Full Route Cache
  entry to poison.
- Every preview fetch is `fetchGraphQL(document, variables)` with **no** `revalidate` and **no**
  `tags`. Next 15's `fetch` is uncached by default, so omitting the options *is* the opt-out —
  there is no `cache` parameter on this client to reach for, and inventing one would be a worse
  answer than omitting two.
- `__prerender_bypass` and `__next_preview_data` appear in no `Vary` and no `s-maxage`-carrying
  route. `/api/preview` and `/api/preview/exit` are `private, no-store` in `next.config.ts`.

> **The one thing that would break this.** Putting an unpublished draft into a shared cache under
> the published URL means anonymous visitors read unpublished editorial content — embargoed
> announcements, half-written incident reports, salaries in a draft About page. That is a
> disclosure with the same detection profile as Key Concept 6, arriving through a feature whose
> whole purpose is to show people things they are not supposed to see yet.

### 8. There is already a timeout. Do not add a second one

`src/lib/graphql/client.ts` has had `signal: AbortSignal.timeout(TIMEOUT_MS)` on every request
since Lesson 10.1, with `TIMEOUT_MS` at 8000. Read it before you write anything, because the
instinct here is to add a resilience timeout on top and that instinct produces a bug.

```
   ONE timeout (correct)                TWO timeouts (what to avoid)
   ─────────────────────────            ──────────────────────────────
   fetch(signal: 8 s)                   fetch(signal: 8 s)
        │                               wrapped in Promise.race(…, 5 s)
        │ 8 s                                │
        ▼                                    │ 5 s — the race resolves
   AbortError → one Error with a         ▼
   message naming the operation      a rejection with NO cause, while the
   and the deadline                  underlying fetch keeps running for
                                     three more seconds, holding a socket
```

Two deadlines mean the shorter one wins and the longer one leaks: the request is still in flight,
still holding a connection, still going to arrive at WordPress. And the error you get is from the
wrapper, so it carries none of the context `execute()` attaches — no operation name, no
`{ cause }`.

**Eight seconds is the number, it is already there, and this lesson's job is to catch what it
throws.** If you want to change it, change `TIMEOUT_MS`; there is exactly one place.

### 9. Stale-on-error: what is free, and what you write

The `docker compose stop wordpress` proof at the end of this lesson demonstrates **two different
mechanisms**, and attributing the result to the wrong one is how people conclude that Next handles
this for you.

| Situation | What happens | Whose code |
|---|---|---|
| The route has an ISR entry, the window expired, the origin is down | Next serves the existing HTML and the background revalidation fails silently | **free** — this is ISR working as designed |
| The route has an ISR entry and the window has not expired | served from cache; the origin is never contacted | free |
| A **new** variable set — a `?q=` nobody has searched before | the fetch throws, and without a catch the user gets `error.tsx` | **yours** |
| A route with no cached entry at all after a deploy | same | **yours** |

Rows one and two are why `/en/incidents/incident-01` survived Lesson 18.1's verification with
WordPress stopped. Row three is why this lesson writes a `try`/`catch`: a list page whose facets are
in the URL has an unbounded number of variable sets, and the first visitor to any new one is
holding an uncached render against a dead origin.

So the list pages get a degraded render rather than an error boundary: the heading, the filters,
and a `role="status"` notice saying the list may be out of date. Lesson 10.4's `error.tsx` is
exactly what this exists to avoid reaching — an error boundary is the correct response to *your*
bug and the wrong response to *somebody else's* deploy.

**Be honest about the limit.** A degraded render on a cold route shows an **empty** list, not stale
content, because there is nothing stale to show. "Stale rather than broken" only applies where a
cache entry exists; everywhere else the promise is "empty and labelled rather than a 500".

And this path must **not** apply to an authenticated route. A down WordPress must never cause
`/account` to serve anything at all, because the only thing it could serve is a cached page
belonging to whoever asked last. `requireSession()` throwing is the correct outcome there.

### 10. `next.config.ts` has one owner per key

This file is edited by six lessons and none of them may reformat another's work.

| Key | Owner |
|---|---|
| `reactStrictMode`, `images.remotePatterns` | 09.1 |
| `images.formats`, `qualities`, `minimumCacheTTL` | 14.5 |
| `experimental.serverActions.allowedOrigins` | 15.5 |
| **`async headers()`** | **this lesson creates it.** Lesson 24.2 appends security headers to the same function |
| `trailingSlash`, `async redirects()` | 19.4 |
| the bundle-analyzer wrapper | 21.3 |

So the Task shows an **anchored fragment** and not a whole file. The file already holds the other
keys; adding yours means adding one property to the object, not retyping it. Lesson 19.4 is adding
`trailingSlash` and `redirects()` at the same point in the course, and a whole-file listing from
either lesson would silently delete the other's work.

`headers()` returns an array of `{ source, headers }` objects, matched in order against the request
path, and `source` uses the same path syntax as `redirects()` — `:path*` for a wildcard segment,
`:locale` for a single one. A response can pick up entries from more than one match, so keep the
sources disjoint rather than clever.

---

## Task

### Step 1: Read the timeout you already have

Before writing any resilience code, confirm there is exactly one deadline in the data layer and
find out what it is.

```bash
cd next-app
grep -n 'TIMEOUT_MS\|AbortSignal' src/lib/graphql/client.ts
```

**Verify §1:**

- [ ] `TIMEOUT_MS` is defined **once** and used **once**, in `execute()`, as
      `signal: AbortSignal.timeout(TIMEOUT_MS)`. The value is `8000`.
- [ ] `grep -c 'Promise.race\|setTimeout' src/lib/graphql/client.ts` is `0`. If you are about to
      add either, reread Key Concept 8 first — two deadlines mean the shorter one wins and the
      longer one leaks a live socket.
- [ ] `sed -n '/no response from WordPress within/p' src/lib/graphql/client.ts` shows the message
      the timeout throws. That string is what Step 4 catches, and knowing it is what stops you
      catching too broadly.

### Step 2: Create `async headers()` in `next.config.ts`

An **anchored fragment**. `next.config.ts` already holds `reactStrictMode` and the `images` object
from Lessons 09.1 and 14.5, and `experimental.serverActions.allowedOrigins` from Lesson 15.5 —
and Lesson 19.4 adds `trailingSlash` and `redirects()` to the same object. **Add one property. Do
not retype the file.**

```ts
// next-app/next.config.ts — add this ONE property to the existing nextConfig
// object, after `images: { … }`. Every other key stays exactly as it is.
// Lesson 24.2 appends security headers to THIS function rather than adding a
// second one; one key, one owner (Key Concept 10).
  async headers() {
    return [
      {
        // Next's own build output. Content-hashed filenames, so the bytes at a
        // URL never change — a change is a NEW URL. This is the one place in
        // the application where a year and `immutable` are correct.
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        // next/image output. NOT immutable: the URL carries ?url=&w=&q=, and
        // the upstream bytes at that WordPress URL can be replaced. 31 days at
        // the edge matches `minimumCacheTTL: 2678400` from Lesson 14.5 — one
        // number, expressed to two different caches. `max-age=0` makes the
        // browser recheck while the shared cache still absorbs the traffic.
        source: '/_next/image',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, s-maxage=2678400, stale-while-revalidate=86400',
          },
        ],
      },
      {
        // THE PERSONALISED ROUTES. `middleware.ts` already sets this on a
        // guarded response (Lesson 15.5), and its matcher deliberately
        // excludes `/api` — so these four entries cover exactly what
        // middleware cannot reach, plus a second statement of intent for what
        // it can. Both words on purpose: `private` says not in a SHARED cache,
        // `no-store` says not in ANY cache (Key Concept 3).
        source: '/api/auth/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
      {
        // Lesson 17.2's preview exchange sets cookies, and a response carrying
        // Set-Cookie must never be shared (Key Concept 7).
        source: '/api/preview/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
      {
        source: '/api/health',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        source: '/:locale/account/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
      {
        source: '/:locale/incidents/submit',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
      // AND NOTHING FOR HTML. No `s-maxage` on any page route, deliberately:
      // Next already emits a Cache-Control derived from each route's
      // `revalidate`, and that is the number `revalidateTag` can actually
      // override. An s-maxage here would create a second cache that nothing in
      // Lesson 18.3's webhook can purge. Key Concept 2 has the reversal
      // condition.
    ];
  },
```

**Verify §2:**

- [ ] `npm run build` succeeds. A malformed `source` is a build-time error, not a runtime one.
- [ ] `grep -c 'async headers' next.config.ts` is `1`.
- [ ] `grep -c 's-maxage' next.config.ts` is `1` — the `/_next/image` entry and nothing else. If it
      is `2` or more, you cached HTML at the edge and Lesson 18.3's webhook cannot purge it.
- [ ] `grep -c 'trailingSlash\|redirects' next.config.ts` is whatever Lesson 19.4 left there —
      **unchanged**. If your diff touches those lines you retyped the file.

### Step 3: Write the split down as a rule

The header entries above are the implementation. This is the rule they implement, and it belongs
somewhere a reviewer will find it.

```markdown
<!-- docs/architecture.md — append -->
## Cache layers and the cacheable/personalised split (Lesson 18.4)

Five layers. `revalidateTag` reaches the last two and **nothing further left**.

| Layer | Header that controls it | Invalidated by |
|---|---|---|
| Router Cache (browser) | `Cache-Control` on the RSC payload | `router.refresh()`, a navigation, a hard reload |
| Browser HTTP cache | `max-age`, `immutable` | effectively never |
| CDN / shared cache | `s-maxage`, `stale-while-revalidate` | **a purge API call. Not `revalidateTag`** |
| Full Route Cache | `export const revalidate` + tags | `revalidateTag`, `revalidatePath` |
| Data Cache | per-`fetch` `revalidate` + tags | `revalidateTag` |

**The rule: ISR and cache tags own HTML freshness; `s-maxage` owns immutable assets.** No page
route in this application carries an `s-maxage` from `next.config.ts`, because a CDN copy held
under `s-maxage` is a second cache that Lesson 18.3's webhook cannot purge, and two systems
disagreeing about freshness is worse than one system being slower. Reversal condition: a CDN we
control **plus** a webhook that purges both systems.

### Cacheable versus personalised

| | Cacheable | Personalised |
|---|---|---|
| Routes | everything under `/[locale]` except the two below | `/[locale]/account/*`, `/[locale]/incidents/submit`, `/api/auth/*`, `/api/preview/*` |
| Reads a cookie | no | yes |
| Segment config | `revalidate` | `dynamic = 'force-dynamic'` |
| `Cache-Control` | Next's, derived from `revalidate` | `private, no-store` — from middleware **and** `next.config.ts` |
| Data layer | `fetchGraphQL` with `revalidate` + tags | `fetchGraphQLAuthed`, which accepts no cache options |

**A response that varies by cookie cannot be shared.** The fix is splitting the routes, not a
`Vary: Cookie` header: `Vary` is correct in principle and destroys the hit rate in practice —
every distinct cookie value, including `NEXT_LOCALE`, becomes its own cache key — and it hides the
decision in a config file instead of putting it in the route's own diff. A cached authenticated
response is a **disclosure**, not an outage: HTTP 200, no alert, and a detection time measured in
weeks.

`draftMode()`'s `__prerender_bypass` and `__next_preview_data` are the same rule applied to
preview. They appear in no `Vary` and no `s-maxage`-carrying route, and every preview fetch passes
no `revalidate` and no `tags` at all (Lesson 17.2).

### One deadline, not two

`src/lib/graphql/client.ts` has carried `AbortSignal.timeout(8000)` on every request since Lesson
10.1. There is exactly one, and adding a second — a `Promise.race`, a wrapper timeout — means the
shorter deadline wins while the longer request stays in flight holding a socket. To change the
number, change `TIMEOUT_MS`.
```

### Step 4: Add the stale-on-error path to the two list pages

`/[locale]/incidents` first. The whole change is a `try`/`catch` and a nullable local.

```tsx
// next-app/src/app/[locale]/incidents/page.tsx — wrap the fetch from Lesson 18.1
import type { IncidentsListQuery } from '@/gql/graphql';

// …inside the component, replacing the bare `const data = await fetchGraphQL(…)`:

  // `null` means the origin did not answer. NOT "there are no incidents" —
  // those are two different pages and conflating them is how you tell a user
  // their data is gone when your CMS is merely restarting.
  let data: IncidentsListQuery | null = null;

  try {
    data = await fetchGraphQL(
      IncidentsListDocument,
      { first: 12, search },
      { revalidate: 300, tags: [listTag('incident')] }
    );
  } catch (error) {
    // A TRANSPORT failure: WordPress mid-deploy, a container restart, or
    // client.ts's 8-second AbortSignal firing. NOT a GraphQL error — those
    // arrive as HTTP 200 with an `errors` array and the 'partial' policy
    // renders what came back (Lesson 10.4 §3), so they never reach here.
    //
    // console.error is deliberate and SERVER-side. Lesson 12.3's
    // zero-console-error assertion is about the browser console; this line
    // never reaches it, and Module 24 ships it to Sentry. Log the MESSAGE, not
    // the error object: a fetch error can carry the request options.
    console.error(
      '[btt] IncidentsList failed; rendering the degraded list —',
      error instanceof Error ? error.message : 'unknown'
    );
  }

  const incidents = data?.incidents?.nodes ?? [];
  const degraded = data === null;
```

```tsx
// next-app/src/app/[locale]/incidents/page.tsx — the notice, above the list
      {degraded ? (
        // role="status" so a screen reader hears it without the focus moving.
        // Module 22 audits this; docs/accessibility.md gets a row in Step 7.
        <p role="status" className="mb-4 rounded border border-border p-4 text-sm">
          We could not reach the newsroom just now, so this list may be out of date.
          Nothing has been lost — try again in a moment.
        </p>
      ) : null}
```

`/[locale]/blog/page.tsx` gets the same shape with `PostsListQuery`, `PostsListDocument` and
`listTag('post')`. Two files, one pattern, and the pattern is worth repeating rather than
extracting: a shared `fetchOrDegrade()` helper would have to decide what "degraded" renders, and
that is a per-page editorial judgement.

**Verify §4:**

- [ ] `npm run type-check` is silent. If `data?.incidents` complains, the generated query type name
      does not match — check `src/gql/graphql.ts` for the exact exported name.
- [ ] `grep -c 'try {' 'src/app/[locale]/incidents/page.tsx'` is `1`, and the same for
      `blog/page.tsx`.
- [ ] `grep -rc 'try {' 'src/app/[locale]/account/page.tsx'` is `0`. **The authenticated route gets
      no stale-on-error path**, deliberately: a down WordPress must not cause `/account` to serve
      anything, because the only thing it could serve belongs to whoever asked last.
- [ ] The catch logs `error.message` and never `error`. A `fetch` error object can carry the
      request options, and those carry a Bearer token on the authenticated path.

### Step 5: Record the `curl -I` transcript

```bash
npm run build && npm run start & SERVER_PID=$!
sleep 6

# The counter from Lesson 10.3 Step 2 — the ground truth, in case a header lies
gqlog() {
  docker compose -f ../wordpress-headless/docker-compose.yml \
    logs --since="${1:-60s}" wordpress | grep -c 'POST /graphql'
}

hdr() { curl -sI "http://localhost:3000$1" | grep -iE '^(cache-control|x-nextjs-cache|age|vary)'; }

hdr /_next/static/chunks/main-app.js   # the filename is hashed — see Verify §5
hdr /en/incidents/incident-01
hdr /en/incidents/incident-01
hdr /en/account
hdr /api/health
kill "$SERVER_PID"
```

**Verify §5:**

- [ ] The static-asset URL will not be that literal path — chunk names are hashed. Get a real one
      with `ls .next/static/chunks | head -3` and substitute. Its `cache-control` is
      `public, max-age=31536000, immutable`.
- [ ] `/en/incidents/incident-01` shows `x-nextjs-cache: HIT` on the second call. If your Next
      version does not emit that header at all, say so and use `gqlog` instead: two loads that
      produce zero GraphQL POSTs came from a cache regardless of what any header says.
- [ ] `/en/incidents/incident-01`'s `cache-control` mentions `s-maxage` with the route's own
      `revalidate` value and a `stale-while-revalidate`. **Next wrote that, not you** — which is
      Key Concept 2's whole argument.
- [ ] `/en/account` shows `no-store`, no `s-maxage`, and no `x-nextjs-cache` at all.
- [ ] `age` is very likely **absent** on every line. It is added by a shared cache and you have
      none in front of you. Do not invent one.

Paste your real output into `docs/architecture.md` under Step 3's section, with the date and your
Next version. This is a number worth keeping and `docs/perf-baseline.md` does not exist yet —
Lesson 21.1 creates it and should copy this transcript into it, exactly as Lesson 14.5 arranged for
its image measurements.

### Step 6: Prove it survives a dead origin

The crude proof, which is the convincing one.

```bash
npm run build && npm run start & SERVER_PID=$!
sleep 6

# Warm the routes you are about to test, so a cache entry exists
curl -s -o /dev/null http://localhost:3000/en/incidents
curl -s -o /dev/null http://localhost:3000/en/incidents/incident-01

docker compose -f ../wordpress-headless/docker-compose.yml stop wordpress

# 1. A warm ISR route: FREE. Next serves the HTML it already has.
curl -s -o /dev/null -w 'warm detail  %{http_code}\n' http://localhost:3000/en/incidents/incident-01
curl -s http://localhost:3000/en/incidents | grep -c 'Deployed on a Friday'

# 2. A COLD variable set: YOUR code. Nobody has ever searched for this.
curl -s -o /dev/null -w 'cold facet   %{http_code}\n' "http://localhost:3000/en/incidents?q=zzz$RANDOM"
curl -s "http://localhost:3000/en/incidents?q=zzz$RANDOM" | grep -c 'could not reach the newsroom'

docker compose -f ../wordpress-headless/docker-compose.yml start wordpress
sleep 12
kill "$SERVER_PID"
```

**Verify §6:**

- [ ] Case 1 answered `200` with real incident titles. That is ISR, and it cost you nothing —
      Lesson 18.1's verification already saw it.
- [ ] Case 2 answered `200` with the degraded notice, **not** a `500` and not Lesson 10.4's
      `error.tsx`. That is the `try`/`catch` from Step 4, and it is the only part of this that is
      your code.
- [ ] Case 2's list is **empty**, not stale. Be precise about the promise: "stale rather than
      broken" applies where an entry exists; on a cold route the honest promise is "empty and
      labelled rather than a 500".
- [ ] The Next terminal shows one `[btt] IncidentsList failed` line per cold request, with a
      message and no request options.

### Step 7: The runbook entry, and one accessibility row

`docs/runbook.md` was created by Lesson 15.2 — **append**, do not create.

```markdown
<!-- docs/runbook.md — append to the document Lesson 15.2 started -->
## A page is stale (Lesson 18.4)

**Symptom:** WordPress shows the new content, the public page does not.

**Find the layer before you change anything.** There are five and only one of them is usually the
culprit. Each command answers exactly one question.

1. **Is it just your browser?** Hard-reload, or open a private window.
   → Fixed: Router Cache or browser HTTP cache. Nothing to do.
2. **Is it the CDN?** `curl -sI <public URL> | grep -i 'x-vercel-cache\|age'`, then the same
   request against the origin. Fresh at the origin and stale publicly means the CDN.
   → Purge that URL at the CDN. `revalidateTag` will never do it (Lesson 18.4 §1).
3. **Did the webhook fire?**
   `docker compose exec wordpress tail -n 20 /var/www/html/wp-content/debug.log | grep revalidate`
   → No line: `transition_post_status` did not match. Check the post type and the status change.
4. **Did it arrive?** Check the Next logs for `POST /api/revalidate`. A `401` means the two
   secrets differ; a `400` means clock skew over 300 s or a payload the schema rejected. With
   `blocking => false` WordPress cannot tell you any of this (Lesson 18.3 §4).
5. **Is `BTT_FRONTEND_URL` reachable from the container?**
   `docker compose exec wordpress getent hosts host.docker.internal` — empty means the webhook has
   been going nowhere. Appendix 06 §4 calls this the single most common cause.
6. **Do the identifiers match?** The payload's `postType` and `slug` must be the ones the route
   tagged with. `npm run lint:tags` proves nothing hand-typed a tag; the 400 on an unknown
   `postType` proves the vocabulary agrees.

**The special case: `/[locale]/hobt` has no timer.** Lesson 18.1 set it to `revalidate: false`, so
there is no window that will eventually fix it. If it is stale, the webhook is the only thing that
can make it fresh — start at step 3, and if the webhook is broken, force it with a no-op save whose
only purpose is to fire `transition_post_status`:

    HOBT=$(docker compose run --rm -T wpcli wp post list --post_type=page --name=hobt --field=ID)
    docker compose run --rm -T wpcli wp post update "$HOBT" --post_status=publish

A `publish` to `publish` transition still fires the hook, which is exactly why Lesson 18.3's guard
set tests for `publish` on either side rather than rejecting `$new === $old` outright.

**WordPress is down and the site should not be:** the incident and blog list pages render a
degraded notice rather than a 500, and every route with a warm ISR entry keeps serving it.
`/account` deliberately does **not** degrade — it fails, because the only thing it could serve is
somebody else's page.

**Rotating `BTT_REVALIDATE_SECRET`:** change it in `wordpress-headless/.env` **and**
`next-app/.env.local` in the same window, then recreate the WordPress container. Between the two
edits every webhook is a silent 401 and every page is on its `revalidate` window — which for
`/hobt` means indefinitely. Do it in that order and verify with one no-op save.
```

One row in `docs/accessibility.md` — Lesson 11.4 created it with a standing rule that every lesson
adding a role or an `aria-*` attribute adds a row:

```markdown
<!-- docs/accessibility.md — append one row -->
| `role="status"` | `incidents/page.tsx`, `blog/page.tsx` | the degraded-list notice when the origin is unreachable. A polite live region, so it is announced without moving focus. Lesson 18.4 |
```

### Step 8: Verify, then hand the debt to Module 23

```bash
npm run build && npm run type-check && npm run lint && npm run lint:tags && npm run test:run
git add -A
git commit -m "feat(cache): explicit cache headers, the cacheable/personalised split, stale-on-error"
```

Step 6 is a manual proof, and a manual proof is a proof that runs once. **Lesson 23.6 owns turning
it into a spec**: stop WordPress, request `/en/incidents`, assert that cached content renders and
that the response is not a `500`, start WordPress. It belongs there rather than here because it
needs the `mutations` Playwright project — it manipulates shared state, so it cannot run in
parallel with the read specs, and Lesson 23.6 is where that project is configured.

**Verify §8:**

- [ ] Every command above exited `0`.
- [ ] `E2E_MODE=1 E2E_SECRET="$E2E_SECRET" npx playwright test --project=smoke` is 9 passed, with
      zero console errors. The degraded notice does not appear on a healthy run, and the
      server-side `console.error` from Step 4 never reaches a browser console.
- [ ] `git diff HEAD~1 --stat` shows `next.config.ts` with **one** added property, and no change to
      any key Lesson 19.4 owns.

---

## Verification

```bash
cd next-app

# The ground truth, in case a header lies (Key Concept 4)
gqlog() {
  docker compose -f ../wordpress-headless/docker-compose.yml \
    logs --since="${1:-60s}" wordpress | grep -c 'POST /graphql'
}
hdr() { curl -sI "http://localhost:3000$1" | grep -iE '^(cache-control|x-nextjs-cache|age|vary|set-cookie)'; }

npm run build && npm run start & SERVER_PID=$!
sleep 6

# 1. The immutable asset. Get a REAL hashed filename first — the names change
#    on every build, so a literal path here would be wrong by the time you ran it.
CHUNK="$(ls .next/static/chunks/*.js | head -1 | sed 's|^\.next|/_next|')"
echo "$CHUNK"
hdr "$CHUNK"
# Expected: cache-control: public, max-age=31536000, immutable
#           Content-hashed, so a change is a new URL. The only place a year is right.

# 2. next/image: shared-cacheable for 31 days, rechecked by the browser every time
hdr '/_next/image'
# Expected: cache-control: public, max-age=0, s-maxage=2678400, stale-while-revalidate=86400
#           (The response itself is a 400 without ?url= — you are reading the
#           HEADER, which headers() applies to the route regardless.)

# 3. An ISR route: MISS then HIT, and a Cache-Control NEXT wrote, not you
hdr /en/incidents/incident-01
hdr /en/incidents/incident-01
# Expected: x-nextjs-cache: MISS then HIT, and a cache-control carrying
#           s-maxage=3600 with a stale-while-revalidate. THAT NUMBER IS THE
#           ROUTE'S `revalidate` — Next derived it. If your Next version emits
#           no x-nextjs-cache header, use check 4 instead; it cannot drift.

# 4. The version-independent version of check 3
curl -s -o /dev/null http://localhost:3000/en/incidents/incident-01
curl -s -o /dev/null http://localhost:3000/en/incidents/incident-01
gqlog 20s
# Expected: 0 — two loads, no WordPress traffic. Served from a cache, whatever
#           any header says.

# 5. NEGATIVE — no page route carries an s-maxage that YOU set
grep -c 's-maxage' next.config.ts
# Expected: 1 — the /_next/image entry, and nothing else. A second one means you
#           created a CDN copy that Lesson 18.3's webhook cannot purge (§2).
grep -n 'source:' next.config.ts
# Expected: /_next/static/:path*, /_next/image, /api/auth/:path*,
#           /api/preview/:path*, /api/health, /:locale/account/:path*,
#           /:locale/incidents/submit — and no other page route

# 6. NEGATIVE — /en/account is never a HIT and carries no shared-cache directive.
#    $JWT_REPORTER comes from Lesson 18.1 Task Step 8.
hdr /en/account
curl -sI -b "btt_at=$JWT_REPORTER" http://localhost:3000/en/account | grep -iE '^(cache-control|x-nextjs-cache)'
# Expected: a cache-control containing `no-store`, no `s-maxage`, no `public`,
#           and NO x-nextjs-cache line at all — there is no route cache entry
#           for it to report on.
curl -sI -b "btt_at=$JWT_REPORTER" http://localhost:3000/en/account | grep -ci 's-maxage\|public,'
# Expected: 0

# 7. NEGATIVE — a preview response is uncacheable, and so is one that sets a cookie
hdr /api/preview
# Expected: cache-control: private, no-store. (The status is 401 without a
#           token — Lesson 17.2 — and the header is what this check is about.)
curl -sI 'http://localhost:3000/api/preview/exit' | grep -iE '^(cache-control|set-cookie|location)'
# Expected: cache-control: private, no-store, plus a 307 Location to the locale
#           home. If a set-cookie line appears, note that it is on a response
#           that also says no-store — a response carrying Set-Cookie must never
#           be shared (§7). If there is nothing to clear there is no set-cookie,
#           and the cache-control is still the assertion that matters.

# 8. NEGATIVE — the stale-on-error path does NOT apply to an authenticated route
grep -c 'try {' 'src/app/[locale]/account/page.tsx' 'src/app/[locale]/account/layout.tsx'
# Expected: 0 for both. A down WordPress must not make /account serve anything,
#           because the only thing it could serve belongs to whoever asked last.
grep -c 'try {' 'src/app/[locale]/incidents/page.tsx' 'src/app/[locale]/blog/page.tsx'
# Expected: 1 for both — the two PUBLIC list pages, and only those

# 9. NEGATIVE — fetchGraphQLAuthed still takes no cache options, three lessons on
sed -n '/export function fetchGraphQLAuthed/,/^): Promise/p' src/lib/graphql/client.ts
# Expected: three parameters — document, variables, credential. No options bag.
grep -c 'FetchGraphQLOptions' src/lib/graphql/client.ts
grep -cE 'fetchGraphQLAuthed\([^)]*,[^)]*,[^)]*,' src/
# Expected: the first is unchanged from Lesson 10.1; the second is 0 — no call
#           site anywhere passes a fourth argument, because there is none.

# 10. NEGATIVE — one deadline in the data layer, not two
grep -c 'AbortSignal.timeout' src/lib/graphql/client.ts
# Expected: 1
grep -rc 'Promise.race' src/lib/ src/app/
# Expected: 0 everywhere. Two deadlines mean the shorter wins and the longer
#           leaks a live socket (§8).

# 11. Resilience, case one: a WARM route with the origin stopped. This part is FREE.
curl -s -o /dev/null http://localhost:3000/en/incidents
docker compose -f ../wordpress-headless/docker-compose.yml stop wordpress
curl -s -o /dev/null -w 'warm detail %{http_code}\n' http://localhost:3000/en/incidents/incident-01
# Expected: warm detail 200
curl -s http://localhost:3000/en/incidents | grep -c 'Deployed on a Friday'
# Expected: 1 or more — the ISR entry, served while the origin is dead

# 12. Resilience, case two: a COLD variable set. This part is YOUR code.
curl -s -o /dev/null -w 'cold facet %{http_code}\n' "http://localhost:3000/en/incidents?q=zzz-$RANDOM"
# Expected: cold facet 200 — NOT 500, and not Lesson 10.4's error.tsx
curl -s "http://localhost:3000/en/incidents?q=zzz-$RANDOM" | grep -c 'could not reach the newsroom'
# Expected: 1 — the degraded notice. The list is EMPTY rather than stale, and
#           §9 is precise about why: there is no cache entry to be stale from.

# 13. NEGATIVE — the authenticated route does not degrade, it fails
curl -s -o /dev/null -w 'account %{http_code}\n' -b "btt_at=$JWT_REPORTER" http://localhost:3000/en/account
# Expected: 500, or a 307 to /en/login. Either is correct and neither is a
#           cached page. The one unacceptable answer is 200 with somebody's
#           submissions on it.
docker compose -f ../wordpress-headless/docker-compose.yml start wordpress
sleep 12

# 14. Everything still passes with the origin back
kill "$SERVER_PID"
npm run build && npm run type-check && npm run lint && npm run lint:tags && npm run test:run
# Expected: 0 failures
E2E_MODE=1 E2E_SECRET="$E2E_SECRET" npx playwright test --project=smoke
# Expected: 9 passed, zero console errors. The degraded notice is absent on a
#           healthy run, and Step 4's console.error is server-side.

# 15. The three documents are written, and none of them is perf-baseline.md
grep -c 'Cache layers and the cacheable/personalised split' ../docs/architecture.md
# Expected: 1
grep -c 'A page is stale' ../docs/runbook.md
# Expected: 1
grep -c 'role="status"' ../docs/accessibility.md
# Expected: 1
test -f ../docs/perf-baseline.md && echo 'DO NOT CREATE THIS' || echo 'correct — Lesson 21.1 owns it'
# Expected: correct — Lesson 21.1 owns it
```

If check 6 ever shows `x-nextjs-cache: HIT` on `/en/account`, stop everything else in this block.
That is the disclosure in Key Concept 6, and no other check matters until it is `MISS` or absent.

## Control Questions

1. `revalidateTag('incident:incident-01')` runs successfully, the origin serves the new page, and
   users keep seeing the old one for another forty minutes. Name the layer, explain why the tag
   could not reach it, and give the two commands that would have told you which layer to look at.
2. `/_next/static/*` gets `max-age=31536000, immutable` and `/_next/image` gets
   `max-age=0, s-maxage=2678400`. Justify both, and say what would break if you gave `/_next/image`
   the `immutable` treatment as well.
3. `Vary: Cookie` on `/en/account` would be *correct*. Give two reasons this application splits the
   routes instead, and name the specific cookie that would destroy the cache hit rate for every
   other visitor.
4. The `docker compose stop wordpress` proof shows `/en/incidents/incident-01` serving real content
   and `/en/incidents?q=<new>` serving a notice. Attribute each outcome to the mechanism
   responsible, and say which of the two you wrote.
5. `/account` is deliberately excluded from the stale-on-error path. State what it would serve if
   it were included, why that response would carry HTTP 200, and how long you would expect the bug
   to survive undetected.

## Learn More

- [MDN — `Cache-Control`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control)
  — the authoritative list; read `s-maxage`, `private` and `immutable` next to each other, because
  the differences between them are the whole of Key Concept 3
- [MDN — `Vary`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Vary) — read
  it before you decide Key Concept 5 was too harsh on it; the cache-key explanation is the argument
- [RFC 5861 — `stale-while-revalidate` and `stale-if-error`](https://www.rfc-editor.org/rfc/rfc5861)
  — short, readable, and `stale-if-error` is the header-level version of Step 4's `try`/`catch`
- [Vercel — Edge Network caching](https://vercel.com/docs/edge-network/caching) — where
  `x-vercel-cache` comes from, what each of its four values means, and which headers Vercel
  overrides
- [Next.js — `headers()` in `next.config.js`](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers)
  — the `source` path syntax, and the fact that several entries can match one request
- [Next.js — self-hosting and caching](https://nextjs.org/docs/app/getting-started/deploying) —
  what `next start` does with the Full Route Cache on your own machine, which is what
  `x-nextjs-cache` reports on
- [Cloudflare — cache and logged-in users](https://developers.cloudflare.com/cache/best-practices/)
  — the WordPress-side version of Key Concept 5, and worth reading to see how much of that guidance
  is a workaround for not being able to split routes
- [MDN — `AbortSignal.timeout()`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static)
  — the one deadline in `client.ts`, and why an aborted `fetch` rejects rather than resolving
- [web.dev — Stale-while-revalidate](https://web.dev/articles/stale-while-revalidate) — the same
  pattern in a Service Worker, which makes the "serve now, refresh behind" model concrete
- [Next.js — `error.js`](https://nextjs.org/docs/app/api-reference/file-conventions/error) — the
  boundary Step 4 exists to avoid reaching, and the distinction between your bug and somebody
  else's outage
