---
title: 'The BlockRenderer'
module: 14
lesson: 2
teaches: [discriminated-unions, typename-narrowing, exhaustiveness-checking, rsc-recursion, block-registry, unknown-block]
produces: ['next-app/src/components/blocks/BlockRenderer.tsx', 'next-app/src/components/blocks/registry.ts', 'next-app/src/components/blocks/UnknownBlock.tsx']
requires: [14.1, 7.3]
---

# Lesson 14.2 — The BlockRenderer

## Quick Overview

`BlockRenderer` takes the flat list from Lesson 14.1 and turns it into a React tree. It is
roughly sixty lines and it is the most carefully designed component in the application, because
four decisions in it determine whether the block system stays maintainable for the next ten
modules or becomes a pile of special cases.

The four: **switch on `__typename`, never on `name`** — `name` is typed `string`, so it narrows
nothing and every branch would need a cast, whereas `__typename` is a literal union and gives
you real narrowing for free. **Put a `never`-typed `default` arm in**, so adding a block in
WordPress without mapping it in Next is a `npm run type-check` failure with the missing type
named in the error, rather than a blank space someone notices in production. **Own the recursion
in the renderer**, rebuilding the tree from `parentClientId` and passing children down, so that
individual block components never call `BlockRenderer` themselves and can therefore be tested in
isolation. And **`UnknownBlock` shouts in development, renders nothing in production, and never
falls back to `renderedHtml`** — a fallback that silently works is a fallback nobody ever
removes.

By the end of this lesson you will have:

- `next-app/src/components/blocks/registry.ts` — a `__typename`-keyed map from block type to component, typed so a wrong component signature fails to compile
- `next-app/src/components/blocks/BlockRenderer.tsx` — flat list to tree, recursion owned here, rendered as a Server Component
- `next-app/src/components/blocks/UnknownBlock.tsx` — a visible dev-only warning, `null` in production, no HTML fallback
- An exhaustiveness check that fails the build by name when a block type is unmapped, demonstrated by deleting a registry entry
- The blog detail route rendering through `BlockRenderer` instead of `dangerouslySetInnerHTML`, with the old code deleted rather than commented out

## Classic WP Analogy

WordPress has two mechanisms that do this job, and you have probably used both:

| Classic WordPress | `BlockRenderer` |
|---|---|
| `render_block` filter switching on `$block['blockName']` | `switch (block.__typename)` |
| `get_template_part('blocks/' . $name)` | `registry[block.__typename]` |
| `register_block_type` with a `render_callback` | a component per block in the registry |
| `$block['innerBlocks']` recursed by `render_block()` | the renderer rebuilding the tree from `parentClientId` |
| A missing template part → nothing rendered | `UnknownBlock` → a loud warning in dev |
| `has_block('btt/hobt-cta', $post)` | a lookup in the same typed list |

The template-part version is the closest, and it is worth naming why: dispatching on a string
to select a renderer is exactly what `get_template_part('blocks/' . $name)` does. The registry
is the same table, made explicit.

The analogy breaks on **what happens when the mapping is missing**, and this is the entire
argument for the `never` arm. `get_template_part('blocks/btt-hobt-cta')` with no such file
renders nothing at all: no error, no warning, no log line, and no way to discover it except a
human noticing a gap on a page. That failure mode is acceptable in PHP because PHP has no way to
know which block names exist. TypeScript does — the union of `__typename` values comes from the
committed schema — so it can tell you at build time that a case is unhandled. Assigning the
unmatched value to a `never`-typed variable is how you ask it to: if the union is fully covered,
the value in the `default` arm is `never` and the assignment compiles; if a case is missing, the
error names the type you forgot. That single line converts a silent content bug into a red CI
run.

The second break is about recursion and it is a genuine architectural difference.
`render_block()` recurses into `innerBlocks` itself, from inside the block being rendered, which
is fine because PHP has one stack and no boundaries. Here, recursion inside a block component
would mean every block component depends on the renderer, the renderer depends on the registry,
and the registry depends on every block component — a cycle that breaks tree-shaking, makes each
component untestable without the whole system, and makes it impossible to reason about which
components are Server Components. So the renderer takes the flat list, rebuilds the tree, and
passes each block's rendered children in as a prop. Block components receive `children` and
never think about nesting. That is why Lesson 14.1 selected `flat: true` and asked for
`parentClientId`.

One consequence worth stating for the next module: because `BlockRenderer` is a Server
Component, everything it renders is server-rendered by default, and a `btt/hobt-cta` that needs a
click handler becomes a client island *inside* the tree rather than turning the tree into
client code. Lesson 14.4 does exactly that.

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
