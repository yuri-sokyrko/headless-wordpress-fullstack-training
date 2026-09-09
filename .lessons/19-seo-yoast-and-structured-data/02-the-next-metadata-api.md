---
title: 'The Next.js Metadata API'
module: 19
lesson: 2
teaches: [next-metadata-api, generate-metadata, metadata-base, opengraph-image, metadata-fallbacks]
produces: ['next-app/src/lib/seo/yoastToMetadata.ts', 'next-app/src/app/[locale]/opengraph-image.tsx']
requires: [19.1, 09.3]
---

# Lesson 19.2 — The Next.js Metadata API

## Quick Overview

Next.js does not want you to render `<head>` tags. It wants you to **export a description of
them** — a static `metadata` object for fixed routes, or an async `generateMetadata` function
for dynamic ones — and it assembles the head itself, deduplicating, resolving relative URLs
against `metadataBase`, and streaming the result ahead of the page body. Once you accept that
inversion, the job of this lesson is small and precise: take the `seo` payload from Lesson
19.1 and return a `Metadata` object. One function, one signature, used by every route.

The interesting part is not the mapping, it is the **fallbacks**. Yoast fields are optional,
and on a real site roughly a third of them are empty. So `yoastToMetadata` needs a defined
answer for every blank: a title pattern when `seo.title` is missing, a trimmed excerpt when
`metaDesc` is missing, a computed canonical when `canonical` is missing, and a generated
OpenGraph image when the editor uploaded nothing. That last one is where `opengraph-image.tsx`
earns its place — a file convention that renders a real PNG at request time from the route's
own data, so every page has a social card whether or not anyone remembered to make one.

By the end of this lesson you will have:

- `src/lib/seo/yoastToMetadata.ts` — a single pure mapper from the `seo` fragment to `Metadata`,
  with an explicit fallback for every field
- `metadataBase` set once in the root layout from `NEXT_PUBLIC_SITE_URL`, so every relative
  URL in every route resolves correctly
- `generateMetadata` exported from `/incidents/[slug]`, `/reviews/[slug]`, `/blog/[slug]`, the
  archives and the WP page catch-all
- `src/app/[locale]/opengraph-image.tsx` — a generated social card, plus the rule for when the editor's
  uploaded image overrides it
- A `notFound()`-safe metadata path, so a bad slug does not throw inside `generateMetadata`
- `curl | grep` proof that the rendered HTML contains the editor's title, description, canonical
  and robots directive

## Classic WP Analogy

In Classic WordPress the `<head>` is built by **accretion**. `wp_head()` fires, and every
plugin that ever wanted a tag prints one, in priority order, into a stream. Nothing coordinates
them. Two plugins can both print a canonical; you find out from a Search Console warning three
weeks later. Your theme's only lever is `remove_action` and hoping you guessed the right
priority.

`generateMetadata` is the opposite model: **declaration with merging**. You return an object.
Next merges it with the parent layout's object — child wins, per key — and emits exactly one
tag per concern. There is no ordering to reason about and no way for two sources to both emit
`<link rel="canonical">`. If you have ever debugged duplicate OpenGraph tags on a WordPress
site with a social plugin *and* Yoast installed, this trade is worth the whole module.

Where the analogy breaks down, and it breaks hard: **`generateMetadata` runs before the page
renders, in its own execution, and it cannot see anything the page computed.** In a Classic
theme, `wp_head()` fires inside the same request as `the_content()`, after `WP_Query` has
already run, so the loop's data is sitting right there. Here, if the page fetches an incident
and `generateMetadata` also needs that incident, both call the same function — and you rely on
React's request-level `fetch` deduplication to keep it one network round trip, which only
works if both call sites use the same cache configuration. That constraint is why Lesson 10.1's
client takes cache options explicitly, and it is the number-one cause of "why is my GraphQL
query firing twice per page?"

---

## Key Concepts

### 1. Accretion versus declaration-with-merging

`wp_head()` is a **stream**. Every plugin that ever wanted a tag prints into it, in priority
order, and nothing arbitrates. The Metadata API is a **tree of objects** that Next merges before
it emits anything, so arbitration is the mechanism rather than an afterthought.

```
CLASSIC — accretion                        NEXT — declaration with merging
────────────────────────────────────       ─────────────────────────────────────────
wp_head()                                  layout.tsx   metadata { metadataBase,
  ├─ 1  core: charset, generator                                    title, description }
  ├─ 10 theme: viewport                                    │  merge, child wins per key
  ├─ 10 Yoast: title, desc, canonical                       ▼
  ├─ 10 social plugin: canonical  ⚠️          page.tsx    generateMetadata() → { title,
  ├─ 20 analytics: verification                                description, alternates,
  └─ 99 something you inherited                                robots, openGraph }
        │                                                     │
        ▼                                                     ▼
  TWO <link rel="canonical"> tags             EXACTLY ONE tag per concern, always
  and no way to know which wins
```

The merge rule is the whole model: **per key, the deepest segment that defines the key wins;
keys nobody redefines are inherited.** Not a deep merge — a page returning `openGraph: { title }`
replaces the parent's whole `openGraph` object rather than patching one field of it.

| | `wp_head()` | Metadata API |
|---|---|---|
| Who can emit a canonical | any plugin, any number of times | the deepest segment that sets `alternates.canonical`, once |
| Removing another author's tag | `remove_action` plus a guessed priority | delete a key, or set it to `null` |
| Discovering a duplicate | Search Console, three weeks later | impossible by construction |
| Ordering matters | yes, and it is global mutable state | no |
| Relative URLs | you resolve them yourself | resolved against `metadataBase` |
| Verdict | ❌ | ✅ |

The cost, stated plainly: you lose the escape hatch. A `wp_head()` hook is a place any code can
intervene, which is horrible for correctness and occasionally the only way to fix something you
do not own. Here the only place to fix a value is the function that returned it — which is what
you want, and which means metadata cannot be patched from a component or a proxy.

### 2. `metadataBase` already exists, and this is what it resolves

Lesson 09.1 wrote it into `src/app/[locale]/layout.tsx` in the same step that created the layout:

```tsx
// next-app/src/app/[locale]/layout.tsx (fragment — ALREADY PRESENT since Lesson 09.1)
export const metadata: Metadata = {
  title: 'Blame The Tech',
  description: 'Incident reports, blame assignment, and reviews nobody asked for.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
};
```

So this lesson **verifies** it rather than adding it — the same shape Lesson 14.5 used for
`images.remotePatterns`, which Lesson 09.1 had also already written. Adding a second
`metadataBase` further down the tree is legal and is a bug: the deepest one wins, so a route
that sets it overrides the site's base for that route only, and you get one page whose social
URLs point somewhere else.

What it actually does, precisely — it is narrower than "sets the site URL":

| Metadata value | With `metadataBase` | Without it |
|---|---|---|
| `alternates.canonical: '/en/incidents/incident-01'` | absolute, on your host | Next warns and drops the relative form |
| `openGraph.images: ['/card.png']` | absolute — required, because scrapers do not resolve relative URLs | broken card everywhere |
| `openGraph.url: '/en/hobt'` | absolute | same problem |
| An **absolute** URL you supply yourself | passed through untouched | passed through untouched |
| `<meta name="description">` | unaffected | unaffected |

That last-but-one row is the one to hold on to: `metadataBase` is a **resolver for relative
values**, not a rewriter of absolute ones. It cannot fix a URL that already carries the wrong
host, which is precisely the situation Key Concept 5 is about. Yoast's canonical arrives
absolute, on `localhost:8080`, and `metadataBase` will happily emit it unchanged.

### 3. Yoast returns a *resolved* title, so the root layout must not define `title.template`

Next has a title template mechanism: a layout declares
`title: { template: '%s — Blame The Tech', default: 'Blame The Tech' }` and every child's string
title is interpolated into it. It is a good feature and using it here would be a bug.

Yoast resolved `%%title%% %%sep%% %%sitename%%` on the WordPress side (Lesson 19.1 Key Concept
8), so `seo.title` already reads `DNS outage blamed on the intern — Blame The Tech`. Interpolate
that into a Next template and you ship:

```
<title>DNS outage blamed on the intern — Blame The Tech — Blame The Tech</title>
```

It renders. It type-checks. It looks fine in a browser tab that truncates at 60 characters, and
it looks ridiculous in a search result.

Two ways out, and they are not equal:

| Option | How | Verdict |
|---|---|---|
| **No template in the layout**; `yoastToMetadata` appends the site name only in its own fallback | the layout keeps a plain `title: 'Blame The Tech'` string, which becomes the default for routes that set nothing | ✅ **this course.** One source of truth per title, and the source is whichever system produced the string |
| Keep the template and have the mapper return `title: { absolute: seo.title }` for Yoast-supplied titles | `absolute` opts a single value out of the parent template | ❌ correct, and it means every title carries a flag saying which mechanism formatted it — two formatting systems, forever |

The rule that falls out of it, and it is worth writing on the wall: **the system that owns the
value owns its formatting.** Yoast formats Yoast titles; `yoastToMetadata` formats the fallback.
Nothing formats a title twice.

