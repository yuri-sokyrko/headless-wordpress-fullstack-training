---
title: 'Rendering Strategies'
module: 18
lesson: 1
teaches: [static-vs-isr-vs-dynamic, generate-static-params, force-dynamic, next-cache-layers, per-route-strategy]
produces: ['next-app/src/app/[locale]/hobt/page.tsx', 'next-app/src/app/[locale]/incidents/page.tsx', 'next-app/src/app/[locale]/incidents/[slug]/page.tsx', 'next-app/src/app/[locale]/scapegoats/[slug]/page.tsx', 'next-app/src/app/api/auth/session/route.ts', 'next-app/src/components/layout/SessionMenu.tsx']
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
is **bounded** — a window sized per content type, never the whole archive — and the long tail is
served by on-demand ISR: the
first request for an old incident renders it, caches it, and every subsequent request is static.
You will measure both, because the difference between "I read that this is slow" and "I watched my
own build go from 40 seconds to 25 minutes" is the difference between a guideline and a habit.

By the end of this lesson you will have:

- A written per-route strategy table covering every route in the app, each row justified, matching
  the table in the module README
- Explicit `export const dynamic` / `export const revalidate` / `generateStaticParams` on every
  route rather than relying on inference
- `/hobt` fully static with `revalidate: false`, and a note on what that commits you to
- `generateStaticParams` bounded per content type — 100 incidents, 50 posts, 20 reviews — with a
  build-time log line proving how many pages it emitted
- Two `npm run build` transcripts — bounded versus deliberately unbounded — with wall-clock times,
  kept as
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

### 1. Four modes, and the decision behind each

Next.js does not have a "rendering mode" switch. It has a set of signals, and it infers a mode
per route from them. Naming the four modes anyway is worth it, because the *decision* is what you
are writing down, and the signals are only how you express it.

| Mode | You write | Route becomes | Choose it when |
|---|---|---|---|
| **Static** | `export const revalidate = false` on a route whose fetches are also `revalidate: false` | rendered once, at build time, until a tag drops it | the content changes only by an editorial action, and you want to know exactly when |
| **ISR** | `export const revalidate = 300` | rendered at build, re-rendered in the background after the window | almost everything editorial — a bounded staleness you can name |
| **Dynamic** | nothing; the route reads `searchParams`, `cookies()` or `headers()` | rendered per request, but the `fetch` inside it may still be cached | the HTML genuinely varies per request, and the *data* does not |
| **`force-dynamic`** | `export const dynamic = 'force-dynamic'` | rendered per request, and the default for every `fetch` in the segment flips to `no-store` | the response is personalised. Authenticated routes, health checks |

**The verdict for this app: ISR is the default, and every departure from it is written down.** The
per-route table in Step 2 is the artifact; the exports in Step 3 are just how you say it in code.

> **`force-dynamic` is not "dynamic, but more so".** It also changes the default `cache` of every
> `fetch` in that segment to `no-store`. On `/account` that is exactly what you want. On
> `/incidents` — a route that is dynamic because it reads `searchParams`, and whose whole
> performance story is that the GraphQL call underneath is *cached* — writing it would flip the
> default for every fetch anyone adds to that route later. So `/incidents` gets `revalidate`, not
> `force-dynamic`. Two routes, both dynamic, two different declarations, for a reason you can say
> out loud.

### 2. The distinction most people miss: a dynamic page with cached data

This is the one that does not exist in Classic WordPress, so there is no intuition to carry over.

```
   /en/incidents?q=friday          ← reads searchParams, so the HTML is
   ┌──────────────────────────┐      assembled on every request
   │  RSC render (per request)│
   │      │                   │
   │      ▼                   │
   │  fetchGraphQL(            │
   │    IncidentsList,         │
   │    { first: 12,           │
   │      search: 'friday' },  │
   │    { revalidate: 300,     │
   │      tags: ['incidents']})│
   └──────┬───────────────────┘
          │  DATA CACHE, keyed on the whole request — method, URL, body
          │  ┌────────────────────────────────────────────────┐
          └─▶│ body …"search":"friday"…  → entry A            │
             │ body …"search":"cache"…   → entry B            │
             │ body …no search…          → entry C            │
             └────────────────────────────────────────────────┘
                       one WordPress query per DISTINCT variable set,
                       per 300 seconds, shared across every visitor
```

Two visitors asking for `?q=friday` inside the same window produce **one** WordPress query. A
third asking for `?q=cache` produces a second. The page is rendered per request; the expensive
part is not. WP Super Cache cannot express this: its unit of caching is the whole HTML document,
so a page with a query string is either cached under that exact URL or not cached at all.

The corollary, from Lesson 10.3 Key Concept 1: the cache key is the whole request body, so adding
a GraphQL variable you do not use is enough to split one cache entry into two. Facets are cheap;
a facet nobody uses is a cache entry nobody shares.

### 3. Four caches, in order, each with its own lifetime

"I cleared the cache and it is still stale" has four possible answers here instead of one. Knowing
which layer you are looking at is most of the debugging skill in this module.

```
  browser                          Next server                        WordPress
  ┌──────────────┐   ┌──────────────────────────────────────────┐   ┌──────────┐
  │ ROUTER CACHE │   │ FULL ROUTE CACHE      DATA CACHE         │   │ WPGraphQL│
  │ RSC payloads │   │ rendered HTML +       fetch() results    │   │          │
  │ per session  │   │ RSC flight            across requests    │   │          │
  │              │   │                                          │   │          │
  │              │   │   REQUEST MEMOIZATION                    │   │          │
  │              │   │   inside ONE render pass                 │   │          │
  └──────────────┘   └──────────────────────────────────────────┘   └──────────┘
   30 s dynamic /      invalidated by            invalidated by
   5 min static        revalidatePath, a tag     revalidate window
   router.refresh()    on a fetch it used,       or revalidateTag
   or a navigation     or a new deployment       (Lesson 18.2)
```

| Cache | Scope | Lifetime | How you clear it | Where it bites you |
|---|---|---|---|---|
| Request Memoization | one render pass | until the render ends | you do not | never — it only ever helps |
| Data Cache | one deployment, every visitor | `revalidate`, or a tag | `revalidateTag` | a stale value inside a freshly rendered page |
| Full Route Cache | one deployment, every visitor | the route's `revalidate`, or a tag any fetch in it carried | `revalidatePath`, or a tag | the page you are staring at, which is why it feels like nothing works |
| Router Cache | one browser session | ~30 s dynamic, ~5 min static | a hard reload, or `router.refresh()` | "it is fixed in an incognito window" |

**The Router Cache is the one that wastes your afternoon**, because it lives in a machine you are
not looking at. Lesson 16.2's `revalidatePath('/{locale}/account')` exists purely to expire it: the
account data comes from `fetchGraphQLAuthed`, which is `no-store`, so there was never a Data Cache
entry — the stale thing was the RSC payload the browser was holding. When a change is visible in
`curl` and invisible in your browser, you are looking at the Router Cache and nothing else.

### 4. Two cookie reads in one layout, and only one of them is free

`src/app/[locale]/layout.tsx` is about to read two cookies. One costs nothing; the other costs the
entire Full Route Cache for every route in the application. The difference is **whether the
framework understands the cookie.**

| Read | Cookie | What Next knows | Effect on rendering |
|---|---|---|---|
| `draftMode()` | `__prerender_bypass` | Next set it, Next named it, Next owns its meaning | `isEnabled` is `false` during static generation, so the route still prerenders; at request time the cookie bypasses the Full Route Cache **for that visitor only** |
| `cookies()` | `btt_at` | nothing at all | an unconditional opt-out of static rendering for every route below the layout |

