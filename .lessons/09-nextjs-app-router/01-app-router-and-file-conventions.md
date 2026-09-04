---
title: 'The App Router & File Conventions'
module: 9
lesson: 1
teaches: [app-router, file-conventions, locale-segment, create-next-app, turbopack, next-env-files]
produces: ['next-app/next.config.ts', 'next-app/src/app/[locale]/layout.tsx', 'next-app/src/app/[locale]/page.tsx', 'next-app/.env.example']
requires: [8.5]
---

# Lesson 09.1 — The App Router & File Conventions

## Quick Overview

Next.js is a framework around React, and its most visible feature is that **the file system is
the router**. A folder is a URL segment, `page.tsx` makes that segment routable, `layout.tsx`
wraps everything below it, and square brackets make a segment dynamic. You already think this
way — WordPress has mapped files to output since 2003 — so this lesson is less about learning a
new idea than about learning where Next.js is stricter than the template hierarchy and where it
is more powerful.

The one decision in this lesson you would not think to make yourself is the route shape. You
will create `src/app/[locale]/` immediately, with a single locale, `en`, even though
internationalization is Module 20. Every route in the app therefore lives one segment deeper
than you would naively write it. This is the cheapest insurance in the whole course: adding a
locale segment later means editing every `page.tsx`, every `layout.tsx`, every `<Link href>`,
every `generateStaticParams`, every `redirect()` and every Playwright spec in the repo. Doing
it now costs one folder.

By the end of this lesson you will have:

- The `create-next-app` scaffold merged into `next-app/`, keeping your Module 07 `tsconfig.json` and ESLint config and your Module 08 components
- `next-app/src/app/[locale]/layout.tsx` — the root layout with `<html lang>` driven by the segment
- `next-app/src/app/[locale]/page.tsx` — a home page rendering `IncidentCard` from the Module 08 fixtures
- `next-app/next.config.ts` and `next-app/.env.example` with `WP_GRAPHQL_ENDPOINT` and `NEXT_PUBLIC_SITE_URL`
- `http://localhost:3000/en` served by `npm run dev`, and the Vite harness from Module 08 deleted

## Classic WP Analogy

The template hierarchy and the App Router solve the same problem — turning a URL into a
rendered page by picking a file — and the mapping is close enough to be genuinely useful:

| Classic WordPress | App Router |
|---|---|
| `index.php` | `src/app/[locale]/page.tsx` |
| `archive-incident.php` | `src/app/[locale]/incidents/page.tsx` |
| `single-incident.php` | `src/app/[locale]/incidents/[slug]/page.tsx` |
| `taxonomy-scapegoat.php` | `src/app/[locale]/scapegoats/[slug]/page.tsx` |
| `page.php` + `page-{slug}.php` | `src/app/[locale]/[...slug]/page.tsx` |
| `header.php` + `footer.php` via `get_header()` | `layout.tsx`, wrapping automatically |
| `404.php` | `not-found.tsx` |
| `functions.php` reading `$_ENV` | `next.config.ts` plus `.env.local` |
| Rewrite rules in `add_rewrite_rule()` | the folder name itself |

The strict improvement is that the mapping is **explicit and readable**. In WordPress the file
that renders a URL is chosen at runtime from a ranked fallback chain driven by the parsed
query, which is why `get_template_part()` calls and `template_include` filters make "which
file rendered this?" a genuine investigation. In the App Router, the URL path *is* the folder
path. There is no fallback chain and no filter that can redirect it.

That is also where the analogy breaks, and it breaks in both directions. WordPress will always
render *something* — if `single-incident.php` is missing it falls back to `single.php`, then
`singular.php`, then `index.php`. Next.js will not: a URL with no matching folder is a 404,
full stop, and the only catch-all is one you write explicitly as `[...slug]`. Conversely,
layouts do something the hierarchy cannot. `get_header()` re-runs on every request, whereas a
Next layout **persists across client-side navigations** — move from `/en/incidents` to
`/en/blog` and the layout component is not re-rendered, its state survives, and only the page
below it swaps. That single behaviour is why an open mobile-nav drawer stays open during
navigation in Module 11, and it has no Classic WordPress equivalent at all.

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
