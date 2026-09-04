---
title: 'Media, Images & next/image'
module: 14
lesson: 5
teaches: [next-image, remote-patterns, responsive-sizes, lcp-priority, aspect-ratio, image-block-mapping]
produces: ['next-app/src/components/blocks/CoreImage.tsx', 'next-app/next.config.ts']
requires: [14.3, 14.4]
---

# Lesson 14.5 — Media, Images & next/image

## Quick Overview

Images are the last core block and the one with the most performance consequence attached. This
lesson maps `core/image` to a `CoreImage` component built on `next/image`, which means
configuring `remotePatterns` so Next is permitted to optimise media from the WordPress host,
reading `width`, `height` and `alt` out of the block's `mediaItem` data so nothing has to be
guessed, and getting `sizes` right so the browser downloads a sensibly-sized file rather than
the largest one available.

Two details carry most of the value. **`sizes` is not optional and a wrong value is worse than
none** — it tells the browser how wide the image will be *before* the CSS has loaded, so a
`sizes` that claims full-viewport width on a 400-pixel column makes the browser fetch a 2000-pixel
file. And **`priority` belongs on exactly one image per route**, the one that is the Largest
Contentful Paint element, because `priority` works by disabling lazy loading and competing for
early bandwidth. Put it on six images and you have prioritised nothing. Module 21 measures both
of these; this lesson is where you get them right the first time.

By the end of this lesson you will have:

- `next-app/next.config.ts` with `remotePatterns` scoped to the WordPress host, explicitly not a wildcard
- `next-app/src/components/blocks/CoreImage.tsx` — intrinsic `width` / `height` from `mediaDetails`, so no layout shift
- `alt` text taken from the WordPress media library, with an empty-string fallback for decorative images rather than a filename
- A `sizes` value per layout context, and `priority` on exactly one image per route
- A verified optimised response: `/_next/image` serving WebP or AVIF, and the same page's Largest Contentful Paint element identified

## Classic WP Analogy

WordPress has done responsive images well since 4.4, and you have been getting them for free:

| Classic WordPress | `next/image` |
|---|---|
| `add_image_size('incident-card', 640, 360, true)` | no registration — sizes generated on request |
| `wp_get_attachment_image($id, 'large')` | `<Image src={…} width height sizes />` |
| `srcset` generated from registered sizes | `srcset` generated from the widths you configure |
| `sizes="(max-width: 640px) 100vw, 640px"` | the same attribute, same meaning, same maths |
| `the_post_thumbnail(…, ['loading' => 'eager'])` | `priority` |
| `wp_get_attachment_metadata()` for width and height | `mediaDetails { width height }` from GraphQL |
| Regenerating thumbnails after changing a size | nothing to regenerate |

The `sizes` attribute is the same attribute, doing the same job, with the same failure mode —
which is genuinely good news, because if you have ever debugged why WordPress served a
1024-pixel image into a 300-pixel slot, you already know the concept this lesson is most
insistent about.

The analogy breaks on **when the variants are created, and who is allowed to ask for them.**
WordPress generates a fixed set of files at upload time from your registered sizes; if a layout
needs 512 pixels and you registered 480 and 640, the browser takes 640 forever, and changing
your mind means regenerating thumbnails across the whole library. `next/image` generates
variants **on request** and caches them, so the widths are a configuration value you can change
by editing one array. That flexibility is why `remotePatterns` exists and why it has to be tight:
the optimiser will resize any image from any host you allow, so a wildcard pattern turns your
deployment into a free image-resizing service for the internet, billed to you. Scope it to the
WordPress host, by protocol and pathname.

The second break is the one that catches people in this specific architecture: **the images are
not on your origin.** In Classic WordPress the theme and the uploads share a host, a filesystem
and a lifetime. Here the media lives on WordPress and the pages live on Vercel, so every image
is a cross-origin fetch that Next must be configured to trust, must optimise, and must cache.
And this is not the final configuration — Module 24 offloads `wp-content/uploads/` to R2 or S3
served from a media subdomain, precisely because a Fly volume pins WordPress to one machine.
When that happens, `remotePatterns` changes and nothing else does, which is a good reason to have
the pattern in exactly one place.

One accessibility note that is really a content note, and it is the sort of thing only a
WordPress developer thinks to check: `alt` comes from the media library, so the front end's
alternative text is only as good as the editors' habits. An empty `alt` is correct for a
decorative image and is not the same as a missing one — and the WordPress default of falling
back to the filename is worse than either. Lesson 12.3's role-based locators will find images by
their accessible name, so this matters to your test suite as well as to your users.

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
