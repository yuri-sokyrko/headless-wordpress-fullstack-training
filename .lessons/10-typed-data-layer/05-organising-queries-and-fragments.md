---
title: 'Organising Queries & Fragments'
module: 10
lesson: 5
teaches: [graphql-documents, graphql-fragments, fragment-colocation, one-query-per-route, overfetching]
produces: ['next-app/src/graphql/fragments/IncidentCardFields.graphql', 'next-app/src/graphql/incidents.graphql', 'next-app/src/graphql/posts.graphql', 'next-app/src/graphql/reviews.graphql', 'next-app/src/graphql/scapegoats.graphql', 'next-app/src/graphql/siteSettings.graphql']
requires: [10.2]
---

# Lesson 10.5 — Organising Queries & Fragments

## Quick Overview

By now the app has a dozen GraphQL documents, several of which select the same eight incident
fields with small variations, and at least one of which selects fields nobody renders. This
lesson restructures `src/graphql/` around two rules: **one query document per route**, and
**one fragment per component that needs data**. A fragment names a set of fields on a specific
type, so `IncidentCardFields` lives next to the query that uses it, gets composed into the list
query and the detail query alike, and gives codegen a type whose name matches the component
that consumes it.

This is the lesson that makes overfetching visible. A GraphQL query is a bill you present to
WordPress, and every field on it costs a resolver call — sometimes a `get_post_meta()`,
sometimes an ACF field lookup, occasionally an N+1 that Module 06's DataLoader work is holding
back. You will read the WPGraphQL query log for one page, find the fields nobody renders, and
delete them. Doing that once, deliberately, is worth more than any amount of caching, and it is
the habit Module 21 assumes you have when it measures Core Web Vitals.

By the end of this lesson you will have:

- `next-app/src/graphql/fragments/IncidentCardFields.graphql` and sibling fragments, one per data-consuming component
- One document per route in `next-app/src/graphql/`, each named for its operation
- `siteSettings.graphql` fetched once in the root layout and memoized, not re-fetched per page
- At least three unused fields deleted, with the before-and-after resolver count recorded
- A naming convention written down: operation names, fragment names, and the file each lives in

## Classic WP Analogy

Fragments are template parts that declare their own data requirements. That sentence is the
whole analogy, and it is worth unpacking, because the second half is the part WordPress cannot
do:

| Classic WordPress | GraphQL |
|---|---|
| `template-parts/card-incident.php` | `fragment IncidentCardFields on Incident { … }` |
| `get_template_part('template-parts/card','incident')` | `...IncidentCardFields` spread into a query |
| One `WP_Query` per template, hand-tuned per archive | one operation document per route |
| `'fields' => 'ids'` to avoid hydrating full posts | selecting only the fields you render |
| `update_post_meta_cache()` priming meta for a loop | a fragment ensuring one query fetches everything the component needs |
| A central `class BTT_Queries` holding your query args | `src/graphql/` holding your documents |

If you have ever built an archive template, watched Query Monitor report six hundred queries,
and fixed it by priming the meta cache, you already have the instinct this lesson formalises:
**decide what data a page needs in one place, then render.** The reason WordPress archives go
wrong is that template parts fetch their own data lazily, one `get_post_meta()` at a time, deep
inside the loop. A fragment cannot do that. It declares its fields, they get composed into the
one query the route fires, and the component receives them as props.

The analogy breaks in the direction you want it to. A template part can silently depend on
`global $post`, on a meta field nobody documented, or on a filter another plugin added — which
is why moving a template part into a different context breaks it in ways that are hard to
diagnose. A fragment is typed and bound to a GraphQL type: `IncidentCardFields on Incident`
cannot be spread into a `Post` selection, and the component that consumes it receives a type
generated from exactly the fields the fragment requested. Read a field the fragment did not
ask for and it is a compile error, not a `null` at runtime. That property is worth stating
plainly, because it is the whole reason fragments beat "one big query file": the data contract
lives next to the component that depends on it, and the compiler enforces it.

The remaining break is a cost, honestly stated: fragments make it very easy to build a query
that is correct, typed, and enormous. Nothing about the mechanism stops you spreading eleven
fragments into one document and asking WordPress for four hundred fields. Codegen will type all
of them, TypeScript will be perfectly happy, and the page will take two seconds. The compiler
checks that you *can* read a field, never that you *should have asked for it*.

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