### 4. The fallback table is the lesson

About a third of Yoast fields are empty on a real site, and in a Classic build a blank field
degrades to a template. Here it degrades to **no tag at all** (Lesson 19.1 Key Concept 9). So
every field needs a defined answer, written down once, identical on every route — because a
fallback that differs per route is worse than none: the editor cannot predict what they will
get.

| `Metadata` key | Yoast source | Fallback when blank |
|---|---|---|
| `title` | `seo.title` | `` `${node.title} — Blame The Tech` `` |
| `description` | `seo.metaDesc` | the route's own summary, tags stripped, trimmed to 155 chars on a word boundary |
| `alternates.canonical` | `seo.canonical` — as a **signal**, Key Concept 5 | the route's own path |
| `robots` | `metaRobotsNoindex === 'noindex'`, and the same for nofollow | `{ index: true, follow: true }` |
| `openGraph.images` | `seo.opengraphImage` | **omit the key entirely**, so the file convention wins — Key Concept 10 |
| `openGraph.title` / `.description` | `opengraphTitle` / `opengraphDescription` | the resolved `title` / `description` above |

Two rows deserve their own paragraph.

**`description`, when the summary is also blank.** The mapper omits the key. It does not invent a
sentence and it does not emit an empty `content=""`. Omitting means Next's merge inherits the
root layout's `description`, which is why that string being a real sentence rather than a
placeholder is load-bearing — the layout is the last fallback in the chain, whether or not
anyone thought of it that way when they wrote it in Lesson 09.1.

**Where the summary comes from is the route's decision, not the mapper's.** `incident` and
`tech_review` are registered **without** `excerpt` support (appendix 03 §1), so there is no
excerpt to fall back on; a blog `post` has one. Rather than pretend otherwise, `yoastToMetadata`
takes a `summary` string and each route supplies the best thing it has:

| Route | Summary source | Why it is better than an excerpt would be |
|---|---|---|
| `/blog/[slug]` | `excerpt` | It exists, and an editor wrote it |
| `/incidents/[slug]` | a sentence built from `incidentDetails` and the severity term | Uses data Yoast has never seen: downtime, environment, resolution |
| `/reviews/[slug]` | `techReviewFields.companyName`, `ratingOverall`, `verdict` | A rating is the single most clickable fact on the page |
| `/hobt` | `hobtPromo.subheadline` | Marketing already wrote the one-line pitch |
| `/[...slug]` | nothing — the key is omitted | A WordPress page has no structured summary. Inherit the layout's. |

That table is the concrete form of Lesson 19.1's promise that **your fallbacks can be better
than Yoast's**, because they can read fields Yoast does not know exist.

### 5. Yoast's canonical carries the wrong host **and** the wrong path — so it is a signal, not a value

This is the most consequential decision in the module, and the usual framing of it is wrong.

Yoast generates `canonical` from `home_url()`. Locally that is `http://localhost:8080`; in
production it is your Fly.io hostname (Module 24). So the obvious fix is to swap the host for
`NEXT_PUBLIC_SITE_URL` and keep the path. Work that through on one real URL:

```
  Yoast's canonical    http://localhost:8080/incidents/incident-01/
  host-swapped         http://localhost:3000/incidents/incident-01/
  your actual route    http://localhost:3000/en/incidents/incident-01
                                            ▲▲▲                    ▲
                                            │                      no trailing slash
                                            the [locale] segment WordPress knows nothing about
```

The host-swapped URL is not your page. It is a `307` to your page — Lesson 09.5's proxy
prefixes the default locale — and Lesson 19.4 sets `trailingSlash: false`, so the slash is a
second redirect. **A canonical tag pointing at a redirect is a canonical tag pointing at
nothing**, and it is the single worst thing this module could ship: it is invisible in a
browser, invisible in the React tree, and it tells every crawler that the page it just fetched
is not the real one.

The reason it cannot be patched with a cleverer rewrite is structural: WordPress's URL space and
your route space are **independent by design**. The `[locale]` prefix exists in one and not the
other, `/blog` is a `permalink_structure` prefix on one side and a directory on the other
(Lesson 03.2), and `[...slug]` maps a WordPress `uri` onto segments by a rule your code owns.
Any function that derives your path from WordPress's path is a duplicate of your router, kept in
sync by hand.

So: **the route knows its own path, and it is the authority.** Yoast's canonical is read for one
piece of information only — whether a human overrode it.

| `seo.canonical` | What it means | What the mapper does |
|---|---|---|
| blank / `null` | Nobody touched it | use the route's own path |
| absolute, **on the WordPress origin** | Auto-generated from `home_url()` | ignore the value, use the route's own path |
| absolute, **on any other origin** | An editor typed it into Yoast's Advanced panel — a deliberate cross-domain canonical, usually "this is a syndicated copy of somebody else's article" | honour it **verbatim** |
| unparseable | A typo in the Advanced panel | use the route's own path, and do not throw |

The third row is the reason to read the field at all rather than delete it from the fragment.
Cross-domain canonicals are a real editorial tool and they are the only case where the editor
knows something your router cannot. The WordPress origin is derived from
`WP_GRAPHQL_ENDPOINT`, which already exists (appendix 04) — no new environment variable, and one
function that knows both hosts.

> **`opengraphUrl` has exactly the same disease**, which is why Lesson 19.1's fragment refuses
> it outright. `og:url` is computed from the resolved canonical, in the same function, from the
> same base. One decision, one place.

### 6. `generateMetadata` runs in its own execution, and dedupe only happens if the cache options match

`generateMetadata` and the page component are two separate function calls. There is no shared
scope, no return value passed between them, and no ordering guarantee you should rely on. If
both need the incident, both fetch the incident.

What saves you is React's request-level `fetch` memoization (Lesson 10.3): two identical
`fetch` calls in one render pass produce one network request. And the operative word is
**identical**.

```
    ONE REQUEST for /en/incidents/incident-01
    ┌──────────────────────────────────────────────────────────────┐
    │  generateMetadata()          page component                  │
    │    fetchGraphQL(doc, {slug},   fetchGraphQL(doc, {slug},      │
    │      {revalidate:3600,           {revalidate:3600,           │
    │       tags:[…]})                  tags:[…]})                 │
    │        │                             │                       │
    │        └──────────┬──────────────────┘                       │
    │             SAME cache key → ONE POST /graphql   ✅           │
    └──────────────────────────────────────────────────────────────┘

    ┌──────────────────────────────────────────────────────────────┐
    │    {revalidate:3600,…}       {revalidate:60,…}               │
    │        │                             │                       │
    │        ▼                             ▼                       │
    │   POST /graphql                 POST /graphql     ❌ TWO      │
    └──────────────────────────────────────────────────────────────┘
```

The cache key is built from the URL, the method, the body **and** the Next cache configuration.
Different `revalidate`, different key. Different `tags`, different key. So the rule is
mechanical: **`generateMetadata` and the page pass byte-identical options**, and the cheapest way
to guarantee that is to write the options once, as a `const`, next to the document import, and
reference it from both.

This is the number-one cause of "why is my GraphQL query firing twice per page", and it is
invisible: the page renders correctly, the metadata is correct, and WordPress does twice the
work. Verification check 12 measures it by building twice, once with matched options and once
with mismatched ones, and reading the difference.

### 7. `generateMetadata` must not throw — a bad slug is a 404, not a 500

`notFound()` inside `generateMetadata` is legal in Next 16 and it is the wrong tool here,
because a *throw* inside `generateMetadata` is not. Compare the three ways a nonexistent slug can
end:

| What `generateMetadata` does on a missing node | What the reader gets |
|---|---|
| Throws (`data.incident!.title`, a `GraphQLRequestError`, anything) | `error.tsx` — an HTTP **500** page for content that simply does not exist ❌ |
| Returns a minimal `Metadata`, page calls `notFound()` | `not-found.tsx`, HTTP **404** ✅ |
| Calls `notFound()` itself | 404 as well, but the decision now lives in two places and they can disagree |

**The verdict: the metadata function returns, the page decides.** `generateMetadata` returns
`{ title: 'Not found — Blame The Tech', robots: { index: false, follow: false } }` and stops.
The page runs next, gets the same memoized `null`, and calls `notFound()` exactly as Lesson
14.4 already has it.

The `robots: { index: false }` on that minimal object is not decoration. A 404 that Next renders
after metadata has already streamed still carries whatever `<meta name="robots">` the metadata
declared, and a soft-404 that says `index, follow` is a page you have asked Google to keep.

Note also that `fetchGraphQL`'s error policy is `'partial'` (Lesson 10.4) — it logs a partial
response and renders. So the common failure here is not an exception at all, it is `data.incident
=== null`, which is a branch and not a `catch`. The `try`/`catch` in the metadata path exists for
transport failures, and its handler returns the same minimal object.

### 8. Archive and pagination titles belong to the router

Yoast has no node for `/en/incidents`, so there is nothing to resolve a title from — Lesson 19.1
Key Concept 8 laid this out. Four titles are yours, and all four are properties of the route
rather than of any content:

