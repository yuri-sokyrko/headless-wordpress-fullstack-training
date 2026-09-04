---
title: 'Attributes, Controls & the Inspector'
module: 13
lesson: 3
teaches: [inner-blocks, allowed-blocks, block-templates, inspector-controls, use-select, wordpress-core-data, storing-ids-not-copies]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/blame-quote/block.json', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/blame-quote/edit.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/blame-quote/save.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/scapegoat-picker/block.json', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/scapegoat-picker/edit.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/scapegoat-picker/save.js']
requires: [13.2]
---

# Lesson 13.3 — Attributes, Controls & the Inspector

## Quick Overview

Two blocks, two mechanisms neither of which `btt/incident-callout` needed. `btt/blame-quote`
uses **`InnerBlocks`**: instead of storing its content in attributes, it declares a region other
blocks can be placed inside, restricted with `allowedBlocks` and pre-populated with a
`template`. Children serialise themselves, so the block's own `save()` becomes a wrapper and
nothing else. `btt/scapegoat-picker` uses **`InspectorControls`** to put its settings in the
sidebar rather than inline, and **`useSelect`** to read the `scapegoat` taxonomy terms out of
WordPress's own data store so the editor picks from a real list.

The design decision buried in `scapegoat-picker` is the one worth arguing about: it stores the
**term ID and nothing else**. Not the name, not the slug, not the avatar URL. Copying those into
the block would make the front end's job trivially easy and would mean that renaming a scapegoat
term leaves stale names scattered through forty published posts, with no way to find them. Store
the reference; resolve it at read time. That is the same instinct that made `scapegoat` a
taxonomy rather than an ACF text field in the first place, and Lesson 14.4 is where it pays off.

By the end of this lesson you will have:

- `src/blame-quote/*` — an `InnerBlocks` block with `allowedBlocks`, a `template`, and `templateLock` considered and decided
- `src/scapegoat-picker/*` — an `InspectorControls` panel with a term selector and one numeric attribute
- A `useSelect` call against `@wordpress/core-data` that handles its own loading and empty states
- A single `scapegoatId` attribute stored on the block, with no denormalised term data
- A verified reload: renaming a scapegoat term in wp-admin changes what the block shows, with no post re-save

## Classic WP Analogy

Both mechanisms have Classic counterparts you have used, and the `InspectorControls` one is
almost exact:

| Classic WordPress | Block editor |
|---|---|
| `add_meta_box(…, 'side', …)` | `<InspectorControls>` |
| `wp_dropdown_categories(['taxonomy' => 'scapegoat'])` | `useSelect` + `getEntityRecords('taxonomy','scapegoat')` |
| `<select name="btt_scapegoat">` in a meta box | `<SelectControl>` in the inspector |
| `update_post_meta($id,'scapegoat_id',$v)` | `setAttributes({ scapegoatId: v })` |
| Nested shortcodes with `do_shortcode($content)` | `InnerBlocks` |
| `get_template_part()` with a `$content` argument | `<InnerBlocks.Content />` in `save()` |
| A meta box that queries terms server-side | an async subscription to a client store |

If you have built a meta box with a taxonomy dropdown — and you have — the shape is identical:
list the terms, let the editor pick one, store the choice. The inspector is simply that meta box
rendered by React inside the editor's own sidebar, which means it participates in undo, in block
duplication, and in copy-paste between posts for free.

The analogy breaks on **when the data arrives**, and this is the difference that generates the
bug. `wp_dropdown_categories()` runs on the server with the taxonomy already loaded, so by the
time your HTML exists the options exist. `useSelect` is a **subscription**: on the first render
it returns `undefined`, then WordPress fetches `/wp-json/wp/v2/scapegoat`, then your component
re-renders with the terms. A block whose `edit` assumes the array exists crashes the editor on
first paint, and the crash presents as a blank white block with an unhelpful console message.
Every `useSelect` in this codebase handles three states — loading, empty, loaded — and the empty
case is real, because a fresh install has no terms until activation seeds them.

The second break is a philosophical one that Classic WordPress lets you dodge.
`wp_dropdown_categories()` is a *rendering* concern, so it does not matter much where its data
comes from. `useSelect` reads the same normalised store the entire editor is built on — the same
store that knows about the current post, its autosave status, the user's capabilities and every
registered block. Learning `useSelect` is learning the editor's actual architecture, not just a
control.

> **This is the one place in the course where REST is the correct API.** The block editor is a
> REST client by construction, so `getEntityRecords` is right, idiomatic, and cheap. It does not
> contradict the rule that the front end never touches REST — those are two different clients
> with two different threat models. wp-admin is authenticated, same-origin and already trusted;
> the public front end is neither.

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
