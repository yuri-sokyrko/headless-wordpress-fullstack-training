---
title: 'Mapping Custom Blocks & the HOBT Funnel'
module: 14
lesson: 4
teaches: [custom-block-mapping, typed-attributes, client-island-in-rsc, editor-composed-pages, catch-all-route, resolving-block-references]
produces: ['next-app/src/components/blocks/IncidentCallout.tsx', 'next-app/src/components/blocks/BlameQuote.tsx', 'next-app/src/components/blocks/ScapegoatPicker.tsx', 'next-app/src/components/blocks/IncidentTicker.tsx', 'next-app/src/components/blocks/HobtCta.tsx', 'next-app/src/app/[locale]/[...slug]/page.tsx', 'next-app/src/app/[locale]/hobt/page.tsx']
requires: [14.3, 13.4, 11.5]
---

# Lesson 14.4 — Mapping Custom Blocks & the HOBT Funnel

## Quick Overview

Five components, one per `btt/*` block from Module 13, and each one demonstrates a different
half of the pattern. `IncidentCallout` is the simple case: read typed attributes, render with
the `ui/` primitives, done. `BlameQuote` renders the children `BlockRenderer` handed it and
nothing else. `ScapegoatPicker` **resolves a reference** — the block stored only a term ID, so
the component looks the term up, which is why storing the ID rather than a copy in Lesson 13.3
was the right call. `IncidentTicker` re-runs the ticker's query in TypeScript rather than
touching the PHP output. And `HobtCta` is a **client island inside a Server Component tree**:
attributes become typed props, the props cross the boundary, and a Module 16 Server Action will
eventually be wired to the click.

Then the payoff. `/en/hobt` stops being the hard-coded section list from Lesson 11.5 and becomes
`<BlockRenderer blocks={page.editorBlocks} />`, and a `[...slug]` catch-all does the same for
every other WordPress page. Marketing reorders the HOBT landing page in Gutenberg, saves, and
the live site changes — no deploy, no code, no ticket. That is what the last two modules were
for, and it is worth taking the ninety seconds to actually do it and watch.

By the end of this lesson you will have:

- Five block components in `next-app/src/components/blocks/`, all registered and all exhaustively covered by the Lesson 14.2 check
- `ScapegoatPicker` resolving a stored term ID to live term data, verified by renaming the term without re-saving the post
- `IncidentTicker` running its own cache-tagged GraphQL query, with `renderedHtml` untouched
- `HobtCta` as a `'use client'` island receiving typed attributes as props, with its CTA still inert until Module 16
- `next-app/src/app/[locale]/hobt/page.tsx` rewritten to render `editorBlocks`, and `next-app/src/app/[locale]/[...slug]/page.tsx` doing the same for any WordPress page

## Classic WP Analogy

You have delivered this feature before, and the Classic route to it was a page template plus
ACF flexible content:

| Classic WordPress | Here |
|---|---|
| `templates/hobt.php` with a fixed section order | `page.tsx` rendering `editorBlocks` in the editor's order |
| ACF flexible content layouts | Gutenberg blocks |
| `if (get_row_layout() === 'hero')` in a `while (have_rows())` loop | `switch (block.__typename)` in the registry |
| `get_template_part('parts/hero')` per layout | one component per block type |
| `page-{slug}.php` for one-off pages | the `[...slug]` catch-all plus a block set |
| `get_term($id)` to resolve a stored term reference | the same lookup, in `ScapegoatPicker` |

ACF flexible content is a genuinely good answer to this problem, and if you built the Classic
version of this page you built something close to what you are building now. The block version
wins on editor experience — the editor sees the page rather than a stack of collapsed field
groups — and on the fact that blocks are core, so the content survives a plugin decision.

The analogy breaks on **who guarantees the shape of the page**, and this is the shift that
changes how you write every component in this lesson. A page template knows there is exactly one
hero, that it is first, and that a CTA follows the module grid. An editor-composed page
guarantees none of it. A block component may be rendered first or last, twice, zero times, or
nested inside a `core/columns` an editor added on a whim. So every component here has to be
**self-contained**: no assumption about position, no `margin-top` that only works second, no
"this is the hero so it owns the page background", and no shared state between siblings. A
component that only looks right at the top of the page is a bug that will be reported as "the
CMS broke the design".

The second break is one the Lesson 13.5 deprecation work predicted: **attributes are whatever
was stored, not whatever your `block.json` currently declares.** A post published before an
attribute existed has no value for it, because block deprecations are lazy and never touch the
database. So each component reads its attributes defensively and renders a sensible default
rather than crashing — and the generated types help here, because Content Blocks types
attributes as nullable for exactly this reason.

The third is a happier one. `HobtCta` needs an `onClick`, which in a Classic build would mean an
enqueued script, a `wp_localize_script()` payload and a jQuery handler bound to a class name. Here
it is one `'use client'` directive on one leaf component: the block's attributes are already
typed props, they cross the boundary as serialisable values, and the surrounding page — layout,
hero, module grid, testimonials — stays entirely on the server. That is the shape Lesson 09.2
was preparing you for, arriving four modules later in its real form.

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