| Route | Title | Where the parts come from |
|---|---|---|
| `/en/incidents` | `All incidents — Blame The Tech` | a constant per archive |
| `/en/incidents?page=3` | `All incidents (page 3) — Blame The Tech` | `searchParams`, awaited |
| `/en/scapegoats/the-intern` | `The Intern — Blame The Tech` | the **term**, whose payload is `TaxonomySEO` and therefore outside `SeoFields` |
| `/en/incidents?q=dns` | not indexable at all | a filtered view; `robots: { index: false }` |

That last row is the one people forget. A faceted archive generates an unbounded number of URLs
that all show subsets of the same content, and letting a crawler enumerate them is how a site
with 40 incidents ends up with 4,000 indexed pages saying nearly the same thing. **A route that
reads a filter from `searchParams` sets `robots: { index: false, follow: true }` when a filter is
present** — `follow`, because you still want the links out of it followed.

Pagination gets the opposite treatment: page 2 of an archive is a genuinely different set of
content and stays indexable, with a canonical pointing at **itself** rather than at page 1.
Pointing every page at page 1 was the received wisdom for years and Google explicitly retired
it; a self-canonical is now the recommendation.

### 9. `opengraph-image.tsx` lives **inside** `[locale]`, and a proxy regex is the reason

Next's image file conventions turn a component into a real PNG at request time. Put
`opengraph-image.tsx` in a segment and every route at or below that segment gets `og:image` and
`twitter:image` pointing at it, with the width, height and content type filled in for you. No
`<meta>` by hand, no image pipeline.

The trap is *which* segment. `next-app/README.md`'s tree used to put it at `src/app/`, beside
`sitemap.ts` and `robots.ts`, and that placement does not work. Run Lesson 09.5's matcher over
the three files:

```
matcher: ['/((?!api|_next|favicon\.ico|.*\..*).*)']

  /sitemap.xml        contains a dot → matches  .*\..*  → EXCLUDED from proxy  ✅
  /robots.txt         contains a dot → matches  .*\..*  → EXCLUDED from proxy  ✅
  /icon.svg           contains a dot → matches  .*\..*  → EXCLUDED from proxy  ✅
  /opengraph-image    NO DOT         → proxy RUNS
                        │
                        ├─ first segment is "opengraph-image", not in LOCALES
                        └─ 307 → /en/opengraph-image  … which would not exist
```

So a root-level `opengraph-image.tsx` 404s for every crawler and every social scraper, silently,
because nothing in your own pages ever requests it — you would find out from a Slack unfurl that
renders a grey box.

There are two fixes and only one of them is acceptable. Adding `opengraph-image` to the matcher's
exclusion list edits a regex that Lessons 09.5 and 15.5 have both explicitly frozen, and every
exception in it is a thing a future reader has to know about. Moving the file inside the locale
segment changes a path. **The verdict: move the file.** The rule that generalises from it is
worth keeping: **a public asset must either carry a file extension or live under a real route
segment** — that is cheaper to remember than an exception in a shared regex, and it is why
`icon.svg` in Lesson 19.4 is correctly at the root while this file is not.

Two things get better as a side effect. The file now receives `params`, so it can read `locale`
— which a root-level file could never have done, and which Module 20 needs when the card's text
becomes translatable. And it sits next to the routes it describes, which is where a per-route
convention belongs.

> **Do not fetch a webfont inside `ImageResponse`.** It turns an image route into a network
> dependency with a timeout, on a path that no page of yours ever exercises, and Satori will
> render nothing rather than render badly. Use the font `next/og` already bundles. A designed
> card with a real typeface is worth doing — after Module 21 adds `next/font` and a local font
> file exists to read from disk.

### 10. When the editor's image wins, omit the key — do not pass a URL

The rule is "the editor's uploaded OpenGraph image always beats the generated card". There are
two ways to implement it and one of them fights the framework.

```tsx
// (illustration of the WRONG shape, not a file)
// openGraph: { images: [editorImage?.sourceUrl ?? '/en/opengraph-image'] }
```

That hard-codes the convention's URL into the mapper. Now the generated card's address exists in
two places, the mapper needs to know the current locale to build it, and moving the file — which
Key Concept 9 just did — silently breaks every page that had no editor image.

The correct shape is to **not set the key at all** when there is no editor image:

```
   seo.opengraphImage present  →  openGraph.images = [{ url, width, height, alt }]
                                  the convention is OVERRIDDEN, per key, by the merge
   seo.opengraphImage absent   →  the `images` key is ABSENT from the returned object
                                  the file convention supplies og:image itself
```

What matters is that nothing in the returned object claims the concern, so the convention's
contribution survives the merge. Same mechanism as the `description` row in Key Concept 4:
**to let a lower layer win, say nothing.**

The scope of the generated card, stated honestly: one background colour, the site name, and a
locale badge. A per-post card — the incident title, the severity colour, the downtime — is a
better product and needs a **route-level** `opengraph-image.tsx` under
`[locale]/incidents/[slug]/`, where it can read `params.slug` and fetch. That is a natural
follow-on and it is deliberately not in this lesson, because one site-level card plus the
editor-override rule is what makes every one of the nine routes correct today.

---

## Task

### Step 1: Audit the root layout instead of editing it

`metadataBase` is already there. Read it, confirm it, and confirm what is **not** there.

```bash
cd next-app

# 1. Exactly one metadataBase in the whole app, in the root layout
grep -rn 'metadataBase' src/
# Expected: one hit, in src/app/[locale]/layout.tsx, from Lesson 09.1

# 2. No title template anywhere. Key Concept 3 — Yoast titles are already resolved,
#    so a template would append the site name twice.
grep -rn 'template:' src/app/
# Expected: no output

# 3. The layout's description is a real sentence, because it is the last fallback in
#    the chain when both Yoast and the route have nothing (Key Concept 4).
grep -n 'description' 'src/app/[locale]/layout.tsx'
# Expected: "Incident reports, blame assignment, and reviews nobody asked for."
```

**Verify §1:**

- [ ] `grep -c 'metadataBase' 'src/app/[locale]/layout.tsx'` is `1`. A second one anywhere is a
      bug — the deepest wins, so one route would resolve its social URLs against a different
      host.
- [ ] `NEXT_PUBLIC_SITE_URL` is set in `.env.local`. If it is unset the `??` default keeps the
      app working locally and would ship `localhost:3000` canonicals to production, which is why
      Module 24's deploy checklist asserts it.
- [ ] You changed **nothing** in this step. It is an audit.

### Step 2: Write the mapper

One file, one pure function, plus the four small predicates the fallback table needs. Every
`process.env` read in the module is inside `originsFromEnv()`, so the mapper itself is
deterministic and the unit test in Step 3 passes origins explicitly.

