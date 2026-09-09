# Module 19 — SEO: Yoast, Metadata & Structured Data

## Prerequisites

Before starting this module you should have completed:

- **Module 10** — the typed data layer, because every SEO field arrives through a codegen'd fragment
- **Module 14** — `BlockRenderer`, because page content is what the metadata describes
- **Module 18** — cache tags and revalidation, because a stale `<title>` is a caching bug, not an SEO bug

> ⚠️ **Do not hand-write titles and descriptions in your React components.** It works, it is
> fast, and it silently takes the `<head>` away from the people whose job it is. Every editor
> who has ever used the Yoast sidebar expects to control the search snippet. This module is
> about giving that control back — the code you write is a *transport*, not an authoring UI.

## Starting State

Module 18 complete: publishing in WordPress updates the live site in seconds via a signed
webhook; every route has a chosen rendering strategy.

```bash
# 1. The stack is up and WordPress answers GraphQL
docker compose -f wordpress-headless/docker-compose.yml ps
# Expected: wordpress, db, adminer, mailpit — all "running", db "(healthy)"

# 2. Next builds and every route reports its rendering strategy
cd next-app && npm run build
# Expected: the route table prints, with ISR revalidate values on /incidents/[slug] and /blog/[slug]

# 3. The revalidation webhook still rejects an unsigned call
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/revalidate -d '{}'
# Expected: 401
```

## What You'll Learn

- **Yoast SEO + `wp-graphql-yoast-seo`** — how the plugin every WordPress editor already knows
  becomes a `seo { ... }` field on every content node
- **The Next.js Metadata API** — `generateMetadata`, `metadataBase`, `alternates`, and why it
  replaces `wp_head()` rather than imitating it
- **File-based OG images** — `opengraph-image.tsx` rendering a real image on request, and when
  the editor's uploaded image should win instead
- **JSON-LD** — `Article`, `Review`, `BreadcrumbList`, `Organization` and `FAQPage`, emitted from
  data you already fetch, validated against the Rich Results test
- **Sitemaps and robots as code** — `app/sitemap.ts` and `app/robots.ts`, and the choice between
  proxying Yoast's XML and regenerating it
- **Redirects that outlive a migration** — sourcing 301s from WordPress instead of a hand-kept
  array in `next.config.ts`

## What You'll Build

- A reusable `seo` GraphQL fragment attached to every content query in `src/graphql/`
- `src/lib/seo/yoastToMetadata.ts` — one mapper from Yoast's payload to a Next `Metadata` object,
  with a defined fallback for every field an editor left blank
- `generateMetadata` on every dynamic route, plus a root `opengraph-image.tsx`
- `src/lib/seo/jsonLd.ts` — typed builders for five schema types, rendered as a single
  `<script type="application/ld+json">` per page
- `app/sitemap.ts`, `app/robots.ts`, and a redirect table read from WordPress
- A canonical-host decision written down, with the trailing-slash rule that follows from it

After this module, an editor changes the search snippet, social card, canonical URL and robots
directive for any page from the Yoast sidebar in wp-admin, and the deployed site reflects it
within one revalidation cycle. No deploy, no developer.

## Lessons

| # | Lesson | New Technology | What You Build |
|---|---|---|---|
| 1 | [Yoast & WPGraphQL SEO](01-yoast-and-wpgraphql-seo.md) | Yoast SEO, `wp-graphql-yoast-seo` | The `seo` fragment, on every content query |
| 2 | [The Next.js Metadata API](02-the-next-metadata-api.md) | `generateMetadata`, `metadataBase`, `opengraph-image` | `yoastToMetadata.ts` and a real OG image |
| 3 | [Structured Data & Rich Results](03-structured-data-and-rich-results.md) | JSON-LD, schema.org, Rich Results test | `jsonLd.ts` — five validated schema types |
| 4 | [Sitemaps, Robots & Redirects](04-sitemaps-robots-and-redirects.md) | `app/sitemap.ts`, `app/robots.ts`, `redirects()` | Sitemap, robots, and WP-sourced 301s |

## Where Each `<head>` Field Comes From

The point of the module in one table. "Editor" means a human types it in the Yoast sidebar and
nobody deploys anything.

| Output | Source of truth | Fallback when empty | Lesson |
|---|---|---|---|
| `<title>` | Yoast `seo.title` | `${post.title} — Blame The Tech` | 19.1, 19.2 |
| `<meta name="description">` | Yoast `seo.metaDesc` | the route's own summary, trimmed to 155 chars — `incident` and `tech_review` have no `excerpt` support ([appendix 03 §1](../appendix/03-content-model-reference.md#1-post-types)) | 19.2 |
| `<link rel="canonical">` | **the route's own path** — Yoast's value is generated from `home_url()`, so it carries WordPress's origin *and* WordPress's path, which has no `[locale]` segment | Yoast `seo.canonical` is honoured verbatim only when it points at a **third** origin, which is the one case an editor could mean it | 19.2 |
| `<meta name="robots">` | Yoast `seo.metaRobotsNoindex` / `...Nofollow` | `index, follow` | 19.2 |
| `og:image` | Yoast `seo.opengraphImage` (via `MediaFields`) | generated `[locale]/opengraph-image.tsx` | 19.2 |
| `og:title`, `og:description` | Yoast opengraph fields | the `<title>` / description above | 19.2 |
| JSON-LD | your data, never Yoast's `schema.raw` | omitted — never a half-populated node | 19.3 |
| `sitemap.xml` | WPGraphQL content queries | — | 19.4 |
| `robots.txt` | `app/robots.ts` | — | 19.4 |
| Permanent redirects | a WordPress-managed redirect list | — | 19.4 |

> **Two sources of truth for one `<title>` is worse than either one alone.** Pick Yoast as
> primary and treat your code as the fallback layer, or pick your code and turn the Yoast
> sidebar off so nobody is misled. This course picks Yoast, because that is the workflow the
> editors already have. The cost, stated plainly: your metadata is now only as good as the
> content team's discipline, and you need the fallbacks in Lesson 19.2 to be genuinely good.

## How to Work

1. **Read the module README, then work the lessons in order.** 19.1 makes the data available,
   19.2 consumes it, 19.3 adds meaning on top, 19.4 covers the site-level files. Skipping 19.1
   leaves 19.2 with nothing to map.
2. **Keep [appendix 03](../appendix/03-content-model-reference.md) open.** JSON-LD in Lesson 19.3
   is built from `techReviewFields` and `incidentDetails` field names, and getting one wrong
   produces a schema that validates but says nothing.
3. **Run every Verification block.** SEO fails silently — a wrong canonical or a stray
   `noindex` produces a page that looks perfect in a browser and vanishes from search. `curl`
   the rendered HTML and read the `<head>`; do not trust the React tree.
4. **Commit after every lesson.** `git commit -m "feat(seo): map yoast metadata to the next metadata api"`
