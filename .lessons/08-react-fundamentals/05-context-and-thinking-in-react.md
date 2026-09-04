---
title: 'Context & Thinking in React'
module: 8
lesson: 5
teaches: [react-context, react-use-context, prop-drilling, derived-state, state-colocation, composition]
produces: ['next-app/src/components/incidents/IncidentFilterProvider.tsx', 'next-app/src/components/incidents/IncidentList.tsx']
requires: [8.4]
---

# Lesson 08.5 — Context & Thinking in React

## Quick Overview

By the end of Lesson 08.4 the filter state lives in one component and three descendants need
it, so you are threading `severity`, `setSeverity`, `scapegoat`, `setScapegoat` and `query`
through components that do not use them. That is prop drilling, and React's answer is
**context**: a value published at one point in the tree and read anywhere below it, without
the components in between knowing it exists. This lesson introduces `createContext` and
`useContext`, then immediately draws the line — context is for values that genuinely span a
subtree, not a global variable store, and reaching for it too early is how React apps become
untestable.

The second half of the lesson is the one that changes how you design components. You will walk
the "thinking in React" process on the incident UI: list every value on screen, decide which
are state and which are derived, push each piece of state to the lowest component that needs
it, and lift it only when two siblings must agree. Applied honestly, that process **deletes**
state that Lesson 08.3 wrote. Finishing this module with fewer lines than you started the
lesson with is the intended outcome.

By the end of this lesson you will have:

- `next-app/src/components/incidents/IncidentFilterProvider.tsx` — a typed context with a custom `useIncidentFilters()` consumer hook
- A consumer hook that throws a named error when used outside its provider, rather than returning `undefined`
- `IncidentList` refactored to read filters from context, with no filter props in its signature
- At least one piece of state deleted and replaced with a value derived during render
- A written state inventory for the incident UI: every value, marked state, derived, or prop

## Classic WP Analogy

Context is the closest React gets to a WordPress global, and the comparison is useful right up
to the point where it becomes dangerous:

| Classic WordPress | React |
|---|---|
| `global $post` — ambient, whole request | context value — ambient, one subtree |
| `wp_localize_script('app','BTT',$data)` | `<Provider value={data}>` |
| `get_option('btt_settings')` anywhere | `useContext(SettingsContext)` anywhere below the provider |
| `setup_postdata()` / `wp_reset_postdata()` | nesting a second provider to shadow the value |

The mechanical similarity is real: both let deep code read a value nobody passed it. The
difference is scope and lifetime. A WordPress global is process-wide and any plugin can
overwrite it, which is why `wp_reset_postdata()` exists and why "some plugin clobbered
`$post`" is a support category. A context value is scoped to the subtree under its provider,
is typed, cannot be written to by consumers, and re-renders exactly the components that read
it. You can mount the same component twice on one page with two different providers and both
work — try that with `global $post`.

Here is where the analogy breaks and why it matters for the rest of the course. **Context is
not state management, and it is not a performance tool.** Every component that calls
`useContext` re-renders when the provider's value changes, so putting a rapidly-changing value
in a context that half the tree consumes is slower than prop drilling, not faster. And there
is a headless-specific trap waiting in Module 09: this provider is a Client Component, and the
moment you wrap a layout in it, everything inside that provider ships to the browser too. The
WordPress instinct — "put shared data in a global so anything can reach it" — is precisely the
instinct that turns a Server Component tree into a client bundle. Lesson 09.2 shows the fix,
which is to push providers as far down the tree as they will go.

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