```ts
// next-app/src/lib/seo/yoastToMetadata.ts
// Yoast's payload -> a Next `Metadata` object, with a DEFINED answer for every blank
// field. The fallback table lives in the Module 19 README and in Lesson 19.2 Key
// Concept 4; this file is that table, executable.
//
// No 'server-only': this is a pure function over plain data, unit-tested in plain Node
// (Lesson 12.1). The same reasoning as tags.ts and errors.ts in Lesson 10.1.
import type { Metadata } from 'next';

import type { SeoFieldsFragment } from '@/gql/graphql';

/** Yoast's payload, non-null. `seo` is nullable on every node in the schema. */
export type SeoPayload = NonNullable<SeoFieldsFragment['seo']>;

/**
 * The two hosts this module has to tell apart: yours, and WordPress's. Passed in so
 * the mapper is pure; `originsFromEnv()` is the ONE place environment is read.
 */
export type Origins = {
  readonly siteUrl: string;
  readonly wordPressOrigin: string;
};

export type YoastToMetadataInput = {
  readonly seo: SeoPayload | null | undefined;
  /** The node's own WordPress title, for the title fallback. */
  readonly title: string | null | undefined;
  /**
   * The route's best one-line summary, possibly containing HTML. The ROUTE chooses
   * this, because `incident` and `tech_review` have no excerpt support (appendix 03
   * §1) and the good fallback differs per type — Key Concept 4.
   */
  readonly summary: string | null | undefined;
  /** THIS route's own path, e.g. `/en/incidents/incident-01`. The canonical authority. */
  readonly path: string;
  readonly ogType?: 'article' | 'website';
};

const SITE_NAME = 'Blame The Tech';
const DESCRIPTION_MAX = 155;

/** The one place this module reads the environment. */
export function originsFromEnv(): Origins {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

  // WordPress's public origin, derived from the endpoint that already exists
  // (appendix 04) rather than from a new variable nobody would remember to set.
  let wordPressOrigin = 'http://localhost:8080';
  try {
    wordPressOrigin = new URL(process.env.WP_GRAPHQL_ENDPOINT ?? '').origin;
  } catch {
    // Unset or malformed. The default above is the local stack, and Verification
    // check 9 asserts no WordPress host reaches the rendered HTML either way.
  }

  return { siteUrl, wordPressOrigin };
}

/**
 * WordPress excerpts arrive as HTML with entities. This is deliberately small: it
 * handles the five entities WordPress actually emits in an excerpt and leaves the
 * rest, because a meta description is plain text and a stray `&hellip;` is a cosmetic
 * bug rather than a security one. No sanitiser needed — nothing here reaches the DOM.
 */
export function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&hellip;/g, '…')
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Trim to at most `max` characters, on a WORD boundary, with an ellipsis if cut. */
export function trimToWords(text: string, max: number = DESCRIPTION_MAX): string {
  if (text.length <= max) return text;

  // Reserve one character for the ellipsis, then cut back to the last space.
  const hard = text.slice(0, max - 1);
  const lastSpace = hard.lastIndexOf(' ');
  const cut = lastSpace > max / 2 ? hard.slice(0, lastSpace) : hard;

  return `${cut.replace(/[.,;:\s]+$/, '')}…`;
}

// THE TRAP. Yoast sends the STRINGS 'noindex'/'index' and 'nofollow'/'follow'.
// Boolean('index') is true, so a truthiness test noindexes the entire site.
// Lesson 19.1 Key Concept 6, and the first two cases in Step 3's test file.
export function isNoindex(value: string | null | undefined): boolean {
  return value === 'noindex';
}

export function isNofollow(value: string | null | undefined): boolean {
  return value === 'nofollow';
}

/**
 * Yoast's canonical is a SIGNAL, not a value — Key Concept 5. Its host AND its path
 * are WordPress's, and the `[locale]` prefix means the two URL spaces genuinely
 * differ, so host-swapping produces a canonical that points at a 307.
 *
 * The route's own path is the authority. The only thing worth reading out of Yoast's
 * value is whether a human overrode it with a cross-domain canonical.
 */
export function resolveCanonical(
  yoastCanonical: string | null | undefined,
  path: string,
  origins: Origins
): string {
  const raw = (yoastCanonical ?? '').trim();
  if (raw === '') return path;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    // A typo in Yoast's Advanced panel. Never throw from a metadata path — KC7.
    return path;
  }

  // Auto-generated from home_url(). Ignore the value entirely.
  if (parsed.origin === origins.wordPressOrigin) return path;

  // Our own origin, spelled absolutely. Keep the path so metadataBase resolves it
  // exactly once and a host change needs no content edit.
  if (parsed.origin === origins.siteUrl.replace(/\/$/, '')) return parsed.pathname;

  // A DELIBERATE cross-domain canonical: "this is a syndicated copy". Honour it.
  return parsed.toString();
}

/**
 * The metadata for a node that does not exist. Returned — never thrown — so the PAGE
 * gets to call notFound() and the reader gets a 404 instead of a 500. Key Concept 7.
 * `index: false` matters: a soft 404 that says `index, follow` is a page you have
 * asked Google to keep.
 */
export function notFoundMetadata(): Metadata {
  return {
    title: `Not found — ${SITE_NAME}`,
    robots: { index: false, follow: false },
  };
}

export function yoastToMetadata(
  input: YoastToMetadataInput,
  origins: Origins = originsFromEnv()
): Metadata {
  const { seo, path, ogType = 'website' } = input;

  // ── title ──────────────────────────────────────────────────────────────────
  // Yoast's value is ALREADY RESOLVED from its template, so it is used verbatim and
  // the site name is appended only by the fallback. One formatter per source — KC3.
  const yoastTitle = (seo?.title ?? '').trim();
  const nodeTitle = (input.title ?? '').trim();
  const title =
    yoastTitle !== ''
      ? yoastTitle
      : nodeTitle !== ''
        ? `${nodeTitle} — ${SITE_NAME}`
        : SITE_NAME;

  // ── description ────────────────────────────────────────────────────────────
  // Yoast first, then the route's summary, then NOTHING — an absent key lets the
  // root layout's description win by merge. Never an empty content="". KC4.
  const yoastDesc = stripTags(seo?.metaDesc ?? '');
  const summary = stripTags(input.summary ?? '');
  const description =
    yoastDesc !== ''
      ? trimToWords(yoastDesc)
      : summary !== ''
        ? trimToWords(summary)
        : undefined;

  // ── canonical ──────────────────────────────────────────────────────────────
  const canonical = resolveCanonical(seo?.canonical, path, origins);

  // ── openGraph ──────────────────────────────────────────────────────────────
  const openGraph: NonNullable<Metadata['openGraph']> = {
    type: ogType,
    siteName: SITE_NAME,
    url: canonical,
    title: (seo?.opengraphTitle ?? '').trim() || title,
  };

  const ogDescription = stripTags(seo?.opengraphDescription ?? '');
  if (ogDescription !== '') openGraph.description = trimToWords(ogDescription);
  else if (description !== undefined) openGraph.description = description;

  // The editor's upload wins — and it wins by SETTING the key. When there is no
  // upload the key is ABSENT, so app/[locale]/opengraph-image.tsx supplies og:image
  // itself. Never hard-code the convention's URL here. KC10.
  const image = seo?.opengraphImage;
  if (image?.sourceUrl != null && image.sourceUrl !== '') {
    openGraph.images = [
      {
        url: image.sourceUrl,
        // MediaFields carries mediaDetails so og:image:width/height are real numbers
        // rather than a scraper's guess — Lesson 14.5's reason, reused.
        width: image.mediaDetails?.width ?? undefined,
        height: image.mediaDetails?.height ?? undefined,
        alt: (image.altText ?? '').trim() || title,
      },
    ];
  }

  const metadata: Metadata = {
    title,
    alternates: { canonical },
    // STRING comparisons, both of them. Module 20.4 adds `alternates.languages`.
    robots: {
      index: !isNoindex(seo?.metaRobotsNoindex),
      follow: !isNofollow(seo?.metaRobotsNofollow),
    },
    openGraph,
  };

  if (description !== undefined) metadata.description = description;

  return metadata;
}

export type ArchiveMetadataInput = {
  /** `All incidents`. A constant per archive — Yoast has no node for an archive. KC8. */
  readonly heading: string;
  readonly description: string;
  readonly path: string;
  /** 1-based. Anything above 1 appends `(page N)` and self-canonicalises. */
  readonly page?: number;
  /** A facet is active, so this URL is one of unboundedly many near-duplicates. */
  readonly filtered?: boolean;
};

/**
 * Archive, term and pagination metadata — the four titles Yoast cannot give you,
 * because they are properties of the ROUTE and not of any content node. KC8.
 */
export function archiveMetadata(input: ArchiveMetadataInput): Metadata {
  const { heading, description, path, filtered = false } = input;
  const page = input.page != null && input.page > 1 ? Math.trunc(input.page) : undefined;

  const title =
    page === undefined
      ? `${heading} — ${SITE_NAME}`
      : `${heading} (page ${page}) — ${SITE_NAME}`;

  // SELF-canonical on page 2, not a pointer at page 1. Google retired rel=prev/next
  // and the page-1 canonical along with it; page 2 is a different set of content.
  const canonical = page === undefined ? path : `${path}?page=${page}`;

  return {
    title,
    description: trimToWords(stripTags(description)),
    alternates: { canonical },
    // A filtered view is one of unboundedly many URLs showing subsets of the same
    // content. Do not index it; DO follow out of it. KC8.
    robots: { index: !filtered, follow: true },
    openGraph: { type: 'website', siteName: SITE_NAME, url: canonical, title },
  };
}
```

**Verify §2:**

- [ ] `npm run type-check` is silent. If `SeoFieldsFragment` is not exported, Lesson 19.1's
      codegen step did not run.
- [ ] `grep -c 'process.env' src/lib/seo/yoastToMetadata.ts` is `2`, both inside
      `originsFromEnv()`. Every other function is pure, which is what makes Step 3 possible.
- [ ] `grep -c 'metaRobotsNoindex' src/lib/seo/yoastToMetadata.ts` is `2` — the predicate and
      its one call site. There is no second comparison anywhere in the app.

### Step 3: Unit-test the mapper, starting with the string trap

A pure function over plain data is exactly the shape Lesson 12.1's testing strategy says to
unit-test, and the robots mapping is the single most expensive thing in the module to get wrong.

