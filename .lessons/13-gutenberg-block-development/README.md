# Module 13 — Gutenberg Block Development

## Prerequisites

Before starting this module you should have completed:

- **Module 12** — `npm test` and `npx playwright test` are green against deterministic seed data
- **Modules 08 and 09** — `edit.js` **is** a React component, using hooks and JSX. This module is deliberately placed after React, not next to Module 03
- **Module 04** — the ACF field groups exist, because Lesson 13.5's stretch block reads one through Block Bindings
- **Module 03** — `blame-the-tech-core` registers the post types these blocks are allowed in

> ⚠️ **You are writing React inside WordPress, with WordPress's own build tooling.** The
> `@wordpress/scripts` toolchain is not the Next.js toolchain: different bundler config,
> different React version resolution, and `wp-` prefixed externals rather than `node_modules`
> imports. Do not try to share code between `blame-the-tech-blocks` and `next-app`.

## Starting State

```bash
# 1. Both test suites green
cd next-app && npm test -- --run && npx playwright test
# Expected: all passing

# 2. WordPress is up, seeded, and the editor works
cd ../wordpress-headless
docker compose run --rm wpcli wp plugin list --status=active --format=csv
# Expected: includes blame-the-tech-core, wp-graphql, advanced-custom-fields-pro
#           (PRO, not free ACF — Lesson 04.2 swapped them, and the free plugin's
#            slug is gone from the active list)
open http://localhost:8080/wp-admin/post-new.php?post_type=incident
# Expected: the block editor loads with core blocks only
```

```
wordpress-headless/wp-content/
├── plugins/blame-the-tech-core/                (M03, M04, M06)
├── mu-plugins/blame-seeder/                    (M12)
└── themes/btt-headless/                        (M02) style.css, functions.php, index.php
```

There is no `plugins/blame-the-tech-blocks/` and no `themes/btt-headless/theme.json`.

## What You'll Learn

- **The block editor mental model** — blocks as serialised HTML comments in `post_content`, and the editor as a React app over a normalised store
- **`block.json` and Block API v3** — declarative registration, `apiVersion: 3`, `supports`, `attributes`, asset handles, and `wp i18n`
- **`@wordpress/scripts`** — `wp-scripts build` / `start`, the `src/<block>/` convention, and why you never hand-write a webpack config
- **`edit` versus `save`** — the editor component and the serialiser, and why a mismatch produces the "this block contains unexpected content" warning
- **`RichText`, `InnerBlocks`, `InspectorControls`** — the three editor UI mechanisms that cover almost every real block
- **`@wordpress/data`** — `useSelect` against `core-data`, and the one place in this course where REST is the right API
- **Dynamic blocks** — `render: file:./render.php`, `save: () => null`, and what "server-rendered" costs you in a headless build
- **Deprecations** — how to change a block's markup without breaking ten thousand published posts
- **`theme.json`** — palette, typography and spacing presets, so the editor's controls produce values the front end already knows

## What You'll Build

A second plugin, `blame-the-tech-blocks`, with six blocks under `src/`, built by
`@wordpress/scripts`, plus a minimal `theme.json` in `btt-headless` so the editor offers the
same design tokens Module 11 defined in Tailwind.

After this module editors have six custom blocks in Gutenberg and can compose the HOBT landing
page and the blog posts with them. **The Next.js front end still ignores every one of them** —
it renders `content` as an HTML blob, exactly as it has since Module 09. That is deliberate,
and Module 14 is where it changes.

## Lessons

| #  | Lesson | New Technology | What You Build |
|----|--------|----------------|----------------|
| 01 | [The Block Editor Mental Model](01-the-block-editor-mental-model.md) | Block serialisation, `@wordpress/scripts` | The `blame-the-tech-blocks` plugin scaffold and build |
| 02 | [Your First Static Block](02-your-first-static-block.md) | `block.json`, `attributes`, `RichText`, `save()` | `btt/incident-callout` |
| 03 | [Attributes, Controls & the Inspector](03-attributes-controls-and-the-inspector.md) | `InnerBlocks`, `InspectorControls`, `useSelect` | `btt/blame-quote` and `btt/scapegoat-picker` |
| 04 | [Dynamic Blocks & the Data Module](04-dynamic-blocks-and-the-data-module.md) | `render.php`, `save: () => null`, attribute design | `btt/incident-ticker` and `btt/hobt-cta` |
| 05 | [Block Quality, Deprecations & theme.json](05-block-quality-deprecations-and-theme-json.md) | `deprecated`, `usesContext`, Block Bindings, `theme.json` | `theme.json`, a real deprecation, and `btt/tech-verdict-card` (stretch) |

## The six blocks

Each one exists because it teaches a mechanism the others do not. None of them is decoration.

| Block | Lesson | Mechanism it teaches | Storage |
|---|---|---|---|
| `btt/incident-callout` | 13.2 | `attributes`, `source`, `RichText`, a real `save()` | Static — markup in `post_content` |
| `btt/blame-quote` | 13.3 | `InnerBlocks` with `allowedBlocks` and a template | Static — children serialise themselves |
| `btt/scapegoat-picker` | 13.3 | `InspectorControls` + `useSelect` on `@wordpress/core-data`, storing a **term ID, not a copy** | Static — one numeric attribute |
| `btt/incident-ticker` | 13.4 | Dynamic rendering: `render: file:./render.php`, `save: () => null` | Nothing in `post_content` but the comment |
| `btt/hobt-cta` | 13.4 | Attribute design for a typed consumer — becomes a client island in Lesson 14.4 | Static — attributes only |
| `btt/tech-verdict-card` | 13.5 | `usesContext` and Block Bindings reading ACF — **optional / stretch** | Static — bindings resolve at render |

> **The sixth block is optional, and the seed data does not know that.** `wp blame seed`
> writes `btt/tech-verdict-card` into `blog-01`, `blog-02` and the HOBT page, so a learner who
> skips Lesson 13.5's stretch step has three posts containing a block WordPress has never heard
> of — wp-admin says "your site does not include support for this block", and Module 14 renders
> it through `UnknownBlock`. That is a designed outcome, not a mistake: it is the only place in
> the course where you get to see what an unregistered block actually does to real content.

> **`btt/scapegoat-picker` is the one place this course consumes REST.** The block editor is a
> REST client by construction, so `useSelect(select => select('core').getEntityRecords(...))`
> is the correct API inside wp-admin. The front end still never touches REST. Both statements
> are true at once, and Lesson 13.3 explains why that is not a contradiction.

Term slugs, field names and post types used by these blocks are fixed by
[the content model contract](../appendix/03-content-model-reference.md).

## How to Work

1. **Read the module README** and confirm Starting State — in particular that the block editor currently loads with core blocks only.
2. **Work the lessons in order.** Each block builds on the previous one's `block.json` patterns, and 13.5's deprecation is a deprecation *of the block you wrote in 13.2*.
3. **Keep `npm run start` running** in `blame-the-tech-blocks` and hard-reload wp-admin after each save. A stale build is the cause of most "my block disappeared" reports.
4. **Run `## Verification` before moving on**, then commit: `git commit -m "feat(blocks): six custom blocks with block.json and theme.json"`.