That asymmetry is the whole justification for Step 1. `draftMode()` is a **special case with a
contract**: Next can prerender the page *and* serve a bypassed render to the one editor holding the
bypass cookie, because it knows what the cookie means. `cookies()` has no such contract — Next
cannot know that `btt_at` only changes the two words in the top-right corner, so it must assume the
whole document depends on it, and the only safe assumption is "render this per request".

> **Lesson 15.4's decision was right for Lesson 15.4.** With no ISR to protect, reading the session
> once in the root layout and passing a plain object down was the simplest correct design, and
> 15.4 Step 6 named the bill in a comment: "Module 18 is where that bill arrives." This is the same
> shape as Lesson 11.4 taking the `<main>` landmark away from eleven route files that were each
> right until a shared layout grew one. A decision that expires is not a mistake; a decision with
> no expiry date is.

### 5. `dynamic`, `revalidate`, `dynamicParams` — and what inference would have chosen

Three exports, and the useful question about each is not "what does it do" but "what would have
happened if I had not written it".

| Export | Values | Inference without it | Why write it anyway |
|---|---|---|---|
| `dynamic` | `'auto'` \| `'force-dynamic'` \| `'force-static'` \| `'error'` | `'auto'` — dynamic if the route reads a dynamic API or has an uncached fetch | on an authenticated route it is a statement of intent that survives a default change |
| `revalidate` | `false` \| `0` \| a number of seconds | the **shortest** `revalidate` of any fetch in the route | a floor for the route as a whole, so a future fetch with no policy cannot make the page fresher than you meant |
| `dynamicParams` | `true` \| `false` | `true` | almost never — the default is what makes a scoped param list safe |

The route-segment `revalidate` and the per-`fetch` `revalidate` interact by taking the **shortest**
window, which Lesson 10.3 Key Concept 5 established. Nothing about that changes here; what changes
is that this module writes both, so the two agree on purpose rather than by accident.

`export const dynamic = 'force-static'` and `'error'` appear in no route in this app. `'error'` is
genuinely useful in a CI-adjacent way — it turns "this route accidentally became dynamic" into a
build failure — and the reason it is not used is honest rather than principled: `/incidents` is
*deliberately* dynamic, so the app cannot adopt a rule it would have to exempt three routes from.
Module 24 revisits it as a build gate.

### 6. `generateStaticParams` is a build-time cache warmer, and it is already bounded

Lesson 09.4 Key Concept 3 introduced it as exactly that: the declarative version of pointing a
crawler at your own sitemap after a deploy. Lesson 09.4 also already **bounded** all three
existing ones, with three different numbers, and the numbers are not sloppiness:

| Route | Bound | Why that number |
|---|---|---|
| `incidents/[slug]` | **100** | 40 seeded incidents, plus room for the ones Module 16 lets visitors submit, without another edit here (Lesson 09.4 Step 5) |
| `blog/[slug]` | **50** | ten seeded posts and an editorial cadence of a few a month |
| `reviews/[slug]` | **20** | eight seeded reviews, written by hand, one at a time |
| `[...slug]` (WP pages) | **50** | Lesson 14.4 Key Concept 7, minus the five reserved segments |
| `scapegoats/[slug]` | **20** | ten seeded terms; a taxonomy grows slower than the content that uses it |

**Do not standardise these to one number.** The bound is a statement about how fast that content
type grows and how likely the tail is to be requested, and three content types with three
different answers is the correct outcome. What they have in common is the principle: *a bounded
window sized per content type, never the whole archive.*

Nobody warms their entire archive. The reason is the same reason nobody caches a page nobody
requests: pre-rendering has a cost per page, that cost is paid on every deploy forever, and the
long tail of an archive is by definition the part nobody asks for.

### 7. `dynamicParams: true` is what makes a bound safe rather than lossy

The bound would be indefensible if a slug outside it 404ed. It does not. `dynamicParams` defaults
to `true`, so a URL not in the list is **rendered on demand, cached, and static from then on**.

```
  incident-01 … incident-40   in generateStaticParams  → HTML written at build time
  incident-41 (published today)  not in the list       → first request renders it (slow, once)
                                                       → cached under revalidate + its tags
                                                       → every later request is static
```

So the bound does not decide *what is available*. It decides *who pays for the first render* — the
build, or the first visitor. That is the entire trade-off, and it is why the honest description of
`generateStaticParams` is "a warmer", not "a route manifest".

Set `dynamicParams = false` and you have opted into a very different product: an editor publishing
an incident sees a 404 until the next deploy. There are sites where that is correct — a
documentation site with a fixed page set, where an unexpected slug means a broken link rather than
new content. This is not one of them.

### 8. `/hobt` is `revalidate: false`, and the reason is commercial

Every other editorial route in this app is ISR with a window. `/hobt` is not, and the argument has
nothing to do with performance.

`/hobt` is the page whose conversion rate the business measures. `seatsLeft` drives an urgency
badge; `priceUsd` drives the CTA. A page you are measuring should change **when somebody changed
it** and at no other time — because the alternative is a funnel report with a step change in it and
no corresponding decision anywhere, which is indistinguishable from noise and takes a week to
attribute.