```ts
// next-app/src/lib/seo/yoastToMetadata.test.ts
// Vitest, environment: 'node' (vitest.config.ts, Lesson 12.1). No DOM, no React, no
// network — the whole point of having pushed environment reads into one function.
import { describe, expect, it } from 'vitest';

import {
  archiveMetadata,
  isNofollow,
  isNoindex,
  resolveCanonical,
  stripTags,
  trimToWords,
  yoastToMetadata,
  type Origins,
  type SeoPayload,
} from '@/lib/seo/yoastToMetadata';

const ORIGINS: Origins = {
  siteUrl: 'https://blamethe.tech',
  wordPressOrigin: 'http://localhost:8080',
};

/** Every field blank, so each test names only what it cares about. */
function seo(overrides: Partial<SeoPayload> = {}): SeoPayload {
  return {
    title: null,
    metaDesc: null,
    canonical: null,
    metaRobotsNoindex: null,
    metaRobotsNofollow: null,
    opengraphTitle: null,
    opengraphDescription: null,
    opengraphImage: null,
    ...overrides,
  } as SeoPayload;
}

describe('the robots strings', () => {
  it('treats the STRING "index" as indexable', () => {
    // Boolean('index') is true. This assertion is the reason the file exists.
    expect(isNoindex('index')).toBe(false);
    expect(isNoindex('noindex')).toBe(true);
    expect(isNoindex(null)).toBe(false);
    expect(isNofollow('follow')).toBe(false);
    expect(isNofollow('nofollow')).toBe(true);
  });

  it('maps an explicitly ALLOWED page to index: true', () => {
    const md = yoastToMetadata(
      { seo: seo({ metaRobotsNoindex: 'index', metaRobotsNofollow: 'follow' }), title: 'x', summary: null, path: '/en/x' },
      ORIGINS
    );
    expect(md.robots).toEqual({ index: true, follow: true });
  });

  it('maps a noindexed page to index: false', () => {
    const md = yoastToMetadata(
      { seo: seo({ metaRobotsNoindex: 'noindex' }), title: 'x', summary: null, path: '/en/x' },
      ORIGINS
    );
    expect(md.robots).toEqual({ index: false, follow: true });
  });

  it('defaults to index, follow when Yoast is silent', () => {
    const md = yoastToMetadata({ seo: null, title: 'x', summary: null, path: '/en/x' }, ORIGINS);
    expect(md.robots).toEqual({ index: true, follow: true });
  });
});

describe('title', () => {
  it('uses Yoast verbatim, because Yoast already resolved its template', () => {
    const md = yoastToMetadata(
      { seo: seo({ title: 'The intern did it — again' }), title: 'DNS outage', summary: null, path: '/en/x' },
      ORIGINS
    );
    expect(md.title).toBe('The intern did it — again');
  });

  it('appends the site name ONCE when Yoast is blank', () => {
    const md = yoastToMetadata({ seo: seo(), title: 'DNS outage', summary: null, path: '/en/x' }, ORIGINS);
    expect(md.title).toBe('DNS outage — Blame The Tech');
  });
});

describe('description', () => {
  it('strips tags and trims on a word boundary', () => {
    const long = `<p>${'blame '.repeat(60)}</p>`;
    const md = yoastToMetadata({ seo: seo({ metaDesc: long }), title: 'x', summary: null, path: '/en/x' }, ORIGINS);
    const description = md.description as string;
    expect(description.length).toBeLessThanOrEqual(155);
    expect(description).not.toContain('<');
    // Cut at a space, not mid-word.
    expect(description.endsWith('blame…')).toBe(true);
  });

  it('falls back to the route summary', () => {
    const md = yoastToMetadata(
      { seo: seo(), title: 'x', summary: '90 minutes of downtime', path: '/en/x' },
      ORIGINS
    );
    expect(md.description).toBe('90 minutes of downtime');
  });

  it('OMITS the key when both are blank, so the layout description wins', () => {
    const md = yoastToMetadata({ seo: seo(), title: 'x', summary: '   ', path: '/en/x' }, ORIGINS);
    expect('description' in md).toBe(false);
  });
});

describe('canonical', () => {
  it('uses the route path when Yoast is blank', () => {
    expect(resolveCanonical(null, '/en/incidents/incident-01', ORIGINS)).toBe('/en/incidents/incident-01');
  });

  it('IGNORES a canonical generated from the WordPress origin', () => {
    // The host is wrong AND the path is wrong — there is no /en in WordPress. KC5.
    expect(
      resolveCanonical('http://localhost:8080/incidents/incident-01/', '/en/incidents/incident-01', ORIGINS)
    ).toBe('/en/incidents/incident-01');
  });

  it('honours a deliberate cross-domain canonical verbatim', () => {
    expect(resolveCanonical('https://example.test/original/', '/en/blog/blog-01', ORIGINS)).toBe(
      'https://example.test/original/'
    );
  });

  it('reduces our own absolute origin to a path', () => {
    expect(resolveCanonical('https://blamethe.tech/en/hobt', '/en/hobt', ORIGINS)).toBe('/en/hobt');
  });

  it('never throws on an unparseable value', () => {
    expect(resolveCanonical('not a url at all', '/en/x', ORIGINS)).toBe('/en/x');
  });
});

describe('openGraph', () => {
  it('OMITS images when the editor uploaded nothing', () => {
    const md = yoastToMetadata({ seo: seo(), title: 'x', summary: null, path: '/en/x' }, ORIGINS);
    expect(md.openGraph && 'images' in md.openGraph).toBe(false);
  });

  it('uses the editor image with real dimensions when present', () => {
    const md = yoastToMetadata(
      {
        seo: seo({
          opengraphImage: {
            id: 'm1',
            altText: 'A server on fire',
            sourceUrl: 'http://localhost:8080/wp-content/uploads/fire.jpg',
            mediaDetails: { width: 1200, height: 630 },
          },
        } as Partial<SeoPayload>),
        title: 'x',
        summary: null,
        path: '/en/x',
      },
      ORIGINS
    );
    expect(md.openGraph?.images).toEqual([
      {
        url: 'http://localhost:8080/wp-content/uploads/fire.jpg',
        width: 1200,
        height: 630,
        alt: 'A server on fire',
      },
    ]);
  });

  it('falls back to the resolved title and description', () => {
    const md = yoastToMetadata(
      { seo: seo({ metaDesc: 'Ninety minutes.' }), title: 'DNS outage', summary: null, path: '/en/x' },
      ORIGINS
    );
    expect(md.openGraph?.title).toBe('DNS outage — Blame The Tech');
    expect(md.openGraph?.description).toBe('Ninety minutes.');
  });
});

describe('archiveMetadata', () => {
  it('self-canonicalises page 2 and labels it', () => {
    const md = archiveMetadata({ heading: 'All incidents', description: 'd', path: '/en/incidents', page: 2 });
    expect(md.title).toBe('All incidents (page 2) — Blame The Tech');
    expect(md.alternates?.canonical).toBe('/en/incidents?page=2');
  });

  it('adds no suffix for page 1', () => {
    const md = archiveMetadata({ heading: 'All incidents', description: 'd', path: '/en/incidents', page: 1 });
    expect(md.title).toBe('All incidents — Blame The Tech');
    expect(md.alternates?.canonical).toBe('/en/incidents');
  });

  it('refuses to index a filtered view but still follows out of it', () => {
    const md = archiveMetadata({ heading: 'All incidents', description: 'd', path: '/en/incidents', filtered: true });
    expect(md.robots).toEqual({ index: false, follow: true });
  });
});

describe('helpers', () => {
  it('collapses whitespace and decodes the entities WordPress emits', () => {
    expect(stripTags('<p>a &amp;  b&hellip;</p>')).toBe('a & b…');
  });

  it('leaves a short string alone', () => {
    expect(trimToWords('short', 155)).toBe('short');
  });
});
```

```bash
npm run test:run
# Expected: all tests pass. `npm test` is WATCH mode — it never returns.
```

**Verify §3:**

- [ ] Every test passes.
- [ ] Break one on purpose: change `isNoindex` to `return Boolean(value);` and re-run. The
      first two `describe` blocks fail. That failure is the bug this whole file exists to
      prevent — put the correct implementation back before continuing.
- [ ] `grep -c "it(" src/lib/seo/yoastToMetadata.test.ts` is 18 or more.

### Step 4: Wire `generateMetadata` onto the node routes

Six routes, one shape. `incidents/[slug]` is shown in full; the rest are the same five lines with
different names, and the table below is the map.

The critical detail is the `const`: **the cache options are written once and passed by both call
sites**, or request memoization does not dedupe and every page costs two queries (Key Concept 6).

