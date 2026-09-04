---
title: 'Tailwind Fundamentals'
module: 11
lesson: 1
teaches: [tailwind, utility-first-css, design-tokens, css-custom-properties, responsive-variants]
produces: ['next-app/tailwind.config.ts', 'next-app/postcss.config.mjs']
requires: [10.5]
---

# Lesson 11.1 — Tailwind Fundamentals

## Quick Overview

Tailwind is a CSS framework with no components in it. You get a large, fixed set of small
classes — `flex`, `gap-4`, `text-sm`, `bg-surface`, `md:grid-cols-3` — and you compose them in
the markup. There is no stylesheet to maintain, no class names to invent, and no cascade to
reason about. It is the styling approach that makes component-based UI pleasant, and it is
genuinely uncomfortable for about two hours if you have spent a decade writing well-organised
CSS files.

You will configure the Blame The Tech design tokens — the severity colour scale, the surface
and text colours, the type scale, the spacing rhythm — as CSS custom properties in a `@theme`
block, then restyle `IncidentCard` with them. Tailwind 4 is CSS-first, so most of what used to
live in `tailwind.config.ts` is now CSS, and the tokens you define are real custom properties
readable from devtools and from any component. That matters for Module 13: `theme.json` will
declare the same palette to the block editor, so a colour an editor picks in Gutenberg is a
colour your front end already knows the name of.

By the end of this lesson you will have:

- `next-app/postcss.config.mjs` and `next-app/tailwind.config.ts` wired into the build
- A `@theme` block in the global stylesheet defining the severity scale, surface and text colours, type scale and spacing tokens
- `IncidentCard` restyled entirely with utilities, and its old class names deleted
- A responsive incident grid using `sm:` / `md:` / `lg:` variants and no media query you wrote by hand
- A dark-mode variant driven by the same tokens, and a written answer to "why is this not just inline styles?"

## Classic WP Analogy

WordPress has always shipped class-name hooks for you to style against — `body_class()`,
`post_class()`, `.wp-block-quote`, `.screen-reader-text` — and the workflow is: WordPress emits
semantic classes, you write CSS rules that target them, and the cascade sorts out conflicts.

| Classic WordPress | Tailwind |
|---|---|
| `body_class()` / `post_class()` semantic hooks | no hooks needed — styling lives on the element |
| `style.css` with `.incident-card__meta { … }` | `className="flex gap-2 text-sm text-muted"` |
| `@media (min-width: 768px) { … }` | `md:` prefix on the utility itself |
| SCSS variables or CSS custom properties in `:root` | `@theme` tokens, which *are* custom properties |
| `wp_enqueue_style()` dependency graph | one generated stylesheet, no handles |
| Specificity battles and `!important` | class order resolved by a merge function |
| `theme.json` presets for the editor | the same tokens, declared once (Lesson 13.5) |

The habit that transfers is the constraint. A good WordPress theme has a `_variables.scss`
with eight colours and six spacing steps, and the discipline is to use only those. Tailwind
makes that discipline the default: `p-4` exists, `p-[17px]` requires you to type brackets and
feel bad about it. If you have ever inherited a theme with `#3c3c3c`, `#3d3d3d` and `#3b3b3c`
all in use, you already understand the value.

The analogy breaks in the place that generates the loudest objection, so it is worth meeting
head-on. **This is not inline styles, and the difference is not cosmetic.** Inline styles cannot
express `:hover`, `:focus-visible`, media queries, dark mode or `prefers-reduced-motion`;
utilities can, because they compile to real rules with real selectors. Inline styles are
unconstrained; utilities come from a token set. And inline styles are per-element bytes that
never compress, whereas Tailwind emits each rule once no matter how often you use it.

The deeper break is architectural, and it is the reason this works here and would not have
worked in your Classic theme: **the component, not the class name, is the unit of reuse.** In
PHP, if the incident meta row appears in four templates you must give it a class name so four
stylesheets can agree. In React it appears in one file, `IncidentCard.tsx`, and the four call
sites reuse the component. The abstraction moved from CSS to JavaScript, which is why the CSS
no longer needs names — and why writing a `.btn-primary` class here is a signal that you should
have written a `<Button variant="primary">` instead. Lesson 11.2 builds exactly that.

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
