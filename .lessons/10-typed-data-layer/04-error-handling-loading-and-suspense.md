---
title: 'Error Handling, Loading & Suspense'
module: 10
lesson: 4
teaches: [error-boundaries, error-tsx, not-found-tsx, suspense, streaming, graphql-error-shape]
produces: ['next-app/src/lib/graphql/errors.ts', 'next-app/src/app/[locale]/loading.tsx', 'next-app/src/app/[locale]/error.tsx', 'next-app/src/app/[locale]/not-found.tsx', 'next-app/src/app/global-error.tsx']
requires: [10.1, 10.3]
---

# Lesson 10.4 — Error Handling, Loading & Suspense

## Quick Overview

Everything built so far assumes WordPress answers, answers quickly, and answers correctly.
This lesson removes all three assumptions. You will map GraphQL's genuinely awkward error shape
into a single typed error class, add an `error.tsx` boundary that shows a useful page instead of
a blank one, add `not-found.tsx` so a bad slug looks deliberate, and add `loading.tsx` so a slow
query streams a skeleton instead of stalling the whole response.

The GraphQL detail worth arriving prepared for: **a GraphQL error is an HTTP 200.** Ask for a
field that does not exist, hit a depth limit, get a permission denial from a resolver, and the
transport says "fine" while the body says otherwise. So `if (!response.ok) throw` — the check
every HTTP client tutorial teaches — catches essentially none of the errors this stack actually
produces. Worse, partial success is normal: WPGraphQL will happily return `data` with one field
resolved and one field `null`, plus an `errors` array explaining why. Deciding what your client
does with a partial response is a design decision, and this lesson makes it explicitly rather
than by accident.

By the end of this lesson you will have:

- `next-app/src/lib/graphql/errors.ts` — a `GraphQLRequestError` carrying the operation name, the `errors` array and the HTTP status
- `next-app/src/app/[locale]/error.tsx` — a Client Component boundary with a working `reset()`
- `next-app/src/app/[locale]/not-found.tsx` and `next-app/src/app/global-error.tsx`
- `next-app/src/app/[locale]/loading.tsx` plus one in-page `<Suspense>` boundary around a slow section
- A written policy on partial responses, and a verified case where WordPress returns HTTP 200 with errors and the page fails safely

## Classic WP Analogy

WordPress's error story is `WP_Error`, and it trains a habit that transfers well:

| Classic WordPress | Next.js / React |
|---|---|
| `WP_Error` returned, not thrown | `GraphQLRequestError` thrown, caught by a boundary |
| `is_wp_error($result)` at every call site | one `throw` in the client, one boundary per route |
| `wp_die('Something went wrong')` | `error.tsx` |
| `status_header(404); get_404_template();` | `notFound()` and `not-found.tsx` |
| `WP_DEBUG` deciding how much detail to show | `process.env.NODE_ENV` deciding the same |
| A white screen from a fatal in a plugin | `global-error.tsx`, the last line of defence |

The valuable transfer is the discipline: `is_wp_error()` teaches you that a function returning
something is not the same as a function succeeding, which is exactly the lesson GraphQL's
200-with-errors response is trying to teach. And the `WP_DEBUG` habit — verbose locally, opaque
in production — is the right habit here too, for the same reason. A stack trace on a public
error page tells an attacker your file paths, your plugin versions, and often your queries.

The analogy breaks on **where** errors get handled, and it is a real conceptual shift.
`is_wp_error()` is checked at the call site, so error handling is scattered through the code
that does the work. React inverts it: you `throw`, and the nearest `error.tsx` above you in the
route tree catches it. Nothing in between needs a check. That is far less code, and it has one
sharp edge — the boundary catches errors thrown during **rendering**, and nothing else. An
error inside an event handler, a `setTimeout`, or a Server Action does not reach `error.tsx`,
and neither does an error thrown while a boundary is itself rendering, which is why
`global-error.tsx` exists.

The second break is that WordPress has no streaming equivalent. PHP builds the whole page and
then sends it, so a slow query is a slow blank browser tab. `loading.tsx` and `<Suspense>` let
Next send the shell immediately and stream the slow part in when it resolves — meaning the user
sees a header, a nav and a skeleton within milliseconds even when WordPress is thinking.
Combined with the Module 11 skeleton components, that turns a slow query from a bounce into a
non-event, and it is the single largest perceived-performance difference between this stack and
Classic WordPress.

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