```tsx
// next-app/src/app/[locale]/incidents/[slug]/page.tsx (fragment) — added ABOVE the
// existing component, plus one change INSIDE it. Nothing else in the file moves.
import type { Metadata } from 'next';

import { IncidentBySlugDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { incidentTag, listTag } from '@/lib/graphql/tags';
import { notFoundMetadata, yoastToMetadata } from '@/lib/seo/yoastToMetadata';

// THE cache options, written ONCE. generateMetadata and the component both pass this,
// so the two fetches share a cache key and React memoizes them into ONE POST /graphql.
// Let them drift and every incident page costs two WordPress queries — Key Concept 6.
// The values are Lesson 10.3's policy table, unchanged by this lesson.
const cacheOptions = (slug: string) => ({
  revalidate: 3600 as const,
  tags: [incidentTag(slug), listTag('incident')],
});

/**
 * A summary built from data YOAST HAS NEVER SEEN. `incident` is registered without
 * excerpt support (appendix 03 §1), so there is no excerpt to fall back on — and the
 * downtime, environment and resolution are a better description than an excerpt
 * would have been. Lesson 19.1 Key Concept 9's promise, made concrete.
 */
function describeIncident(incident: {
  readonly severities?: { readonly nodes: ReadonlyArray<{ readonly name?: string | null } | null> } | null;
  readonly incidentDetails?: {
    readonly downtimeMinutes?: number | null;
    readonly environment?: string | null;
    readonly resolutionStatus?: string | null;
  } | null;
}): string | null {
  const details = incident.incidentDetails;
  const parts = [
    incident.severities?.nodes[0]?.name ?? null,
    details?.environment != null ? `${details.environment} environment` : null,
    typeof details?.downtimeMinutes === 'number'
      ? `${Math.round(details.downtimeMinutes)} minutes of downtime`
      : null,
    details?.resolutionStatus != null ? `resolution: ${details.resolutionStatus}` : null,
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? `${parts.join(' · ')}.` : null;
}

export async function generateMetadata({
  params,
}: {
  // Next 16: params is a Promise here too, including inside generateMetadata.
  readonly params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;

  try {
    // The SAME options the component passes, bound to a local name so Verification
    // check 13 can replace exactly one line and measure what divergence costs.
    const options = cacheOptions(slug);
    const data = await fetchGraphQL(IncidentBySlugDocument, { slug }, options);
    const incident = data.incident;

    // RETURN, never notFound() and never a throw. The page runs next, gets the same
    // memoized null, and calls notFound() — so the reader gets a 404, not a 500.
    if (incident == null) return notFoundMetadata();

    return yoastToMetadata({
      seo: incident.seo,
      title: incident.title,
      summary: describeIncident(incident),
      path: `/${locale}/incidents/${slug}`,
      ogType: 'article',
    });
  } catch {
    // Transport failure. fetchGraphQL's 'partial' policy (Lesson 10.4) means a
    // GraphQL error arrives as null data rather than a throw, so this branch is for
    // the network being gone — and a metadata function that throws is a 500 page.
    return notFoundMetadata();
  }
}
```

Then, inside the existing component, replace the inline options object with the same `const`:

```tsx
// next-app/src/app/[locale]/incidents/[slug]/page.tsx (fragment) — the component's
// own fetch. The options object it used to build inline becomes the shared const.
  const data = await fetchGraphQL(IncidentBySlugDocument, { slug }, cacheOptions(slug));
```

The other five are the same edit. Copy the block, change the four names:

| Route file | Document | `cacheOptions` | `summary` | `ogType` |
|---|---|---|---|---|
| `blog/[slug]/page.tsx` | `PostBySlugDocument` | `revalidate: 3600`, `[postTag(slug), listTag('post')]` | `post.excerpt` — it exists, and an editor wrote it | `article` |
| `reviews/[slug]/page.tsx` | `ReviewBySlugDocument` | `revalidate: 3600`, `[reviewTag(slug), listTag('review')]` | `` `${companyName} scores ${ratingOverall}/10 — ${verdict}.` `` | `article` |
| `[...slug]/page.tsx` | `PageByUriDocument` | `revalidate: 3600`, `[pageTag(name), listTag('page')]` | `null` — a WP page has no structured summary; inherit the layout's | `website` |
| `hobt/page.tsx` | `HobtPromoDocument` | `revalidate: false`, `[pageTag('hobt'), listTag('page')]` | `hobtPromo.subheadline` | `website` |
| `scapegoats/[slug]/page.tsx` | the document Lesson 18.1's route already imports | **that route's own const, reused** | `scapegoatProfile.tagline` | — see below |

> **`/scapegoats/[slug]` does not use `yoastToMetadata` at all.** A term's Yoast payload is
> `TaxonomySEO`, a different object type from `PostTypeSEO`, so `SeoFields` cannot spread onto it
> (Lesson 19.1 §4) and there is no `seo` in that route's data. Use `archiveMetadata` with the
> term's own fields — and if Lesson 18.1 named the document or the options const differently, the
> import is the one line you change.

```tsx
// next-app/src/app/[locale]/scapegoats/[slug]/page.tsx (fragment) — added above the
// component. Reuse THIS route's existing document and cache-options const; identical
// options, or you have just doubled the query.
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const data = await fetchGraphQL(ScapegoatBySlugDocument, { slug }, cacheOptions(slug));
  const term = data.scapegoat;
  if (term == null) return notFoundMetadata();

  return archiveMetadata({
    heading: term.name ?? 'Scapegoat',
    description:
      term.scapegoatProfile?.tagline ?? `Every incident this organisation blamed on ${term.name ?? 'them'}.`,
    path: `/${locale}/scapegoats/${slug}`,
  });
}
```

**Verify §4:**

- [ ] `grep -rl generateMetadata src/app | wc -l` counts six route files after this step and
      ten after Step 5.
- [ ] For every route: `grep -c 'cacheOptions' <the file>` is `3` — the definition and **two**
      call sites. A `2` means one of the two fetches still builds its options inline, which is
      the doubled-query bug.
- [ ] The incident detail route still calls `notFound()` **in the component** and nowhere else.
      `generateMetadata` returns; the page decides.
- [ ] `npm run type-check` is silent.

### Step 5: Build the archive and term titles by hand

Four archives, no nodes, no Yoast. All four are `archiveMetadata` calls.

```tsx
// next-app/src/app/[locale]/incidents/page.tsx (fragment) — added above the component.
// This route ALREADY awaits searchParams for its facets (Lesson 18.1); generateMetadata
// awaits the same Promise, which costs nothing.
import type { Metadata } from 'next';

import { archiveMetadata } from '@/lib/seo/yoastToMetadata';

/** searchParams values are `string | string[] | undefined`. Take the first. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { locale } = await params;
  const query = await searchParams;

  const page = Number.parseInt(first(query.page) ?? '1', 10);

  return archiveMetadata({
    heading: 'All incidents',
    description:
      'Every outage, misconfiguration and 3am pager alert, with the blame formally assigned.',
    path: `/${locale}/incidents`,
    // If your facet route paginates by CURSOR rather than by page number, drop this
    // argument: a cursor URL is not a stable address and `filtered` already covers it.
    page: Number.isFinite(page) ? page : 1,
    // A faceted URL is one of unboundedly many views of the same 40 incidents.
    // Do not let a crawler enumerate them — Key Concept 8.
    filtered:
      first(query.q) !== undefined ||
      first(query.severity) !== undefined ||
      first(query.scapegoat) !== undefined,
  });
}
```

The other three take no `searchParams` and are three lines each:

| Route file | `heading` | `description` |
|---|---|---|
| `blog/page.tsx` | `The blog` | `Long-form incident post-mortems, and opinions nobody solicited.` |
| `reviews/page.tsx` | `Tech reviews` | `Ratings for the tools and vendors that caused the incidents.` |
| `scapegoats/page.tsx` | `The blame leaderboard` | `Who or what has been held responsible, ranked by incident count.` |

Each one is:

```tsx
// next-app/src/app/[locale]/blog/page.tsx (fragment) — added above the component.
// Same shape in reviews/page.tsx and scapegoats/page.tsx, with the row's own strings.
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  return archiveMetadata({
    heading: 'The blog',
    description: 'Long-form incident post-mortems, and opinions nobody solicited.',
    path: `/${locale}/blog`,
  });
}
```

**Verify §5:**

- [ ] All four archives return a title ending `— Blame The Tech`, and none of them imports
      `yoastToMetadata` — there is no node, so there is nothing to map.
- [ ] `curl -s 'http://localhost:3000/en/incidents?q=dns' | grep -o '<meta name="robots"[^>]*>'`
      shows `noindex`, and the same URL without `?q=` shows `index`. That contrast is Key
      Concept 8, observable.
- [ ] `curl -s 'http://localhost:3000/en/incidents?page=2' | grep -o '<link rel="canonical"[^>]*>'`
      ends `?page=2`, **not** at page 1.

### Step 6: The generated social card

One file, inside the locale segment for the reason in Key Concept 9.

```tsx
// next-app/src/app/[locale]/opengraph-image.tsx
// The site-level social card. Every route at or below [locale] gets og:image and
// twitter:image pointing here, with width, height and content type filled in by the
// convention — unless yoastToMetadata SET openGraph.images, in which case the
// editor's upload wins by merge (Key Concept 10).
//
// WHY IT IS IN [locale] AND NOT AT src/app/: this path has no file extension, so
// Lesson 09.5's matcher `/((?!api|_next|favicon\.ico|.*\..*).*)` does NOT exclude it.
// At the root it would be 307'd to /en/opengraph-image and 404 for every crawler,
// silently, because no page of ours ever requests it. Lessons 09.5 and 15.5 both
// froze that matcher, and moving one file is cheaper than an exception in a regex
// three modules have agreed not to edit.
import { ImageResponse } from 'next/og';

export const alt = 'Blame The Tech — incident reports, blame assignment, and reviews nobody asked for';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  // Being inside [locale] is what makes this readable at all — a root-level file has
  // no params. The TEXT stays locale-neutral today: Module 20 owns the message
  // catalogues, and half-translating a social card is worse than not translating it.
  const { locale } = await params;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          // Inline styles only: Satori does not run Tailwind, and there is no
          // stylesheet in an image route. A solid background is the right scope.
          background: '#0b1020',
          color: '#f8fafc',
          fontSize: 64,
        }}
      >
        <div style={{ display: 'flex', fontSize: 28, letterSpacing: 4, opacity: 0.7 }}>
          {locale.toUpperCase()}
        </div>
        <div style={{ display: 'flex', fontWeight: 700, lineHeight: 1.1 }}>Blame The Tech</div>
        <div style={{ display: 'flex', fontSize: 32, opacity: 0.8 }}>
          Incident reports · blame assignment · reviews nobody asked for
        </div>
      </div>
    ),
    // NO `fonts` array. next/og bundles a font; fetching a webfont at request time
    // would put a network dependency with a timeout on a route no page exercises,
    // and Satori renders NOTHING rather than rendering badly. Module 21 adds
    // next/font and a local file, which is when a real typeface becomes cheap.
    { ...size }
  );
}
```

