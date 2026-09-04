---
title: 'Dynamic Blocks & the Data Module'
module: 13
lesson: 4
teaches: [dynamic-blocks, render-php, save-returns-null, server-side-render, attribute-design-for-consumers, block-context]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-ticker/block.json', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-ticker/edit.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-ticker/render.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/hobt-cta/block.json', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/hobt-cta/edit.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/hobt-cta/save.js']
requires: [13.3]
---

# Lesson 13.4 — Dynamic Blocks & the Data Module

## Quick Overview

Some blocks cannot be static. `btt/incident-ticker` shows the five most recent S1 and S2
incidents, and freezing that list into `post_content` at save time would mean a ticker that is
wrong within a day. So it becomes a **dynamic block**: `save: () => null`, nothing but the
comment in the post content, and a `render: file:./render.php` that queries WordPress at request
time. `btt/hobt-cta` goes the other way — it is static, its attributes are simple, and it exists
to be a design exercise in what a block should store when the consumer is a typed React
component rather than a PHP template.

Dynamic blocks are also the one place in this module where headless costs you something real,
and the lesson says so plainly. `render.php` produces PHP-rendered HTML, and Module 14 has a
hard rule against rendering WordPress's HTML on the Next side — so the ticker's PHP output is
useful in wp-admin and in the WordPress-rendered preview, and completely unused by your actual
front end. Next re-runs the equivalent query itself. That means the ticker's logic exists twice,
in two languages, and keeping them agreeing is a maintenance cost you are choosing on purpose.
Naming that cost is more useful than pretending dynamic blocks are free.

By the end of this lesson you will have:

- `src/incident-ticker/*` — a dynamic block with `save: () => null` and `render: file:./render.php`
- A `render.php` using `WP_Query` with a `tax_query` on `severity`, output escaped with `esc_html()` and `wp_kses_post()`
- An `edit.js` that shows a live preview in the editor using `useSelect`, not a static placeholder
- `src/hobt-cta/*` — attributes designed for a typed consumer: a label, a variant from a closed set, a target and a `LeadSource` value
- A written comparison of what the ticker costs in a headless build versus a Classic one, and why it is still the right choice here

## Classic WP Analogy

A dynamic block is a shortcode with a user interface. That is not an approximation — the
mechanism is the same and even the PHP looks the same:

```
Classic: shortcode                          Dynamic block: render.php
──────────────────────────────────────────  ──────────────────────────────────────────
add_shortcode('btt_ticker', function($a) {  <?php
  $q = new WP_Query([                       // render.php receives $attributes,
    'post_type'      => 'incident',         // $content and $block
    'posts_per_page' => (int) $a['count'],  $q = new WP_Query([
    'tax_query'      => [[ … ]],              'post_type'      => 'incident',
  ]);                                         'posts_per_page' => $attributes['count'],
  ob_start();  /* … */  return ob_get_clean(); 'tax_query'      => [[ … ]],
});                                         ]);
                                            // echo directly; the block wrapper handles the rest
```

Both run on every request, both read attributes, both query the database, both must escape their
output. If you have written a shortcode that lists posts, you have written a dynamic block's
renderer. What the block adds is everything around it: an inserter entry, an inspector panel, a
live preview in the editor, undo support, and attributes with declared types instead of
`shortcode_atts()` defaults.

The analogy breaks in the direction that matters for this course. **A shortcode's output is the
deliverable; `render.php`'s output is not.** In a Classic build, `render.php` renders the thing
visitors see, and that is the end of the story. In this architecture, WPGraphQL Content Blocks
exposes the ticker block's `renderedHtml` — the output of that very PHP — and Lesson 14.1
establishes a hard rule against rendering it: it arrives with `wp-block-*` classes Tailwind
never compiled, raw `<a>` tags that bypass client-side navigation, WordPress's locale rather
than the route's, and HTML baked at WordPress render time with nothing to hang a cache tag on.
So Next reads the ticker's *attributes* — `count`, `severities` — and fires its own GraphQL
query, in TypeScript, with its own cache tags.

The cost, stated plainly: the ticker's selection logic is implemented twice, once in
`render.php` and once in a React component in Lesson 14.4, and a change to one is a silent
divergence from the other. The alternatives are worse. Rendering `renderedHtml` would breach a
security and design boundary the whole front end depends on; making the block static would make
it wrong; dropping the PHP renderer entirely would break the editor preview and the WordPress
preview route Module 17 relies on. Two implementations, documented and tested, is the least bad
option — and the second implementation is nine lines because the query already exists.

`btt/hobt-cta` has a smaller and happier break. In a Classic build you would store the
button's classes and markup, because markup is the output. Here you store **meaning**: a
`variant` from a closed set, a `leadSource` from the `LeadSource` enum in
[the content model contract](../appendix/03-content-model-reference.md#3-registered-graphql-enums),
and a target URL. The front end decides what a `primary` variant looks like. That is the whole
attribute-design principle for a headless block set: store what the editor decided, never how it
should look.

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
