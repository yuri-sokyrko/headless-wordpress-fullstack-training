---
title: 'Sitemaps, Robots & Redirects'
module: 19
lesson: 4
teaches: [next-sitemap, next-robots, canonical-host, trailing-slash, wordpress-sourced-redirects]
produces: ['next-app/src/app/sitemap.ts', 'next-app/src/app/robots.ts', 'next-app/next.config.ts']
requires: [19.2, 18.2]
---

# Lesson 19.4 — Sitemaps, Robots & Redirects

## Quick Overview

Three site-level files decide whether crawlers can find and trust your content, and all three
are the kind of thing that gets set up once, wrongly, and then produces mysterious traffic
losses for a year. `app/sitemap.ts` and `app/robots.ts` are Next.js file conventions that
export functions and produce `/sitemap.xml` and `/robots.txt`. Redirects are the harder
problem, because they are *content*: when an editor changes a slug, someone has to remember
that the old URL still exists in Google's index and on somebody's Slack message from 2019.

The core decision in this lesson is **who owns the sitemap**. Yoast already generates one, at
`/sitemap_index.xml` on the WordPress host — which is the wrong host, listing the wrong URLs,
split across paginated sub-sitemaps. You have two honest options: proxy it through a Next route
handler and rewrite every URL, or regenerate it from WPGraphQL. This course regenerates,
because the sitemap must reflect *your* routing (locale prefixes from Module 20, the
`/blog` rewrite base, the `[...slug]` catch-all) and because rewriting XML you did not
generate is a maintenance tax with no upside. The same logic decides the redirect question:
you source 301s from a WordPress-managed list so editors can add one without a deploy, then
serve them from `next.config.ts` — or from middleware, if the list is long enough that
bundling it stops being reasonable.

By the end of this lesson you will have:

- `src/app/sitemap.ts` — generated from WPGraphQL, with `lastModified` from `modifiedGmt`, split
  into multiple sitemaps if the entry count justifies it
- `src/app/robots.ts` — allowing crawl of the public site, disallowing `/api/`, and pointing at
  the sitemap
- A decided and documented canonical host, with `www` vs apex resolved in exactly one place
- A trailing-slash rule (`trailingSlash: false`) and the redirect that enforces it
- A redirect table read from WordPress, applied as 301s, with a fallback for when the fetch fails
- Proof that `/wp-admin`, `/graphql` and the WordPress origin are not linked, indexed or listed

## Classic WP Analogy

You already know the pieces; they were just distributed differently.

| Classic WordPress | Headless with Next.js |
|---|---|
| Yoast writes `/sitemap_index.xml` | `app/sitemap.ts` returns an array of `MetadataRoute.Sitemap` entries |
| A physical or virtual `robots.txt` | `app/robots.ts` returns rules and a `sitemap` URL |
| Redirection plugin table in the DB | A WP-managed list read at build/revalidate time, served from `next.config.ts` |
| `.htaccess` `RewriteRule` | `redirects()` and `rewrites()` in `next.config.ts`, or `middleware.ts` |
| `home_url()` decides the canonical host | `metadataBase` and `NEXT_PUBLIC_SITE_URL` decide it |
| WordPress adds trailing slashes to permalinks by default | `trailingSlash` is a config flag you must choose deliberately |

Two places the analogy breaks, and both bite in production.

**Trailing slashes.** WordPress permalinks end in `/` by default and `redirect_canonical()`
quietly fixes anything that doesn't. Next.js has no such thing. If `/incidents/dns` and
`/incidents/dns/` both render 200, you have duplicated your entire site for a crawler, and no
amount of correct canonicals fully undoes that. Pick one form, set `trailingSlash`, and let
Next 308 the other — and if you are migrating from a Classic site whose URLs *did* end in `/`,
that choice is already made for you.

**Redirects are not code.** The Redirection plugin let an editor fix a broken link at 4pm on a
Friday. A hand-maintained array in `next.config.ts` requires a pull request, a review and a
deploy — so it stops getting maintained, and then the 404s come back. Keeping the list in
WordPress preserves the workflow the team actually had. The cost, stated plainly: the redirect
list is now a network dependency of your build, so it needs a cached fallback and a "the fetch
failed, serve no redirects rather than crash" branch.

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