**Verify §6:**

- [ ] The file is at `src/app/[locale]/opengraph-image.tsx`. If you put it at `src/app/`, check
      13 in the Verification block catches it — go and read that check now rather than later.
- [ ] `npm run type-check` is silent. The `Promise<>` is not belt and braces: **Next 16 made the
      image conventions async**, so `params` — and the `id` from `generateImageMetadata`, which
      this course does not use — arrive as Promises here just as they do in a page. Next 15 passed
      a plain object, which is why every example you find online omits the `await`.
- [ ] `npm run build` lists `/[locale]/opengraph-image` in the route table.

### Step 7: Run the whole toolchain, then read the head you actually shipped

```bash
npm run test:run
npm run type-check
npm run lint
npm run build

# Serve the built app and read the <head> WordPress data produced. Do not trust the
# React tree — the module README is right about this and so is every SEO post-mortem.
npm run start & SERVER_PID=$!
sleep 6
curl -s http://localhost:3000/en/incidents/incident-01 \
  | tr '>' '>\n' | grep -E '<title|name="description"|rel="canonical"|name="robots"|property="og:'
kill "$SERVER_PID"
```

**Verify §7:**

- [ ] `<title>` is the Yoast title you typed in Lesson 19.1 Task §8, not the WordPress post
      title.
- [ ] `<link rel="canonical">` is `http://localhost:3000/en/incidents/incident-01` — your host,
      **with** the `/en` prefix, **without** a trailing slash.
- [ ] `<meta name="robots" content="index, follow">`.
- [ ] `og:image` is present. With no editor upload it points at
      `/en/opengraph-image`; the convention supplied it, not the mapper.

### Step 8: Write the two decisions down

`docs/` is yours, and these are the two rows a future reader will come looking for.

Append to `docs/architecture.md`, under a new `## The canonical host (Lesson 19.2)` heading:

```markdown
- `NEXT_PUBLIC_SITE_URL` is the ONE place the public origin is decided. `metadataBase` in
  `src/app/[locale]/layout.tsx` reads it; `sitemap.ts` and `robots.ts` read it in Lesson 19.4;
  nothing else constructs an absolute URL.
- Yoast's `seo.canonical` is a **signal, not a value**. Its host is `home_url()` and its path is
  WordPress's, which has no `[locale]` segment — so host-swapping it produces a canonical
  pointing at a 307. `resolveCanonical()` uses the route's own path and reads Yoast's value only
  to detect a deliberate cross-domain canonical.
- The WordPress origin is derived from `WP_GRAPHQL_ENDPOINT`. There is no second environment
  variable naming the same host twice.
```

Append to `docs/content-model.md`, under `## Who owns each <head> field (Lesson 19.2)`:

```markdown
| Output | Editor controls it via | Fallback if blank | Nobody can override |
|---|---|---|---|
| `<title>` | Yoast SEO title | `${title} — Blame The Tech` | — |
| `<meta name="description">` | Yoast meta description | the route's own summary, then the layout's | — |
| `<link rel="canonical">` | Yoast Advanced → canonical, for cross-domain only | the route's own path | the host, which is `NEXT_PUBLIC_SITE_URL` |
| `<meta name="robots">` | Yoast Advanced → allow search engines | `index, follow` | — |
| `og:image` | Yoast Social → image | `/[locale]/opengraph-image` | — |
| `og:title`, `og:description` | Yoast Social | the resolved title/description | — |
| Archive and pagination titles | — | — | the route owns them; Yoast has no node |
```

```bash
git add -A
git commit -m "feat(next): map yoast metadata to the next metadata api"
```

**Verify §8:**

- [ ] `grep -c 'canonical host' ../docs/architecture.md` is `1`.
- [ ] `grep -c 'head> field' ../docs/content-model.md` is `1`.
- [ ] The `docs/` files were **appended to**, not replaced. Lesson 01.2 created
      `architecture.md` and Module 04 created `content-model.md`; both have earlier sections.

---

## Verification

