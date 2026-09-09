---
title: 'i18n SEO & Edge Cases'
module: 20
lesson: 4
teaches: [hreflang, x-default, per-locale-sitemap, rtl-readiness, locale-cache-tags, untranslated-content-ux]
produces: ['next-app/src/lib/seo/alternates.ts', 'next-app/src/app/sitemap.ts']
requires: [20.3, 19.4, 18.3]
---

# Lesson 20.4 — i18n SEO & Edge Cases

## Quick Overview

A multilingual site that does not tell search engines about its languages is three sites
competing with each other for the same queries. The fix is an `hreflang` cluster: every page in
a translation group links to every other page in the group **and to itself**, reciprocally, with
an `x-default` naming the version for visitors whose language you do not serve. Next's Metadata
API expresses this as `alternates.languages`, which means it is one function away from the
`translations` data you already fetch in Lesson 20.2 — and one forgotten self-reference away
from an invalid cluster that Search Console reports as "no return tags" six weeks later.

The rest of the lesson is the edge cases, which is where multilingual projects actually fail.
Per-locale sitemap entries, because a single sitemap listing only English URLs hides two thirds
of your content. Untranslated-content UX, because the policy decided in Lesson 20.2 needs a
visible affordance and an honest `hreflang` consequence — you must not claim a German alternate
for a page that is actually English. RTL readiness, because Arabic is not in the course but the
logical-property discipline that makes it a configuration change rather than a rewrite costs
almost nothing today. Translated block content, because `BlockRenderer` renders whatever the
German post contains and any string hard-coded inside a block component is now a bug in two
languages. And **locale-aware cache tags**, which is the one with teeth: the Module 18 scheme
tags an incident as `incident:dns`, so publishing the German translation purges the English
page and vice versa. Three languages sharing one tag is a correctness bug wearing a performance
bug's clothes.

By the end of this lesson you will have:

- `src/lib/seo/alternates.ts` — a reciprocal, self-inclusive `hreflang` cluster with `x-default`,
  merged into every route's `generateMetadata`
- `src/app/sitemap.ts` extended to emit every locale's URLs with `alternates.languages` per entry
- Locale-scoped cache tags (`incident:de:dns-ausfall`, `incidents:de`) and the revalidation
  webhook payload extended with `locale`
- A tested untranslated-content path: the chosen fallback, a visible notice, and no false
  `hreflang` claim
- RTL readiness — `dir` on `<html>`, logical CSS properties instead of `left`/`right`, and a
  forced-`rtl` screenshot check
- Every remaining hard-coded string inside `src/components/blocks/` moved into the catalogues

## Classic WP Analogy

Polylang did all of this for you, invisibly, and that is the honest framing of this lesson.

| Classic WordPress with Polylang | Headless |
|---|---|
| Polylang injects `<link rel="alternate" hreflang="...">` into `wp_head()` | `alternates.languages` in `generateMetadata`, built by you |
| Yoast + Polylang produce per-language sitemap indexes | `app/sitemap.ts` iterates locales |
| `is_rtl()` and the theme's `rtl.css` | `dir` on `<html>` plus logical CSS properties |
| Page cache keyed by full URL, so locale is free | Cache **tags** are yours to name — locale is not free |
| Untranslated post 404s or redirects per a Polylang setting | A branch you write, with a UI affordance |

The interesting break is the caching row, and it is worth sitting with. A Classic WordPress page
cache keys on the request URL. `/de/vorfaelle/dns-ausfall` and `/incidents/dns` are different
strings, therefore different cache entries, therefore locale-correct caching **by accident** —
you never thought about it because URL keying made it impossible to get wrong.

Next's ISR cache is also keyed by URL, so reads are fine. But **invalidation is keyed by tag**,
and tags are strings you invented in Lesson 18.3. Nothing in the framework knows that
`incident:dns` should mean the English one. So publishing a German edit either purges all three
languages (wasteful, and it hammers WordPress with three regenerations) or purges the wrong one
(a stale page nobody can explain). This is a genuinely new failure mode with no Classic
analogue, it appears the moment you add a second language, and the fix is entirely a naming
convention — which is why it belongs in the same lesson as `hreflang` rather than back in
Module 18.

---

## Key Concepts

### 1. What `hreflang` is for, and what happens without it

Three URLs, three languages, one topic. Without `hreflang` a search engine sees three pages
about the same thing and has to guess whether they are translations, duplicates, or unrelated.
Its guesses are the two failure modes you can observe in the wild:

| Without `hreflang` | Result |
|---|---|
| the engine treats them as near-duplicates | it picks one, indexes it, and the other two lose their rankings to their own translation |
| the engine indexes all three | a German searcher gets the English URL, bounces, and the German page's engagement signals get worse |

An `hreflang` cluster says: these URLs are the same content in different languages, serve each
visitor the one that matches. It is a **bidirectional claim**, which is why it is more than a
tag — every URL in the group has to make it, about every other URL, including itself.

### 2. Reciprocal, self-inclusive, and `x-default`

Three rules, and each one is a distinct way to get it wrong.

```
   /en/incidents/incident-01            /de/incidents/incident-01-de
   ────────────────────────────         ────────────────────────────────
   hreflang="en"  → itself      ◀──┐    hreflang="en"  → the EN url
   hreflang="uk"  → відмова-01     │    hreflang="uk"  → відмова-01
   hreflang="de"  → incident-01-de │    hreflang="de"  → itself
   hreflang="x-default" → the EN url    hreflang="x-default" → the EN url
                       └──────────┘
              every page names every page, itself included
```

| Rule | What breaks without it |
|---|---|
| **reciprocal** — every member links to every other member | Google discards the whole cluster. It cannot trust a one-way claim, because anyone could claim to be your translation |
| **self-inclusive** — a page links to *itself* too | the "no return tags" error in Search Console, six weeks after the deploy, in a report nobody was watching |
| **`x-default`** — one entry for "no match" | a visitor whose language you do not serve gets whichever version the engine guesses |

The self-inclusion rule is the one this codebase is structurally likely to break, and Lesson
20.2 §4 said why: WPGraphQL's `translations` field returns **siblings only**. Spread it into a
cluster and you have produced exactly the invalid shape. The node has to be added back, in one
function, which is why `alternates.ts` exists rather than four route-local object literals.

`x-default` is not a language — it is "use this when nothing matched". Point it at the default
locale's URL, and express it as the literal key `'x-default'` in `alternates.languages`.

### 3. `alternates.languages`, and composing with the Yoast mapper

Next's Metadata API renders the cluster for you:

```ts
// (illustration)
alternates: {
  canonical: 'https://blamethe.tech/de/incidents/incident-01-de',
  languages: {
    en: 'https://blamethe.tech/en/incidents/incident-01',
    uk: 'https://blamethe.tech/uk/incidents/відмова-01',
    de: 'https://blamethe.tech/de/incidents/incident-01-de',
    'x-default': 'https://blamethe.tech/en/incidents/incident-01',
  },
}
```

**`yoastToMetadata()` is Lesson 19.2's and it stays a pure single-concern function.** It maps
editor-controlled `<head>` fields — title, description, canonical with the host swapped, robots,
Open Graph — and it knows nothing about locales. `alternates.languages` comes from translation
data, not from Yoast, so it is **composed on top** rather than folded in:

