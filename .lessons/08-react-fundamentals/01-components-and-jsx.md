---
title: 'Components & JSX'
module: 8
lesson: 1
teaches: [react-components, jsx, react-dom-client, vite-scratch-harness]
produces: ['next-app/src/components/incidents/IncidentCard.tsx']
requires: [7.5]
---

# Lesson 08.1 — Components & JSX

## Quick Overview

React is a library with a very small surface: you write functions that return markup, and
React works out what the browser should look like. That is the whole idea. Everything else —
hooks, context, Server Components — is machinery built on top of it. This lesson gets you to
the point where you can write one of those functions, render it into a real page, and change
it and watch it update, without Next.js in the way.

You will build `IncidentCard`, the component that shows a single Blame The Tech incident. In
this lesson it renders hard-coded content, because the goal is the syntax and the render
mechanics, not the data. To see it in a browser you set up a throwaway Vite harness in
`next-app/scratch/` — thirty lines, gitignored, deleted in Lesson 09.1. Keeping the harness
separate from the real app is deliberate: React and Next.js are two different technologies,
and learning them simultaneously is why so many WordPress developers bounce off this part of
the stack.

By the end of this lesson you will have:

- `next-app/src/components/incidents/IncidentCard.tsx` — a typed React component rendering incident markup
- `react`, `react-dom` and their `@types` packages installed in `next-app/package.json`
- A gitignored Vite harness at `next-app/scratch/` that mounts the component with `createRoot`
- A running dev server on `http://localhost:5173` that hot-reloads when you edit the component
- A working answer to "what does JSX compile to?", verified by reading the compiled output

## Classic WP Analogy

You have written this component already, in PHP, hundreds of times:

| Classic WordPress | React |
|---|---|
| `template-parts/card-incident.php` | `src/components/incidents/IncidentCard.tsx` |
| `get_template_part('template-parts/card', 'incident')` | `<IncidentCard />` |
| `the_title()`, `esc_html($x)` | `{incident.title}` — escaped automatically |
| `<?php if ($x) : ?> … <?php endif; ?>` | `{x && …}` — an expression, not a statement |
| `class="incident-card"` | `className="incident-card"` |
| Child theme overrides the file | Nothing overrides it; you pass different props |

The mechanical difference is that a template part **echoes** — it writes into PHP's output
buffer and returns nothing useful — while a component **returns a value**. That value is a
plain JavaScript object describing what the UI should be, and React decides what to do with
it. `<IncidentCard />` is not "include this file", it is a function call whose result you can
store in a variable, put in an array, or pass to another component.

Here is where the analogy breaks, and it breaks in a way that will bite you within an hour:
**JSX is not a template language.** It has no `{{ }}`, no `@if`, no filters, no partial
inclusion by string name. It is JavaScript expression syntax that a compiler rewrites into
function calls, which is why `class` is a reserved word and becomes `className`, why you write
`{list.map(...)}` instead of a `foreach` block, and why you cannot drop an `if` statement into
the middle of returned markup — an `if` is a statement, and only expressions fit inside `{}`.
The second break is the one WordPress developers feel most: there is no `global $post` and no
`setup_postdata()`. A component knows nothing except what you hand it as props. That feels
like extra typing in Lesson 08.1 and turns into the reason the whole app is testable by
Module 12.

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
