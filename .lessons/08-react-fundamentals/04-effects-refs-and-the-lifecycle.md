---
title: 'Effects, Refs & the Lifecycle'
module: 8
lesson: 4
teaches: [use-effect, effect-cleanup, use-ref, custom-hooks, you-might-not-need-an-effect]
produces: ['next-app/src/components/incidents/IncidentSearch.tsx', 'next-app/src/components/incidents/useDebouncedValue.ts']
requires: [8.3]
---

# Lesson 08.4 — Effects, Refs & the Lifecycle

## Quick Overview

`useEffect` is the hook that lets a component reach outside React — timers, event listeners,
focus, `document.title`, anything the render pass itself must not do. It is also the most
misused hook in React, because it looks like a lifecycle callback and it is not one. This
lesson teaches it the way you will want to have learned it: what an effect actually is, when
the dependency array runs it again, why cleanup exists, and — most importantly — the list of
things you are about to reach for an effect for that need no effect at all.

You will build `IncidentSearch`, a text input that filters incidents by title. The search
value is state, the filtered result is derived, and the only genuine effect in the whole
component is a debounce timer, which you extract into a reusable `useDebouncedValue` hook.
You will also use `useRef` to move keyboard focus to the input when the "clear filters" button
runs, which is the kind of thing that reads as a nice touch here and turns into a WCAG
requirement in Module 22.

By the end of this lesson you will have:

- `next-app/src/components/incidents/IncidentSearch.tsx` — a controlled search input with a debounced query
- `next-app/src/components/incidents/useDebouncedValue.ts` — your first custom hook, with a cleanup function
- A `useRef`-driven focus move, demonstrated with the keyboard only
- A deliberately wrong effect (deriving filtered results into state) written, observed double-rendering, then deleted
- A written note of the three effects you removed and what replaced them

## Classic WP Analogy

WordPress gives you hooks that fire at known points in a page's life, and you have used them
to do exactly what effects do:

| Classic WordPress | React | What fires it |
|---|---|---|
| `add_action('wp_enqueue_scripts', …)` | an effect with `[]` deps | once, after the first render |
| `add_action('save_post', …)` | an effect with `[value]` deps | after any render where `value` changed |
| `jQuery(document).ready(…)` | an effect with `[]` deps | after the DOM exists |
| `wp_deregister_script()` on teardown | the function an effect **returns** | before the next run, and on unmount |
| `$('#q').focus()` | `inputRef.current?.focus()` | whenever you call it |

The comparison holds for the "run this after the thing exists" shape. It breaks on
**frequency and ownership**. A WordPress hook fires once per request and the process then
exits, so cleanup is somebody else's problem. A React effect can run on every single render,
forever, in the same browser tab, which is why the returned cleanup function is not optional
politeness: an effect that adds an event listener and never removes it leaks one listener per
render. In development React deliberately mounts, unmounts and remounts every component once
to make missing cleanup visible immediately — that double-run is a feature, and this lesson
shows you the effect it exposes.

The second break is the one worth writing on a sticky note: **most effects are the wrong
tool.** WordPress trains you to think in hooks, so the instinct is to hook everything. In
React, if a value can be computed from props and state, compute it during render — do not
store it in state and sync it with an effect. Filtering a list, formatting a date, deriving a
count, resetting state when a prop changes: none of these is an effect. The official React
docs have a page titled "You Might Not Need an Effect", and the reason it exists is that the
WordPress-and-jQuery instinct is extremely common and extremely expensive.

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
