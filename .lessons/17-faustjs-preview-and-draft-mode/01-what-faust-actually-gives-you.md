---
title: 'What Faust Actually Gives You'
module: 17
lesson: 1
teaches: [faustjs, wp-template-hierarchy-in-react, framework-evaluation, spike-not-rewrite, apollo-coupling]
produces: []
requires: [10.1]
---

# Lesson 17.1 — What Faust Actually Gives You

## Quick Overview

**Faust.js** is WP Engine's Next.js framework for headless WordPress, and the honest one-line
summary is that it solves three problems you have already solved by hand, and one you have not:
WordPress-controlled routing with a real template hierarchy in React. Instead of writing
`app/[locale]/incidents/[slug]/page.tsx` yourself, you write `wp-templates/single-incident.js` and
Faust resolves which template a given WordPress URI should use, exactly as `single-{post_type}.php`
does in a classic theme. It ships preview, login and a `faustjs` seed-query layer on top of Apollo
Client, and it is the closest thing the ecosystem has to "a headless WordPress theme".

You are going to install it **beside** the app you have built, in its own `/faust` route group,
against the same WordPress. This is a **spike**, not a rewrite: no existing route changes, no
existing dependency is replaced, and the whole thing is deleted in Lesson 17.4 — which is why it
never appears in the expected tree in `next-app/README.md`. The point of a spike is to buy
information at a fixed price. By the end of this lesson you will know what Faust does for free,
what it does instead of letting you do it, and where its Apollo data layer sits relative to the
`fetch`-plus-cache-tags client you built in Lesson 10.1. Hold the verdict until 17.4. Evaluating a
framework by reading its marketing page is how teams end up rewriting twice.

By the end of this lesson you will have:

- Faust installed in a `/faust` route group with its own `faust.config.js`, running against your
  existing WordPress with no change to any existing route
- One working Faust template — `wp-templates/single-incident.js` — rendering a real incident
- The same incident rendered by your own route, side by side, with both response payloads captured
- A filled-in first column of the Faust scorecard in the module README: what it gave you, and what
  it took over
- A note on the two coupling points you will weigh in 17.4: Apollo Client as the data layer, and
  Faust's own routing resolution
- The `@faustwp/*` package versions and their last release dates written down — maintenance status
  is an architectural input, not gossip

## Classic WP Analogy

Faust is a **headless theme**, and once you see it that way everything about it makes sense.
Classic WordPress resolves a URL through `template-loader.php` and the template hierarchy:
`single-incident.php`, then `single.php`, then `singular.php`, then `index.php`. Inside the
template, `get_queried_object()` hands you the thing WordPress already decided the URL referred to,
and you render it. You never write a router, because WordPress *is* the router.

| Classic WordPress theme | Faust.js | This app's own stack |
|---|---|---|
| `single-incident.php` | `wp-templates/single-incident.js` | `app/[locale]/incidents/[slug]/page.tsx` |
| `template-loader.php` | Faust's `getWordPressProps` / template resolver | the Next file-system router |
| `get_queried_object()` | the seed query + `useFaustQuery` | your own `fetchGraphQL` call, typed by codegen |
| `functions.php` | `faust.config.js` + plugins | `next.config.ts` + your own libs |
| the theme's `WP_Query` loop | Apollo `useQuery` | an RSC `await` with cache tags |
| Preview in wp-admin, working out of the box | working out of the box | Lesson 17.2, built by hand |

The trade is the same one you have made a hundred times choosing between a starter theme and a
blank one. A starter theme gives you a working site by Friday and a set of conventions you will
fight in month four. A blank theme costs you Friday and gives you nothing to fight.

**Where the analogy breaks down, and it is the break that decides this module:** a classic theme's
template hierarchy is *free*, because WordPress has already parsed the request and run the main
query before your template loads. Faust's version is not free — it costs you the router. When
WordPress decides which component renders a URL, Next.js can no longer be the authority on that
route's rendering strategy, and everything Module 18 is about — `revalidate` per route,
`generateStaticParams`, `revalidateTag` from a webhook, `force-dynamic` on personalised pages —
becomes something you negotiate with a framework instead of something you declare. Faust also
predates the App Router's maturity and leans on Apollo, whose client-side cache is a different
model from Next's server-side Data Cache. You end up with two caches and no single source of truth
about freshness.

The second break: a classic theme is *your* code. Faust is a dependency in maintenance mode,
sitting between you and two frameworks that both move quickly. In Classic WordPress the equivalent
risk is adopting a page builder — enormous leverage right up until you need something it did not
anticipate.

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
