---
title: 'i18n SEO & Edge Cases'
module: 20
lesson: 4
teaches: [hreflang, x-default, per-locale-sitemap, rtl-readiness, locale-cache-tags, untranslated-content-ux]
produces: ['next-app/src/lib/seo/alternates.ts', 'next-app/src/app/sitemap.ts', 'next-app/src/lib/graphql/tags.ts']
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
