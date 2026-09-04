---
title: 'WPGraphQL Content Blocks'
module: 14
lesson: 1
teaches: [wpgraphql-content-blocks, editor-blocks, block-attributes-over-the-wire, rendered-html-rejected, flat-block-list]
produces: ['next-app/src/graphql/fragments/editorBlocks.graphql', 'wordpress-headless/schema.graphql', 'next-app/src/gql/']
requires: [13.4, 10.2]
---

# Lesson 14.1 — WPGraphQL Content Blocks

## Quick Overview

The HTML blob you have been rendering since Module 09 was always a structured tree. Here it is.

`content` is a serialisation, not a document. Every `<div>` in it was produced from a block with
a name and typed attributes, and WordPress has always been able to hand you the structure rather
than the string. WPGraphQL Content Blocks exposes exactly that: `editorBlocks` on any content
node, a flat ordered list where each entry carries a `__typename`, a `clientId`, a
`parentClientId` and its own `attributes`. Query it once and the paragraph is a
`CoreParagraph`, the callout is a `BttIncidentCallout`, and `severity` is a string you can
switch on instead of a class name you have to parse. This is the most important conceptual
moment in the course, and it is worth pausing on: the loss of structure you have been working
around for five modules was never in the data, only in the field you were asking for.

The lesson also settles a decision that shapes the whole of `src/components/blocks/`. Every
block comes back with **both** `attributes` and `renderedHtml` — WordPress's own rendering of
that block — and `renderedHtml` looks like a shortcut that saves you writing twelve components.
It is not. Rendering it costs you client-side navigation, image optimisation, your design
system, the route's locale, cache-tag granularity, and it opens a `dangerouslySetInnerHTML`
surface writable by anyone with `edit_posts`. The rule for the rest of the course is short:
**never render `renderedHtml`.** This lesson makes the argument in full so that the rule is a
conclusion rather than a decree.

By the end of this lesson you will have:

- WPGraphQL Content Blocks installed and configured, with `btt/*` blocks appearing as generated GraphQL types
- `next-app/src/graphql/fragments/editorBlocks.graphql` — a flat `editorBlocks` selection with per-type inline fragments
- A refreshed `wordpress-headless/schema.graphql` and regenerated `next-app/src/gql/`, both committed, with the diff reviewed
- A GraphiQL side-by-side of the same blog post as `content` and as `editorBlocks`, saved for reference
- A written decision record rejecting `renderedHtml`, with the five costs enumerated and the one narrow exception named

## Classic WP Analogy

WordPress has shipped this exact capability in PHP since 5.0, and you may well have used it:

```
Classic PHP                                 WPGraphQL Content Blocks
──────────────────────────────────────────  ──────────────────────────────────────────
$blocks = parse_blocks($post->post_content);  editorBlocks(flat: true) {
foreach ($blocks as $b) {                       __typename
  $b['blockName']   // 'btt/incident-callout'   clientId
  $b['attrs']       // ['severity' => 's1…']    parentClientId
  $b['innerBlocks'] // nested array             ... on BttIncidentCallout {
  render_block($b); // ← the trap               attributes { severity headline }
}                                               }
                                              }
```

`parse_blocks()` is the same idea, and if you have written a `render_block` filter or built a
custom block-driven template you already have the mental model. `blockName` is `__typename`,
`attrs` is `attributes`, `innerBlocks` is what `parentClientId` reconstructs, and
`render_block()` is `renderedHtml`. The structure was always available; the only new thing is
that it now crosses a network boundary.

The analogy breaks in one good way and one dangerous way.

**The good break: `attrs` is untyped and `attributes` is not.** `parse_blocks()` returns
`attrs` as a plain associative array of whatever JSON happened to be in the comment — every
value is `mixed`, missing keys are silent, and a typo in `$b['attrs']['severty']` is a `null`
you find in production. WPGraphQL Content Blocks registers a **distinct GraphQL type per block**,
which means codegen produces a distinct TypeScript type per block, which means Lesson 14.2 can
build a discriminated union over them and have the compiler check that you handled every case.
This is the payoff for every hour spent in Module 10.

**The dangerous break: `render_block()` is the right answer in PHP and the wrong answer here.**
In a Classic theme, calling `render_block()` is correct — it is the same rendering path the rest
of the site uses, the theme's CSS matches the output, and links are ordinary anchors that work.
Reaching for `renderedHtml` in Next feels like the same move and is not, because the output is
now crossing into a system that shares none of those assumptions:

| Cost | Detail |
|---|---|
| No `next/link` | You get raw `<a href>`, so every internal link is a full document load |
| No `next/image` | Raw `<img src>` — no optimisation, no `sizes`, no LCP priority, and Module 21 fails |
| Wrong CSS | `wp-block-*` class names Tailwind never compiled a rule for, so it is unstyled or half-styled |
| Wrong locale | The blob is rendered in WordPress's current language, not the route's — Module 20 breaks |
| No cache granularity | HTML baked at WP render time, with nothing for `revalidateTag` to key on |
| An XSS surface | `dangerouslySetInnerHTML` fed by any user with `edit_posts`, which in this app means editors, not just administrators |

The one narrow exception is **inline** rich text — the `<strong>`, `<em>` and `<a>` inside a
paragraph's own text — which genuinely is HTML and genuinely has to be rendered as HTML.
Lesson 14.3 routes it through a single sanitizing component, and that component is the only place
`dangerouslySetInnerHTML` appears in the entire codebase.

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
