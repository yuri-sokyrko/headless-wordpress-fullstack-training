---
title: 'Your First Static Block'
module: 13
lesson: 2
teaches: [block-json, block-attributes, attribute-source, rich-text, save-function, block-validation]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/block.json', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/edit.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/save.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-callout/style.scss']
requires: [13.1]
---

# Lesson 13.2 — Your First Static Block

## Quick Overview

`btt/incident-callout` is the block an editor drops into a blog post to flag a live incident: a
severity level, a short headline, and a body they can make bold and add links to. It is a
**static** block, meaning everything it needs is serialised into `post_content` at save time
and no PHP runs at render time. Static is the right default for most blocks and the right place
to start, because it forces you to meet `block.json`, `attributes`, `edit`, `save` and the block
validator in one sitting.

The concept with the most depth here is the `attributes` schema, and specifically `source`. An
attribute with no `source` is stored as JSON in the block's HTML comment. An attribute with
`source: 'html'` or `source: 'attribute'` is **parsed back out of the saved markup** — so the
headline text lives in the `<h3>` where it belongs, not duplicated into the comment. Choosing
correctly between the two is what makes a block's serialised output readable, migratable, and
still meaningful if the plugin is ever deactivated. You will also use `RichText`, which is the
one editor component that genuinely has no Classic WordPress equivalent: an inline
contenteditable surface producing a constrained subset of HTML, and the reason Lesson 14.3 needs
a sanitizer at all.

By the end of this lesson you will have:

- `src/incident-callout/block.json` — `apiVersion: 3`, the `btt` category, a typed `attributes` schema and a declared `supports` set
- A `severity` attribute constrained to the four-term closed set, and `headline` / `body` attributes sourced from the saved markup
- `src/incident-callout/edit.js` — a React component using `useBlockProps` and two `RichText` fields
- `src/incident-callout/save.js` producing markup that the block validator accepts on reload
- The block used in a real blog post, its serialised `post_content` read by eye, and one deliberate validation failure triggered and fixed

## Classic WP Analogy

A static block is a shortcode with a visual editor and a compiler:

```
Classic: a shortcode                        Blocks: a static block
─────────────────────────────────────────   ──────────────────────────────────────────
add_shortcode('btt_callout', function($a){  // block.json
  $a = shortcode_atts([                     "attributes": {
    'severity' => 's3-minor',                 "severity": { "type": "string",
    'headline' => '',                                       "default": "s3-minor" },
  ], $a);                                     "headline": { "type": "string",
  return sprintf(                                          "source": "html",
    '<div class="callout %s"><h3>%s</h3>…',                "selector": "h3" }
    esc_attr($a['severity']),               }
    esc_html($a['headline'])                // save.js  → the markup, once, at save time
  );                                        // edit.js  → the same markup, editable
});
```

`shortcode_atts()` and the `attributes` schema are doing the same job: declaring the parameters,
their types and their defaults. The `save()` function is doing the same job as your shortcode's
`return`: producing the markup. And `RichText` with `allowedFormats` is the same instinct as
running the body through `wp_kses_post()` — deciding which HTML a user may produce.

There are two real breaks, and the first is the one that will actually bite you today.

**A shortcode renders on every request; `save()` renders once, forever.** Change your
shortcode's output and every existing post updates on the next page load. Change `save()` and
every already-published post still contains the old markup — and now the validator compares your
new output against that old markup and declares the block broken. This is not a bug; it is the
consequence of storing rendered output. It is why Lesson 13.5 teaches `deprecated`, and it is
why you should get `save()` roughly right before an editor publishes forty posts with it.

**Escaping is not yours to do.** In PHP you write `esc_html()` and `esc_attr()` because
forgetting means an XSS hole. In JSX, `{headline}` is escaped automatically, and the only way to
inject raw HTML is to ask for it explicitly. `RichText` is the exception that proves the rule:
its value genuinely is HTML, it is stored as HTML, and it is the one attribute in the entire
block set that needs sanitizing before a React front end renders it. Lesson 14.3 handles that in
exactly one file.

The headless break, worth restating because it inverts a Classic instinct: **`style.scss` styles
the editor, not your site.** In a Classic build the block's stylesheet is the block's
appearance. Here Next.js renders the block from its attributes using Tailwind, so `style.scss`
exists to make the block look right *to the editor*, and nothing more. Effort spent perfecting
front-end CSS in this file is effort thrown away in Module 14.

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