| | ISR, `revalidate: 60` (Lesson 10.3's policy) | Static, `revalidate: false` (this lesson) |
|---|---|---|
| Changes when | a timer expires and somebody happens to visit | an editor saves, via the webhook in Lesson 18.3 |
| A/B or funnel measurement | the variant boundary is a wall-clock guess | the variant boundary is an editorial event with a timestamp |
| If the webhook breaks | self-heals within 60 s | **stale until somebody notices** |
| Build cost | one page | one page |

That last row is the cost, stated plainly: **`revalidate: false` makes the webhook load-bearing.**
There is no timer behind it any more. Lesson 10.3 chose 60 seconds because no webhook existed yet,
which was the right call then and is the wrong call the moment Lesson 18.3 lands. Lesson 18.4's
runbook entry exists precisely because this route has no fallback, and Lesson 18.3's verification
ends by publishing a change and watching `/hobt` update.

### 9. An authenticated route is `force-dynamic` **and** uncached, and those are two properties

They sound like one thing. They are not, and conflating them is how a disclosure bug ships.

| Property | Mechanism | Prevents |
|---|---|---|
| The **route** is not cached as HTML | `export const dynamic = 'force-dynamic'` on `account/{layout,page}.tsx` | the Full Route Cache holding one user's rendered account page and serving it to the next |
| The **data** is not cached | `fetchGraphQLAuthed` hard-codes `cache: 'no-store'` and takes no options parameter | the Data Cache holding one user's GraphQL response and handing it to a different render |
| No **shared cache** in front holds it | `Cache-Control: private, no-store`, set by proxy on guarded paths (Lesson 15.5) | a CDN or corporate proxy caching the HTML |

Delete the first and the second still holds. Delete the second and the first still holds. Neither
one is a substitute for the other, which is why Lesson 15.5 §10 lists all three and calls only the
second a design property — the other two are discipline, and discipline is what a rushed colleague
skips.

**`fetchGraphQLAuthed` must never gain a cache option.** Module 18's README opens with that rule
and this lesson does not weaken it. It is the highest-severity bug this architecture can produce:
not an outage, a disclosure. It is unrepresentable today because there is no parameter to pass.

Note also what does **not** move in Step 1. `/account` and `/incidents/submit` still call
`requireSession()` server-side, still export `force-dynamic`, and Lesson 15.5's thesis still holds
in full: delete `src/proxy.ts` and nothing becomes reachable that was not reachable before.
Only the *chrome* moved out of the layout. The security boundary is where it was.

### 10. The cost of Next's model versus a page-cache plugin

The comparison the Classic WP Analogy started, finished honestly.

| | WP Super Cache / W3TC | Next's caches |
|---|---|---|
| Where the policy lives | a settings screen, one policy for the whole site | your code, per route, per fetch |
| A new page inherits | the site policy | whatever the framework infers |
| Granularity | whole HTML documents | four layers, independently addressable |
| Invalidation | flush all, or per URL | per tag, with fan-out (Lesson 18.2) |
| Code review sees it | no | **yes** — it is a diff |
| Cost of forgetting | the plugin covers you | the route gets the inference, which may change on a minor upgrade |

A page-cache plugin is invisible to your theme. You install it and nothing in your code changes.
That is genuinely a feature: it means the cache cannot be got wrong by a plugin author who never
heard of it.

Next's caching is expressed *in* your code. The upside is that it is reviewable, granular and
tag-invalidatable. The cost, stated plainly: **every new route file is a fresh opportunity to
forget**, and a route that forgets gets whatever Next 16 infers today — which is not necessarily
what Next 16 will infer. That is why Step 2 writes the table into `docs/architecture.md` and Step 3
makes every route say its policy out loud, including the ones where the export is redundant.

---

## Task

### Step 1: Move the session read out of the root layout

You cannot choose a rendering strategy while one file has already chosen for you. Lesson 15.4
Step 6 put `await getSession()` in `src/app/[locale]/layout.tsx`, which reads `cookies()`, which
makes **every route below it dynamic**. Until that read moves, `export const revalidate = false`
has no effect, `generateStaticParams` pre-renders nothing, and Steps 6 and 7 would measure two
builds that both emit zero pages.

The chrome becomes a client component that asks a route handler for the session. Four files: two
new, two edited.

```ts
// next-app/src/app/api/auth/session/route.ts
// The session, as the browser is allowed to see it.
//
// This exists so the ROOT LAYOUT does not have to read cookies(). Reading them
// there made every route in the application dynamic (Lesson 15.4 Step 6 named
// that cost); reading them here confines the dynamic part to one 200-byte JSON
// response that nothing renders.
//
// The response is a PROJECTION, not the Session object. `roles` stays on the
// server, where requireCapability() uses it — the header needs a name, not a
// capability list, and the smallest answer that works is the one to publish.
import { getSession } from '@/lib/auth/session';

// Redundant in Next 16 for a handler that reads cookies, and written anyway:
// a statement of intent that survives a future default change, exactly as
// /api/health does (Lesson 09.5 §4).
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const session = await getSession();

  const body = session.isLoggedIn
    ? { isLoggedIn: true, displayName: session.displayName }
    : { isLoggedIn: false };

  return Response.json(body, {
    headers: {
      // `private` so no shared cache may hold it, `no-store` so no cache may.
      // Lesson 18.4 is where the difference between those two words matters.
      'Cache-Control': 'private, no-store',
    },
  });
}
```

```tsx
// next-app/src/components/layout/SessionMenu.tsx
'use client';

// The only personalised region of the page, and now the only part of it that
// is not static. Fetches on mount, reserves its own width, and NEVER logs:
// Lesson 12.3's smoke suite fails a spec on any console.error, on all nine
// routes, and a header that logs when the network hiccups would fail all nine.
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { logout } from '@/actions/auth';
import { Button } from '@/components/ui/button';

/**
 * Declared here rather than imported from `@/lib/auth/session`.
 *
 * That module carries `import 'server-only'`, and while `import type` is erased
 * by `verbatimModuleSyntax` (Lesson 07.3), relying on erasure at a client
 * boundary means one dropped `type` keyword ships a server-only module to the
 * browser. The route handler above is the contract; this is its client half,
 * and it is deliberately narrower — no `roles`, and no token, because there is
 * no token in `Session` to begin with.
 */
type SessionView =
  | { readonly isLoggedIn: true; readonly displayName: string }
  | { readonly isLoggedIn: false };

const ANONYMOUS: SessionView = { isLoggedIn: false };

/** `unknown` in, a usable union out. The response is JSON from our own server, and it is still parsed defensively. */
function asSessionView(value: unknown): SessionView {
  if (typeof value !== 'object' || value === null) {
    return ANONYMOUS;
  }

  const record = value as Record<string, unknown>;

  if (record.isLoggedIn !== true || typeof record.displayName !== 'string') {
    return ANONYMOUS;
  }

  return { isLoggedIn: true, displayName: record.displayName };
}

export function SessionMenu({ locale }: { readonly locale: string }) {
  // `null` means "not answered yet" and is a THIRD state, distinct from
  // logged out. Collapsing them shows a Sign in link to a signed-in user on
  // every page load, which is worse than showing nothing for 80 ms.
  const [session, setSession] = useState<SessionView | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/auth/session', { signal: controller.signal, cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<unknown>) : null))
      .then((payload) => setSession(asSessionView(payload)))
      .catch(() => {
        // Deliberately silent. An aborted fetch during navigation is normal,
        // and a failed one degrades to the anonymous affordance — which is the
        // safe direction, because the server is still the authority on every
        // guarded route.
        if (!controller.signal.aborted) {
          setSession(ANONYMOUS);
        }
      });

    return () => controller.abort();
  }, []);

  return (
    // min-w RESERVES the space. Without it the header reflows when the fetch
    // lands, which Module 21 measures as CLS and Module 22 audits.
    <div className="ml-4 flex min-w-[9rem] items-center justify-end gap-2">
      {session === null ? (
        <span aria-hidden="true" className="h-8 w-full" />
      ) : session.isLoggedIn ? (
        <>
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {session.displayName}
          </span>
          {/* Still a plain <form> posting to the Server Action from Lesson
              15.4. A Server Action works from a client component and from a
              statically rendered page — which is the property that makes this
              whole extraction possible. */}
          <form action={logout}>
            <Button type="submit" variant="outline" size="sm">
              Log out
            </Button>
          </form>
        </>
      ) : (
        <Link href={`/${locale}/login`} className="text-sm underline">
          Sign in
        </Link>
      )}
    </div>
  );
}
```

Now the two edits. Both undo parts of Lesson 15.4 Step 6 and neither is declared in this lesson's
`produces:`, per the edit convention that lesson set.

```tsx
// next-app/src/app/[locale]/layout.tsx — remove three things, keep everything else
//
// DELETE the import:  import { getSession } from '@/lib/auth/session';
// DELETE the read:    const session = await getSession();   (and its comment block)
// DELETE the prop:    session={session}
//
// The SiteChrome fetch stays exactly as Lesson 10.5 wrote it. The <Header> call
// goes back to the two props Lesson 11.3 gave it:

        <Header locale={locale} siteTitle={chrome.generalSettings?.title ?? 'Blame The Tech'} />
```

```tsx
// next-app/src/components/layout/Header.tsx — drop the session prop, mount SessionMenu
//
// DELETE:  import { logout } from '@/actions/auth';
// DELETE:  import type { Session } from '@/lib/auth/session';
// DELETE:  the `session` member of the props type and its doc comment
// DELETE:  the whole <div className="ml-auto flex items-center gap-2 md:ml-4"> block
//          that Lesson 15.4 added, including the <form action={logout}> inside it
// KEEP:    'use client' still absent — Header fetches the menu (Lesson 11.3 §3)
import { SessionMenu } from './SessionMenu';

// …immediately after the closing </nav> of the desktop navigation:

        <SessionMenu locale={locale} />
```

If `Button` is now unused in `Header.tsx`, remove that import too — `npm run lint` will say so.

**Verify §1:**

- [ ] `grep -c 'getSession' 'src/app/[locale]/layout.tsx'` is `0`.
- [ ] `grep -rc 'btt_at' src/components/layout/SessionMenu.tsx` is `0`. The client never names the
      cookie, because the cookie is httpOnly and unreadable from JavaScript.
- [ ] `grep -c 'console' src/components/layout/SessionMenu.tsx` is `0`.
- [ ] `curl -s http://localhost:3000/api/auth/session` with no cookie prints exactly
      `{"isLoggedIn":false}`.
- [ ] `npm run type-check` is silent, and `npm run lint` reports no unused import in `Header.tsx`.

> **The two alternatives, and why neither is taken.** **Partial Prerendering** is the right answer
> to this problem, and on Next 16 it is no longer a flag called `experimental.ppr` — it ships as
> part of `cacheComponents: true`, which is a different and larger commitment: uncached data
> outside a `<Suspense>` boundary becomes a build error, so adopting it is a rewrite of how every
> route in this application declares its data, not a switch. A course cannot hand you that in one
> aside, and the whole point of this module would evaporate the day it did. **Accepting a fully dynamic application** is the other option, and it forfeits Lesson 18.2,
> Lesson 18.3 and Lesson 18.4 along with it: there is nothing to invalidate if nothing is cached.
> The cost of what you are doing instead, stated plainly: **one extra HTTP request per page load,
> and one frame in which a signed-in user sees the anonymous affordance.** The width reservation
> keeps the second one from moving the layout; nothing makes the first one free.

### Step 2: Write the per-route strategy table into `docs/architecture.md`

An implicit strategy is not a strategy. This table is the one the module README defends, and it is
the artifact Lesson 18.2's tag work and Lesson 18.3's webhook are both written against.

```markdown
<!-- docs/architecture.md — append -->
## Rendering strategy, per route (Lesson 18.1)

ISR is the default. Every departure from it is a decision with a reason.

| Route | Strategy | Segment export | Why |
|---|---|---|---|
| `/[locale]` | ISR | `revalidate = 300` | Mostly editorial, cheap to keep warm |
| `/[locale]/hobt` | static | `revalidate = false` | **Webhook-only.** Conversion is measured here; it changes when an editor changes it |
| `/[locale]/incidents` | dynamic | `revalidate = 300` | Reads `searchParams` for facets. The inner GraphQL fetch is still cached per variable-set |
| `/[locale]/incidents/[slug]` | ISR + tags | `revalidate = 3600` | 100 newest pre-rendered; on-demand ISR covers the tail |
| `/[locale]/blog`, `/reviews` | ISR + tags | `revalidate = 3600` | Editorial lists |
| `/[locale]/blog/[slug]` | ISR + tags | `revalidate = 3600` | 50 newest pre-rendered |
| `/[locale]/reviews/[slug]` | ISR + tags | `revalidate = 3600` | 20 newest pre-rendered |
| `/[locale]/scapegoats` | ISR + tags | `revalidate = 600` | Reads term `count`, which changes on every publish |
| `/[locale]/scapegoats/[slug]` | ISR + tags | `revalidate = 3600` | 20 newest pre-rendered |
| `/[locale]/[...slug]` | ISR + tags | `revalidate = 3600` | Editor-composed WordPress pages, 50 newest |
| `/[locale]/account`, `/[locale]/incidents/submit` | `force-dynamic`, uncached | `dynamic = 'force-dynamic'` | Authenticated. **Never** in a shared cache |
| `/api/health`, `/api/auth/*` | `force-dynamic` | `dynamic = 'force-dynamic'` | A cached health check is not a health check |

`generateStaticParams` is **bounded per content type**, never exhaustive: 100 incidents, 50 posts,
50 pages, 20 reviews, 20 scapegoats. `dynamicParams` stays at its default `true`, so a slug
outside the bound renders on demand and is static from then on. The bound decides who pays for the
first render — the build, or the first visitor — and nothing else.

The session read lives in `GET /api/auth/session` and not in the root layout, because reading
`cookies()` there makes every route below it dynamic. `draftMode()` in the same layout is free:
Next owns `__prerender_bypass` and can keep the page static while bypassing it per visitor.
```

### Step 3: Say the policy out loud in every route file

Add the segment exports from the table. Two representative edits; the rest are the same shape.

```tsx
// next-app/src/app/[locale]/incidents/page.tsx — the segment policy and the URL facet
import { fetchGraphQL } from '@/lib/graphql/client';
import { listTag } from '@/lib/graphql/tags';
import { IncidentsListDocument } from '@/gql/graphql';

// A FLOOR for the route, matching the per-fetch value from Lesson 10.3 so the
// two agree on purpose. NOT `dynamic = 'force-dynamic'`: that would flip the
// default cache of every fetch in this segment to no-store, and the cached
// fetch is the entire point of this route (Key Concept 1).
export const revalidate = 300;

export default async function IncidentsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  // Next 16: both are Promises, and reading EITHER of these makes the route
  // render per request. That is correct here and it costs nothing, because the
  // expensive part is the query below and the query is cached.
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const { q } = await searchParams;

  // One facet, in the URL, deep-linkable and shareable. `?q=friday` and
  // `?q=cache` are two Data Cache entries; two visitors asking for the same
  // one share it. `undefined` rather than '' so the no-search case stays a
  // single entry instead of splitting on an empty string.
  const search = typeof q === 'string' && q.trim() !== '' ? q.trim() : undefined;

  const data = await fetchGraphQL(
    IncidentsListDocument,
    { first: 12, search },
    { revalidate: 300, tags: [listTag('incident')] }
  );

  // …the rest of the route is unchanged: IncidentFilterProvider still wraps
  // IncidentBrowser, and its severity and scapegoat controls still narrow the
  // fetched page in the browser. The URL owns what WordPress is ASKED for;
  // the island owns refinement within the answer. The cost, stated plainly:
  // two search affordances until Lesson 22.2 revisits IncidentFilters.
}
```

```tsx
// next-app/src/app/[locale]/incidents/[slug]/page.tsx — the segment policy
// Matches the per-fetch value from Lesson 10.3. `dynamicParams` is written
// once, explicitly, because the whole defence of a bounded generateStaticParams
// rests on it and a reader should not have to know the default.
export const revalidate = 3600;
export const dynamicParams = true;
```

Apply the rest from the table: `revalidate = 300` on `[locale]/page.tsx`, `revalidate = 3600` on
`blog/page.tsx`, `blog/[slug]`, `reviews/page.tsx`, `reviews/[slug]`, `[...slug]`, `revalidate =
600` on `scapegoats/page.tsx`. `account/{layout,page}.tsx` and `incidents/submit/page.tsx` already
export `force-dynamic` from Lesson 15.5 — leave them exactly as they are.

**Verify §3:**

- [ ] `grep -rl 'export const revalidate\|export const dynamic' src/app --include='page.tsx' | wc -l`
      counts every route file you edited plus the three Lesson 15.5 already covered.
- [ ] `grep -rn "force-dynamic" src/app --include='*.tsx'` names only `account/layout.tsx`,
      `account/page.tsx` and `incidents/submit/page.tsx`.
- [ ] `npm run type-check` is silent.

### Step 4: Make `/hobt` static, and commit to what that means

```tsx
// next-app/src/app/[locale]/hobt/page.tsx — replace Lesson 11.5's 60-second window
// STATIC, and the reason is commercial rather than technical (Key Concept 8).
// Conversion is measured on this page, so it must change when an editor changes
// it and at no other time. `false` means "cached until a tag drops it", and the
// tag is dropped by the webhook in Lesson 18.3.
//
// This makes the webhook LOAD-BEARING: there is no timer behind it any more.
// Lesson 18.4's runbook entry is the response to that, and it is not optional.
export const revalidate = false;
```

```tsx
// next-app/src/app/[locale]/hobt/page.tsx — and the fetch, so the two agree
  const data = await fetchGraphQL(
    HobtPromoDocument,
    { uri: HOBT_URI },
    // `revalidate: false` rather than `cache: 'force-cache'` — the same posture,
    // spelled so it reads "the tag is the only thing that will ever expire
    // this" (Lesson 10.3 Key Concept 4).
    { revalidate: false, tags: [pageTag('hobt')] }
  );
```

**Verify §4:**

- [ ] `grep -c 'revalidate = false' 'src/app/[locale]/hobt/page.tsx'` is `1`, and
      `grep -c 'revalidate: false' 'src/app/[locale]/hobt/page.tsx'` is `1`. Both, or the segment
      and the fetch disagree and the shorter one wins.
- [ ] `grep -c '60' 'src/app/[locale]/hobt/page.tsx'` no longer matches a revalidate window. If it
      does, you edited one of the two places.

### Step 5: Build `scapegoats/[slug]`, the route six files already point at

Lesson 09.4 shipped the leaderboard with a paragraph saying the per-scapegoat page arrives in
Module 18, and no `<Link>` on the term names, because a link to a 404 is worse than no link. This
is that page. Two GraphQL operations first — an **edit** to a Lesson 10.5 file, so not a
`produces:` entry:

```graphql
# next-app/src/graphql/scapegoats.graphql — two operations added in Lesson 18.1
# ScapegoatLeaderboard, above, is unchanged.

# generateStaticParams for /[locale]/scapegoats/[slug]. hideEmpty: false so a
# term with no incidents yet still gets a page rather than a 404.
query ScapegoatSlugs($first: Int!) {
  scapegoats(first: $first, where: { hideEmpty: false }) {
    nodes {
      slug
    }
  }
}

# The term, its ACF term field group (appendix 03 §4.2), and its incidents.
# `incidents` here is the term-to-post connection WPGraphQL generates because
# `scapegoat` is registered for the `incident` post type — the same "the
# taxonomy already knows" property that makes the leaderboard one indexed read
# (Lesson 09.4 §8). Verification check 8 proves the field exists rather than
# trusting this comment.
#
# `avatar` is deliberately not selected: it is an AcfMediaItemConnectionEdge and
# rendering it well needs `mediaDetails` for next/image (Lesson 14.5). Out of
# scope for a page whose job is the term and its incidents.
query ScapegoatBySlug($slug: ID!, $first: Int!) {
  scapegoat(id: $slug, idType: SLUG) {
    id
    name
    slug
    count
    scapegoatProfile {
      tagline
      defensiveness
      officialExcuse
      firstBlamedOn
      isSentient
    }
    incidents(first: $first, where: { status: PUBLISH }) {
      nodes {
        ...IncidentCardFields
      }
    }
  }
}
```

```bash
npm run codegen && npm run type-check
```

```tsx
// next-app/src/app/[locale]/scapegoats/[slug]/page.tsx
import { notFound } from 'next/navigation';

import { IncidentCard } from '@/components/incidents/IncidentCard';
import { ScapegoatBySlugDocument, ScapegoatSlugsDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { listTag, termTag } from '@/lib/graphql/tags';

export const revalidate = 3600;
export const dynamicParams = true;

/** Ten seeded terms (appendix 03 §9). A taxonomy grows slower than the content that uses it. */
const PRERENDER_LIMIT = 20;

/** Below Lesson 06.4's 50-node connection cap, so this is one query. */
const INCIDENTS_SHOWN = 24;

export async function generateStaticParams(): Promise<Array<{ locale: string; slug: string }>> {
  const data = await fetchGraphQL(
    ScapegoatSlugsDocument,
    { first: PRERENDER_LIMIT },
    // A FIRST APPROXIMATION, and a deliberate one. `incidents` is roughly
    // right — a new scapegoat term usually arrives attached to a newly
    // published incident — but it is not what this query depends on. The set of
    // scapegoat SLUGS changes when a TERM changes, which is a different
    // WordPress hook and a different tag. Lesson 18.2's tag audit is where
    // every read in the app gets the tag it actually depends on; this lesson is
    // about rendering strategy, and mixing the two passes would hide both.
    { revalidate: 3600, tags: [listTag('incident')] }
  );

  const params = (data.scapegoats?.nodes ?? []).flatMap((node) =>
    typeof node?.slug === 'string' ? [{ locale: 'en', slug: node.slug }] : []
  );

  // The build-time receipt. Verification reads this line; do not delete it.
  console.log(`[btt] prerender scapegoats: ${params.length} of at most ${PRERENDER_LIMIT}`);

  return params;
}

export default async function ScapegoatPage({
  params,
}: {
  readonly params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug } = await params;

  const data = await fetchGraphQL(
    ScapegoatBySlugDocument,
    { slug, first: INCIDENTS_SHOWN },
    // TWO tags. The term page changes when the term changes, and when an
    // incident is published that carries it — which moves `count` and adds a
    // card. Lesson 18.3's webhook sends both.
    { revalidate: 3600, tags: [termTag('scapegoat', slug), listTag('incident')] }
  );

  const scapegoat = data.scapegoat;

  if (scapegoat == null) {
    notFound();
  }

  const profile = scapegoat.scapegoatProfile;
  const incidents = scapegoat.incidents?.nodes ?? [];

  return (
    <main>
      <h1 className="text-3xl font-semibold tracking-tight">{scapegoat.name}</h1>

      {/* The profile fields are DELIBERATELY UNSEEDED — Lesson 12.4 §3 says so
          and leaves them that way. So every one of them renders as absent
          rather than as `null`, `undefined` or a crash. This is not defensive
          coding; it is the documented state of the fixture. */}
      {typeof profile?.tagline === 'string' && profile.tagline !== '' ? (
        <p className="mt-2 text-lg italic text-muted-foreground">{profile.tagline}</p>
      ) : null}

      <dl className="mt-6 grid gap-2 sm:grid-cols-2">
        <dt>Times blamed</dt>
        <dd>{scapegoat.count ?? 0}</dd>

        {/* typeof, not a truthiness check: `defensiveness` is a Float and 0 is
            a legitimate value. Lesson 08.1 Step 4 made exactly this mistake
            with downtimeMinutes and then fixed it. */}
        {typeof profile?.defensiveness === 'number' ? (
          <>
            <dt>Defensiveness</dt>
            <dd>{profile.defensiveness}/10</dd>
          </>
        ) : null}

        {typeof profile?.firstBlamedOn === 'string' && profile.firstBlamedOn !== '' ? (
          <>
            <dt>First blamed</dt>
            <dd>{profile.firstBlamedOn}</dd>
          </>
        ) : null}

        {profile?.isSentient === true ? (
          <>
            <dt>Sentient</dt>
            <dd>Allegedly</dd>
          </>
        ) : null}
      </dl>

      {typeof profile?.officialExcuse === 'string' && profile.officialExcuse !== '' ? (
        <blockquote className="mt-6 border-l-2 pl-4">{profile.officialExcuse}</blockquote>
      ) : null}

      <h2 className="mt-10 text-2xl font-semibold">Incidents blamed on {scapegoat.name}</h2>

      {incidents.length === 0 ? (
        <p className="mt-2 text-muted-foreground">Nothing yet. Give it time.</p>
      ) : (
        <ul className="mt-4 grid gap-4">
          {incidents.flatMap((incident) =>
            incident == null ? [] : [
              <li key={incident.id}>
                {/* IncidentCard's props type IS IncidentCardFieldsFragment
                    (Lesson 10.5), which is why this compiles with no mapping. */}
                <IncidentCard incident={incident} />
              </li>,
            ]
          )}
        </ul>
      )}
    </main>
  );
}
```

**Verify §5:**

- [ ] `npm run codegen` regenerated `src/gql/` and `npm run type-check` is silent. If
      `ScapegoatBySlugDocument` does not exist, the operation name in the `.graphql` file and the
      import disagree.
- [ ] `http://localhost:3000/en/scapegoats/the-intern` renders the term name as the `<h1>`, a
      "Times blamed" count, and a list of incident cards.
- [ ] The tagline, defensiveness, excuse and sentience rows are **absent**, not empty and not
      `null`. That is the fixture doing what Lesson 12.4 documented.
- [ ] `http://localhost:3000/en/scapegoats/not-a-real-term` returns 404.

Now give the leaderboard the links it has been missing since Lesson 09.4 — one anchored edit:

```tsx
// next-app/src/app/[locale]/scapegoats/page.tsx — the term name becomes a link
// DELETE the <p> that says "There is no per-scapegoat page yet". It exists now.
            <Link href={`/${locale}/scapegoats/${scapegoat.slug}`}>
              <strong>{scapegoat.name}</strong>
            </Link>
```

That route reads `params` for `locale` already; add `import Link from 'next/link';` if it is not
there.

### Step 6: Un-scope `generateStaticParams` on purpose, and time the build

Lesson 09.4 already bounded all three dynamic routes, so there is no missing function to add. What
is missing is the **number**, and the only way to get it is to break working code on purpose —
the same move Module 14's README calls step 3: break it, watch the failure, and let the failure be
the feature.

There is a wrinkle that makes this more interesting than raising a constant. Lesson 06.4 capped
every WPGraphQL connection at **50 nodes** via `graphql_connection_max_query_amount`, and a client
asking for more is silently clamped. So `first: 100` never returned 100. Enumerating an archive
means a **cursor loop**, and that loop is the build-time cost you are about to measure.

`IncidentSlugs` needs a cursor. An edit to a Lesson 10.5 document:

```graphql
# next-app/src/graphql/incidents.graphql — IncidentSlugs gains a cursor
# Lesson 06.4 caps every connection at 50 nodes, so a bound above 50 is a LOOP
# rather than a bigger `first`. Lesson 18.1 Step 6.
query IncidentSlugs($first: Int!, $after: String) {
  incidents(first: $first, after: $after, where: { status: PUBLISH }) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      slug
    }
  }
}
```

```tsx
// next-app/src/app/[locale]/incidents/[slug]/page.tsx — the bounded warmer
import { fetchGraphQL } from '@/lib/graphql/client';
import { listTag } from '@/lib/graphql/tags';
import { IncidentSlugsDocument } from '@/gql/graphql';

/** Lesson 06.4's `graphql_connection_max_query_amount`. Asking for more is clamped, silently. */
const PAGE_SIZE = 50;

/**
 * 40 seeded incidents (appendix 03 §9), plus room for the ones Module 16 lets
 * visitors submit — Lesson 09.4's number and Lesson 09.4's reason, now actually
 * reachable because the loop below pages past the 50-node cap.
 *
 * `null` means "every slug WordPress will give you". Step 6 sets it to `null`
 * ON PURPOSE, to produce a number; Step 7 puts the bound back.
 */
const PRERENDER_LIMIT: number | null = 100;

export async function generateStaticParams(): Promise<Array<{ locale: string; slug: string }>> {
  const slugs: string[] = [];
  let after: string | null = null;

  for (;;) {
    const data = await fetchGraphQL(
      IncidentSlugsDocument,
      { first: PAGE_SIZE, after },
      { revalidate: 3600, tags: [listTag('incident')] }
    );

    for (const node of data.incidents?.nodes ?? []) {
      if (typeof node?.slug === 'string') {
        slugs.push(node.slug);
      }
    }

    const info = data.incidents?.pageInfo;

    if (
      info?.hasNextPage !== true ||
      typeof info.endCursor !== 'string' ||
      (PRERENDER_LIMIT !== null && slugs.length >= PRERENDER_LIMIT)
    ) {
      break;
    }

    after = info.endCursor;
  }

  const bounded = PRERENDER_LIMIT === null ? slugs : slugs.slice(0, PRERENDER_LIMIT);

  // The build-time receipt, and the number Verification reads. `queries` is the
  // interesting one: it is what grows linearly with the archive.
  console.log(
    `[btt] prerender incidents: ${bounded.length} pages, ` +
      `${Math.ceil(slugs.length / PAGE_SIZE) || 1} GraphQL queries, bound ${PRERENDER_LIMIT ?? 'NONE'}`
  );

  return bounded.map((slug) => ({ locale: 'en', slug }));
}
```

Now break it and measure:

```bash
# The deliberate regression: no bound at all.
sed -i.bak 's/^const PRERENDER_LIMIT: number | null = 100;/const PRERENDER_LIMIT: number | null = null;/' \
  'src/app/[locale]/incidents/[slug]/page.tsx'
grep -n 'PRERENDER_LIMIT: number' 'src/app/[locale]/incidents/[slug]/page.tsx'
# Expected: the line now reads `= null;`

time npm run build 2>&1 | tee /tmp/btt-build-unscoped.log
grep '\[btt\] prerender' /tmp/btt-build-unscoped.log
```

**Verify §6:**

- [ ] The `[btt] prerender incidents` line reports **40 pages** and **1 GraphQL query** — 40 seeded
      incidents fit inside one 50-node page, which is why this is an honest measurement of the
      *mechanism* and a dishonest measurement of the *cost*.
- [ ] Write down the `real` time from `time` and the total pre-rendered page count Next prints.

### Step 7: Restore the bound, build again, and do the arithmetic honestly

```bash
mv 'src/app/[locale]/incidents/[slug]/page.tsx.bak' 'src/app/[locale]/incidents/[slug]/page.tsx'
grep -n 'PRERENDER_LIMIT: number' 'src/app/[locale]/incidents/[slug]/page.tsx'
# Expected: the line reads `= 100;` again

time npm run build 2>&1 | tee /tmp/btt-build-scoped.log
grep '\[btt\] prerender' /tmp/btt-build-scoped.log
```

**Say the uncomfortable thing plainly: at 40 incidents these two builds take the same time.**
40 is under both bounds, so both emit 40 pages and issue one query. There is no wall-clock
difference to report and inventing one would be worse than having none.

What you *can* measure is the per-page cost, and then extrapolate to a number a reader can check:

```
  per-page cost  =  (unscoped build time − a build with generateStaticParams returning [])
                    ────────────────────────────────────────────────────────────────────────
                                        pages pre-rendered

  at 10,000 incidents, unbounded:
      queries      = ceil(10000 / 50)                     = 200 sequential GraphQL round trips
      pages         = 10,000
      build time    = base + 10,000 × <your per-page cost>

  at the bound of 100:
      queries      = 2
      pages         = 100
      build time    = base + 100 × <your per-page cost>
```

Measure the per-page cost the cheap way: temporarily `return [];` from `generateStaticParams`,
build, and subtract. On a 2024 laptop the per-page figure for these routes lands in the low tens of
milliseconds, so 10,000 pages is minutes of rendering **plus** 200 sequential round trips to a
WordPress that is answering nothing else — which is where the 25-minute figure in the module README
comes from. It is arithmetic from a number you measured, not a transcript. That is the honest
version, and an extrapolation a reader can check beats an observation they cannot.

Append both readings to `docs/architecture.md`, under the table from Step 2:

```markdown
<!-- docs/architecture.md — append under the rendering strategy table -->
### `generateStaticParams` measurements (Lesson 18.1)

Date: ______  ·  Next version: ______  ·  Machine: ______

| Variant | Pages pre-rendered | GraphQL queries | `npm run build` real time |
|---|---|---|---|
| unbounded (`PRERENDER_LIMIT = null`) | ______ | ______ | ______ |
| bounded (`PRERENDER_LIMIT = 100`) | ______ | ______ | ______ |
| `generateStaticParams` returning `[]` | 0 | 0 | ______ |

Per-page cost = (bounded − empty) ÷ pages = ______ ms.
Projected unbounded build at 10,000 incidents = base + 10,000 × that, plus 200 sequential
queries. **At 40 seeded incidents the two variants are indistinguishable, and the projection is
arithmetic rather than an observation.** Lesson 21.1 may copy the per-page number into
`docs/perf-baseline.md`.
```

### Step 8: Prove the authenticated routes are uncached, with two different sessions

One session proves nothing: a cached page and a correct page look identical to one visitor. Two
sessions is the test.

```bash
cd ../wordpress-headless

# Passwords into THIS SHELL ONLY. Never a dotfile, never .env — appendix 04 §1.
export BTT_REPORTER_PASSWORD="$(openssl rand -base64 24)"
export BTT_EDITOR_PASSWORD="$(openssl rand -base64 24)"
docker compose run --rm wpcli wp user update reporter --user_pass="$BTT_REPORTER_PASSWORD" >/dev/null
docker compose run --rm wpcli wp user update editor   --user_pass="$BTT_EDITOR_PASSWORD"   >/dev/null

jwt() {
  curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg u "$1" --arg p "$2" '{
         query: "mutation Login($u:String!,$p:String!){ login(input:{username:$u,password:$p}){ authToken } }",
         variables: { u: $u, p: $p } }')" | jq -r '.data.login.authToken'
}

export JWT_REPORTER="$(jwt reporter@blamethe.tech "$BTT_REPORTER_PASSWORD")"
export JWT_EDITOR="$(jwt editor@blamethe.tech "$BTT_EDITOR_PASSWORD")"
test -n "$JWT_REPORTER" -a "$JWT_REPORTER" != null && echo 'reporter token captured'
test -n "$JWT_EDITOR"   -a "$JWT_EDITOR"   != null && echo 'editor token captured'
```

**Verify §8:**

- [ ] Both lines printed "token captured". A `null` means the password update did not take — rerun
      the `wp user update` for that user.
- [ ] `curl -s -b "btt_at=$JWT_REPORTER" http://localhost:3000/en/account | grep -c 'Sam Reporter'`
      is `1` or more, and the same command with `$JWT_EDITOR` finds `Dana Editor` and **not** Sam.
- [ ] `curl -s -b "btt_at=$JWT_REPORTER" http://localhost:3000/api/auth/session` prints
      `{"isLoggedIn":true,"displayName":"Sam Reporter"}` — and no `roles`, no token, nothing else.

---

## Verification

```bash
cd next-app

# The WordPress request counter from Lesson 10.3 Step 2. Re-paste it in a new shell.
gqlog() {
  docker compose -f ../wordpress-headless/docker-compose.yml \
    logs --since="${1:-60s}" wordpress | grep -c 'POST /graphql'
}

# 1. Types, lint and the unit suite are clean before anything is measured
npm run type-check && npm run lint && npm run test:run
# Expected: no type errors, no lint errors, every Vitest file green.
#           tags.test.ts in particular — nothing in this lesson touched tags.ts.

# 2. NEGATIVE — the session read is GONE from the root layout. This is the check
#    that makes every other number in this block possible.
grep -c 'getSession' 'src/app/[locale]/layout.tsx'
# Expected: 0

# 3. NEGATIVE — the client half never names the cookie, and never logs
grep -rc 'btt_at' src/components/layout/SessionMenu.tsx
# Expected: 0   — the cookie is httpOnly; JavaScript cannot read it and does not try
grep -c 'console' src/components/layout/SessionMenu.tsx
# Expected: 0   — Lesson 12.3's smoke suite fails a spec on any console.error

# 4. Build, and read the two receipts generateStaticParams prints for itself
npm run build 2>&1 | tee /tmp/btt-build-final.log
grep '\[btt\] prerender' /tmp/btt-build-final.log
# Expected: two lines —
#   [btt] prerender incidents: 40 pages, 1 GraphQL queries, bound 100
#   [btt] prerender scapegoats: 10 of at most 20
#   40 incidents and 10 scapegoat terms are appendix 03 §9's seed counts.
#   TWO lines is correct TODAY, with one locale. Module 20 adds `uk` and `de`,
#   and a child route's generateStaticParams runs once per parent locale — so
#   from Lesson 20.3 onward this prints SIX lines and the build makes three
#   times as many GraphQL round trips. That is not a regression; it is the
#   cost of the locale segment, and Lesson 21.1 is where it gets measured.

# 5. Static output actually landed on disk. THIS CHECK IS THE ARBITER, not
#    check 4, and that ordering was measured rather than assumed. On Next
#    16.3.4 a layout that reads `cookies()` prerenders ZERO pages and still
#    prints the same `●` symbol, the same child slug rows, and the same check-4
#    receipt — because `generateStaticParams` runs either way, and `●` means
#    "this route has generateStaticParams", not "HTML exists". Only the disk
#    tells them apart. Do not grep the build table for the literal SSG either:
#    Next 16 prints symbols and they move between minors.
find .next/server/app -name 'incident-*.html' | wc -l
# Expected: 40. If this is 0, nothing was prerendered — whatever check 4 said.
#           The second tell is the build table's `Revalidate` column: Next only
#           prints it when at least one route is genuinely prerendered with ISR.

# 6. /hobt is genuinely static: serve it with WordPress STOPPED
docker compose -f ../wordpress-headless/docker-compose.yml stop wordpress
npm run start & SERVER_PID=$!
sleep 6
curl -s -o /dev/null -w '/en/hobt %{http_code}\n' http://localhost:3000/en/hobt
# Expected: /en/hobt 200 — served from the build. `revalidate = false` means no
#           timer will ever try to refetch it, so a dead origin is invisible here.
curl -s -o /dev/null -w '/en/incidents/incident-01 %{http_code}\n' \
  http://localhost:3000/en/incidents/incident-01
# Expected: 200 — pre-rendered, same reason
kill "$SERVER_PID"
docker compose -f ../wordpress-headless/docker-compose.yml start wordpress
sleep 12

# 7. The URL facet is one cache entry per variable set, shared across visitors
npm run start & SERVER_PID=$!
sleep 6
curl -s -o /dev/null 'http://localhost:3000/en/incidents?q=friday'
curl -s -o /dev/null 'http://localhost:3000/en/incidents?q=friday'
gqlog 20s
# Expected: 1 — two requests, one WordPress query. The HTML was assembled twice;
#           the query was not (Key Concept 2).
curl -s -o /dev/null 'http://localhost:3000/en/incidents?q=cache'
gqlog 30s
# Expected: 2 — a DIFFERENT variable set is a different entry. Facets are cheap;
#           a facet nobody shares is a cache entry nobody shares.

# 8. The term-to-post connection this lesson assumed really exists in the schema
grep -c 'ScapegoatToIncidentConnection' ../wordpress-headless/schema.graphql
# Expected: 1 or more. If it is 0, run `npm run schema:pull` first — and if it is
#           still 0, `scapegoat` is not registered for the `incident` post type
#           and appendix 03 §2 is where to look.

# 9. The new route renders, and the unseeded profile fields render as ABSENT
curl -s http://localhost:3000/en/scapegoats/the-intern | grep -c 'Times blamed'
# Expected: 1
curl -s http://localhost:3000/en/scapegoats/the-intern | grep -c 'Defensiveness'
# Expected: 0 — deliberately unseeded (Lesson 12.4 §3). Absent, not null, not 0.
curl -s http://localhost:3000/en/scapegoats/the-intern | grep -cE 'null|undefined|NaN'
# Expected: 0   — the strongest single assertion about nullable ACF term fields
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/scapegoats/not-a-real-term
# Expected: 404

# 10. dynamicParams: a slug outside the bound still renders. Prove it with the
#     one route whose bound is smaller than its catalogue.
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/reviews/review-01
# Expected: 200 — inside the bound of 20
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/blog/blog-10
# Expected: 200 — rendered on demand if it fell outside the bound, and static after

# 11. NEGATIVE — the anonymous session answer carries no credential of any kind
curl -s http://localhost:3000/api/auth/session
# Expected: exactly {"isLoggedIn":false}
curl -s http://localhost:3000/api/auth/session | grep -cE 'jwt|token|btt_at|roles'
# Expected: 0
curl -si http://localhost:3000/api/auth/session | grep -i '^cache-control'
# Expected: a Cache-Control containing private and no-store

# 12. NEGATIVE — two different sessions get two different /en/account bodies.
#     Requires the two JWTs exported in Task Step 8.
curl -s -b "btt_at=$JWT_REPORTER" http://localhost:3000/en/account | grep -c 'Sam Reporter'
# Expected: 1 or more
curl -s -b "btt_at=$JWT_EDITOR" http://localhost:3000/en/account | grep -c 'Sam Reporter'
# Expected: 0   — if this is 1, an authenticated response was cached and served to
#           the wrong user. That is a DISCLOSURE, not a performance bug. Stop.
curl -s -b "btt_at=$JWT_EDITOR" http://localhost:3000/en/account | grep -c 'Dana Editor'
# Expected: 1 or more

# 13. NEGATIVE — and that response is not cacheable by anything in front of it
curl -si -b "btt_at=$JWT_REPORTER" http://localhost:3000/en/account | grep -i '^cache-control'
# Expected: a Cache-Control containing no-store (proxy sets `private, no-store`
#           on guarded paths — Lesson 15.5). Never `s-maxage`, never `public`.

# 14. NEGATIVE — mounting draftMode() in the same layout did NOT undo Step 1.
#     Lesson 17.2 put PreviewBanner there; it reads __prerender_bypass, which
#     Next owns, so the routes must still be pre-rendered (Key Concept 4).
grep -c 'PreviewBanner' 'src/app/[locale]/layout.tsx'
# Expected: 1
find .next/server/app -name 'incident-*.html' | wc -l
# Expected: still 40 files, WITH PreviewBanner mounted. Measured on Next
#           16.3.4: this passes, and the two builds' route tables are
#           byte-identical. Check 4's receipt is NOT the arbiter here — it
#           prints 40 pages either way. If this count is 0, reading draftMode()
#           in a layout is opting your Next version out of static rendering —
#           a blocker for Lesson 17.2 as much as for this one, and the fix is to
#           move the banner below the layout, into the three content routes that
#           already await it. Report the build output; do not work around it.

# 15. NEGATIVE — the unbounded variant is gone from the committed file
grep -c 'PRERENDER_LIMIT: number | null = null' 'src/app/[locale]/incidents/[slug]/page.tsx'
# Expected: 0
test -f 'src/app/[locale]/incidents/[slug]/page.tsx.bak' && echo 'BAK STILL PRESENT' || echo clean
# Expected: clean — Step 7 moved it back

# 16. NEGATIVE — THE THESIS, still true. Delete the proxy and nothing new
#     is reachable. A /tmp copy, never a git restore: this file changed in
#     Lesson 15.5 and the module commits AFTER verification, so git would hand
#     you the previous module's version.
cp src/proxy.ts /tmp/btt-proxy-181.ts
rm src/proxy.ts
kill "$SERVER_PID"
npm run build >/dev/null 2>&1
npm run start & SERVER_PID=$!
sleep 6
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/en/account
# Expected: 307 http://localhost:3000/en/login?next=/en/account
#           Same answer as with proxy. account/layout.tsx's requireSession()
#           produced it. Only the CHROME moved out of the layout in this lesson;
#           the boundary is exactly where Lesson 15.5 left it.
kill "$SERVER_PID"
cp /tmp/btt-proxy-181.ts src/proxy.ts
rm /tmp/btt-proxy-181.ts

# 17. The strategy table and the measurements are written down
grep -c 'Rendering strategy, per route' ../docs/architecture.md
# Expected: 1
grep -c 'generateStaticParams` measurements' ../docs/architecture.md
# Expected: 1

# 18. Both suites still green after all of that
npm run build && npm run test:run
# Expected: 0 failures
E2E_MODE=1 E2E_SECRET="$E2E_SECRET" npx playwright test --project=smoke
# Expected: 9 passed — and ZERO console errors, which is what proves SessionMenu
#           is silent on every one of the nine routes
```

If check 12 finds `Sam Reporter` under the editor's token, stop and reread Key Concept 9. Nothing
else in this block matters until that is `0`.

## Control Questions

1. `/en/incidents` is dynamic and `/en/incidents/incident-01` is ISR, yet a hundred requests to
   the first one in five minutes produce the same number of WordPress queries as a hundred
   requests to the second. Explain, naming the cache that is responsible in each case and the
   thing each one is keyed on.
2. Reading `cookies()` in the root layout made every route dynamic; reading `draftMode()` in the
   same file does not. State the difference in one sentence, then say what would have to be true
   for `cookies()` to get the same treatment.
3. `/hobt` moved from `revalidate = 60` to `revalidate = false`. Name the thing that is now
   load-bearing which was not before, the observable symptom if it silently stops working, and
   which lesson's artifact is the response to that risk.
4. `PRERENDER_LIMIT` is 100 for incidents, 50 for posts and 20 for reviews. Argue against
   standardising all three to 50, then describe precisely what a visitor experiences when they
   request the 101st incident.
5. A colleague adds `export const dynamic = 'force-dynamic'` to `incidents/page.tsx`, reasoning
   that the route is dynamic anyway so the export is documentation. Describe what actually changes,
   what does *not* change today, and the specific future commit that turns it into a regression.

## Learn More

- [Next.js — route segment config](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config)
  — `dynamic`, `revalidate`, `dynamicParams` and `fetchCache` in the framework's own words; read
  the `force-dynamic` row twice, because it is the one that also changes `fetch` defaults
- [Next.js — `generateStaticParams`](https://nextjs.org/docs/app/api-reference/functions/generate-static-params)
  — the "all paths at build time versus a subset" section is exactly the trade-off Steps 6 and 7
  measure
- [Next.js — Caching](https://nextjs.org/docs/app/guides/caching) — the canonical description of
  the four caches in Key Concept 3, including the diagrams showing which one a `revalidateTag` call
  actually touches
- [Next.js — Partial Prerendering](https://nextjs.org/docs/app/getting-started/partial-prerendering)
  — the feature that makes Step 1 unnecessary, so you can judge for yourself when it is safe to
  take a dependency on it
- [Next.js — `draftMode`](https://nextjs.org/docs/app/api-reference/functions/draft-mode) — read
  this next to Key Concept 4; the `__prerender_bypass` cookie is what makes the asymmetry real
- [Next.js — Incremental Static Regeneration](https://nextjs.org/docs/app/guides/incremental-static-regeneration)
  — on-demand versus time-based revalidation, which is the bridge into Lesson 18.2
- [WPGraphQL — connection edges, nodes and pagination](https://www.wpgraphql.com/docs/connections/)
  — the cursor loop in Step 6 is this document applied to a build step
- [WordPress — `graphql_connection_max_query_amount`](https://www.wpgraphql.com/filters/graphql_connection_max_query_amount/)
  — the filter Lesson 06.4 set to 50, and the reason a bound above 50 is a loop
- [React — `useEffect` for synchronising with an external system](https://react.dev/reference/react/useEffect)
  — `SessionMenu` is the smallest honest example: a fetch on mount, an `AbortController`, and a
  cleanup function
- [web.dev — Cumulative Layout Shift](https://web.dev/articles/cls) — why `min-w-[9rem]` on a
  region that resolves asynchronously is a correctness decision and not styling