```ts
// (illustration — the real edit is in the Task)
const meta = yoastToMetadata(node, { path });

return {
  ...meta,
  // Spread `meta.alternates` FIRST so the canonical survives, then add languages.
  alternates: { ...meta.alternates, ...alternatesForNode(node, hrefFor) },
};
```

Folding it in would give the Yoast mapper a second input, a second reason to change and a
second set of tests. Two functions, one composition point per route, and `yoastToMetadata`'s
tests stay about Yoast.

### 4. The exact count, per route shape

Module 21's Starting State runs `curl -s .../de/incidents | grep -c 'rel="alternate"'` and
**expects `4`**. So the count is a contract, and it differs by route:

| Route | Exists in | `languages` entries | `rel="alternate"` links |
|---|---|---|---|
| `/de/incidents` (archive) | all three locales, always | `en`, `uk`, `de`, `x-default` | **4** |
| `/de/incidents/incident-01-de` | en, uk, de | `en`, `uk`, `de`, `x-default` | **4** |
| `/de/incidents/incident-06-de` | en, de | `en`, `de`, `x-default` | **3** |
| `/en/incidents/incident-40` | en only | `en`, `x-default` | **2** |
| `/en/reviews/review-01` | en only | `en`, `x-default` | **2** |

**Module 21 asserts the archive number**, and an archive is the easy case: `/incidents`,
`/blog`, `/reviews`, `/scapegoats`, `/hobt` and `/` are Next-owned paths that exist in every
locale by construction, so their clusters are computed from `routing.locales` with no data at
all. Node routes ask the translation group.

Two entries for a single-language page rather than none is a deliberate choice. Google does not
require `hreflang` on a page with no alternates, so zero would be defensible — and the
self-referential pair is what lets the locale switcher (Lesson 20.3) read the document's own
`<link rel="alternate">` tags and **disable** the locales that do not exist. One mechanism
carrying the claim, used by both the crawler and the switcher, instead of two that can disagree.

### 5. Per-locale sitemap entries

Lesson 19.4's `src/app/sitemap.ts` emits `en` URLs only, and says that this lesson extends it. A
sitemap listing one third of your content is worse than it sounds: the missing URLs are still
crawlable, but they are discovered slowly, and a new German article can wait weeks.

Two changes, and the second is the one people miss:

1. **Iterate locales.** Every entry the sitemap emits today becomes up to three, using the same
   translation data the `hreflang` cluster uses.
2. **Put `alternates.languages` on each entry.** Next's `MetadataRoute.Sitemap` supports it, and
   it emits `xhtml:link rel="alternate"` inside each `<url>`. That is the sitemap's own way of
   declaring the cluster, and it is a **second, independent** channel for the same claim — which
   is a feature here rather than a duplication risk, because both come from one function.

`lastmod` is per translation, not per group: a German edit changes the German entry's `lastmod`
and leaves the English one alone. That is correct, and it falls out of translations being
separate posts.

### 6. The notice, and the `hreflang` claim you must not make

Lesson 20.2 chose the policy: a node with no version in the requested locale 307s to the
default-locale URL with `?from=<locale>`. Two halves land here.

**The visible half.** `?from=de` needs an explanation on the page it lands on, or the user
experiences a silent language switch. A dismissible notice — "Not available in Deutsch — showing
English" — is the whole feature. It reads the query string client-side, so the page it sits on
stays statically renderable.

**The invisible half, which is the one with teeth.** `/en/incidents/incident-40` must **not**
advertise a `de` alternate. There is no German URL to point at, and pointing `hreflang="de"` at
the English URL is a claim that the English page is the German version — which is how you get
the English page indexed for German queries and then outranked by a competitor who told the
truth. The rule falls out of the data: the cluster is built from `availableLocales()`, and a
locale with no sibling contributes no entry, so the false claim is unrepresentable rather than
merely discouraged.

The canonical tag does the rest. `alternates.canonical` never includes the query string, so
`/en/incidents/incident-40?from=de` and `/en/incidents/incident-40` are one indexable URL.

### 7. RTL readiness costs almost nothing today

Arabic is not in this course. The discipline that would make it a configuration change rather
than a rewrite is two rules, and both are free:

| Physical property | Logical property | In `rtl` |
|---|---|---|
| `margin-left` (`ml-4`) | `margin-inline-start` (`ms-4`) | flips to the right |
| `padding-right` (`pr-2`) | `padding-inline-end` (`pe-2`) | flips to the left |
| `text-align: left` | `text-align: start` | flips |
| `left-0` | `start-0` | flips |
| `border-l` | `border-s` | flips |

