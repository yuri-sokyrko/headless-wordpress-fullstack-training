---
title: 'Fixing LCP & CLS'
module: 21
lesson: 2
teaches: [lcp-optimization, cls-prevention, next-font, image-priority, image-sizes, reserved-space]
produces: ['next-app/src/app/[locale]/layout.tsx', 'next-app/src/app/[locale]/hobt/page.tsx', 'next-app/src/components/layout/Header.tsx']
requires: [21.1, 14.4, 11.2]
---

# Lesson 21.2 — Fixing LCP & CLS

## Quick Overview

LCP and CLS belong in one lesson because they share a cause: **things arriving late and at an
unexpected size**. An image that starts downloading after the JavaScript has parsed is a slow
LCP. That same image, arriving without declared dimensions, is also a layout shift. A font that
swaps in at 800 ms shifts every line of text on the page. A "Get Demo" dialog trigger that
renders `null` until hydration collapses the header and then expands it. Fix the arrival order
and the reserved space and both metrics move together.

The work is specific. Exactly one image per route gets `priority` — the one that *is* the LCP
element — and everything else must not, because `priority` adds a preload hint and four
competing preloads is slower than none. Every `next/image` needs correct `sizes`, or the browser
downloads a 1920 px file to display it at 400 px. `next/font` self-hosts and inlines the font
declaration so there is no render-blocking request to a third-party origin, and it needs the
Cyrillic subset added or Ukrainian silently falls back and shifts. Every region whose height is
not known at build time — the incident count, the urgency badge driven by `seatsLeft`, an
oEmbed iframe from a blog post — gets space reserved with an aspect ratio or a fixed min-height.
That last category is the one editors will keep re-introducing, so `BlockRenderer` is where the
defence belongs.

By the end of this lesson you will have:

- `next/font` configured in `src/app/[locale]/layout.tsx` with the Latin **and** Cyrillic subsets,
  `display: 'swap'`, and a matched fallback stack that minimises the swap shift
- A single, deliberate `priority` image per route, with a written rule for identifying the LCP element
- Correct `sizes` on every `next/image` in `src/components/`, verified against the actual rendered
  width rather than guessed
- Reserved space for every dynamic region: aspect-ratio wrappers, skeletons that match final
  height, and no hydration-dependent header collapse
- Embed handling in `BlockRenderer` that reserves space for `core/embed` before the iframe loads
- A re-measured `docs/perf-baseline.md` row showing LCP and CLS before and after

## Classic WP Analogy

Classic WordPress solved most of this for you, and it is worth being precise about which parts.

| Classic WordPress | Next.js |
|---|---|
| `wp_get_attachment_image()` emits `width`, `height`, `srcset`, `sizes` | `next/image` emits the same, but `sizes` is **yours to write** |
| `the_post_thumbnail('large')` picks a registered size | `fill` or explicit `width`/`height`, plus `sizes` |
| `wp_enqueue_style()` in `wp_head` — blocking, but early | `next/font` inlines `@font-face` and preloads the file |
| A Google Fonts `<link>` in `header.php` | Never. `next/font` self-hosts at build time. |
| An image optimiser plugin generating WebP | Built in — the Next image optimiser, at request time |
| `add_image_size()` + regenerate thumbnails | `deviceSizes` / `imageSizes` in `next.config.ts` |

The `sizes` row is where the analogy breaks and where the actual bug lives. WordPress computes
a `sizes` attribute for you from the registered image size — usually
`(max-width: 1024px) 100vw, 1024px` — and it is frequently wrong, but it is *present*, and
`srcset` gives the browser something reasonable to choose from. In `next/image` with `fill`,
omitting `sizes` makes the browser assume `100vw`, so a thumbnail in a three-column grid
downloads the full-width variant. Nothing warns you. The image looks perfect. It is eight times
larger than it needed to be, and on a real network that is your LCP.

The other break is a genuine reversal of instinct. In Classic WordPress, adding a preload hint
for the hero was an optimisation you bolted on and it almost always helped. In Next.js,
`priority` is a preload, and the temptation — "mark all the above-the-fold images priority" — is
actively harmful: preloads compete for the same connection, and four of them means the real LCP
element finishes *later* than with none. **`priority` is a scarce resource. One per route.**

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
