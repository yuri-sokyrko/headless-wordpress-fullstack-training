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
- The Module 16 Server Actions audited against the scheme — `void listTag('incident')` in
  `submitIncident` stays a non-call, and the lesson says why no Server Action in this application
  ever expires a public tag
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

### 1. A time window is a guess; a tag is a fact

Every `revalidate` number in this app is an estimate of how often somebody edits something. That
estimate is wrong in both directions at once.

| | `revalidate: 3600` alone | `revalidate: 3600` + a tag |
|---|---|---|
| An editor publishes at 09:00 | the public sees it some time before 10:00 | the public sees it in seconds |
| Nobody edits anything all day | the page is re-rendered 24 times for no reason | rendered once |
| You want a specific page fresh now | shorten the window everywhere, or wait | invalidate that one tag |
| The mechanism knows *what* changed | no — only *when* | yes |

**The verdict: keep the window, add the tag, and treat the window as the fallback rather than the
policy.** A tag is a fact — "this cached entry depends on `incident:incident-01`" — asserted at
write time by the code that knew it. The window is what happens when the fact never arrives,
because the webhook was down or the network dropped a fire-and-forget POST. Both, not either: the
tag is the mechanism and the window is the insurance, and Lesson 18.1's `/hobt` is the one route
that deliberately buys no insurance.

### 2. Fan-out is the reason this architecture can be static at all

`delete_transient()` deletes one entry. `revalidateTag` invalidates **every** cached entry that
carried that tag, wherever in the application it was written, in one call.

```
    revalidateTag('incidents')
              │
      ┌───────┼─────────┬──────────────┬────────────────┬──────────────┐
      ▼       ▼         ▼              ▼                ▼              ▼
  /en          /en/     /en/scapegoats  /en/scapegoats/  sitemap.ts    the
  home feed    incidents  leaderboard   the-intern       (Module 19)   incident
  IncidentsList  archive   term counts   term page                     ticker block
      │                                                                (14.4)
      └── all of these fetched with tags: [listTag('incident')] and are
          now stale. Each rebuilds on ITS next request, independently.
```

There is no WordPress equivalent. The object cache has **groups**, but no "flush this group"
primitive — so the pattern everyone lands on is a hand-maintained index of transient keys, written
by the code that sets them and read by the code that deletes them. That index is the thing that
drifts. `tags.ts` is the same idea with the index finally in one file and the compiler checking the
call sites.

This is why "static and fresh" is a real combination here rather than a slogan. Ten routes can each
be pre-rendered HTML, and one publish event can correctly expire exactly the seven of them that
showed that incident, without anybody having enumerated the seven.

### 3. The strings are the engineering problem; the API is nearly trivial

`revalidateTag(tag: string, profile: string)`. That is very nearly the whole API surface, and it is
not where the difficulty is.

