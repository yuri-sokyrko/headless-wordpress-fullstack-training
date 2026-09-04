---
title: 'Navigation, Linking & Layouts'
module: 9
lesson: 4
teaches: [next-link, nested-layouts, generate-static-params, not-found, use-pathname, prefetching]
produces: ['next-app/src/app/[locale]/blog/page.tsx', 'next-app/src/app/[locale]/blog/[slug]/page.tsx', 'next-app/src/app/[locale]/reviews/page.tsx', 'next-app/src/app/[locale]/reviews/[slug]/page.tsx', 'next-app/src/app/[locale]/scapegoats/page.tsx']
requires: [9.3]
---

# Lesson 09.4 — Navigation, Linking & Layouts

## Quick Overview

Blame The Tech has one working section. This lesson builds the other three — the blog, the tech
reviews and the scapegoat leaderboard — and connects them with real navigation. The routes
themselves are repetition of Lesson 09.3, which is intentional: writing the same server-fetch
shape four times is how it stops being novel, and the reviews route adds the one genuinely new
data problem in Phase 2, the ACF repeater that arrives as a list of objects rather than a list
of strings.

The new mechanics are navigational. `<Link>` replaces `<a>` and gives you client-side
navigation with automatic prefetching, so moving between sections re-renders the page below the
layout without a full document load. `generateStaticParams` tells Next which dynamic slugs to
prerender at build time — the direct equivalent of asking WordPress to warm its page cache, but
declared in code. And `notFound()` gives you a real 404 from inside a component, which is the
piece that makes a bad slug behave correctly rather than rendering an empty shell.

By the end of this lesson you will have:

- `next-app/src/app/[locale]/blog/page.tsx` and `blog/[slug]/page.tsx` on the `posts` connection
- `next-app/src/app/[locale]/reviews/page.tsx` and `reviews/[slug]/page.tsx`, including the `pros` and `cons` repeaters
- `next-app/src/app/[locale]/scapegoats/page.tsx` — the blame leaderboard, ordered by term `count`
- Site navigation added inline to `src/app/[locale]/layout.tsx` with locale-aware `<Link href>` values
- `generateStaticParams` on all three dynamic routes, and `notFound()` on a slug that does not exist

## Classic WP Analogy

Every piece of this lesson has a Classic WordPress counterpart, and the counterparts are the
functions you reach for without thinking:

| Classic WordPress | App Router | Note |
|---|---|---|
| `<a href="<?php the_permalink(); ?>">` | `<Link href={`/${locale}/blog/${slug}`}>` | you build the URL; there is no permalink structure to consult |
| `wp_nav_menu(['theme_location' => 'primary'])` | hard-coded `<Link>` list, for now | Module 11 extracts it, Module 20 localises it |
| `get_header()` in every template | `layout.tsx`, applied automatically | you cannot forget to call it |
| `is_page('about')` for active state | `usePathname()` in a Client Component | requires `'use client'` — that is why the nav is an island |
| `status_header(404); get_404_template();` | `notFound()` | throws; nothing after it runs |
| Warming the cache with a crawler | `generateStaticParams()` | declared in code, runs at build |

The analogy holds well for building URLs and for the header-and-footer wrapper. It breaks on
three things worth naming.

**There is no permalink structure.** In WordPress, `the_permalink()` consults the rewrite rules,
so changing `/blog/%postname%/` to `/articles/%postname%/` updates every link on the site. In
Next the URL is a string you construct, and the folder name is the only source of truth. If you
rename `blog/` to `articles/` you will be editing `<Link>` calls. That is the cost of the
explicitness you gained in Lesson 09.1, and it is why the `[locale]` segment being present from
day one matters so much.

**`<Link>` prefetches.** Hovering a link in production quietly fetches the target route's data
before you click, which is why navigation feels instant and also why your WordPress access log
shows GraphQL requests for pages nobody visited. `<a href>` has no such behaviour, and neither
does WordPress. It is a genuine performance win with a genuine cost, and Module 18 revisits it
once caching exists.

**Layouts persist; `get_header()` does not.** A WordPress page load reconstructs the header from
scratch every time. A Next layout is rendered once and then survives every client-side
navigation below it, keeping its state. This is the behaviour that makes the app feel like an
app, and it is also the reason a `useEffect` in a layout does not re-run when the page changes —
a distinction that produces genuinely confusing bugs if you expect PHP's request lifecycle.

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
