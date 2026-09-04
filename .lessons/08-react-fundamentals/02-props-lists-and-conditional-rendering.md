---
title: 'Props, Lists & Conditional Rendering'
module: 8
lesson: 2
teaches: [react-props, list-rendering, react-keys, conditional-rendering, typed-component-props]
produces: ['next-app/src/components/incidents/IncidentList.tsx', 'next-app/src/components/incidents/fixtures.ts']
requires: [8.1]
---

# Lesson 08.2 — Props, Lists & Conditional Rendering

## Quick Overview

A component that renders hard-coded content is a static HTML file with extra steps. This
lesson makes `IncidentCard` take its content as **props** — a single typed object passed in by
the caller — and then builds `IncidentList`, which renders forty of them from an array. Along
the way you meet the two things that generate the most React bugs in real codebases: keys, and
rendering something that might be `null`.

The data comes from `fixtures.ts`, a typed array shaped exactly like the `incidents` GraphQL
connection you saved in Module 05 — nested `node` objects, connection edges for taxonomy
terms, nullable ACF numbers and all. Using the real shape now rather than a flattened
convenience shape is the point: when Lesson 09.3 replaces the fixture import with a live
query, the components do not change. Fixtures that lie about the shape of your data are a debt
you pay twice.

By the end of this lesson you will have:

- `next-app/src/components/incidents/fixtures.ts` — six typed incidents in real WPGraphQL response shape
- `next-app/src/components/incidents/IncidentList.tsx` — an array rendered with `.map()` and stable `key` values
- `IncidentCard` refactored to a typed props interface with no hard-coded content
- A severity `<Badge>`-style element driven by the four-term closed set from the content model
- An empty-state branch and a "no cost recorded" branch, both handled without `undefined` reaching the DOM

## Classic WP Analogy

The WordPress loop and a React list render the same job with the ownership reversed:

```
Classic                                   React
─────────────────────────────────────     ─────────────────────────────────────
$q = new WP_Query([...]);                 const { incidents } = props;
while ($q->have_posts()) {                {incidents.map((incident) => (
  $q->the_post();          ← mutates       <IncidentCard
  get_template_part('card','incident');       key={incident.slug}
}                                             incident={incident}
wp_reset_postdata();       ← or else        />
                                          ))}
```

`the_post()` advances an internal pointer and populates `global $post`, so the template part
receives its data through a global side effect. `get_template_part()` cannot take an argument
in older WordPress at all, and even with the modern `$args` parameter, nothing checks what you
passed. React inverts both: data travels as an explicit argument, and TypeScript rejects the
call at build time if the shape is wrong. Forgetting `wp_reset_postdata()` has no React
equivalent, because there was never a global to reset.

The analogy breaks on **`key`**. WordPress has nothing like it, and the WordPress instinct —
"use the loop index" — is specifically the wrong answer. `key` is how React matches an item
between two renders so it can move a DOM node instead of rebuilding it. Index keys are stable
only while the array order never changes, which is exactly not true of a filtered list, and
the failure mode is not a crash: it is a checkbox that stays ticked next to the wrong incident
after you filter. Use the field WordPress already guarantees is unique and stable — the
`slug`. The second break is subtler: in PHP, echoing `null` prints nothing and echoing `false`
prints nothing, so sloppy conditionals are invisible. In JSX, `{0}` renders a literal `0` and
`{undefined}` renders nothing, which means `{incident.downtimeMinutes && <p>…</p>}` silently
prints a bare `0` for an incident with no downtime. That specific bug appears in this lesson,
on purpose.

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