The second argument is a Next 16 change and it is not optional — the one-argument call every
pre-16 tutorial shows is deprecated and produces a TypeScript error. It names a
[`cacheLife`](https://nextjs.org/docs/app/api-reference/functions/cacheLife) profile, which is how
long a cached entry may still be served *while* the fresh one is fetched. This course passes
`'max'` everywhere: a publish in WordPress means "this is stale now", the visitor who arrives
during the refetch gets the previous HTML rather than a spinner, and the next one gets the new
page. Stale-while-revalidate is the correct trade for public content.

Its sibling matters for the shape of Module 16. `updateTag(tag)` is Server-Actions-only and gives
**read-your-writes**: it expires *and* refetches inside the same request, so the user who just
submitted the form sees their own change rather than a cached page that is one revalidation
behind. This application never needs it — Key Concept 7 explains why no Server Action here expires
a public tag — but "webhook → `revalidateTag`, own-mutation → `updateTag`" is the rule to carry to
the next codebase.

```
   THE OBVIOUS DESIGN — TWO TAG BUILDERS, NO COMPILER BETWEEN THEM

   1. the read      src/app/**/page.tsx      tags: [incidentTag(slug), listTag('incident')]
                            │                          ▲
                            │                          │  typed, checked
                            ▼                          │
   2. the vocabulary  src/lib/graphql/tags.ts ─────────┘
                            ┆
                            ┆  ...reproduced, BY HAND, in another language
                            ▼
   3. the write      includes/Revalidate.php   'incident-' . $post->post_name
                                                    ▲
                                       NOTHING checks this against 2.
```

`incident:incident-01` in TypeScript and `incident-incident-01` in PHP produces: HTTP 200, a
`revalidated` array full of plausible-looking strings, no log line, no error, and a page that stays
stale. Every instinct you have says the caching is broken. The caching is working perfectly, on a
tag nobody attached.

> **This is the failure mode to memorise, because you will meet it in some other codebase.** A tag
> mismatch is indistinguishable from a caching bug for exactly as long as you are willing to stare
> at the caching. The only cheap way out is to make sure there is exactly one thing in the system
> that builds a tag — which is what Lesson 18.3 does, and it is worth knowing that the obvious
> design is the one above.

Lesson 18.3 therefore does **not** build tag strings in PHP. The webhook payload carries WordPress
**identifiers** — `postType: 'incident'`, `slug: 'incident-01'` — and the Next route handler calls
`incidentTag()` and `listTag()` on them, so `tags.ts` stays the only tag builder in either
codebase:

```
   WHAT THIS COURSE BUILDS — ONE TAG BUILDER

   src/lib/graphql/tags.ts ◀── the read (page.tsx)
              ▲
              └── the write (src/app/api/revalidate/route.ts)
                              ▲
                              │  { "postType": "incident", "slug": "incident-01" }
                              │  Zod rejects an unknown postType with a LOUD 400
                       includes/Revalidate.php
```

The two-codebase contract does not disappear — PHP still has to send `tech_review` and not
`techReview`, and `$post->post_name` and not `$post->post_title`. What changes is the **failure
mode**: a drifted identifier is a `400` you can see, and a drifted tag string was a `200` you
could not. Lesson 18.3 Key Concept 8 makes that argument properly; Lesson 12.2's `tags.test.ts`
still pins the exact output strings, because they are now the only strings anybody builds.

### 4. The naming scheme, and where the locale goes

The scheme is Lesson 10.3 Key Concept 6's and it does not change here. What changes is that it is
now load-bearing, so the exact shapes matter:

| Builder | Produces | Invalidates |
|---|---|---|
| `incidentTag('incident-01')` | `incident:incident-01` | one incident, everywhere it appears |
| `postTag`, `reviewTag`, `pageTag` | `post:…`, `review:…`, `page:…` | one node of that type |
| `listTag('incident')` | `incidents` | every list of incidents |
| `taxonomyListTag('scapegoat')` | `scapegoats` | every list of scapegoat terms |
| `termTag('scapegoat', 'the-intern')` | `scapegoat:the-intern` | one term and its archives |
| `siteTag()` | `site-settings` | the SCF options page |
| `menuTag('primary')` | `menu:primary` | one menu location |

Lowercase, colon-separated, singular for a node and plural for a list. `listTag` takes the
**singular** type and returns the plural, so the call site reads "the list of incidents" while the
tag stays `incidents` — and `listTag('incidents')` is a compile error, which is the entire point of
the asymmetry.

**The locale goes in two different places, and Lesson 12.2 already pins both:**

```
   node tag:  incident:de:incident-01     locale INFIXED   (type : locale : slug)
   list tag:  incidents:de                locale APPENDED  (plural : locale)
```

Nothing in this app passes a locale yet. Module 20.4 does. The asymmetry looks arbitrary until you
read it as a prefix tree: a node tag is `type` then `scope` then `identity`, and a list tag has no
identity to put last. Whatever the justification, **the shapes are frozen by a test that already
exists**, so this is a fact to reproduce rather than a decision to revisit.

### 5. `segment()` throws, and that is a feature

`tags.ts` normalises every slug through one function: trim, lowercase, reject empty, reject a slug
containing `:`. Two of those are throws, and both exist because of PHP.

| Input | `segment()` | Why not just tolerate it |
|---|---|---|
| `'  Incident-01  '` | `'incident-01'` | a slug is editorial input; normalise rather than trust |
| `'відмова-системи'` | unchanged | Module 20 has non-Latin slugs; there is no ASCII allowlist, deliberately |
| `''` | **throws** | `incident:` matches nothing, and looks like it worked |
| `'   '` | **throws** | same |
| `'incident:01'` | **throws** | `incident:incident:01` is a tag PHP would build differently |

The rule underneath: **a tag that the PHP side could not reproduce byte for byte must fail loudly in
TypeScript, at the moment it is constructed.** An empty slug produces `incident:` — a syntactically
fine tag that will never match anything and will never be invalidated by anything. That is not a
tag; it is a silent no-op with a plausible shape. Better to crash the render.

### 6. Two list vocabularies, and why mixing them is a compile error

`tags.ts` has **two** list builders, and they are not a duplication waiting to be merged.

| | `listTag(type)` | `taxonomyListTag(taxonomy)` |
|---|---|---|
| Parameter type | `ContentType` — `incident`, `post`, `review`, `page` | `TaxonomyName` — `scapegoat`, `severity`, `stack` |
| Produces | `incidents`, `posts`, `reviews`, `pages` | `scapegoats`, `severities`, `stacks` |
| Changed in WordPress by | `transition_post_status` | **`saved_term`** |
| Arrives in the webhook as | `type: 'post'` | `type: 'term'` |
| Locale | appended — `incidents:de` | appended — `scapegoats:de` |

Two vocabularies that share a shape, not a duplication. A post type and a taxonomy are different
WordPress registrations, changed by different hooks, arriving down different branches of Lesson
18.3's payload. Merging them over one union would make `listTag('scapegoat')` compile, which is
precisely the outcome to avoid: **because the parameter types are disjoint, the wrong call is a
compile error rather than a runtime no-op.** Lesson 12.2 pins both directions with a paired
`@ts-expect-error`, and that pair is not theoretical — it is what caught Lesson 16.2's
`termAllowlist()` reaching for `listTag('scapegoat')`, because the function it wanted existed and
it guessed the wrong name.

**A mistaken word in a vocabulary does not announce itself as a vocabulary problem — it shows up as
somebody using the nearest wrong one.** So this lesson's job is not to add words but to route every
call site in `src/` through them and write the vocabulary down (Step 7). Two still do not:

| Call site | Today | After Step 3 |
|---|---|---|
| `scapegoats/page.tsx` — the leaderboard | `listTag('incident')` alone, so a renamed term never expires the leaderboard | `[taxonomyListTag('scapegoat'), listTag('incident')]` |
| `scapegoats/[slug]` — `generateStaticParams` | `listTag('incident')`, the first approximation Lesson 18.1 flagged | `[taxonomyListTag('scapegoat')]` |

Neither is a type error. Both attach a tag that describes a dependency the query does not have,
and a tag naming the wrong dependency is invalidated at the wrong times in both directions: too
often, and then not at all when it matters.

### 7. No Server Action in this application ever expires a public tag

Lesson 16.2's `submitIncident` is the natural place to look for `revalidateTag`, and it does not
call it. Lesson 16.2 §8 argued that per-surface; the general form is stronger:

> **No Server Action in this application ever expires a public tag, and that is the architecture,
> not an omission.** Every public state change happens in WordPress — publish, approve, edit a
> term — and WordPress is the only system that knows it happened. Next's Server Actions only ever
> change *private* state, which is why they call `revalidatePath` on `/{locale}/account` and
> nothing else. That is exactly why Lesson 18.3 has to exist.

Read the table in Lesson 16.2 §8 next to that sentence. A submitted incident is `pending`, so:

| Surface | Changed by `submitIncident`? | Tag expired |
|---|---|---|
| `/en/incidents` — the public archive | **no**, the incident is invisible | none. Expiring `incidents` would throw away a good entry to change nothing |
| the scapegoat term page and its `count` | **no**, counts exclude `pending` | none |
| `/en/account` — the reporter's own submissions | yes | none — the data is `no-store`; what is stale is the **Router Cache**, so `revalidatePath` |
| all of the above, **on publish** | yes | Lesson 18.3, from WordPress |

So `void listTag('incident')` in `submitIncident` stays a non-call. It is a comment with a type
check: it documents which tag *would* be expired and fails `npm run type-check` if `tags.ts` ever
renames the helper, which a prose comment would not. There are no placeholder `revalidateTag` calls
in Module 16 to replace, because Lesson 16.2 deliberately never wrote any.

### 8. Never tag an authenticated fetch, and here is exactly what breaks

`fetchGraphQLAuthed` has three parameters — document, variables, credential — and **no options
bag**. There is no `tags` array to pass and no `revalidate` to set. This lesson is the one where
somebody tries, because this is the lesson that hands out cache options.

Suppose it accepted them, and somebody wrote
`fetchGraphQLAuthed(MySubmissionsDocument, {}, cred, { tags: [listTag('incident')] })`:

```
  1. Sam requests /en/account.  Authorization: Bearer <sam's jwt>
  2. The response — Sam's private submissions — is written to the DATA CACHE,
     keyed on method + URL + body + headers, tagged `incidents`.
  3. Dana requests /en/account.  Authorization: Bearer <dana's jwt>
       → DIFFERENT headers → different key → a MISS. Dana sees her own data.
  4. ...until any code path issues the same request with the same headers.
     A retry. A background revalidation. A Server Action re-running the read
     inside a request that already has Sam's token in scope. Then Sam's
     response is served for a render that is not Sam's.
  5. Two HTTP 200s in the log. No error. Nobody notices for a month.
```

The subtlety worth naming: the header is part of the cache key, so this is not *immediately* a
leak, and that is what makes it dangerous. It is a leak that waits for a coincidence. Add a
`revalidateTag('incidents')` call from the webhook and step 4 stops needing a coincidence — the
entry is dropped and re-populated by whichever request happens to arrive first.

**Which is why the fix is not vigilance.** The function has no parameter. A colleague in a hurry
cannot get this wrong; they would have to change the signature, which is a diff a reviewer sees.
Verification check 6 greps for it, and Lesson 18.4 asserts it again.

### 9. Invalidation is not immediate the way `delete_transient()` is

`delete_transient()` runs in the same process that owns the cache. The row is gone before the
function returns. `revalidateTag` is not that.

```
   t=0    editor publishes → webhook → revalidateTag('incident:incident-01')
                             the entry is MARKED STALE. It is still on disk.
   t=0    a request arriving right now may still be served the stale render
          (Next serves stale while it revalidates — that is the point of ISR)
   t=0+   the next request for that route triggers a re-render
          → fetchGraphQL runs → WordPress is queried → new HTML is written
   t=1s   everybody after that gets the new page
```

Three consequences, all worth knowing before you debug one of them:

- **The first visitor after a publish pays the render cost.** On a page with a slow query that is a
  measurable, once-per-publish latency spike. It is also why the editor clicking "View post" often
  sees the change instantly — they *are* the first visitor.
- **Nothing observable happens at invalidation time.** No log line, no file deleted you can watch.
  The only way to see a tag work is to request the page afterwards.
- **`revalidateTag` must run inside a route handler or a Server Action.** It cannot be called from
  a plain module at import time; Next needs a request context to attach the invalidation to. This
  is the mistake that turns into "why does my `scripts/` file throw", and it is why Step 6's manual
  proof uses a throwaway **route handler** rather than a script.

### 10. `revalidatePath('/', 'layout')` — named so it can be avoided

There is a sledgehammer. `revalidatePath('/', 'layout')` invalidates every cached route under the
root layout: the Full Route Cache, the Data Cache entries those routes used, and the Router Cache
for every client.

| Call | Invalidates | Use it |
|---|---|---|
| `revalidateTag('incident:incident-01')` | every entry carrying that tag | **always, in production** |
| `revalidatePath('/en/account')` | that one route's cached render and RSC payload | for a route with no tag, because its data was never cached — Lesson 16.2 |
| `revalidatePath('/', 'layout')` | **everything** | once, in the test-only hook in Lesson 18.3 |

It has exactly one legitimate use in this course, and it arrives in the next lesson: after
`wp db reset && wp db import`, every cache entry in Next describes a database that no longer
exists. There is no set of tags that expresses "the entire content universe was replaced" — so the
sledgehammer is not a shortcut there, it is the correct description of what happened.

Everywhere else it is wrong for a reason worth stating as a number: it discards every good entry
along with the bad ones, so the next request to **every** route pays a full render, and on a site
with a hundred warm routes that is a hundred cold renders and a hundred WordPress queries arriving
at once — from a cache invalidation whose purpose was to update one page.

---

## Task

### Step 1: Promote `tags.ts`, and read the builder nothing has used yet

**Not a single function changes name or shape in this step.** Lesson 10.3 wrote all nine builders
and Lesson 12.2 pins their exact output. What changes is what the file *means*: from Lesson 18.3
onward it is not a convenience, it is the only thing in either codebase that constructs a cache
tag. Say so at the top of it.

```ts
// next-app/src/lib/graphql/tags.ts — replace the opening comment block
// The ONLY place cache tag strings are constructed. The two call sites that
// must agree are both here in TypeScript, with `tsc` between them: the fetch
// that ATTACHES a tag (src/app/**/page.tsx) and the route handler that
// EXPIRES it (src/app/api/revalidate/route.ts).
//
// WordPress never builds a tag string. Module 18.3's webhook sends IDENTIFIERS
// — type, post type, taxonomy, slug, term id, locale — and the Next route
// turns them into tags with the functions below. That is deliberate: the
// cross-language contract is then a short enumerated vocabulary that Zod
// validates, so a drifted identifier is a loud 400 rather than a silent
// success. `incident:dns` here versus `incident-dns` rebuilt in PHP is the bug
// that design makes unrepresentable, by having no PHP.
//
// Lesson 12.2 unit-tests the exact output of every function below, and Lesson
// 18.2 §3 is why those tests are not optional.
//
// No `import 'server-only'` here, deliberately: this file is pure string
// manipulation with no secret and no I/O, and Module 12 runs its tests in a
// plain Node process where the `server-only` module throws on purpose.
```

Then read `taxonomyListTag` — the one builder in the file that, until this lesson, almost nothing
called. Lesson 10.3 shipped it because its own per-route policy table promised the tag string
`scapegoats`, and Lesson 16.2's `termAllowlist()` is its only existing consumer:

```ts
// next-app/src/lib/graphql/tags.ts — read this, do not retype it (Lesson 10.3)
export function taxonomyListTag(taxonomy: TaxonomyName, locale?: string): string {
  const plural = TAXONOMY_PLURAL[taxonomy];
  return locale === undefined ? plural : `${plural}:${segment(locale)}`;
}
```

`TAXONOMY_PLURAL` spells the three plurals out rather than deriving them, for a reason worth
noticing: `severity` plus `s` is not a word. Every plural here is a written decision, which is what
makes the vocabulary reproducible by anyone reading Step 7's contract.

**Verify §1:**

- [ ] `grep -c '^export function' src/lib/graphql/tags.ts` is `9`, and
      `grep -c 'taxonomyListTag' src/lib/graphql/tags.ts` is `1`. Both were already true before you
      started this step — Lesson 10.3 wrote them.
- [ ] `git diff src/lib/graphql/tags.ts` shows **only the comment block**. If it shows a function
      body, you retyped something Lesson 12.2 is asserting on.
- [ ] `npm run test:run` and `npm run type-check` are both clean, and unchanged.

### Step 2: Extend the Module 18 contract test with what the webhook actually emits

Lesson 12.2 already pins every builder's output, including `taxonomyListTag`'s plurals, its
appended locale, and the paired `@ts-expect-error`. What it could not pin is the set of strings
**Lesson 18.3's webhook route emits per event**, because that route did not exist. Its
`describe('the contract with Module 18')` block asserts five; the webhook's term branch emits two
more, and one is a shape nothing anywhere has asserted. An **edit** to Lesson 12.2's file, so not
a `produces:` entry.

```ts
// next-app/src/lib/graphql/tags.test.ts — widen the body of the existing
// describe('the contract with Module 18') test
  it('produces the exact strings Module 18.3 makes the webhook route expire', () => {
    // ONE structural assertion instead of seven `toBe`s: seven toBe's stop at
    // the first failure, this prints every difference at once (Lesson 12.2 §2).
    expect({
      node: incidentTag('incident-01'),
      list: listTag('incident'),
      term: termTag('severity', 's1-catastrophic'),
      taxonomyList: taxonomyListTag('scapegoat'),
      // THE ID-KEYED TERM TAG. Lesson 14.4's ScapegoatPicker tags its fetch
      // with termTag('scapegoat', String(termId)), because the block stores a
      // term ID and cannot know the slug before its own response arrives. The
      // webhook therefore sends BOTH forms of every term event, and until now
      // nothing asserted that an integer survives segment() unchanged.
      termById: termTag('scapegoat', String(4)),
      site: siteTag(),
      menu: menuTag('primary'),
    }).toEqual({
      node: 'incident:incident-01',
      list: 'incidents',
      term: 'severity:s1-catastrophic',
      taxonomyList: 'scapegoats',
      termById: 'scapegoat:4',
      site: 'site-settings',
      menu: 'menu:primary',
    });
  });
```

Add `taxonomyListTag` to that file's import list if Lesson 12.2 did not already need it there.

```bash
npm run test:run
```

**Verify §2:**

- [ ] `tags.test.ts` is green with the **same number of tests as before** — this step widened one
      assertion rather than adding a case.
- [ ] `npx vitest run -t "webhook"` runs exactly one test. If it runs zero, your `it(...)` text
      differs from the line above; use whatever your file says.
- [ ] `termById` is `scapegoat:4`, not `scapegoat:4:` and not `scapegoat:`. `segment()` trims and
      lowercases and does nothing else to a numeric string, which is the property Lesson 18.3
      relies on when it stringifies `term_id`.

### Step 3: Route every tag in `src/` through `tags.ts`

Three call sites are wrong or missing. Fix them, then prove there is nothing else.

```tsx
// next-app/src/app/[locale]/scapegoats/page.tsx — the leaderboard's tags
import { listTag, taxonomyListTag } from '@/lib/graphql/tags';

  const data = await fetchGraphQL(
    ScapegoatLeaderboardDocument,
    { first: 10 },
    // TWO tags, both real dependencies. The set of terms changes when an editor
    // adds or renames one; `count` changes on every incident publish. Lesson
    // 10.3's policy table promised exactly these two strings.
    { revalidate: 600, tags: [taxonomyListTag('scapegoat'), listTag('incident')] }
  );
```

```tsx
// next-app/src/app/[locale]/scapegoats/[slug]/page.tsx — discharge Lesson 18.1's DEBT
// DELETE the `// DEBT (Lesson 18.2)` comment block and its listTag('incident').
  const data = await fetchGraphQL(
    ScapegoatSlugsDocument,
    { first: PRERENDER_LIMIT },
    // The set of scapegoat SLUGS now has a tag of its own. It changes when a
    // term is created, renamed or deleted, and at no other time.
    { revalidate: 3600, tags: [taxonomyListTag('scapegoat')] }
  );
```

`src/actions/incidents.ts` needs **no change**, and it is worth opening to see why. Lesson 16.2's
`termAllowlist()` already reads:

```ts
// next-app/src/actions/incidents.ts — termAllowlist(), from Lesson 16.2. READ ONLY.
  const data = await fetchGraphQL(IncidentTermOptionsDocument, undefined, {
    revalidate: 60,
    tags: [taxonomyListTag('scapegoat'), taxonomyListTag('severity')],
  });
```

That is the one existing consumer of a builder nothing else used, and it is why the builder exists.
`listTag('scapegoat')` there would not be a style problem — `'scapegoat'` is not a member of
`ContentType`, so it is a compile error, which is Key Concept 6's point and what Lesson 12.2's
paired `@ts-expect-error` pins in both directions.

Now the audit. Every `fetchGraphQL` call in the app should have a `tags` array whose members are
all function calls:

```bash
# Every read, and its tags. Read the output; do not just count the lines.
grep -rn -A 4 'fetchGraphQL(' src/app src/components src/actions --include='*.ts' --include='*.tsx' \
  | grep 'tags:'
```

**Verify §3:**

- [ ] Every `tags:` line in that output contains at least one `(` — a function call, never a
      literal.
- [ ] `npm run type-check` is silent, as it was before you started. Nothing in this step could
      break it, which is Key Concept 6's point: the two list builders take disjoint parameter
      types, so the only way left to get a tag wrong is one that is *valid* and *inaccurate*, and
      no compiler catches that. Reading the audit output is the control.
- [ ] `npm run test:run` still green — `tags.test.ts` and `nav.test.ts` both.

### Step 4: Audit the Module 16 Server Actions, and change nothing

This step produces no diff. That is the finding.

```bash
grep -nE "revalidateTag\(" src/actions/*.ts
# Expected: no output.
grep -n 'revalidatePath\|void listTag' src/actions/incidents.ts
```

Read the two lines that come back next to Lesson 16.2 §8's table, then write the reasoning into
`docs/api-contract.md` in Step 7. What you are confirming:

| Question | Answer |
|---|---|
| Does any Server Action call `revalidateTag`? | No, and none should |
| Is `void listTag('incident')` a bug? | No. It is a comment with a type check — Lesson 16.2's blockquote |
| Should `submitIncident` expire `incidents`? | No. The new incident is `pending`, so no public page changed |
| Then who expires it? | WordPress, on publish, in Lesson 18.3 |

> **The temptation to resist is "while I am here".** `revalidateTag(listTag('incident'))` in
> `submitIncident` looks like tidying up an obvious omission. It throws away a warm cache entry for
> every list of incidents in the application, every time anybody submits a form, to change nothing
> — because a `pending` post is invisible to every one of those queries. It is a performance
> regression that presents as diligence, and the only defence against it is having written down
> why the call is absent.

### Step 5: Write the guard, so nothing can drift back

Two lines of prose in a code review is not a control. A script is.

```js
// next-app/scripts/check-tag-literals.mjs
// Fails if a cache-tag-shaped string literal appears anywhere under src/
// outside tags.ts and its test.
//
// This is deliberately a script rather than an ESLint rule TODAY, and the shape
// is chosen so Module 24 can promote it: an explicit, commented pattern list
// translates into a `no-restricted-syntax` rule almost mechanically, and a
// shell one-liner does not.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = 'src';

/** The two files whose whole job is to construct these strings. */
const ALLOWED = new Set(['src/lib/graphql/tags.ts', 'src/lib/graphql/tags.test.ts']);

/**
 * `src/gql/` is codegen output, committed and never hand-edited (Lesson 10.2).
 * A typed-document-node AST is full of `"value":"incidents"` — GraphQL FIELD
 * names, not cache tags. Skipping a generated directory is not an exception to
 * the rule; it is the rule not applying.
 */
const SKIP_DIRS = new Set(['src/gql']);

/** A single line may opt out with this marker AND a reason after it. */
const ESCAPE = 'not-a-cache-tag';

/** Every shape tags.ts can emit, as a literal somebody might type by hand. */
const PATTERNS = [
  // node and term tags: 'incident:…', 'scapegoat:…', 'menu:…'
  /['"`](incident|post|review|page|menu|scapegoat|severity|stack):/,
  // list tags, whole-string: 'incidents', 'severities', 'stacks'
  /['"`](incidents|posts|reviews|pages|scapegoats|severities|stacks)['"`]/,
  // the one singleton
  /['"`]site-settings['"`]/,
];

async function* walk(dir) {
  if (SKIP_DIRS.has(relative('.', dir))) return;

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.tsx?$/.test(entry.name)) yield path;
  }
}

const hits = [];

for await (const path of walk(ROOT)) {
  const rel = relative('.', path);
  if (ALLOWED.has(rel)) continue;

  const lines = (await readFile(path, 'utf8')).split('\n');

  lines.forEach((line, index) => {
    if (line.includes(ESCAPE)) return;

    for (const pattern of PATTERNS) {
      if (pattern.test(line)) {
        hits.push(`${rel}:${index + 1}: ${line.trim()}`);
        break;
      }
    }
  });
}

if (hits.length > 0) {
  console.error(
    `${hits.length} hand-typed cache tag literal(s). Build them with ` +
      `src/lib/graphql/tags.ts instead — a tag PHP cannot reproduce invalidates ` +
      `nothing and reports success (Lesson 18.2 §3):`
  );
  for (const hit of hits) console.error(`  - ${hit}`);
  process.exit(1);
}

console.log('no hand-typed cache tag literals under src/');
```

```bash
npm pkg set scripts.lint:tags="node scripts/check-tag-literals.mjs"
npm run lint:tags
```

**It will fail on its first run, on a line that is not a bug**, and dealing with that correctly is
the point of the step. Lesson 14.4's catch-all route holds a set of reserved first segments, and
three of them are spelled exactly like list tags:

```tsx
// next-app/src/app/[locale]/[...slug]/page.tsx — annotate Lesson 14.4's RESERVED set
// One line, one marker, one reason. Module 24 turns this into an
// eslint-disable-next-line with the same comment attached.
const RESERVED = new Set(['hobt', 'blog', 'incidents', 'reviews', 'scapegoats']); // not-a-cache-tag: route segments
```

**Verify §5:**

- [ ] The first run reported three hits in `[...slug]/page.tsx`, and after the annotation
      `npm run lint:tags` prints `no hand-typed cache tag literals under src/` and exits `0`.
- [ ] The annotation is on **one line** and carries a reason. A blanket `ALLOWED` entry for that
      file would exempt every future line in it, which is one decision covering an unbounded set —
      exactly what Lesson 12.3 refused to do with its console allowlist.
- [ ] If it fires anywhere else, read the line before you silence it. A guard's first job is to
      find the thing you did not know was there.

### Step 6: Prove a tag works, with a throwaway route handler

`/api/revalidate` does not exist until Lesson 18.3, and `revalidateTag` cannot be called from a
plain module at import time — Next needs a request context to attach the invalidation to. So the
proof needs a route handler, and this one is deleted before the step ends.

```ts
// next-app/src/app/api/tag-probe/route.ts
// TEMPORARY — DELETED AT THE END OF THIS STEP. Do not commit it.
//
// UNAUTHENTICATED, on purpose, so that the reason Lesson 18.3 is a whole lesson
// about an HMAC signature is concrete rather than theoretical: as written, this
// route lets anyone on your network invalidate your cache in a loop and point
// every resulting miss at WordPress.
import { revalidateTag } from 'next/cache';

import { incidentTag, listTag } from '@/lib/graphql/tags';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const slug = new URL(request.url).searchParams.get('slug') ?? '';

  // Built by tags.ts, never concatenated here — which is the whole exercise.
  // `?list=0` sends ONLY the node tag, which is how the neighbour proof works.
  const sendList = new URL(request.url).searchParams.get('list') !== '0';
  const tags = sendList ? [incidentTag(slug), listTag('incident')] : [incidentTag(slug)];

  for (const tag of tags) {
    // 'max' is the cacheLife profile — required since Next 16, and the reason
    // a one-argument call you copied from a tutorial will not type-check.
    revalidateTag(tag, 'max');
  }

  return Response.json({ revalidated: tags });
}
```

```bash
npm run build && npm run start & SERVER_PID=$!
sleep 6

# The two titles you are about to change, before anything happens
title() { curl -s "http://localhost:3000/en/incidents/$1" | grep -o '<h1[^>]*>[^<]*</h1>'; }
title incident-01
title incident-02

# Change BOTH in WordPress. IDs come from the slugs, never hard-coded.
cd ../wordpress-headless
ID1=$(docker compose run --rm -T wpcli wp post list --post_type=incident --name=incident-01 --field=ID)
ID2=$(docker compose run --rm -T wpcli wp post list --post_type=incident --name=incident-02 --field=ID)
docker compose run --rm -T wpcli wp post update "$ID1" --post_title="Renamed by Lesson 18.2 (one)"
docker compose run --rm -T wpcli wp post update "$ID2" --post_title="Renamed by Lesson 18.2 (two)"
cd ../next-app

# Nothing has changed on the front end. Both pages are cached HTML.
title incident-01
title incident-02

# Invalidate ONLY incident-01's node tag, and only that.
curl -s 'http://localhost:3000/api/tag-probe?slug=incident-01&list=0'
title incident-01     # the new title
title incident-02     # STILL THE OLD ONE
```

**Verify §6:**

- [ ] Before the probe, both detail pages showed their **old** titles even though WordPress had the
      new ones. That is the Full Route Cache, and it is the state every "why is my site stale"
      question is asking about.
- [ ] After the probe, `incident-01` shows the new title and **`incident-02` still shows the old
      one**. One tag, one page. That is surgical invalidation, and it is what
      `revalidatePath('/', 'layout')` would have thrown away.
- [ ] The probe response body was `{"revalidated":["incident:incident-01"]}` — the exact string,
      built by `incidentTag`, which is what Lesson 18.3's PHP must reproduce.
- [ ] Now clean up, and mean it:

```bash
kill "$SERVER_PID"
rm -rf src/app/api/tag-probe
cd ../wordpress-headless
docker compose run --rm -T wpcli wp post update "$ID1" --post_title="Deployed on a Friday (#1)"
docker compose run --rm -T wpcli wp post update "$ID2" --post_title="Deployed on a Friday (#2)"
cd ../next-app
git status --short src/app/api/
# Expected: no tag-probe. Lesson 12.3's smoke suite asserts incident-01's exact
#           title, so leaving the rename in place fails the suite in Lesson 18.3.
```

If `incident-02`'s title in your seed data is not `Deployed on a Friday (#2)`, read it out of
WordPress before you change it — `wp post get "$ID2" --field=post_title` — rather than trusting
this page.

### Step 7: Write the vocabulary into `docs/api-contract.md` as the contract it is

Lesson 10.3 wrote the **policy** there — which route carries which tags. This adds the
**vocabulary**, and it documents two things with two different audiences. The **tag vocabulary** is
a contract between two TypeScript call sites — the `fetch` that attaches a tag and the route
handler that expires it — with `tsc` between them. The **identifier vocabulary** is the contract
with PHP, and there is no compiler between those two, which is exactly why Zod parses it and why a
drift there is a `400` rather than a silent success. Lesson 18.3's PHP is written against the
identifier half.

```markdown
<!-- docs/api-contract.md — append -->
## Cache tag vocabulary (Lesson 18.2)

**Two contracts, one table.** The tags are a contract between the code that **attaches** a tag and
the code that **expires** it — both TypeScript, both going through
`next-app/src/lib/graphql/tags.ts`, with the compiler between them. The identifiers are the
contract with **PHP**, and nothing checks those at compile time — which is why the webhook route
parses them with Zod, and why an identifier this app does not recognise is a `400` rather than a
silent `200`. WordPress never builds a tag string.

| Tag | Builder | WordPress identifier it is built from | Example |
|---|---|---|---|
| `incident:<slug>` | `incidentTag(slug)` | `$post->post_name`, `post_type = incident` | `incident:incident-01` |
| `post:<slug>` | `postTag(slug)` | `post_type = post` | `post:blog-01` |
| `review:<slug>` | `reviewTag(slug)` | `post_type = tech_review` | `review:review-01` |
| `page:<slug>` | `pageTag(slug)` | `post_type = page` | `page:hobt` |
| `incidents` / `posts` / `reviews` / `pages` | `listTag(type)` | the post type of the saved post | `incidents` |
| `scapegoats` / `severities` / `stacks` | `taxonomyListTag(tax)` | the taxonomy of the saved term | `scapegoats` |
| `scapegoat:<slug>` | `termTag(tax, slug)` | `$term->slug` | `scapegoat:the-intern` |
| `site-settings` | `siteTag()` | `acf/save_post` on the options page | `site-settings` |
| `menu:<location>` | `menuTag(location)` | **nothing yet** — the webhook does not send menu events; see the gap note in Lesson 18.3's contract | `menu:primary` |

Rules that are not negotiable:

- Lowercase, colon-separated. Singular for a node, plural for a list.
- Locale is **infixed** on a node tag (`incident:de:incident-01`) and **appended** on a list tag
  (`incidents:de`). Nothing passes a locale until Module 20.4; the shapes are already pinned by
  `src/lib/graphql/tags.test.ts`.
- A slug containing `:` or an empty slug **throws** rather than producing a tag PHP could not
  reproduce.
- **Never a hand-typed tag string outside `tags.ts`.** Enforced by `npm run lint:tags`.
- **Never a tag on an authenticated fetch.** `fetchGraphQLAuthed` has no options parameter, so
  there is nothing to pass. See below.

### Why `fetchGraphQLAuthed` refuses cache options

The Data Cache is keyed on the whole request, including the `Authorization` header, and shared
across every visitor. A tagged authenticated response is a private response sitting in a shared
store waiting for a coincidence — a retry, a background revalidation, a Server Action re-reading
inside a request that already holds somebody's token. Then one user's page is served for another
user's render, as two HTTP 200s with no error anywhere.

It is not prevented by discipline. `fetchGraphQLAuthed(document, variables, credential)` has three
parameters and no fourth. Changing that is a signature change, which is a diff a reviewer sees.

### Who calls `revalidateTag`

**Nothing in Next does, except the webhook route.** No Server Action in this application expires a
public tag: every public state change happens in WordPress, and WordPress is the only system that
knows it happened. `submitIncident` calls `revalidatePath('/{locale}/account')` — the account data
is `no-store`, so what was stale was the browser's Router Cache — and deliberately leaves
`incidents` alone, because a `pending` incident is invisible to every query that carries that tag.
```

### Step 8: Verify, then commit

```bash
npm run lint:tags && npm run type-check && npm run lint && npm run test:run
git add -A
git commit -m "feat(cache): promote tags.ts to the shared tag vocabulary, with a drift guard"
```

**Verify §8:**

- [ ] `git status --short` shows no `src/app/api/tag-probe/`.
- [ ] `git diff HEAD~1 --stat` includes `tags.ts`, `tags.test.ts`, `scripts/check-tag-literals.mjs`,
      `package.json`, `src/actions/incidents.ts`, the two scapegoat routes and
      `docs/api-contract.md` — and **not** `src/lib/graphql/client.ts`.

---

## Verification

```bash
cd next-app

# The WordPress request counter from Lesson 10.3 Step 2. Re-paste it in a new shell.
gqlog() {
  docker compose -f ../wordpress-headless/docker-compose.yml \
    logs --since="${1:-60s}" wordpress | grep -c 'POST /graphql'
}

# 1. Nine builders, all of them Lesson 10.3's, and none of them renamed
grep -c '^export function' src/lib/graphql/tags.ts
# Expected: 9
grep -oE '^export function [a-zA-Z]+' src/lib/graphql/tags.ts | sort
# Expected: incidentTag listTag menuTag pageTag postTag reviewTag siteTag
#           taxonomyListTag termTag  — the same nine as before this lesson
git diff --stat src/lib/graphql/tags.ts
# Expected: a handful of changed lines, all inside the opening comment block

# 2. The unit suite, which is where the exact strings live
npm run test:run
# Expected: every file green, with the test COUNT unchanged from Lesson 12.2 —
#           Step 2 widened one structural assertion rather than adding a case.
npx vitest run -t "appends the locale"
# Expected: 2 tests — listTag's and taxonomyListTag's. Both pin an APPENDED
#           locale, against the INFIXED form a node tag uses.
npx vitest run -t "webhook"
# Expected: 1 test, now asserting seven strings including scapegoat:4

# 3. Types and lint clean
npm run type-check && npm run lint
# Expected: no output. Note what this does NOT prove: a tag can be perfectly
#           well-typed and still name a dependency the query does not have.
#           Check 5's guard and the Step 3 audit are what cover that.

# 4. The drift guard passes
npm run lint:tags
# Expected: no hand-typed cache tag literals under src/

# 5. NEGATIVE — the guard actually fires. Introduce one literal in a throwaway
#    file, watch it fail, delete it. A guard nobody has seen fail is a guard
#    nobody knows the polarity of.
cat > src/lib/graphql/_literal-probe.ts <<'EOF'
// next-app/src/lib/graphql/_literal-probe.ts
// TEMPORARY — proves npm run lint:tags fires. Deleted three lines below.
export const wrong = ['incident:incident-01', 'incidents'];
EOF
npm run lint:tags; echo "exit=$?"
# Expected: a non-zero exit, and TWO reported hits on _literal-probe.ts — the
#           node-tag pattern and the list-tag pattern
rm src/lib/graphql/_literal-probe.ts
npm run lint:tags
# Expected: clean again

# 6. NEGATIVE — the singular/plural rule is enforced by the compiler, for both
#    list builders. Probe from a throwaway file: restoring tags.ts from git
#    would hand you Lesson 10.3's version and silently delete Step 1.
cat > src/lib/graphql/_type-probe.ts <<'EOF'
// next-app/src/lib/graphql/_type-probe.ts
// TEMPORARY — two deliberate type errors. Deleted below.
import { listTag, taxonomyListTag } from '@/lib/graphql/tags';
export const a = listTag('incidents');
export const b = taxonomyListTag('scapegoats');
EOF
npm run type-check 2>&1 | grep -c 'not assignable'
# Expected: 2 or more
rm src/lib/graphql/_type-probe.ts
npm run type-check
# Expected: no output

# 7. NEGATIVE — segment() throws rather than producing a tag PHP cannot rebuild.
#    Asserted through Vitest and not a shell one-liner, because tags.ts is
#    TypeScript and plain `node` cannot import it.
npx vitest run -t "throws"
# Expected: 3 tests pass — empty slug, whitespace-only slug, and a slug
#           containing ':'. incidentTag('') does NOT return 'incident:'.

# 8. NEGATIVE — fetchGraphQLAuthed still has no options parameter at all
sed -n '/export function fetchGraphQLAuthed/,/^): Promise/p' src/lib/graphql/client.ts
# Expected: exactly three parameters — document, variables, credential. There is
#           no fourth, so there is nothing to tag and nothing to forget.
grep -n 'FetchGraphQLOptions' src/lib/graphql/client.ts
# Expected: hits inside the type declaration, nextOptions() and fetchGraphQL
#           ONLY. Not one inside fetchGraphQLAuthed.

# 9. NEGATIVE — and PROVE the consequence rather than asserting it: an
#    authenticated route has no Data Cache entry, so there is nothing a tag
#    could ever expire. Two identical requests must hit WordPress twice.
npm run build && npm run start & SERVER_PID=$!
sleep 6
curl -s -o /dev/null -b "btt_at=$JWT_REPORTER" http://localhost:3000/en/account
curl -s -o /dev/null -b "btt_at=$JWT_REPORTER" http://localhost:3000/en/account
gqlog 20s
# Expected: 2 or more. Compare with Lesson 10.3 check 4, where two loads of
#           /en/incidents produced 0. `cache: 'no-store'` means every render
#           asks WordPress, which is exactly the price of not leaking.
#           ($JWT_REPORTER comes from Lesson 18.1 Task Step 8.)

# 10. NEGATIVE — no Server Action expires a public tag, and that is deliberate
grep -cE 'revalidateTag\(' src/actions/incidents.ts src/actions/leads.ts src/actions/auth.ts
# Expected: 0 for all three files
grep -c 'void listTag' src/actions/incidents.ts
# Expected: 1 — a comment with a type check, not a missing call (Key Concept 7)

# 11. Surgical invalidation, end to end, using the tag vocabulary. This is Task
#     Step 6 compressed; run it if you skipped the manual walkthrough.
cd ../wordpress-headless
ID1=$(docker compose run --rm -T wpcli wp post list --post_type=incident --name=incident-01 --field=ID)
OLD=$(docker compose run --rm -T wpcli wp post get "$ID1" --field=post_title)
docker compose run --rm -T wpcli wp post update "$ID1" --post_title="Tag proof"
cd ../next-app
curl -s http://localhost:3000/en/incidents/incident-01 | grep -c 'Tag proof'
# Expected: 0 — cached HTML, WordPress already changed. THIS is what "stale" is.
mkdir -p src/app/api/tag-probe && cat > src/app/api/tag-probe/route.ts <<'EOF'
// next-app/src/app/api/tag-probe/route.ts
// TEMPORARY. Unauthenticated on purpose — Lesson 18.3 is why that is not shippable.
import { revalidateTag } from 'next/cache';
import { incidentTag } from '@/lib/graphql/tags';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  const slug = new URL(request.url).searchParams.get('slug') ?? '';
  revalidateTag(incidentTag(slug), 'max');
  return Response.json({ revalidated: [incidentTag(slug)] });
}
EOF
kill "$SERVER_PID"; npm run build >/dev/null 2>&1; npm run start & SERVER_PID=$!
sleep 6
curl -s 'http://localhost:3000/api/tag-probe?slug=incident-01'
# Expected: {"revalidated":["incident:incident-01"]}
curl -s http://localhost:3000/en/incidents/incident-01 | grep -c 'Tag proof'
# Expected: 1 — one tag, one page, no deploy and no timer

# 12. NEGATIVE — a tag that does not exist is a silent success. This is the
#     failure mode of Lesson 18.3's whole lesson, and it is worth seeing once.
curl -s 'http://localhost:3000/api/tag-probe?slug=no-such-incident'
# Expected: {"revalidated":["incident:no-such-incident"]} — HTTP 200, a tag
#           nothing carries, nothing invalidated, nothing logged. Exactly what a
#           PHP/TypeScript mismatch looks like from the outside.

# 13. Clean up completely, and put the title back
kill "$SERVER_PID"
rm -rf src/app/api/tag-probe
cd ../wordpress-headless
docker compose run --rm -T wpcli wp post update "$ID1" --post_title="$OLD"
cd ../next-app
git status --short src/app/api/ src/lib/graphql/
# Expected: no tag-probe, no _literal-probe.ts, no _type-probe.ts.
#           Lesson 12.3's smoke suite asserts incident-01's exact title.

# 14. The contract is written where Lesson 18.3 will read it
grep -c 'Cache tag vocabulary' ../docs/api-contract.md
# Expected: 1
grep -c 'taxonomyListTag' ../docs/api-contract.md
# Expected: 1 or more

# 15. Both suites green
npm run test:run
# Expected: 0 failures
E2E_MODE=1 E2E_SECRET="$E2E_SECRET" npx playwright test --project=smoke
# Expected: 9 passed — which also proves check 13's title restore worked
```

If check 5 exits `0`, the guard is not running your patterns — `npm pkg get scripts.lint:tags` and
confirm the path. A guard that always passes is worse than no guard, because it is now evidence.

## Control Questions

1. `revalidateTag('incidents')` expires cached entries on six different routes, and
   `delete_transient('btt_incidents')` expires exactly one. Explain what WordPress would have to
   maintain by hand to get the same fan-out, and why that hand-maintained thing is the part that
   drifts.
2. `tags.ts` builds `incident:de:incident-01` but `incidents:de`. State both rules, name the file
   that would fail if you swapped them, and give the reason the asymmetry is defensible rather than
   arbitrary.
3. `submitIncident` calls `revalidatePath('/{locale}/account')` and never calls `revalidateTag`.
   Justify both halves of that in terms of which cache actually held stale bytes, and name the
   system that *is* responsible for expiring `incidents`.
4. A colleague adds a fourth parameter to `fetchGraphQLAuthed` so a slow account page can be
   cached for thirty seconds. Walk through the sequence of events that ends with one user seeing
   another user's submissions, and say why the header being part of the cache key makes the bug
   *harder* to find rather than easier.
5. The PHP webhook builds `incident-incident-01` and the TypeScript attached
   `incident:incident-01`. State the HTTP status the webhook receives, what appears in each
   application's log, what the visitor sees, and the one artifact in this lesson that would have
   caught it before deployment.

## Learn More

- [Next.js — `revalidateTag`](https://nextjs.org/docs/app/api-reference/functions/revalidateTag) —
  the whole API surface of this lesson, and the note that it must be called from a route handler or
  Server Action
- [Next.js — `revalidatePath`](https://nextjs.org/docs/app/api-reference/functions/revalidatePath) —
  read the `'layout'` versus `'page'` second argument carefully; that distinction is the difference
  between Lesson 16.2's call and Key Concept 10's sledgehammer
- [Next.js — `fetch` and `next.tags`](https://nextjs.org/docs/app/api-reference/functions/fetch) —
  where the tags you build actually get attached, and the cache-key rules that make an
  `Authorization` header dangerous
- [Next.js — Incremental Static Regeneration, on demand](https://nextjs.org/docs/app/guides/incremental-static-regeneration)
  — the "marked stale, rebuilt on the next request" behaviour of Key Concept 9, from the framework
- [WordPress — Transients API](https://developer.wordpress.org/apis/transients/) — worth rereading
  with fan-out in mind; the absence of group invalidation is the whole analogy
- [WordPress — Object Cache API](https://developer.wordpress.org/reference/classes/wp_object_cache/)
  — `wp_cache_set`'s `$group` parameter, and the fact that nothing consumes it as an invalidation
  handle
- [`vitest` — `-t` test name filter](https://vitest.dev/guide/filtering) — the fastest debugging
  tool in the runner, used three times in this lesson's Verification
- [TypeScript — `@ts-expect-error`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-9.html#-ts-expect-error-comments) —
  why an expected error that stops being an error is itself a build failure, which is what makes
  the two compile-error tests load-bearing
- [ESLint — `no-restricted-syntax`](https://eslint.org/docs/latest/rules/no-restricted-syntax) —
  the rule Module 24 promotes `scripts/check-tag-literals.mjs` into, and the reason the script is
  written as an explicit pattern list