```bash
cd next-app

# A WordPress-request counter, as in Lesson 10.3. Re-paste it if this is a new shell.
gqlog() {
  docker compose -f ../wordpress-headless/docker-compose.yml \
    logs --since="${1:-60s}" wordpress | grep -c 'POST /graphql'
}

# 1. Exactly one metadataBase, in the root layout, and no title template anywhere
grep -rn 'metadataBase' src/ | wc -l
# Expected: 1
grep -rn 'template:' src/app/ ; echo "exit=$?"
# Expected: no matches, exit=1 — Yoast titles are already resolved (Key Concept 3)

# 2. One comparison against each robots string, in one file
grep -rn "=== 'noindex'\|=== 'nofollow'" src/ | wc -l
# Expected: 2, both in src/lib/seo/yoastToMetadata.ts

# 3. The unit tests pass, including the two that exist only for the string trap
npm run test:run
# Expected: all pass. `npm test` is WATCH mode and never returns.

# 4. Types and lint clean
npm run type-check && npm run lint
# Expected: no output

# 5. Every node route pairs its two fetches through ONE options const. A `1` on any
#    row is the doubled-query bug: one call site still builds its options inline.
for f in 'src/app/[locale]/incidents/[slug]/page.tsx' \
         'src/app/[locale]/blog/[slug]/page.tsx' \
         'src/app/[locale]/reviews/[slug]/page.tsx' \
         'src/app/[locale]/[...slug]/page.tsx' \
         'src/app/[locale]/hobt/page.tsx'; do
  printf '%s  cacheOptions=%s\n' "$f" "$(grep -c 'cacheOptions' "$f")"
done
# Expected: 3 for each file — the definition and two call sites. A 2 is the
#           doubled-query bug: one fetch is still building its options inline.

# 6. Put ONE post into noindex from the sidebar's own meta key, BEFORE the build, so
#    the prerender picks it up. Check 12 asserts it and check 12b puts it back.
INCIDENT_ID=$(docker compose -f ../wordpress-headless/docker-compose.yml run --rm -T wpcli \
  wp post list --post_type=incident --name=incident-02 --field=ID | tr -d '\r')
echo "incident-02 is post $INCIDENT_ID"
docker compose -f ../wordpress-headless/docker-compose.yml run --rm -T wpcli \
  wp post meta update "$INCIDENT_ID" _yoast_wpseo_meta-robots-noindex 1
# Expected: Success. Yoast stores 1 = noindex, 2 = index, absent = the default.

# 7. A COLD production build, and the WordPress request count that goes with it.
#    Cold matters: a warm .next Data Cache answers from disk and measures nothing.
rm -rf .next
SECONDS=0
npm run build > /tmp/btt-build-matched.log 2>&1
MATCHED=$(gqlog "${SECONDS}s")
echo "matched options: $MATCHED WordPress requests during the build"
# Expected: a number in the low hundreds. The ABSOLUTE value is not the result —
#           check 13 reads the DELTA against a second build. Write this down.
grep -c 'opengraph-image' /tmp/btt-build-matched.log
# Expected: 1 or more — the route table lists /[locale]/opengraph-image

npm run start > /tmp/btt-start.log 2>&1 & SERVER_PID=$!
sleep 6

# 8. The head you actually shipped, on the incident whose Yoast fields you typed in
#    Lesson 19.1 Task §8. Do NOT trust the React tree.
curl -s http://localhost:3000/en/incidents/incident-01 \
  | tr '>' '>\n' | grep -E '<title|name="description"|rel="canonical"|name="robots"'
# Expected, four lines:
#   <title>The intern did it — again</title>
#   <meta name="description" content="Ninety minutes of downtime, one DNS record, …">
#   <link rel="canonical" href="http://localhost:3000/en/incidents/incident-01">
#   <meta name="robots" content="index, follow">

# 9. NEGATIVE — exactly ONE canonical in the document. This single number is the whole
#    argument for the Metadata API over wp_head().
curl -s http://localhost:3000/en/incidents/incident-01 | grep -c 'rel="canonical"'
# Expected: 1. Never 0, never 2.

# 10. NEGATIVE — no canonical, and no tag of any kind, carries the WordPress host.
#     Yoast's own value said :8080; resolveCanonical() discarded it (Key Concept 5).
curl -s http://localhost:3000/en/incidents/incident-01 | grep -c 'localhost:8080'
# Expected: 0
curl -s http://localhost:3000/en/incidents/incident-01 \
  | grep -o 'rel="canonical" href="[^"]*"'
# Expected: an href on :3000, WITH the /en prefix and WITHOUT a trailing slash.
#           A host-swapped Yoast canonical would have been :3000/incidents/incident-01/
#           — no /en, one trailing slash, and a 307 away from the page it is on.

# 11. NEGATIVE — a page whose Yoast description is blank still emits a description,
#     because the fallback fired. incident-03 was never touched in the sidebar.
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incident(id:\"incident-03\",idType:SLUG){ seo{ metaDesc } } }"}' \
  | jq -r '.data.incident.seo.metaDesc | if . == null or . == "" then "BLANK in Yoast" else . end'
# Expected: BLANK in Yoast
curl -s http://localhost:3000/en/incidents/incident-03 | grep -o 'name="description" content="[^"]*"'
# Expected: a real sentence built from incidentDetails — downtime, environment,
#           resolution. Not an empty content="", and not the tag missing.

# 12. NEGATIVE — the noindex you set in check 6 reaches the rendered HTML, and the
#     page next to it does not. Two assertions, because either one alone can pass by
#     accident.
curl -s http://localhost:3000/en/incidents/incident-02 | grep -o 'name="robots" content="[^"]*"'
# Expected: content="noindex, nofollow" — Next expands index:false to both
curl -s http://localhost:3000/en/incidents/incident-01 | grep -o 'name="robots" content="[^"]*"'
# Expected: content="index, follow" — the STRING "index" mapped to true. If BOTH pages
#           say noindex, you wrote a truthiness test. Lesson 19.1 Key Concept 6.

# 13. NEGATIVE — a bad slug is a 404, not a 500 from inside generateMetadata
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/incidents/no-such-incident
# Expected: 404
curl -s http://localhost:3000/en/incidents/no-such-incident | grep -c 'name="robots" content="noindex'
# Expected: 1 — notFoundMetadata() refuses to let a soft 404 stay indexable

# 14. The generated card is a real PNG, at the path inside the locale segment
curl -s -o /dev/null -w '%{http_code}  %{content_type}\n' http://localhost:3000/en/opengraph-image
# Expected: 200  image/png
curl -s http://localhost:3000/en/incidents/incident-03 | grep -o 'property="og:image" content="[^"]*"'
# Expected: an href containing /en/opengraph-image — the file convention supplied it,
#           because incident-03 has no editor upload and the mapper omitted the key.

# 15. NEGATIVE — the check that would have caught the placement bug. The root-level
#     path has no file extension, so proxy matches it and 307s it away.
curl -s -o /dev/null -w '%{http_code}  %{redirect_url}\n' http://localhost:3000/opengraph-image
# Expected: 307 and a redirect_url of http://localhost:3000/en/opengraph-image
#           A file at src/app/opengraph-image.tsx would have made that 307 land on
#           nothing — a 404 for every crawler, invisible from your own pages.

# 16. NEGATIVE — a filtered archive is not indexable; the unfiltered one is
curl -s 'http://localhost:3000/en/incidents?q=dns' | grep -o 'name="robots" content="[^"]*"'
# Expected: content="noindex, follow"
curl -s http://localhost:3000/en/incidents | grep -o 'name="robots" content="[^"]*"'
# Expected: content="index, follow"
curl -s 'http://localhost:3000/en/incidents?page=2' | grep -o 'rel="canonical" href="[^"]*"'
# Expected: an href ending ?page=2 — a SELF canonical, not a pointer at page 1

kill "$SERVER_PID"

# 17. Put the sidebar back the way you found it
docker compose -f ../wordpress-headless/docker-compose.yml run --rm -T wpcli \
  wp post meta delete "$INCIDENT_ID" _yoast_wpseo_meta-robots-noindex
# Expected: Success

# 18. NEGATIVE — MEASURE the doubled query rather than asserting it. Break the pairing
#     on one route, rebuild cold, and read the delta. A `.bak` copy, not
#     `git checkout --`: this route file predates the lesson and the module commits
#     AFTER verification, so a checkout would hand you back the pre-19.2 version.
sed -i.bak 's/const options = cacheOptions(slug);/const options = { revalidate: 60, tags: [incidentTag(slug)] };/' \
  'src/app/[locale]/incidents/[slug]/page.tsx'
grep -c 'revalidate: 60' 'src/app/[locale]/incidents/[slug]/page.tsx'
# Expected: 1 — if this is 0 the sed did not match and the measurement is meaningless

rm -rf .next
SECONDS=0
npm run build > /tmp/btt-build-mismatched.log 2>&1
MISMATCHED=$(gqlog "${SECONDS}s")
echo "matched=$MATCHED  mismatched=$MISMATCHED  delta=$((MISMATCHED - MATCHED))"
# Expected: a delta of roughly 40 — ONE extra WordPress request per pre-rendered
#           incident, and there are 40 seeded incidents. The exact number moves with
#           how many pages generateStaticParams scoped, which is why the DELTA is the
#           result and the absolute counts are not.
#           A delta of ~0 means either the sed missed (check the grep above) or your
#           Next release changed how fetch cache keys are built — in which case say
#           what you measured and re-read Key Concept 6 before trusting it.

mv 'src/app/[locale]/incidents/[slug]/page.tsx.bak' 'src/app/[locale]/incidents/[slug]/page.tsx'
grep -c 'const options = cacheOptions(slug);' 'src/app/[locale]/incidents/[slug]/page.tsx'
# Expected: 1 — restored

# 19. Leave the tree clean and the build honest
rm -rf .next && npm run build > /dev/null 2>&1 && echo "clean build ok"
# Expected: clean build ok
git status --short
# Expected: no .bak file, no .next, nothing unexpected

# 20. The two decisions are written down where a future reader will look
grep -c 'canonical host' ../docs/architecture.md
# Expected: 1
grep -c 'head> field' ../docs/content-model.md
# Expected: 1
```

If check 12 shows `noindex` on **both** incidents, stop and read `isNoindex`: a truthiness test
passes every check here except that one. If check 18's delta is 0 while the `grep` above it
printed `1`, write down the numbers you got rather than deleting the check.

## Control Questions

1. Yoast's `seo.canonical` for `incident-01` is `http://localhost:8080/incidents/incident-01/`.
   Write down the URL a host-swap would produce, say what happens when a crawler fetches it, and
   then explain why no rewrite of that string — however careful — can produce the right answer.
2. `generateMetadata` and the page component both call `fetchGraphQL` with the same document and
   the same variables, and WordPress logs two requests per page. Give the cause, the fix, and the
   reason neither `npm run type-check` nor the rendered HTML would ever tell you.
3. The root layout does not define `title.template`. Say what a template would do to a
   Yoast-supplied title, name the one-line alternative that would have made a template safe, and
   give the rule that decides between them.
4. `yoastToMetadata` deliberately omits `openGraph.images` when the editor uploaded nothing,
   rather than pointing it at the generated card. Explain the mechanism that makes the omission
   work, and name two things that break if you set the key to the convention's URL instead.
5. `opengraph-image.tsx` is at `src/app/[locale]/` and `robots.ts` is at `src/app/`. Give the
   single property of the two URLs that decides which placement is correct, and say what you
   would have had to change instead — and why that was the worse trade.

## Learn More

- [Next.js — `generateMetadata`](https://nextjs.org/docs/app/api-reference/functions/generate-metadata)
  — the full field reference plus the merge rules; read the "Ordering" and "Merging" sections
  against Key Concept 1 before you argue with any of it
- [Next.js — `metadataBase`](https://nextjs.org/docs/app/api-reference/functions/generate-metadata#metadatabase)
  — exactly which values it resolves, which is narrower than most people assume and is the whole
  content of Key Concept 2
- [Next.js — `opengraph-image` and `twitter-image`](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image)
  — the `alt`, `size` and `contentType` exports, and the route-segment behaviour that makes a
  site-level card possible at all
- [Next.js — `ImageResponse`](https://nextjs.org/docs/app/api-reference/functions/image-response) —
  the supported CSS subset, which is smaller than you expect; read it before designing a card
- [Satori](https://github.com/vercel/satori) — the renderer under `ImageResponse`, and the
  authority on why an unsupported style silently produces nothing
- [Next.js — request memoization](https://nextjs.org/docs/app/guides/caching#request-memoization)
  — the mechanism Key Concept 6 depends on, and the sentence about the cache key that explains
  why identical options are not optional
- [Google Search Central — canonicalization and `rel=canonical`](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
  — including what Google does with a canonical that points at a redirect, which is the failure
  Key Concept 5 exists to prevent
- [Google Search Central — pagination best practices](https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading)
  — the current advice, which is a self-canonical per page and not a pointer at page 1
- [The Open Graph protocol](https://ogp.me/) — the required properties, and why `og:image:width`
  and `og:image:height` are worth carrying real numbers for
- [MDN — `<meta name="robots">`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name)
  — the directive vocabulary, useful when you need to explain why `noindex, follow` and
  `index, nofollow` are both sensible and mean very different things
