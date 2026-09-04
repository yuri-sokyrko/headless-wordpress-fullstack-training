---
title: 'Server vs Client Components'
module: 9
lesson: 2
teaches: [react-server-components, use-client, client-islands, serialization-boundary, bundle-boundary]
produces: ['next-app/src/app/[locale]/incidents/page.tsx', 'next-app/src/components/incidents/IncidentFilterProvider.tsx']
requires: [9.1]
---

# Lesson 09.2 — Server vs Client Components

## Quick Overview

In the App Router every component is a **Server Component** unless you say otherwise. It runs
on the server, during the request, and its code is never sent to the browser. Adding
`'use client'` at the top of a file opts that file and everything it imports into the client
bundle, where it hydrates and can hold state. This is one directive with two effects — where
the code runs, and whether the code ships — and confusing those two is the source of nearly
every "why is this component not interactive?" and "why is my bundle 400 KB?" question in
Phase 2.

You will build `/en/incidents` as a Server Component page and keep the Module 08 filter as a
**client island**: a small `'use client'` subtree inside an otherwise server-rendered page.
That means moving `'use client'` onto exactly three files and, critically, moving
`IncidentFilterProvider` *down* the tree rather than wrapping the layout in it. The Lesson 08.5
warning lands here — a provider at the top of a layout drags the whole page into the client
bundle, and you will measure that before and after.

By the end of this lesson you will have:

- `next-app/src/app/[locale]/incidents/page.tsx` — a Server Component page still using fixtures
- `'use client'` on `IncidentFilters`, `IncidentSearch` and `IncidentFilterProvider`, and nowhere else
- The provider mounted around the filter island only, not around the layout
- A before-and-after of the route's First Load JS from the `npm run build` output
- A deliberate `console.log` in a Server Component, observed in the terminal and *not* in the browser console

## Classic WP Analogy

Classic WordPress already has this split, and you have been managing it by hand for years:

| Classic WordPress | App Router |
|---|---|
| PHP in `single-incident.php` | a Server Component |
| `wp_enqueue_script('filters')` | `'use client'` on the filter component |
| `wp_localize_script('filters','BTT',$data)` | props passed from server to client component |
| "does this need JS?" answered per feature | answered per file, by the directive |
| `is_admin()` / `wp_doing_ajax()` guards | the compiler refuses the import instead |

The mental model transfers almost exactly. A PHP template runs on the server, touches the
database, and emits HTML the browser never gets the source of — that is a Server Component.
An enqueued script runs in the browser, holds state, and responds to clicks — that is a Client
Component. And `wp_localize_script()` is genuinely the same job as passing props across the
boundary: taking server-side data and handing it to browser-side code.

The analogy breaks in three specific ways, all of which you will hit in this lesson. First,
**the boundary is transitive in one direction only.** A Server Component can render a Client
Component, but a Client Component cannot render a Server Component — once you are in the
client bundle, everything you import comes with you. There is no PHP equivalent, because a
script tag cannot include a template part. Second, **props crossing the boundary must be
serializable.** You can pass a string, a number, a plain object or an array; you cannot pass a
function, a `Date` you expect to stay a `Date`, or a class instance. `wp_localize_script()` has
the same constraint via `wp_json_encode()`, but WordPress fails silently and React fails loudly
at build time. Third — and this is the one with security consequences —
**a Server Component can read secrets and a Client Component cannot.** `process.env.WP_APP_TOKEN`
in a Server Component is fine; the same line in a `'use client'` file is either `undefined` or,
if you rename the variable with a `NEXT_PUBLIC_` prefix to "fix" it, published to the world.
Lesson 09.5 verifies that boundary with `grep`, and rule 4 in
[the env reference](../appendix/04-env-reference.md#1-the-five-rules) states it plainly:
`NEXT_PUBLIC_` is an instruction, not a hint.

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
