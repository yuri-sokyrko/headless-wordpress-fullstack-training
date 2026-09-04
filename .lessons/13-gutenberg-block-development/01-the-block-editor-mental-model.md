---
title: 'The Block Editor Mental Model'
module: 13
lesson: 1
teaches: [block-serialization, block-api-v3, wp-scripts, block-registration, editor-as-react-app]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-blocks/blame-the-tech-blocks.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/package.json']
requires: [12.4, 9.2]
---

# Lesson 13.1 — The Block Editor Mental Model

## Quick Overview

Before you write a block, it is worth knowing exactly what one is, because the answer explains
every strange thing the block editor does. A block is **markup already serialised into
`post_content`**, wrapped in an HTML comment that names the block and carries its attributes as
JSON. The post content is still the source of truth, still one `longtext` column, and still what
`the_content()` prints. The editor is a React application that parses those comments into a
normalised JavaScript store, renders a component per block, and re-serialises the whole document
on save.

Two consequences worth internalising now. First, `edit.js` **is a React component** — it takes
props, uses hooks, returns JSX, and obeys everything you learned in Module 08. That is precisely
why this module sits at 13 and not next to Module 03: writing your first React component inside
WordPress's build tooling, with WordPress's data layer, in a plugin, would have been three new
things at once. Second, the toolchain is not the Next.js toolchain. `@wordpress/scripts` owns
the bundler config, resolves `@wordpress/*` imports to the `wp-` globals WordPress already
enqueues, and expects a `src/<block-name>/` layout. Do not try to share code between this
plugin and `next-app`.

By the end of this lesson you will have:

- `wordpress-headless/wp-content/plugins/blame-the-tech-blocks/blame-the-tech-blocks.php` — plugin header registering blocks from the build directory
- `wordpress-headless/wp-content/plugins/blame-the-tech-blocks/package.json` with `@wordpress/scripts`, `build`, `start` and `lint` scripts
- The plugin activated, `npm run start` watching, and an empty `btt` block category visible in the inserter
- A hand-read example of block serialisation: a paragraph and a group inspected as raw `post_content`
- A written note of which WordPress packages are externals rather than bundled dependencies, and why that matters for bundle size

## Classic WP Analogy

You have solved the "structured content inside a post" problem twice before, and blocks are the
third attempt:

| Approach | Where the data lives | Editor UI | Front-end rendering |
|---|---|---|---|
| **Shortcodes** | `[btt_callout source="dns"]` in `post_content` | none — raw text | a PHP callback, at render time |
| **Meta boxes + post meta** | `wp_postmeta` rows | a form beside the editor | template reads `get_post_meta()` |
| **Blocks** | an HTML comment plus markup in `post_content` | a React component, in place | the saved markup, or a PHP callback |

Blocks are closest to shortcodes: both live inline in `post_content`, both carry attributes as
part of the content, and both can be reordered by moving text. The difference is that a
shortcode is opaque until render, while a block stores both the attributes *and* the resulting
markup, which is why a block renders instantly in the editor and a shortcode shows you
`[btt_callout source="dns"]`.

The analogy breaks in three ways that will each cost you an hour if you meet them unprepared.

**Attributes are stored twice, and the copies must agree.** A shortcode has exactly one
representation. A block has the JSON in the comment *and* the rendered markup below it, and on
load WordPress re-runs your `save()` function and compares its output to the stored markup. If
they differ by so much as an attribute order, you get "this block contains unexpected content"
and the editor offers to convert it to HTML. Nothing in Classic WordPress validates your output
against previously-saved output, and this validator is the single most common source of block
development frustration.

**The editor is a client of the REST API, not of your PHP.** The block editor loads a post over
`/wp-json/wp/v2/…`, holds it in a JavaScript store, and saves it back the same way — which is
why [the content model contract](../appendix/03-content-model-reference.md#1-post-types)
requires `show_in_rest => true` on every post type even though this is a headless build. A post
type with REST disabled has no working editor, and the symptom is a white screen rather than a
useful error.

**Nothing here renders your front end.** This is the headless-specific break, and it is the one
to keep in mind for the next five lessons. In a Classic build, the markup `save()` produces
*is* what visitors see, so `style.scss` matters and getting the class names right matters. Here,
Next.js will read the **attributes** and render its own components — Module 14 — so `save()`'s
markup exists only to keep the editor and `the_content()` happy. That is not a reason to be
sloppy with it, but it does change what you optimise for.

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
