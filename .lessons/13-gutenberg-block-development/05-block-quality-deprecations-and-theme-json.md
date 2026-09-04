---
title: 'Block Quality, Deprecations & theme.json'
module: 13
lesson: 5
teaches: [block-deprecations, block-supports, theme-json, block-bindings, block-uses-context, block-i18n, wp-scripts-lint]
produces: ['wordpress-headless/wp-content/themes/btt-headless/theme.json', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/tech-verdict-card/block.json', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/tech-verdict-card/edit.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/tech-verdict-card/save.js']
requires: [13.4]
---

# Lesson 13.5 — Block Quality, Deprecations & theme.json

## Quick Overview

Five blocks work. This lesson makes them maintainable. You will add a real `deprecated` entry to
`btt/incident-callout` — changing its saved markup and providing a migration so the forty posts
already using it keep loading — audit `supports` across all five blocks so editors get the
controls they should and none of the ones they should not, add translation functions so the
editor UI is localisable before Module 20 needs it, and get `wp-scripts lint-js` clean.

Then `theme.json`, which in a headless build does something narrower and more interesting than
usual: it configures the **editor**, not the site. The palette, type scale and spacing presets
you declare there are the options an editor sees in Gutenberg, and they are deliberately the
same tokens Lesson 11.1 defined in Tailwind — so when someone picks "S1 Catastrophic red" in
wp-admin, they pick a value your front end already has a class for. The lesson closes with an
**optional stretch block**, `btt/tech-verdict-card`, using `usesContext` and Block Bindings to
read an ACF field from the surrounding post. It is genuinely useful and genuinely newer API
surface than the rest of the module, so skipping it costs you nothing in Module 14.

By the end of this lesson you will have:

- A working `deprecated` array on `btt/incident-callout`, with an old post loading without a validation warning
- An audited `supports` set across all five blocks, with `color`, `spacing` and `align` decided per block rather than by default
- `__()` / `_x()` around every editor-facing string, with a text domain matching the plugin
- `wordpress-headless/wp-content/themes/btt-headless/theme.json` declaring the same tokens as Lesson 11.1
- `btt/tech-verdict-card` **(optional)** reading `techReviewFields.verdict` through Block Bindings, with `usesContext` for the post ID

## Classic WP Analogy

Two of the three topics have close Classic counterparts, and one is genuinely new:

| Classic WordPress | Here |
|---|---|
| `add_theme_support('editor-color-palette', …)` | `theme.json` → `settings.color.palette` |
| `add_theme_support('editor-font-sizes', …)` | `settings.typography.fontSizes` |
| A plugin update that must not break old data | a `deprecated` entry with a `migrate` function |
| `dbDelta()` plus a version-gated upgrade routine | the same idea, but lazy and per-block |
| `load_plugin_textdomain()` + `__()` in PHP | `__()` from `@wordpress/i18n` + `wp i18n make-json` |
| `get_the_ID()` available ambiently in a template | `usesContext: ['postId']`, declared explicitly |

The `theme.json` comparison is exact enough to be reassuring: it is the same list of colours and
font sizes you used to register with `add_theme_support`, moved into a JSON file with a schema
and a much larger surface. If you have configured an editor palette before, you already know
what this file is for.

Deprecations are where the analogy breaks, and the break is worth understanding properly because
it is unlike any migration you have written. A WordPress plugin upgrade routine is **eager and
central**: it bumps a version option, runs once, rewrites the data, done. A block deprecation is
**lazy and per-instance**. It does not touch the database at all. It sits in an array, and each
time the editor loads a post containing an old-format block, the parser tries your current
`save()`, fails validation, walks the `deprecated` entries until one matches, runs its `migrate`
function, and hands the editor the modernised attributes. The stored `post_content` is still the
old markup until somebody re-saves that post — which they may never do.

Two consequences follow, and both matter for Module 14. Old deprecations can essentially never be
deleted, because there may always be an unopened 2019 post relying on one. And the front end must
tolerate both shapes: a block queried through WPGraphQL Content Blocks returns whatever
attributes are actually stored, which for an un-re-saved post is the old set. Lesson 14.4's block
components handle a missing attribute by rendering a sensible default rather than crashing, and
this is why.

The second break is smaller but sharper: **`theme.json`'s `styles` section does nothing for your
site.** In a Classic block theme, `theme.json` generates the front-end CSS — that is most of its
value. Here, Next.js renders every page and never loads a WordPress stylesheet, so the `styles`
half of the file affects only wp-admin and the WordPress-rendered preview. The `settings` half is
what matters, because it constrains what editors can choose. Spending an afternoon perfecting
front-end styles in `theme.json` is the same mistake as perfecting `style.scss` in Lesson 13.2,
and it is an easy one to make because every tutorial you will find assumes a Classic front end.

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
