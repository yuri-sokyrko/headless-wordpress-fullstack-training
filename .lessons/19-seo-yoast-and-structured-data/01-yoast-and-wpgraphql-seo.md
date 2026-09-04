---
title: 'Yoast & WPGraphQL SEO'
module: 19
lesson: 1
teaches: [yoast-seo, wp-graphql-yoast-seo, graphql-fragments, editor-owned-metadata]
produces: ['next-app/src/graphql/fragments/Seo.graphql', 'wordpress-headless/schema.graphql']
requires: [10.2, 18.4]
---

# Lesson 19.1 — Yoast & WPGraphQL SEO

## Quick Overview

Yoast SEO is probably the plugin you have installed more times than any other, and in a
Classic build you never think about how its output reaches the page — `wp_head()` fires, Yoast
hooks it, and the `<head>` fills up. In a headless build that hook has no page to fill. The
plugin is still the right place for the data, because it is where the content team already
works and where the readability and snippet-preview tooling lives, but the data now has to
travel over GraphQL like everything else. `wp-graphql-yoast-seo` is the bridge: install it and
every content node in the schema grows an `seo` field carrying title, meta description,
canonical, the robots directives, the OpenGraph and Twitter sets, and a breadcrumb trail.

That field is large, and you will want it on incidents, reviews, posts, pages, scapegoat terms
and the front page — six or more queries. So you write it **once** as a GraphQL fragment and
spread it into every document. This lesson is where that fragment gets designed: which fields
you actually consume, which ones you deliberately ignore (Yoast's `schema.raw` is the big one
— Lesson 19.3 explains why you build JSON-LD yourself instead), and how to refresh
`schema.graphql` and regenerate types so the fragment is type-checked rather than hopeful.

By the end of this lesson you will have:

- Yoast SEO and `wp-graphql-yoast-seo` installed, pinned and activated in the WordPress stack
- Yoast's own front-end output (its sitemap and `wp_head` injection) configured for a headless
  site, so it is not competing with Next.js
- `next-app/src/graphql/fragments/Seo.graphql` — one fragment, spread into every content query
- A refreshed committed `wordpress-headless/schema.graphql` and regenerated `src/gql/` types
- A GraphiQL query that returns real `seo` values for a seeded incident, proving the editor's
  sidebar input is reachable from the front end

## Classic WP Analogy

| Classic WordPress | Headless with WPGraphQL Yoast SEO |
|---|---|
| `wp_head()` in `header.php` | Nothing. There is no PHP-rendered `<head>` to hook. |
| Yoast hooks `wp_head` and prints tags | Yoast stores the same data in post meta; the plugin exposes it as `seo { ... }` |
| `WPSEO_Frontend::get_title()` | `seo.title` on the content node |
| Yoast's XML sitemap at `/sitemap_index.xml` | Still generated, but on the wrong host — Lesson 19.4 decides what to do about it |
| The Yoast sidebar in the editor | **Unchanged.** This is the whole point. |

The analogy holds unusually well right up to one detail, and that detail matters: **in Classic
WordPress, Yoast renders the tags itself, so its output is authoritative. Here, Yoast only
supplies values — your code decides what becomes a tag.** Every transformation, every
fallback, every "the editor left this blank so use the excerpt" rule is now yours to write and
yours to get wrong. A Classic site with a blank Yoast description still emits a sensible
description because Yoast has internal templates; a headless site emits nothing at all unless
you wrote the fallback.

The second place it breaks is variables. Yoast's title templates (`%%title%% %%sep%%
%%sitename%%`) are resolved server-side, and `wp-graphql-yoast-seo` returns the **resolved**
string — which is good — but only for values Yoast itself computed. Anything Yoast would have
computed at render time from the current request (a paginated archive's "Page 2 of 7", for
instance) does not exist, because there is no request. Archive and pagination titles are yours
to build, and Lesson 19.2 does exactly that.

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