Tailwind v4 ships the logical utilities (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`,
`text-start`, `text-end`, `border-s`, `border-e`), so this is a find-and-replace, not a
rewrite. `dir` on `<html>` (Lesson 20.3) is what activates them: a logical property is
meaningless without a document direction to resolve against.

**What this does not buy you:** icons that encode direction (a "next" chevron), horizontal
scroll affordances, and anything positioned with a transform. Those need real design work in an
RTL locale, and pretending otherwise is how a project claims RTL support it does not have. What
the discipline buys is that the *layout* does not have to be rebuilt — which is most of the
work and all of the risk.

### 8. Translated block content, and the strings hiding inside block components

`BlockRenderer` (Lesson 14.2) renders whatever the German post contains, so translated block
*data* needs nothing at all — the German incident's block tree came across in Lesson 20.1's
seeder and it renders. That is the good news and it is genuinely most of the story.

The bad news is the block **components**. `src/components/blocks/` holds six components, and
every English string hard-coded inside one is now wrong in two languages — on a German page,
inside German content, which is where it is most visible and least likely to be noticed by an
English-speaking reviewer. A label like "Related incidents" or "Read the postmortem" lives in a
component, not in the block's attributes, so no amount of translated content fixes it.

Lesson 20.3's ESLint rule was scoped to four directories. This lesson sweeps `blocks/` and then
**widens the rule to all of `src/components/**`**, with `src/components/ui/` excluded —
generated by the shadcn CLI, and a lint rule that fights a code generator loses.

### 9. Locale-aware cache tags: the one with teeth

This is the module's genuinely new failure mode, and it has no Classic analogue at all.

```
   CLASSIC PAGE CACHE                     NEXT ISR
   ──────────────────────────────         ────────────────────────────────────
   key:        the request URL            key:        the request URL   ✅ same
   invalidate: by URL                     invalidate: by TAG            ⚠️ yours

   /de/incidents/incident-01-de           reads:  fine, URL-keyed
   /en/incidents/incident-01              purges: incident:incident-01
     different strings                              ↑ which language is that?
     different entries                              nothing in the framework knows
     locale-correct BY ACCIDENT
```

**Reads are fine.** Next's ISR cache is URL-keyed, so the German page and the English page are
different entries with no help from you — exactly as a Classic page cache was.

**Invalidation is keyed by tag**, and tags are strings you invented in Lesson 18.2. Nothing in
Next knows that `incident:incident-01` means the English one. So publishing a German edit either:

| If the tag ignores locale | Consequence |
|---|---|
| you purge the shared tag | all three languages regenerate — three WordPress round trips for one edit, on every publish, forever |
| you purge per-locale but the PHP builder still sends the shared string | **nothing** is purged, `/api/revalidate` returns `200`, the response lists a tag, and nothing is logged |

The second row is the failure Lesson 18.2 warned about, and it is why **this lesson changes both
codebases**. `includes/Revalidate.php` is Module 18's file and editing it here is correct: a
Next-side rename alone is worse than no change at all, because it converts a working
invalidation into a silent no-op that reports success.

The shapes are already pinned by `src/lib/graphql/tags.test.ts` (Lesson 12.2), and they are
deliberately asymmetric:

| Tag | Shape | Example |
|---|---|---|
| node | **locale infixed** | `incident:de:incident-01-de` |
| list | **locale appended** | `incidents:de` |
| term | **no locale** | `scapegoat:the-intern` |
| site, menu | no locale | `site-settings`, `menu:primary` |

The asymmetry is not an accident: a node tag's last segment is a slug, which can contain almost
anything, so the locale goes where it cannot be confused with one. A list tag has no slug, so
appending reads better. Both were pinned by a test in Module 12 **before anything produced
them**, which is what makes changing every call site in this lesson a mechanical job rather than
a negotiation.

**Terms keep no locale, and that is a decision rather than an omission.** Lesson 20.1 registered
the three taxonomies as not translatable, so a term is shared by all three languages — one
`The Intern`, attached to English and German incidents alike. A term edit therefore *should*
invalidate every locale, and `scapegoat:de:the-intern` would be a tag that nothing ever emits
and nothing ever purges: a dead string that looks like caution.

And the boundary from Lesson 20.2 still holds: **`fetchGraphQLAuthed` has no cache options**, so
there is no such thing as a locale-tagged authenticated response. The one place a locale could
have leaked a private page into a shared cache is unrepresentable.

---

## Task

### Step 1: Write `src/lib/seo/alternates.ts`

Two functions: one for a document with translations, one for a Next-owned path that exists in
every locale by construction.

```ts
// next-app/src/lib/seo/alternates.ts
// The hreflang cluster, in one place. Reciprocal because every page in the group
// runs the same function over the same group; self-inclusive because the current
// node is added back to a `translations` list that never contains it (Lesson
// 20.2 section 4).
import type { Metadata } from 'next';

import {
  availableLocales,
  localeToLanguageCode,
  type LocalisedNode,
  type TranslationLink,
} from '@/lib/i18n/locale';
import { routing, type Locale } from '@/lib/i18n/routing';

/**
 * Absolute URLs, because `alternates.languages` is a cross-origin claim: a
 * relative value would resolve against whichever host served the page, which is
 * the same reason Lesson 19.2 rewrites Yoast's canonical host.
 *
 * `metadataBase` (set once in the root layout) resolves relative canonicals, but
 * hreflang entries are the one place this project spells the origin out — a
 * cluster is only meaningful between origins that agree.
 */
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

function absolute(path: string): string {
  return `${SITE_URL}${path}`;
}

type Languages = Record<string, string>;

function withXDefault(languages: Languages, defaultUrl: string): Metadata['alternates'] {
  return {
    languages: {
      ...languages,
      // NOT a language: "use this when nothing matched". Points at the default
      // locale, and the literal key is what Next renders as hreflang="x-default".
      'x-default': defaultUrl,
    },
  };
}

/**
 * For a Next-owned path — an archive, the home page, `/hobt`. These exist in
 * every locale by construction, so the cluster needs no data: three locales plus
 * x-default is FOUR entries, which is the number Module 21's Starting State
 * asserts against `/de/incidents`.
 */
export function alternatesForPath(path: (locale: Locale) => string): Metadata['alternates'] {
  const languages: Languages = {};

  for (const locale of routing.locales) {
    languages[locale] = absolute(path(locale));
  }

  return withXDefault(languages, absolute(path(routing.defaultLocale)));
}

/**
 * For a document. A locale with no version of this document contributes NO
 * entry — so the false claim "the English page is the German version" is
 * unrepresentable rather than merely discouraged.
 *
 * `href` is the same callback shape `requireLocalisedNode()` takes in Lesson
 * 20.2, because only the route knows whether its URLs are slug-shaped or
 * uri-shaped.
 */
export function alternatesForNode(
  node: LocalisedNode,
  href: (locale: Locale, target: TranslationLink) => string
): Metadata['alternates'] {
  const byLocale = new Map<Locale, TranslationLink>();

  // The node itself FIRST — `translations` never contains it, and forgetting
  // this line is the "no return tags" error in Search Console.
  if (node.language?.code != null) {
    for (const locale of routing.locales) {
      // localeToLanguageCode, never locale.toUpperCase() — Lesson 20.2 section 5.
      if (node.language.code === localeToLanguageCode(locale)) byLocale.set(locale, node);
    }
  }

  for (const sibling of node.translations ?? []) {
    if (sibling == null) continue;

    for (const locale of routing.locales) {
      if (sibling.language?.code === localeToLanguageCode(locale)) byLocale.set(locale, sibling);
    }
  }

  const languages: Languages = {};

  for (const locale of availableLocales(node)) {
    const target = byLocale.get(locale);
    if (target !== undefined) languages[locale] = absolute(href(locale, target));
  }

  // The default locale's URL if it exists, otherwise this document's own — a
  // German-only document still needs an x-default, and pointing it at a URL that
  // does not exist is worse than pointing it at the only one that does.
  const fallback = byLocale.get(routing.defaultLocale) ?? node;

  return withXDefault(languages, absolute(href(routing.defaultLocale, fallback)));
}
```

> **Two loops, one `Map`, and the node inserted before its siblings.** The insertion order is
> not cosmetic: if a document's own language somehow also appears in `translations` — which a
> hand-edited translation group in wp-admin can produce — the sibling wins, and the sibling is
> the one WordPress currently believes in. Reaching for `locale.toUpperCase()` instead of
> `localeToLanguageCode()` here would work for all three current locales and fail on the
> fourth, which is exactly the shortcut Lesson 20.2 §5 argued against.

**Verify §1:**

- [ ] `grep -c 'toUpperCase' src/lib/seo/alternates.ts` returns `0`.
- [ ] `npm run type-check` is silent.
- [ ] A one-liner shows the shape before it renders:

```bash
npx tsx -e "import { alternatesForPath } from './src/lib/seo/alternates.ts'; console.log(alternatesForPath((l) => '/' + l + '/incidents'));"
```

- [ ] That prints four keys: `en`, `uk`, `de` and `x-default`.

### Step 2: Merge the cluster into every `generateMetadata`

Composition, not replacement — `yoastToMetadata()` (Lesson 19.2) keeps its single concern.

```tsx
// next-app/src/app/[locale]/incidents/[slug]/page.tsx — edit: generateMetadata
import type { Locale, TranslationLink } from '@/lib/i18n/locale';
import { alternatesForNode } from '@/lib/seo/alternates';
import { yoastToMetadata } from '@/lib/seo/yoastToMetadata';

const hrefForIncident = (locale: Locale, node: TranslationLink): string =>
  `/${locale}/incidents/${node.slug ?? ''}`;

// …inside generateMetadata, after the SAME fetch the page makes:
//
//   // Identical `revalidate` and `tags` to the page's fetch, or Next treats them
//   // as two different requests and WordPress is queried twice — Lesson 19.2.
//   const data = await fetchGraphQL(IncidentBySlugDocument, { slug }, options);
//
//   // generateMetadata must NOT throw on a bad slug: return something minimal
//   // and let the page call notFound(). Lesson 19.2's rule, unchanged.
//   if (data.incident == null) return { title: 'Not found' };
//
//   const meta = yoastToMetadata(data.incident, { path: `/${locale}/incidents/${slug}` });
//
//   return {
//     ...meta,
//     // meta.alternates FIRST, so the canonical Lesson 19.2 computed survives.
//     alternates: { ...meta.alternates, ...alternatesForNode(data.incident, hrefForIncident) },
//   };
```

Archives take the other function, and need no data at all:

```tsx
// next-app/src/app/[locale]/incidents/page.tsx — edit: generateMetadata
import { alternatesForPath } from '@/lib/seo/alternates';

// …inside generateMetadata:
//   // FOUR entries, from routing.locales plus x-default. This is the exact
//   // number Module 21's Starting State curls for.
//   alternates: alternatesForPath((target) => `/${target}/incidents`),
```

Every route, and which function it takes:

| Route | Function | Entries |
|---|---|---|
| `[locale]/page.tsx` | `alternatesForPath((l) => \`/${l}\`)` | 4 |
| `[locale]/incidents/page.tsx`, `blog`, `reviews`, `scapegoats`, `hobt` | `alternatesForPath` | 4 |
| `[locale]/incidents/[slug]`, `blog/[slug]`, `reviews/[slug]` | `alternatesForNode` | 2, 3 or 4 |
| `[locale]/[...slug]` | `alternatesForNode` with `localePathForUri` | 2, 3 or 4 |
| `[locale]/login`, `account`, `incidents/submit` | **none** — `robots: { index: false }` already | 0 |

Then delete the private channel Lesson 20.3 used and point the switcher at the real one:

```tsx
// next-app/src/app/[locale]/incidents/[slug]/page.tsx — edit: DELETE this line
//   other: { 'btt:alternates': availableLocales(incident).join(' ') },
// The hreflang cluster now carries the same claim in the standard form. Two
// mechanisms making one claim is how they drift; delete the private one.
```

```tsx
// next-app/src/components/layout/LocaleSwitcher.tsx — edit: the effect's selector
//   const listed = Array.from(
//     document.querySelectorAll<HTMLLinkElement>('link[rel="alternate"][hreflang]')
//   )
//     .map((link) => link.hreflang)
//     // x-default is not a locale, and routing.locales filters it out anyway.
//     .filter((code) => code !== 'x-default');
//
//   if (listed.length === 0) return;
//   setAvailable(routing.locales.filter((locale) => listed.includes(locale)));
```

**Verify §2:**

- [ ] `curl -s http://localhost:3000/de/incidents | grep -c 'rel="alternate"'` returns **4**.
- [ ] `curl -s http://localhost:3000/en/incidents/incident-40 | grep -c 'rel="alternate"'`
      returns **2** — `en` and `x-default`, and no `de`.
- [ ] `grep -rn 'btt:alternates' src/` returns no output.
- [ ] `curl -s http://localhost:3000/de/incidents/incident-01-de | grep -o 'rel="canonical" href="[^"]*"'`
      shows the German URL on `NEXT_PUBLIC_SITE_URL`'s host — the Yoast mapper's canonical
      survived the spread.

### Step 3: Extend the sitemap to every locale

`src/app/sitemap.ts` is Lesson 19.4's file. It exports one default async function returning
`MetadataRoute.Sitemap` and today emits `en` URLs only, with a comment saying this lesson
extends it. **Extend the entry builders; do not rewrite the file.**

```ts
// next-app/src/app/sitemap.ts — edit: the locale loop and per-entry alternates
import type { MetadataRoute } from 'next';

import { routing } from '@/lib/i18n/routing';
import { localeToLanguageCode } from '@/lib/i18n/locale';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * A Next-owned path, in every locale, each entry declaring the whole cluster.
 *
 * `alternates.languages` here is the SITEMAP's channel for the same claim the
 * <head> makes — it renders as xhtml:link inside each <url>. Two channels, one
 * function producing both, which is the only way they stay in agreement.
 */
function staticEntries(path: string, lastModified: Date): MetadataRoute.Sitemap {
  const languages = Object.fromEntries(
    routing.locales.map((locale) => [locale, `${SITE_URL}/${locale}${path}`])
  );

  return routing.locales.map((locale) => ({
    url: `${SITE_URL}/${locale}${path}`,
    lastModified,
    alternates: { languages },
  }));
}

// …and for content, one query per locale rather than one query:
//
//   const perLocale = await Promise.all(
//     routing.locales.map((locale) =>
//       fetchGraphQL(
//         IncidentSlugsDocument,
//         { first: 100, language: localeToLanguageCode(locale) },
//         { revalidate: 3600, tags: [listTag('incident', locale)] }
//       ).then((data) => ({ locale, nodes: data.incidents?.nodes ?? [] }))
//     )
//   );
//
// `lastModified` stays PER TRANSLATION: a German edit moves the German entry and
// leaves the English one alone, because translations are separate posts with
// separate `modified` dates.
```

**Verify §3:**

- [ ] `curl -s http://localhost:3000/sitemap.xml | grep -c '<loc>'` is roughly three times what
      Lesson 19.4 produced.
- [ ] `curl -s http://localhost:3000/sitemap.xml | grep -c 'hreflang="uk"'` is greater than `0`.
- [ ] `curl -s -o /dev/null -w '%{content_type}\n' http://localhost:3000/sitemap.xml` is still
      `application/xml`. Module 20's Starting State asserts that, and it is the check that
      catches a thrown error rendering as an HTML error page.

### Step 4: Pass the locale to every tag — and notice what `tags.ts` needs

`src/lib/graphql/tags.ts` needs **no functional change at all**, and that is the payoff of a
decision made ten modules ago. Lesson 10.3 gave every builder a trailing optional `locale`
parameter and wrote "the cheapest insurance in the course is a parameter"; Lesson 12.2 pinned
the exact output shapes — `incident:de:incident-01` and `incidents:en` — before a single call
site produced them. So the only edit to the file is two comments that stopped being true:

```ts
// next-app/src/lib/graphql/tags.ts — edit: two stale comments
/** `type[:locale]:slug`. The locale segment is passed by every read from Lesson 20.4. */
function nodeTag(type: ContentType, slug: string, locale: string | undefined): string {

/**
 * A slug is editorial input, so normalise it rather than trusting it. No ASCII
 * allowlist: WordPress slugs may be non-Latin, and Lesson 20.1 seeded Cyrillic
 * ones. The only forbidden character is the separator itself.
 *
 * The PHP half of this contract (includes/Revalidate.php) must use
 * mb_strtolower() — plain strtolower() leaves Cyrillic untouched, and the two
 * codebases would then disagree about `Відмова-01`.
 */
```

Now every read passes the locale. Two representative call sites:

```tsx
// next-app/src/app/[locale]/incidents/[slug]/page.tsx — edit: the tags
//   const options = {
//     revalidate: 3600,
//     tags: [incidentTag(slug, locale), listTag('incident', locale)],
//   };
//
//   // generateMetadata uses the SAME options object. Different tags would make
//   // it a different cache entry and query WordPress twice.
```

```tsx
// next-app/src/app/[locale]/incidents/page.tsx — edit: the tags
//   { revalidate: 300, tags: [listTag('incident', locale)] }
```

| Read | Tags before | Tags after |
|---|---|---|
| `/[locale]/incidents` | `incidents` | `incidents:<locale>` |
| `/[locale]/incidents/[slug]` | `incident:<slug>`, `incidents` | `incident:<locale>:<slug>`, `incidents:<locale>` |
| `/[locale]/blog`, `blog/[slug]` | `posts`, `post:<slug>` | the same, locale-scoped |
| `/[locale]/reviews`, `reviews/[slug]` | `reviews`, `review:<slug>` | the same, locale-scoped |
| `/[locale]/[...slug]`, `/[locale]/hobt` | `page:<name>`, `pages` | `page:<locale>:<name>`, `pages:<locale>` |
| `/[locale]/scapegoats` | `scapegoats`, `incidents` | `scapegoats`, `incidents:<locale>` |
| root layout — `SiteChrome`, `PrimaryMenu` | `site-settings`, `menu:primary` | **unchanged** — no locale |
| term tags anywhere | `scapegoat:<slug>` | **unchanged** — Key Concept 9 |

Then extend the test file with the shapes that were not pinned yet. `tags.test.ts` is Lesson
12.2's; this is an append, and the existing assertions must stay exactly as they are:

```ts
// next-app/src/lib/graphql/tags.test.ts — append
describe('locale-scoped tags (Lesson 20.4)', () => {
  it('infixes the locale on every node tag, not just incidents', () => {
    expect(incidentTag('incident-01-de', 'de')).toBe('incident:de:incident-01-de');
    expect(postTag('blog-01-de', 'de')).toBe('post:de:blog-01-de');
    expect(reviewTag('review-01', 'en')).toBe('review:en:review-01');
    expect(pageTag('hobt-de', 'de')).toBe('page:de:hobt-de');
  });

  it('appends the locale on every list tag', () => {
    expect(listTag('incident', 'de')).toBe('incidents:de');
    expect(listTag('post', 'uk')).toBe('posts:uk');
    expect(listTag('page', 'de')).toBe('pages:de');
  });

  it('lowercases a Cyrillic slug, which is where PHP and JS most easily disagree', () => {
    // strtolower() in PHP would leave this unchanged; mb_strtolower() matches.
    expect(incidentTag('Відмова-01', 'uk')).toBe('incident:uk:відмова-01');
  });

  it('keeps term, site and menu tags locale-FREE', () => {
    // Taxonomies are not translatable (Lesson 20.1), so one term is shared by
    // all three languages and a term edit SHOULD invalidate all of them.
    // `termTag` has no locale parameter, which makes the wrong thing unwritable.
    expect(termTag('scapegoat', 'the-intern')).toBe('scapegoat:the-intern');
    expect(siteTag()).toBe('site-settings');
    expect(menuTag('primary')).toBe('menu:primary');
  });
});
```

**Verify §4:**

- [ ] `npm test -- --run src/lib/graphql/tags.test.ts` passes, including every pre-existing
      assertion. If `incidentTag('incident-01', 'de')` now fails, you changed the infix.
- [ ] `grep -rnE "(incidentTag|postTag|reviewTag|pageTag)\('[^']+'\)" src/app/ src/components/`
      returns no output — no node tag is built without a locale any more.
- [ ] `npm run type-check` is silent.

### Step 5: Teach the PHP builder the same shapes, in this lesson

`includes/Revalidate.php` is Lesson 18.3's file. Editing it here is correct and the reason is
Key Concept 9: a Next-side rename alone converts working invalidation into a silent no-op that
returns `200`. Both halves move together or neither does.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Revalidate.php
// Add these three methods to the class Lesson 18.3 wrote, and route its payload
// builder through the first two. This file is the PHP half of the contract in
// next-app/src/lib/graphql/tags.ts, and Verification compares them string by
// string.

	/**
	 * `type[:locale]:slug` — the locale is INFIXED. Matches nodeTag() in tags.ts.
	 *
	 * @throws \InvalidArgumentException When a segment cannot produce a valid tag.
	 */
	public static function node_tag( string $type, string $slug, ?string $locale = null ): string {
		$parts = null === $locale
			? array( $type, $slug )
			: array( $type, $locale, $slug );

		return implode( ':', array_map( array( self::class, 'segment' ), $parts ) );
	}

	/**
	 * `plural[:locale]` — the locale is APPENDED. Matches listTag() in tags.ts.
	 *
	 * The map is spelled out rather than derived: `tech_review` becomes `reviews`,
	 * not `tech_reviews`, and no pluralisation rule would have guessed that.
	 */
	public static function list_tag( string $type, ?string $locale = null ): string {
		$plural = array(
			'incident'    => 'incidents',
			'post'        => 'posts',
			'tech_review' => 'reviews',
			'page'        => 'pages',
		);

		if ( ! isset( $plural[ $type ] ) ) {
			throw new \InvalidArgumentException( sprintf( 'No list tag for post type %s.', $type ) );
		}

		return null === $locale
			? $plural[ $type ]
			: $plural[ $type ] . ':' . self::segment( $locale );
	}

	/**
	 * The PHP twin of segment() in tags.ts, with the same two rejections.
	 *
	 * mb_strtolower(), NOT strtolower(): plain strtolower() is byte-wise and
	 * leaves `Відмова-01` untouched, while JavaScript's toLowerCase() is
	 * Unicode-aware. That single difference is enough to make every Ukrainian
	 * invalidation a silent no-op, and it is the reason Verification compares the
	 * two implementations on a mixed-case Cyrillic slug rather than on `dns`.
	 */
	private static function segment( string $value ): string {
		$value = mb_strtolower( trim( $value ), 'UTF-8' );

		if ( '' === $value ) {
			throw new \InvalidArgumentException( 'cache tag: empty slug — nothing to tag.' );
		}

		if ( false !== strpos( $value, ':' ) ) {
			throw new \InvalidArgumentException(
				sprintf( 'cache tag: slug "%s" contains ":", which is the separator.', $value )
			);
		}

		return $value;
	}
```

The payload already carries `locale` — Lesson 18.3 put it there, parsed it, and said this is
where it starts mattering. Two things change in the hook:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Revalidate.php — edit
	// The post's OWN language, from Polylang. Not the site default, and not the
	// language of whoever pressed Publish.
	$locale = function_exists( 'pll_get_post_language' )
		? pll_get_post_language( $post_id )
		: null;

	// pll_get_post_language() returns false for a post with no language — an
	// attachment, or content created before Lesson 20.1 ran. `null` then means
	// "no locale segment", which produces the shared tag, which is the correct
	// conservative answer for something outside the translation model.
	$locale = ( is_string( $locale ) && '' !== $locale ) ? $locale : null;
```

And the term branch keeps the shared form **plus** the ID-keyed tag Lesson 18.3 added:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Revalidate.php — edit
	// Terms are NOT translated (Lesson 20.1), so a term tag carries no locale and
	// one edit correctly invalidates all three languages. Keep both forms Lesson
	// 18.3 emits — the slug-keyed tag and the id-keyed one.
```

**Verify §5:**

- [ ] `docker compose exec wordpress php -l /var/www/html/wp-content/plugins/blame-the-tech-core/includes/Revalidate.php`
      prints `No syntax errors detected`.
- [ ] `docker compose run --rm -T wpcli wp eval 'echo Blame\Core\Revalidate::node_tag("incident","incident-01-de","de");'`
      prints `incident:de:incident-01-de`.
- [ ] `docker compose run --rm -T wpcli wp eval 'echo Blame\Core\Revalidate::list_tag("tech_review","de");'`
      prints `reviews:de` — **not** `tech_reviews:de`.
- [ ] `grep -c 'strtolower' includes/Revalidate.php` matches only `mb_strtolower`. A bare
      `strtolower` is the bug this whole step exists to prevent.

### Step 6: The untranslated-content notice

The affordance for `?from=<locale>`. It ships as a second export from `LocaleSwitcher.tsx`:
both are locale chrome, both are client-side for the same reason, and a second `'use client'`
module for eleven lines would be worse.

```tsx
// next-app/src/components/layout/LocaleSwitcher.tsx — append
/**
 * The visible half of the untranslated-content policy (Lesson 20.2 section 8).
 *
 * Reads `?from=` with useSearchParams, so the surrounding page needs no
 * `searchParams` prop and stays statically renderable — a Client Component
 * reading the query does not make its parent dynamic. It DOES need a Suspense
 * boundary during static rendering, which the layout provides.
 */
export function UntranslatedNotice({
  labels,
}: {
  /** Locale code → "Not available in Deutsch — showing English", resolved on the server. */
  readonly labels: Readonly<Record<string, string>>;
}) {
  const searchParams = useSearchParams();
  const [dismissed, setDismissed] = useState(false);

  const from = searchParams.get('from');
  const message = from === null ? undefined : labels[from];

  if (message === undefined || dismissed) return null;

  return (
    <div
      // `status`, not `alert`: this is advisory, and `alert` interrupts a screen
      // reader mid-sentence. Lesson 11.4's rule, and Lesson 20.4 adds the row to
      // docs/accessibility.md for it.
      role="status"
      className="mx-auto mb-4 flex max-w-6xl items-center justify-between gap-4 rounded-md border border-border bg-muted px-4 py-2 text-sm"
    >
      <p>{message}</p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="rounded-md px-2 py-1 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {labels['dismiss'] ?? 'Dismiss'}
      </button>
    </div>
  );
}
```

Mount it in the root layout, inside a Suspense boundary, above `{children}`:

```tsx
// next-app/src/app/[locale]/layout.tsx — edit: inside <main>, above {children}
//   <Suspense fallback={null}>
//     <UntranslatedNotice labels={noticeLabels} />
//   </Suspense>
//
// `fallback={null}` is correct here and would be wrong for the switcher: the
// notice is absent on almost every request, so reserving space for it would
// introduce the layout shift Module 21 measures.
```

The strings go in the catalogues under `common`, one per locale plus the dismiss label:
`"notAvailable": "Not available in {language} — showing English"`, interpolated in the layout
with `getTranslations` so the notice receives finished strings.

**Verify §6:**

- [ ] `curl -s 'http://localhost:3000/en/incidents/incident-40?from=de' | grep -c 'role="status"'`
      returns `1`.
- [ ] The same URL without `?from=de` returns `0`.
- [ ] `grep -c "'use client'" src/components/layout/LocaleSwitcher.tsx` still returns `1`.

### Step 7: The RTL and block-string sweeps, then widen the lint rule

```bash
cd next-app

# Every physical property in the component tree. Each hit is a one-word fix.
grep -rnE 'ml-|mr-|pl-|pr-|left-|right-|text-left|text-right|border-l|border-r' src/components/ src/app/
```

| Replace | With |
|---|---|
| `ml-*`, `mr-*` | `ms-*`, `me-*` |
| `pl-*`, `pr-*` | `ps-*`, `pe-*` |
| `left-*`, `right-*` | `start-*`, `end-*` |
| `text-left`, `text-right` | `text-start`, `text-end` |
| `border-l`, `border-r` | `border-s`, `border-e` |

`src/components/ui/` is exempt — it is generated by the shadcn CLI and regenerating a component
would revert your edits. Record that as a known gap rather than fighting the generator.

Then check it by forcing the direction, in the browser console on `/de/incidents`:

```
document.documentElement.dir = 'rtl'
```

Read down the page: the nav should mirror, the severity badges should sit on the other side of
each card, and the skip link should appear top-right. Anything that stayed put is a physical
property the grep missed — usually inside an inline `style` or a transform, which is exactly the
category Key Concept 7 says RTL support does **not** come free.

Now sweep `src/components/blocks/` for hard-coded English, and widen the rule so the next one
fails a build:

```bash
# Scoped so it means something: a JSX text node opening with a capitalised word.
grep -rnE '>[A-Z][a-z]+ ' src/components/blocks/
```

That pattern finds `<h3>Related incidents` and misses three real cases, which is worth knowing
before you trust it: a string in a prop (`aria-label="Read more"`), a lowercase opener
(`>and then`), and anything interpolated (`{'Read more'}`). The lint rule catches the third; the
first is Module 22.1's audit surface; the second you find by reading.

```js
// next-app/eslint.config.mjs — edit: widen the Lesson 20.3 block
  {
    // Lesson 20.4: all components now, because blocks/ has been swept too.
    files: ['src/components/**/*.tsx'],
    // Generated by the shadcn CLI (Lesson 11.2). A lint rule that fights a code
    // generator loses, and re-running the CLI would revert the fixes anyway.
    ignores: ['src/components/ui/**'],
    rules: {
      'react/jsx-no-literals': [
        'error',
        { noStrings: true, ignoreProps: true, allowedStrings: [' ', '·', '—', '/', ':'] },
      ],
    },
  },
```

**Verify §7:**

- [ ] `grep -rnE 'margin-left|padding-right|text-align: *left' src/components/` is empty.
- [ ] `grep -rnE '\b(ml|mr|pl|pr)-[0-9]' src/components/layout/ src/components/incidents/ src/components/hobt/ src/components/blocks/`
      is empty. Hits in `src/components/ui/` are the documented exemption.
- [ ] `npm run lint` is clean with the widened glob.
- [ ] `E2E_MODE=1 npx playwright test --project=smoke` still passes. The sweep changed classes
      and strings, not roles or accessible names.

### Step 8: Write the last two documents

Append to `docs/architecture.md`, under the `## Localisation (Module 20)` heading Lesson 20.2
created:

```markdown
**hreflang.** Built by `src/lib/seo/alternates.ts`, composed onto — never folded into —
`yoastToMetadata()`. Clusters are reciprocal and self-inclusive, with `x-default` pointing at
the `en` URL. Entry counts: a Next-owned path emits 4 (three locales + `x-default`); a document
emits one per locale it exists in, plus `x-default`. A locale with no translation contributes no
entry, so no page ever advertises an alternate that is really another language.

**Cache tags are locale-scoped.** Node tags infix the locale (`incident:de:incident-01-de`);
list tags append it (`incidents:de`); term, site and menu tags carry none, because taxonomies
are not translatable in this project and one term is shared by all three languages. The strings
are built by `src/lib/graphql/tags.ts` and reproduced by `Blame\Core\Revalidate` in PHP. The PHP
side uses `mb_strtolower()`; `strtolower()` would leave Cyrillic slugs uppercase and every
Ukrainian invalidation would silently do nothing.

**RTL.** No locale in this project is RTL. `dir` is on `<html>` and components use logical CSS
properties, so adding one is a configuration change for layout — but not for direction-encoding
icons, transforms, or `src/components/ui/`, which is generated.
```

And one row to `docs/accessibility.md` — Lesson 11.4 created it with the standing rule that
every lesson adding an `aria-*` attribute or a language affordance adds a row:

```markdown
| `<html lang>` / `<html dir>` | root layout | `lang` from the `[locale]` segment since Lesson 09.1, `dir` from `dirOf(locale)` since Lesson 20.3. A screen reader switches voice on `lang`; without it, German is read with English phonetics. |
| `role="status"` on the untranslated notice | `UntranslatedNotice` | Advisory, not `alert`: it must not interrupt. |
| Locale switcher | `LocaleSwitcher` | `nav` with an accessible name, current locale marked `aria-current="true"`, unavailable locales rendered as **disabled** buttons with a reason in the accessible name rather than hidden. |
| Known gap: `global-error.tsx` | outside `[locale]` | Its strings are hard-coded English, because there is no request locale outside the segment. |
| Known gap: `alt` text | media | Media is shared across languages (Lesson 20.1), so `alt` text is English in every locale. |
```

**Verify §8:**

- [ ] Both documents contain the new sections, and neither was created by this lesson — Lesson
      11.4 and Lesson 01.2 own those files.
- [ ] `git status --short docs/` shows two modified files, not two new ones.
- [ ] `docs/accessibility.md` still has the table header Lesson 11.4 wrote. You appended rows to
      an existing table rather than starting a second one.

---

## Verification

```bash
cd next-app

# 1. THE NUMBER MODULE 21 ASSERTS. en, uk, de and x-default.
curl -s http://localhost:3000/de/incidents | grep -c 'rel="alternate"'
# Expected: 4

# 2. …and they are the right four
curl -s http://localhost:3000/de/incidents | grep -o 'hreflang="[a-z-]*"' | sort
# Expected: hreflang="de", hreflang="en", hreflang="uk", hreflang="x-default"

# 3. A node translated into all three locales gives 4; one translated into two
#    gives 3. Both are correct, and the difference is data rather than code.
curl -s http://localhost:3000/de/incidents/incident-01-de | grep -c 'rel="alternate"'
# Expected: 4
curl -s http://localhost:3000/de/incidents/incident-06-de | grep -c 'rel="alternate"'
# Expected: 3  — en, de, x-default. incident-06 has no Ukrainian translation.

# 4. NEGATIVE — a page with no German version advertises NO `de` alternate.
#    Pointing hreflang="de" at an English URL claims the English page IS the
#    German version, which is the lie this whole lesson exists to avoid.
curl -s http://localhost:3000/en/incidents/incident-40 | grep -c 'hreflang="de"'
# Expected: 0
curl -s http://localhost:3000/en/incidents/incident-40 | grep -c 'rel="alternate"'
# Expected: 2  — en and x-default, which is what the locale switcher reads

# 5. The cluster is RECIPROCAL and SELF-INCLUSIVE. Fetch the German page, pull the
#    `en` alternate out of it, fetch THAT, and confirm it points back — and at
#    itself.
EN_URL=$(curl -s http://localhost:3000/de/incidents/incident-01-de \
  | grep -o 'hreflang="en" href="[^"]*"' | sed 's/.*href="//;s/"//')
echo "$EN_URL"
# Expected: http://localhost:3000/en/incidents/incident-01

curl -s "$EN_URL" | grep -o 'hreflang="[a-z-]*" href="[^"]*"' | sort
# Expected: four lines — de → incident-01-de, en → THIS url (self-inclusive),
#           uk → відмова-01, x-default → THIS url.
#           A missing `en` line is the "no return tags" error.

# 6. The sitemap now covers every locale, with per-entry alternates
curl -s http://localhost:3000/sitemap.xml | grep -c '<loc>'
# Expected: roughly three times the Lesson 19.4 number
for l in en uk de; do
  echo "$l $(curl -s http://localhost:3000/sitemap.xml | grep -c "/$l/")"
done
# Expected: three non-zero counts
curl -s -o /dev/null -w '%{content_type}\n' http://localhost:3000/sitemap.xml
# Expected: application/xml — still XML, not an HTML error page

# 7. THE TWO-CODEBASE CONTRACT. The best single check in Module 20: the same four
#    tags, built independently in TypeScript and in PHP, compared byte for byte.
#    The Cyrillic mixed-case slug is deliberate — mb_strtolower() matches
#    JavaScript's toLowerCase(), and plain strtolower() does not.
npx tsx -e "
import { incidentTag, listTag, pageTag } from './src/lib/graphql/tags.ts';
console.log(incidentTag('incident-01-de', 'de'));
console.log(listTag('incident', 'de'));
console.log(pageTag('hobt-de', 'de'));
console.log(incidentTag('Відмова-01', 'uk'));
" > /tmp/btt-tags-ts.txt

cd ../wordpress-headless
docker compose run --rm -T wpcli wp eval '
echo Blame\Core\Revalidate::node_tag("incident","incident-01-de","de"), PHP_EOL;
echo Blame\Core\Revalidate::list_tag("incident","de"), PHP_EOL;
echo Blame\Core\Revalidate::node_tag("page","hobt-de","de"), PHP_EOL;
echo Blame\Core\Revalidate::node_tag("incident","Відмова-01","uk"), PHP_EOL;
' > /tmp/btt-tags-php.txt

diff /tmp/btt-tags-ts.txt /tmp/btt-tags-php.txt && echo IDENTICAL
# Expected: IDENTICAL, and the four lines are
#           incident:de:incident-01-de
#           incidents:de
#           page:de:hobt-de
#           incident:uk:відмова-01

# 8. NEGATIVE — no bare strtolower() survived in the PHP builder
grep -n 'strtolower' wp-content/plugins/blame-the-tech-core/includes/Revalidate.php
# Expected: only mb_strtolower lines. A bare strtolower() makes check 7's fourth
#           line differ by four bytes and every Ukrainian purge a no-op.

# 9. THE HEADLINE CLAIM. Publishing a German edit does not purge the English page.
#    Warm both entries first, so there is something to purge.
cd ../next-app
curl -s -o /dev/null http://localhost:3000/en/incidents/incident-01
curl -s -o /dev/null http://localhost:3000/de/incidents/incident-01-de
EN_BEFORE=$(curl -s http://localhost:3000/en/incidents/incident-01 | grep -o '<h1[^>]*>[^<]*')
echo "$EN_BEFORE"
# Expected: the English title — "Deployed on a Friday (#1)"

cd ../wordpress-headless
DE_ID=$(docker compose run --rm -T wpcli wp eval 'echo get_page_by_path("incident-01-de", OBJECT, "incident")->ID;')
docker compose run --rm -T wpcli wp post update "$DE_ID" --post_title='Am Freitag deployt — geändert (#1)'
# Expected: Success: Updated post <id>.

sleep 3   # wp_remote_post is non-blocking (blocking => false, Lesson 18.3)

curl -s http://localhost:3000/de/incidents/incident-01-de | grep -c 'geändert'
# Expected: 1 — the German page regenerated
curl -s http://localhost:3000/en/incidents/incident-01 | grep -o '<h1[^>]*>[^<]*'
# Expected: BYTE-IDENTICAL to $EN_BEFORE. The English entry was never tagged
#           `incident:de:incident-01-de`, so nothing invalidated it. Before this
#           lesson both languages shared `incident:incident-01` and this line
#           would have shown a regenerated page.

# Put the fixture back.
docker compose run --rm -T wpcli wp post update "$DE_ID" --post_title='Am Freitag deployt (#1)'

# 10. NEGATIVE — no node tag is built without a locale any more
cd ../next-app
grep -rnE "(incidentTag|postTag|reviewTag|pageTag)\('[^']+'\)" src/app/ src/components/
# Expected: no output

# 11. NEGATIVE — and term, site and menu tags still carry none
grep -rn "termTag(" src/app/ src/components/ | grep -c "locale"
# Expected: 0. Taxonomies are not translatable (Lesson 20.1), so one term is
#           shared by three languages and a term edit SHOULD purge all of them.

# 12. NEGATIVE — tags.test.ts is still green, including the assertions Lesson
#     12.2 wrote before anything produced these strings
npm test -- --run src/lib/graphql/tags.test.ts
# Expected: all green. `incidentTag('incident-01', 'de')` is still
#           `incident:de:incident-01` — the infix did not move.

# 13. NEGATIVE — fetchGraphQLAuthed still has no cache options, so a
#     locale-tagged authenticated response remains unrepresentable
grep -n 'export function fetchGraphQLAuthed' -A 6 src/lib/graphql/client.ts
# Expected: three parameters — document, variables, credential. No options
#           parameter, and `cache: 'no-store'` hard-coded in the body.

# 14. NEGATIVE — no physical CSS properties left in the components you own
grep -rnE 'margin-left|margin-right|padding-left|padding-right|text-align: *(left|right)' src/components/
# Expected: no output
grep -rnE '\b(ml|mr|pl|pr)-[0-9]' src/components/layout/ src/components/incidents/ src/components/hobt/ src/components/blocks/
# Expected: no output. Hits under src/components/ui/ are the documented exemption.

# 15. NEGATIVE — no hard-coded English left in the block components
grep -rnE '>[A-Z][a-z]+ ' src/components/blocks/
# Expected: no output. Note what this pattern does NOT catch: a string in a prop
#           (aria-label="Read more"), a lowercase opener (>and then), and anything
#           interpolated ({'Read more'}). The lint rule below catches the third.

# 16. The untranslated notice appears only when it was asked for
curl -s 'http://localhost:3000/en/incidents/incident-40?from=de' | grep -c 'role="status"'
# Expected: 1
curl -s 'http://localhost:3000/en/incidents/incident-40' | grep -c 'role="status"'
# Expected: 0

# 17. Everything still builds, types, lints and passes
npm run type-check && npm run lint
# Expected: silent, then no errors and no warnings
npm test -- --run
# Expected: all green
E2E_MODE=1 npx playwright test --project=smoke
# Expected: all pass
npm run build
# Expected: completes, and the sitemap route is listed

rm -f /tmp/btt-tags-ts.txt /tmp/btt-tags-php.txt
```

## Control Questions

1. `/de/incidents` emits four `rel="alternate"` links and
   `/en/incidents/incident-40` emits two. Explain both numbers, and say which one Module 21's
   Starting State asserts and why that is the easier of the two to get right.
2. `translations` returns siblings only. Describe precisely what `alternatesForNode` does about
   that, what Search Console reports if you skip it, and how long it typically takes to find out.
3. Next's ISR cache and a Classic WordPress page cache are both keyed by URL, yet only the
   headless build has a locale-caching bug. Name the operation where the two differ, and explain
   why a naming convention is a complete fix.
4. This lesson edits `includes/Revalidate.php`, which Module 18 created. Give the specific
   failure that would occur if the Next-side tag rename shipped in this lesson and the PHP change
   shipped in the next one, and say what the webhook would return while it was happening.
5. `termTag` still has no `locale` parameter. Justify that in terms of Lesson 20.1's taxonomy
   decision, and describe the bug you would introduce by adding one.

## Learn More

- [Google Search Central — managing multi-regional and multilingual sites](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites)
  — the source for reciprocity, self-inclusion and `x-default`; read the "common mistakes"
  section against your own output
- [Google Search Central — `hreflang` implementation](https://developers.google.com/search/docs/specialty/international/localized-versions)
  — the three ways to declare a cluster (`<head>`, HTTP header, sitemap) and the rule that they
  must not disagree, which is why Lesson 20.3 turned next-intl's header off
- [Next.js — `alternates` in the Metadata API](https://nextjs.org/docs/app/api-reference/functions/generate-metadata#alternates)
  — the exact object shape, including that `languages` keys are rendered verbatim so
  `'x-default'` works
- [Next.js — `sitemap.ts` with alternates](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap)
  — the `alternates.languages` field on a sitemap entry and the `xhtml:link` markup it produces
- [Next.js — `revalidateTag`](https://nextjs.org/docs/app/api-reference/functions/revalidateTag)
  — worth re-reading now that the tags carry a locale: nothing in the API validates a tag string,
  which is the whole reason this lesson exists
- [MDN — CSS logical properties](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_logical_properties_and_values)
  — the full physical-to-logical mapping, and the properties that have no logical equivalent
- [Tailwind CSS — RTL support](https://tailwindcss.com/docs/hover-focus-and-other-states#rtl-support)
  — the `ms-*`/`me-*`/`ps-*`/`pe-*` utilities and the `rtl:` variant for the cases logical
  properties cannot express
- [PHP — `mb_strtolower`](https://www.php.net/manual/en/function.mb-strtolower.php) — and read
  `strtolower` immediately afterwards. The difference between those two pages is the difference
  between a working Ukrainian purge and a silent one
- [W3C — Structural markup and right-to-left text in HTML](https://www.w3.org/International/questions/qa-html-dir)
  — what `dir` on `<html>` actually changes, and why `dir="auto"` belongs on user-generated text
  rather than on a document
