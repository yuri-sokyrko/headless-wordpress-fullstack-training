# Module 14 — Blocks as Data

## Prerequisites

Before starting this module you should have completed:

- **Module 13** — six blocks registered by `blame-the-tech-blocks`, and at least two blog posts plus the HOBT page composed with them
- **Module 10** — `fetchGraphQL`, codegen from a committed `schema.graphql`, and `npm run codegen:check` clean
- **Module 11** — `src/components/ui/` exists, so block components have primitives to render with
- **Module 07** — discriminated unions and `never`, because the renderer is built out of both

> ⚠️ **This is the second of the two conceptual jumps in the course** (Module 09 was the
> first). The reveal in Lesson 14.1 only lands if you have actually been living with the HTML
> blob since Module 09. If you quietly fixed it early, go and look at `git log` for
> `blog/[slug]/page.tsx` before you start.

## Starting State

```bash
# 1. Blocks exist in WordPress and are used in content
cd wordpress-headless
docker compose run --rm wpcli wp post list --post_type=post --format=count
# Expected: 10
docker compose run --rm wpcli wp plugin list --status=active --format=csv
# Expected: includes blame-the-tech-blocks

# 2. The front end still renders the body as one opaque string
cd ../next-app && grep -rln "dangerouslySetInnerHTML" src/app/ | sort
# Expected: three files — incidents/[slug], blog/[slug] and reviews/[slug] page.tsx.
#           That is the blob you remove, three times over.
```

```
next-app/src/
├── components/{ui,layout,incidents,hobt}/          (M11)
├── lib/graphql/{client,errors,tags}.ts             (M10)
├── graphql/  gql/                                  (M10, committed)
└── app/[locale]/blog/[slug]/page.tsx               renders `content` as HTML
```

There is no `src/components/blocks/` and no `[...slug]` catch-all route.

## What You'll Learn

- **WPGraphQL Content Blocks** — `editorBlocks` as a flat, typed, ordered list with `attributes`, `clientId`, `parentClientId` and `renderedHtml`
- **Why `renderedHtml` is never rendered** — five concrete failures, from `<a>` instead of `<Link>` to a `dangerouslySetInnerHTML` surface fed by anyone with `edit_posts`
- **Discriminated unions in practice** — `switch` on `__typename`, never on `name`
- **Exhaustiveness checking** — a `never`-typed `default` arm, so an unmapped block fails the **build**, not the page
- **Recursion owned by the renderer** — flat list to tree, and why block components never render their own children
- **Sanitized rich text** — one component, `isomorphic-dompurify`, a strict allowlist, and the only `dangerouslySetInnerHTML` in the entire codebase
- **Client islands from block attributes** — typed props crossing the server/client boundary inside an RSC tree
- **`next/image`** — `remotePatterns`, `sizes`, `priority`, and what WordPress gives you to compute an aspect ratio with

## What You'll Build

`src/components/blocks/` — `BlockRenderer.tsx`, a `registry.ts` mapping `__typename` to
component, `RichText.tsx`, `UnknownBlock.tsx`, and one component per block you support: core
paragraph, heading, list, quote, code and image, plus the five `btt/*` blocks from Module 13.
Then the `[...slug]` catch-all that renders any WordPress page through the same renderer, and
`next.config.ts` configured for WordPress-hosted media.

After this module editor-composed pages render as a real React tree. `/en/hobt` changes when
marketing edits the page, with no deploy and no code change — which was the whole point of
composing it from blocks.

## Lessons

| #  | Lesson | New Technology | What You Build |
|----|--------|----------------|----------------|
| 01 | [WPGraphQL Content Blocks](01-wpgraphql-content-blocks.md) | `editorBlocks`, `flat: true`, generated block types | The `editorBlocks` fragment, refreshed schema and `src/gql/` |
| 02 | [The BlockRenderer](02-the-block-renderer.md) | Discriminated unions, `never` exhaustiveness, recursion | `BlockRenderer.tsx`, `registry.ts`, `UnknownBlock.tsx` |
| 03 | [Mapping Core Blocks & Safe HTML](03-mapping-core-blocks-and-safe-html.md) | `isomorphic-dompurify`, a strict allowlist | `RichText.tsx` and six core-block components |
| 04 | [Mapping Custom Blocks & the HOBT Funnel](04-mapping-custom-blocks-and-the-hobt-funnel.md) | Typed attributes, client islands in an RSC tree | The five `btt/*` components, `/hobt`, `[...slug]` |
| 05 | [Media, Images & next/image](05-media-images-and-next-image.md) | `next/image`, `remotePatterns`, `sizes` | `CoreImage.tsx` and image config |

## The verdict on `renderedHtml`

WPGraphQL Content Blocks returns both `attributes` and `renderedHtml` for every block. The
course uses `attributes` and **never** renders `renderedHtml`. Lesson 14.1 argues it in full;
this is the summary you will want to quote in a code review.

| What `renderedHtml` costs you | Consequence |
|---|---|
| Raw `<a href>` and `<img src>` | No `next/link` prefetch, no `next/image` optimisation, no locale-aware hrefs |
| WordPress class names | `wp-block-*` classes Tailwind never compiled a style for |
| WordPress's locale | The blob is rendered in WP's language, not the route's — breaks Module 20 |
| HTML baked at WP render time | Nothing to key a cache tag off, so Module 18's tag-based revalidation degrades |
| A `dangerouslySetInnerHTML` surface | Fed by any user with `edit_posts`, which in this app includes editors, not just admins |

The one narrow exception is **inline** rich text — bold, italic, links inside a paragraph — and
it is routed through the single sanitizing component in Lesson 14.3. `btt/incident-ticker`,
which is server-rendered in WordPress, re-runs its query on the Next side instead of shipping
its PHP output.

> **The cost, stated plainly.** Refusing `renderedHtml` means every block an editor can insert
> needs a component, and a block with no component is a build failure rather than a rough
> rendering. That is the correct trade for a designed product and the wrong one for a site
> where editors may install arbitrary block plugins. Lesson 14.2 makes the failure loud and
> early precisely because the alternative — a silent HTML fallback — is a fallback nobody would
> ever remove.

## How to Work

1. **Read the module README** and confirm Starting State, including the two `dangerouslySetInnerHTML` hits. You are about to delete both.
2. **Work the lessons in order.** 14.2 is unusable without 14.1's generated types, and 14.3 through 14.5 all plug into 14.2's registry.
3. **Break the exhaustiveness check on purpose.** Delete one entry from `registry.ts` and run `npm run type-check`. The build should fail, by name. That failure is the feature.
4. **Run `## Verification` before moving on**, then commit: `git commit -m "feat(next): render editor blocks as a typed react tree"`.
