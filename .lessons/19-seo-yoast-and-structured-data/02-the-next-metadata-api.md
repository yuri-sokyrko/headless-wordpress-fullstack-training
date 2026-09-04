---
title: 'The Next.js Metadata API'
module: 19
lesson: 2
teaches: [next-metadata-api, generate-metadata, metadata-base, opengraph-image, metadata-fallbacks]
produces: ['next-app/src/lib/seo/yoastToMetadata.ts', 'next-app/src/app/opengraph-image.tsx']
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
- `src/app/opengraph-image.tsx` — a generated social card, plus the rule for when the editor's
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
