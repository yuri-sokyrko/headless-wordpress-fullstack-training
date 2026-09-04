---
title: 'JavaScript Weight & INP'
module: 21
lesson: 3
teaches: [bundle-analyzer, client-component-audit, next-dynamic, next-script, hydration-cost, long-tasks, inp]
produces: ['next-app/next.config.ts', 'docs/perf-baseline.md']
requires: [21.1, 08.4, 20.3]
---

# Lesson 21.3 — JavaScript Weight & INP

## Quick Overview

Every kilobyte of JavaScript is paid for three times: downloaded, parsed and compiled, then
executed to hydrate. On a mid-range Android the second and third costs dominate, which is why a
site can score well on LCP and still feel broken to touch. This lesson opens the bundle, finds
out what is actually in it, and removes what does not need to be there — then measures the
result rather than assuming it.

The single highest-leverage discipline is **server components by default**. `'use client'` is
not a performance annotation, it is a boundary declaration: everything imported below that
boundary ships to the browser. One `'use client'` on a component that imports a date library, or
a barrel `index.ts` that re-exports forty icons, or the whole next-intl catalogue from Lesson
20.3, and you have shipped all of it. So you audit: list every `'use client'` file, name the
interactive thing that justifies it, and for each one either push the boundary downward — make
the interactive leaf a client component and leave its parent on the server — or delete the
directive. `@next/bundle-analyzer` turns that audit from opinion into a treemap. Then
`next/dynamic` for the genuinely heavy and genuinely deferred (the "Get Demo" dialog body, not
its trigger button), `next/script` with a chosen strategy for every third party, and a look at
long tasks in a real profile to find what is actually delaying INP — on this site, the incident
filter re-rendering a 40-item list synchronously is the honest suspect.

By the end of this lesson you will have:

- `@next/bundle-analyzer` wired into `next.config.ts` behind an env flag, with treemaps for the
  six key routes saved alongside the baseline
- A client-component inventory — every `'use client'` file, the interaction that justifies it, the
  ones you deleted — and at least one boundary pushed downward so a parent returns to the server
- `next/dynamic` on the dialog body and any genuinely deferred heavy component, with a
  matched-height placeholder so the win does not cost CLS
- A `strategy` chosen and justified for every `next/script`: analytics, Turnstile, anything else
- A recorded Total Blocking Time improvement and a long-task profile of the incident filter
- The First Load JS number per route, which becomes the budget in Lesson 21.4

## Classic WP Analogy

`wp_enqueue_script()` is the closest thing you have used, and the comparison is instructive
because Classic WordPress gave you *more* control here, not less.

| Classic WordPress | Next.js App Router |
|---|---|
| `wp_enqueue_script( 'x', $src, $deps, $ver, true )` | An `import` — the bundler decides placement |
| Conditional enqueue: `if ( is_singular('incident') )` | Route-level code splitting, automatic |
| `wp_dequeue_script()` to remove a plugin's bloat | Delete the import, or move the boundary |
| `wp_localize_script()` passing PHP data to JS | Props across the server/client boundary in the RSC payload |
| `defer` / `async` via `script_loader_tag` | `next/script` `strategy` |
| jQuery, always, because something needs it | React, always, but only where you declared a client |

Classic WordPress made JavaScript weight **visible and conditional**. You enqueued deliberately,
you could see the whole list in the page source, and dequeuing a bad plugin script was a
one-liner. The cost of that control was that every plugin author also had it, so a real
WordPress site shipped nineteen scripts, half of them on every page.

Where the analogy breaks, and this is the mental shift: **in Next.js, JavaScript weight is
implicit and follows from the module graph.** There is no enqueue list to read. You add
`'use client'` to a card component so it can have an `onClick`, that card imports a formatting
helper, the helper imports a 90 KB locale-data library, and none of that appears anywhere you
would naturally look. The failure mode is not "someone enqueued too much", it is "an import
three levels down crossed the boundary". `wp_dequeue_script` had no equivalent for that; the
bundle analyzer is the equivalent, and reading a treemap is the skill this lesson is actually
teaching.

The other break worth naming: `wp_localize_script` data was inert JSON. RSC payload props are
also serialised into the HTML, and a client component that takes a whole 40-item incident array
as a prop pays for it **twice** — once in the flight payload and once in hydration. Passing an
ID and letting the server render the content is the headless-native answer, and it has no
Classic equivalent because in Classic WordPress the server rendered everything anyway.

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
