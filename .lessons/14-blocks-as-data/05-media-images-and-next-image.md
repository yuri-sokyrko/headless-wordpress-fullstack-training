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

### 1. `remotePatterns` already exists, and it is worth understanding anyway

`next.config.ts` has been carrying this since Lesson 09.1:

```ts
// next-app/next.config.ts — (illustration of what is already there, from Lesson 09.1)
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost', port: '8080', pathname: '/wp-content/uploads/**' },
    ],
  },
```

Lesson 09.1 declared it four modules early **so that this lesson could be about `sizes` and
`priority` rather than about configuration**, and left a two-line comment explaining it. Those
two lines are not the argument, so here is the argument.

`next/image` refuses any remote host it was not told about. That refusal is not a safety rail
against typos; it is the difference between an image optimiser and an **open image proxy**.
Without an allowlist, anyone can request
`/_next/image?url=https://someone-elses-cdn.example/4k.png&w=3840&q=90`, and your deployment
will fetch it, transcode it, cache it and serve it — on your bandwidth, your CPU and your cache
storage, indefinitely, at whatever rate they can generate URLs. On Vercel that is a line item.
On your own infrastructure it is an outage.

The object form is four independent narrowings, and using fewer of them is a decision:

| Key | Ours | What omitting it permits |
|---|---|---|
| `protocol` | `'http'` | both `http` and `https`. Harmless; be explicit anyway |
| `hostname` | `'localhost'` | **nothing — it is required** |
| `port` | `'8080'` | any port on that host, including a dev server you forgot |
| `pathname` | `'/wp-content/uploads/**'` | **any path on the WordPress host** — including a REST endpoint that returns an attacker-supplied redirect |

| `hostname` value | Verdict |
|---|---|
| `'localhost'` with a `pathname` | ✅ **this course** |
| `'*.blamethe.tech'` | acceptable in production if you own every subdomain and none of them proxies |
| `'**'` | ❌ **never.** This is the open proxy. Verification greps for it |

> **Wildcards are a bill somebody pays, and it is usually not the person who wrote them.**
> `hostname: '**'` gets a stuck deploy working in ninety seconds and it is the single most
> expensive line in a Next config. If you need many hosts, list them. If the list is genuinely
> unbounded, you do not want the optimiser in that position at all — you want a signed URL
> scheme, which is a different design.

### 2. The optimiser pipeline, and the two things that are not free

```
   <Image src="http://localhost:8080/wp-content/uploads/2024/09/hero.jpg"
          width={1600} height={900} sizes="(min-width:1024px) 720px, 100vw" />
        │
        ▼  renders
   <img srcset="/_next/image?url=…&w=640&q=75 640w,
                /_next/image?url=…&w=750&q=75 750w, …"
        sizes="(min-width:1024px) 720px, 100vw" loading="lazy" decoding="async"
        width="1600" height="900">
        │
        ▼  the BROWSER picks one entry using `sizes` + its own DPR
   GET /_next/image?url=…&w=750&q=75      Accept: image/avif,image/webp,*/*
        │
        ├── 1. is `url`'s host in remotePatterns?   no → 400
        ├── 2. is `w` in deviceSizes/imageSizes?    no → 400
        ├── 3. is `q` in qualities?                 no → 400
        ├── 4. cache HIT?  → serve, x-nextjs-cache: HIT
        └── 5. MISS → fetch the original from WordPress
                    → transcode to the best format the Accept header allows
                    → write to the image cache
                    → serve, x-nextjs-cache: MISS
```

Two costs, and neither is visible in a Lighthouse score:

| Not free | Detail |
|---|---|
| **CPU, on the first request per (url, w, q)** | Decoding a 4000-pixel JPEG and re-encoding it as AVIF is expensive — AVIF encoding is *much* slower than WebP. A cold cache plus a viral page is a thundering herd on your own optimiser |
| **Cache storage, forever-ish** | One original × ~8 widths × 2 formats × 2 qualities is up to 32 derived files. `minimumCacheTTL` decides how long you keep them |

The mitigation for the first is that step 4 exists: the second request is a HIT. The mitigation
for a *cold* cache is to not have 3840-pixel originals in the media library, which is a
WordPress-side decision (`big_image_size_threshold`) and worth knowing about.

### 3. `width` and `height` are intrinsic dimensions, and they prevent CLS

`next/image` requires either `width` **and** `height`, or `fill`. This is not bookkeeping —
those two numbers become the rendered `<img width height>` attributes, from which the browser
computes an aspect ratio and **reserves the space before the bytes arrive**.

```
   WITHOUT width/height                     WITH width/height
   ─────────────────────────────            ─────────────────────────────
   text renders at y=200                    text renders at y=200
   image arrives, is 900px tall             box reserved: 900px tall
   text JUMPS to y=1100                     image paints into it
   → Cumulative Layout Shift                → CLS contribution: 0
```

And the numbers must be the **intrinsic** ones — the size of the file — not the size you intend
to display. `next/image` scales down with CSS; what it needs from you is the ratio.

WordPress has them: `mediaDetails { width height }`, which
[`MediaFields`](../10-typed-data-layer/05-organising-queries-and-fragments.md) has selected
since Lesson 10.5 with a comment saying "Module 21 needs them for `next/image`". This is that
comment coming due, one module early.

> **Do not read them from the block's attributes.** `core/image` has `width` and `height`
> attributes, and they are populated **only when an editor resized the image inside the
> editor** — so they are `null` most of the time and, when set, they are the *display* size and
> not the intrinsic one. The media library is the source of truth. Task §3's component reads
> `mediaItem.mediaDetails` and never the attributes.

`fill` is the alternative, and it is right when **the container decides**: a hero that must fill
a fixed-height band, a square avatar, a card cover with a locked aspect ratio. `fill` makes the
image `position: absolute` and stretch to its nearest positioned ancestor, so it needs a
`relative` parent with a height or an aspect ratio — and it needs `sizes`, always, because
there is no `width` for the browser to fall back on.

| | `width`/`height` | `fill` |
|---|---|---|
| Aspect ratio | the image's own | **the container's** — the image is cropped by `object-fit` |
| Needs a positioned parent | no | yes, with a height or `aspect-*` |
| `sizes` | strongly recommended | **required** |
| Right for | editor content of unknown shape | a design slot of known shape |

`CoreImage` uses `width`/`height` as the primary path, because an editor's image is whatever
shape it is and cropping it to a ratio you invented is a worse failure than a tall image.

### 4. `sizes`, properly

This is the attribute people copy and do not understand, and a wrong value is genuinely worse
than none.

`sizes` answers one question: **how wide will this image be laid out, at this viewport width?**
The browser reads it *before* stylesheets have applied and *before* layout, picks the smallest
`srcset` entry that satisfies it at the current device pixel ratio, and starts the download.

Three things follow, and each one is a bug someone has shipped:

1. **It is a promise about CSS that CSS does not verify.** Change a `max-w-3xl` to `max-w-5xl`
   and `sizes` is silently wrong. Nothing warns you.
2. **Too large is a download you paid for.** `sizes="100vw"` on a 400-pixel column, on a 2×
   phone, asks for a 750-pixel file to paint 400 CSS pixels — nearly four times the bytes.
3. **Too small is a blurry image.** The browser trusts you and picks a file that must be
   upscaled. This is the one that gets reported as "the images look bad on my laptop", months
   later.

Omitting `sizes` is not neutral either: `next/image` defaults it to `100vw`, which is case 2 for
every image that is not full-bleed.

The three layout contexts in this app, with the exact string for each:

| Context | Laid out at | `sizes` |
|---|---|---|
| Prose column, `[...slug]` and `blog/[slug]` (`max-w-3xl` inside `px-4`) | ≤ 48 rem, minus padding on small screens | `(min-width: 1024px) 720px, calc(100vw - 2rem)` |
| `/hobt` hero, full container width up to the layout's max | up to 64 rem | `(min-width: 1024px) 1024px, 100vw` |
| Testimonial avatar, fixed 40 px | always 40 px | `40px` |

The third row is the one worth pausing on. A fixed-size image gets a fixed `sizes`, and then the
`srcset` the browser chooses from is 40 px and 80 px rather than eight entries up to 3840. That
is a small win per avatar and a large one on a page with twelve of them.

**How to debug it, in ninety seconds:** DevTools → Network → Img, reload, and look at the `w=`
parameter of the request that was actually made. Then compare it with the element's rendered
width in the Elements panel (`400 × 267` under the box model) multiplied by your DPR. If the
fetched width is more than about 1.5× that, your `sizes` is too generous. That check is faster
and more reliable than reasoning about the string.

### 5. `priority` belongs on exactly one image per route

`priority` is not "make this image load faster". It is three mechanical changes:

| What `priority` does | Effect |
|---|---|
| `loading="eager"` instead of `lazy` | the browser does not wait for the image to approach the viewport |
| `fetchpriority="high"` | it moves ahead of other images, and competes with scripts and CSS |
| a `<link rel="preload" as="image" imagesrcset=…>` in the document head | the request starts before the `<img>` is even parsed |

All three take bandwidth and connections from something else. So:

**Prioritise six images and you have prioritised nothing.** Worse than nothing — you have
delayed the one that mattered, because six preloads at the top of `<head>` compete with the CSS
that determines whether any of them is even visible.

The rule this course follows: **`priority` goes on the single element most likely to be the
Largest Contentful Paint element for that route, and nowhere else.** On `/hobt` that is the hero
image. On `/en/blog/blog-01` there is no candidate above the fold that this module renders, so
nothing gets it.

Which is why `CoreImage` **does not take a `priority` prop at all**, and Verification asserts
that the word does not appear in the file. A block component cannot know whether it is the LCP
element, because it does not know where on the page it sits — an editor can put the same image
block first or twelfth. LCP priority is a **route-level** decision. Module 21 revisits it with
measurements, and if it decides a block sometimes needs it, the honest mechanism is a prop
threaded from the route through `BlockRenderer`, not a guess inside the component.

### 6. `alt`, and the WordPress trap

`alt` comes from the media library's alternative-text field, so your front end's accessibility is
exactly as good as your editors' habits. Three cases, three different correct answers:

| Case | Correct `alt` | What it does |
|---|---|---|
| The image carries information | a description of that information | announced by a screen reader |
| The image is decorative | **`alt=""`** | the image is removed from the accessibility tree entirely |
| Nobody filled it in | there is no correct answer | see below |

The WordPress-specific trap: **historically, an empty alternative-text field caused WordPress to
fall back to the attachment's title, which defaults to the filename.** So a decorative image
uploaded as `IMG_4471-1-scaled.jpg` announces as "IMG 4471 1 scaled", which is worse than either
correct answer — it is noise that cannot be skipped, and it is indistinguishable from a
description to anyone reading the markup.

`alt=""` and a missing `alt` are **not** the same thing, and this is the distinction to hold on
to. `alt=""` is a claim: "this image carries no information, skip it". A missing `alt` is an
absence, and assistive technology guesses — often by reading the filename. `next/image` makes
`alt` a required prop precisely so that you cannot leave it absent by accident; what it cannot
do is stop you passing a filename.

This also matters to your test suite. Lesson 12.3's locators are `getByRole` plus an accessible
name, so an image's `alt` **is** its address in Playwright. Module 22 audits it, and Module 23's
agentic exploration will report an image whose accessible name is a filename as a finding.

### 7. `formats`, `qualities`, and the two knobs this course does not turn

Three keys are added in this lesson, and two are deliberately left alone.

**`formats: ['image/avif', 'image/webp']`** — a **preference list**. Next reads the request's
`Accept` header and serves the first entry the browser accepts, falling back to the original
format.

| | AVIF | WebP |
|---|---|---|
| Typical size vs JPEG | ~50% smaller | ~30% smaller |
| Encode time | **slow** — several times WebP | fast |
| Browser support | modern only | effectively universal |
| Verdict | ✅ first choice, with WebP behind it | ✅ the fallback that always works |

Listing both is the whole point: modern browsers get the smaller file, everything else gets a
file that works, and neither branch is a special case in your code.

**`qualities: [75, 90]`** — Next 15 wants the permitted `q` values declared, and an undeclared
one is a 400. That is a cache-integrity feature as much as a config one: without it, `q=1`
through `q=100` are a hundred distinct cache keys per width per format, which anyone can walk to
inflate your cache. Declare the two you use. 75 is `next/image`'s default and is right for
photographic content; 90 exists for anything where the artefacts show.

**`minimumCacheTTL`** — the default is 60 seconds, which is far too short here. A WordPress
upload has a **permanent URL**: `wp-content/uploads/2024/09/hero.jpg` is that file forever, and
editing the image in WordPress produces a new filename rather than new bytes at the old one. So
a derived variant can be cached for a month, and re-transcoding it every minute is CPU spent on
nothing.

The two knobs **not** turned, and why declining is also a decision:

| Key | Default | Why leave it |
|---|---|---|
| `deviceSizes` | `[640, 750, 828, 1080, 1200, 1920, 2048, 3840]` | Eight widths that match real device classes. Trimming it saves cache storage and risks the blurry case from Key Concept 4. Module 21 may trim it **with measurements**; guessing now is worse than the default |
| `imageSizes` | `[16, 32, 48, 64, 96, 128, 256, 384]` | The widths used for fixed-size images. The 40 px avatar picks 48 and 96 from this list, which is exactly right |

### 8. Module 24 moves the media, and only this file changes

Module 24 offloads `wp-content/uploads/` to S3 or R2, served from a media subdomain, because a
Fly volume pins WordPress to one machine and uploads on a container filesystem do not survive a
redeploy.

```
   TODAY                                     AFTER MODULE 24
   ────────────────────────────────          ──────────────────────────────────────
   sourceUrl:                                sourceUrl:
     http://localhost:8080/wp-content/         https://media.blamethe.tech/2024/09/
       uploads/2024/09/hero.jpg                  hero.jpg
        │                                          │
   remotePatterns: localhost:8080            remotePatterns: media.blamethe.tech
        │                                          │
   CoreImage.tsx                             CoreImage.tsx    ← unchanged
   HobtHero.tsx                              HobtHero.tsx     ← unchanged
   MediaFields.graphql                       MediaFields…     ← unchanged
```

**One array, in one file.** No component contains a hostname, no `.graphql` document contains a
hostname, and nothing derives a URL by string concatenation — `sourceUrl` arrives from WordPress
already absolute, and that is the property that makes the migration a config change.

Which is also the reason `remotePatterns` is hard-coded rather than read from an environment
variable. Appendix 04 §9 lists every env var and which module introduces it, and Module 14 adds
**none** — `NEXT_PUBLIC_WORDPRESS_URL` is the named anti-pattern in appendix 04 §3.2, and
`next.config.ts` is evaluated at build time on the machine doing the build, so a server-only
variable there is available but pointless: it makes the allowlist invisible in code review, and
the allowlist is a security control. Different environments get different values through the
config file itself, which is versioned and reviewable.

### 9. `/hobt`'s images arrive in this lesson, on purpose

`hobt.graphql` in Lesson 11.5 deliberately did not select `heroImage`, and its comment said why:

> `heroImage` and each testimonial's `avatar` are deliberately NOT selected. Rendering them
> properly needs `next/image`, `remotePatterns` in `next.config.ts` and
> `mediaDetails { width height }` — all of which land in Lesson 14.5. A field you select and do
> not render is a resolver call you pay for and waste.

This lesson adds both fields **with** the components that render them, which is the same
discipline as Lesson 14.1's rule about inline fragments and the registry: the query and the
renderer move together, in one commit. That is not tidiness — a selected-and-unrendered field is
invisible overfetching, and Lesson 10.5's audit found three of them by hand because nothing in
the type system will.

The two images are also a useful contrast, and it is the contrast from Key Concepts 3 and 4:

| | `heroImage` | testimonial `avatar` |
|---|---|---|
| Shape | whatever the editor uploaded | forced to a 40 px circle |
| Dimensions | intrinsic, from `mediaDetails` | fixed `40`/`40` |
| `sizes` | `(min-width: 1024px) 1024px, 100vw` | `40px` |
| `priority` | **yes** — the LCP element | no. Twelve avatars below the fold |
| Uses `mediaDetails` | yes | **no**, and that is honest overfetch |

That last row deserves its sentence. `MediaFields` selects `mediaDetails { width height }` and
the avatar ignores it, because it renders at a fixed size. Writing a second, smaller fragment to
save two integers per testimonial would trade a real maintenance cost for a rounding error —
Lesson 10.5's audit measured *bytes*, and the honest conclusion here is that one reused fragment
wins. Name the waste; do not fix it with a fifth fragment.

---

## Task

### Step 1: Read the config that exists, then add three keys

Verify before you edit. The allowlist is a security control, and confirming what it currently
says is part of the job.

```bash
cd next-app
grep -n -A 12 'images:' next.config.ts
# Expected: the remotePatterns array from Lesson 09.1, with protocol, hostname,
#           port and pathname all present.

npx next --version
# Expected: 15.x — note the minor version. `images.qualities` needs 15.2 or newer;
#           if you are older, drop that key rather than guessing.
```

Then one anchored addition **inside** the existing `images` object. `remotePatterns` is not
retyped and not moved.

```ts
// next-app/next.config.ts (fragment) — added inside the existing `images: { … }`
// object, immediately after the remotePatterns array from Lesson 09.1.

    // A PREFERENCE list. Next reads the request's Accept header and serves the
    // first entry the browser accepts, falling back to the original format. AVIF
    // is ~50% smaller than JPEG and much slower to encode; WebP behind it means
    // every browser gets something better than the original. Key Concept 7.
    formats: ['image/avif', 'image/webp'],

    // Next 15 wants the permitted `q` values declared, and an undeclared one is a
    // 400. That is cache integrity as much as configuration: without it, q=1..100
    // are a hundred cache keys per width per format that anyone can walk.
    // 75 is next/image's default; 90 is for anything where artefacts show.
    qualities: [75, 90],

    // The default is 60 SECONDS, which is wrong for WordPress uploads: an upload
    // has a permanent URL, and editing an image in WordPress produces a new
    // filename rather than new bytes at the old one. 31 days.
    minimumCacheTTL: 2678400,

    // NOT set, deliberately: deviceSizes and imageSizes. Their defaults are eight
    // real device-class widths and eight fixed-size widths, and trimming them
    // without measurements trades cache storage for the blurry-image failure in
    // Key Concept 4. Module 21 may trim them, with numbers.
```

```bash
npm run type-check
npm run build 2>&1 | grep -i 'invalid\|unrecognized\|warn' | head
# Expected: no output. An "Invalid next.config.ts options detected: qualities"
#           warning means your Next version predates the key — remove it.
```

**Verify §1:**

- [ ] `remotePatterns` is byte-for-byte what Lesson 09.1 wrote. You added keys; you did not
      rewrite the allowlist.
- [ ] `npm run build` prints no config warning.
- [ ] `grep -c "hostname: '\*\*'" next.config.ts` is `0`, and it stays `0` for the rest of the
      course.

### Step 2: Introspect `CoreImage`, then extend the fragment

The block's own attributes give you a URL and a caption. The **media library** gives you the
dimensions and the alt text, and Key Concept 3 explains why you want the second set. Find out
what your plugin version exposes before you write the selection.

```bash
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"CoreImage\"){ fields { name type { name kind ofType { name } } } } }"}' \
  | jq -r '.data.__type.fields[] | "\(.name)  \(.type.name // .type.ofType.name)"'
# Expected: a list including `attributes`, `clientId`, `parentClientId`, `name`
#           and — in the versions this course was checked against — `mediaItem`,
#           a MediaItem. That connection is what makes the next 6 lines possible.
```

```graphql
# next-app/src/graphql/fragments/editorBlocks.graphql — added after `... on BttHobtCta`
    # The media library is the source of truth for dimensions and alt text, so
    # this spreads MediaFields (Lesson 10.5) rather than declaring a second one.
    # `attributes.width`/`height` are deliberately NOT selected: they are set only
    # when an editor resized the image, and then they are the DISPLAY size.
    # Lesson 14.5 Key Concept 3.
    ... on CoreImage {
      attributes {
        url
        alt
        caption
        href
        sizeSlug
      }
      mediaItem {
        ...MediaFields
      }
    }
```

```bash
npm run codegen
# Expected: an error naming CoreImage as missing from BlockRegistry when you run
#           type-check next. That is Layer 1 of Lesson 14.2's check, again.
```

> **`mediaItem` absent from your version's `CoreImage`?** Then delete those three lines and
> resolve the attachment the way `ScapegoatPicker` resolves a term: the `id` attribute is the
> attachment's database ID, so add `id` to the `attributes` selection, add a
> `query MediaItemById($id: ID!) { mediaItem(id: $id, idType: DATABASE_ID) { ...MediaFields } }`
> to a new `src/graphql/media.graphql`, and make `CoreImage` an `async` component with its own
> `fetchGraphQL`. Same pattern, one more round trip per image, and the component below changes
> in two places.

### Step 3: Write `CoreImage.tsx`

```tsx
// next-app/src/components/blocks/CoreImage.tsx
// The last core block. No `priority` prop, deliberately — Key Concept 5.
import Image from 'next/image';

import { RichText } from '@/components/blocks/RichText';
import type { BlockComponentProps } from '@/components/blocks/registry';

/**
 * The prose column is `max-w-3xl` (48 rem) inside the layout's `px-4`, so the
 * image is ~720 px on a large viewport and the viewport minus 2 rem below that.
 * Getting this wrong the other way — `100vw` everywhere — makes a 400 px slot
 * fetch a 750 px file on a 2x phone. Key Concept 4, and the DevTools check there
 * is how you verify it after a layout change.
 */
const SIZES = '(min-width: 1024px) 720px, calc(100vw - 2rem)';

/** No dimensions anywhere. A guess, and the reason this is the fallback. */
const FALLBACK_RATIO = 'aspect-[3/2]';

export function CoreImage({ block }: BlockComponentProps<'CoreImage'>) {
  const attributes = block.attributes;
  const media = block.mediaItem;

  // The media library's URL wins over the attribute's. The attribute holds
  // whatever URL was current when the block was inserted, and a re-upload or the
  // Module 24 media-subdomain move leaves it stale. `url` is the fallback for an
  // image inserted from an external source, which has no attachment behind it.
  const src = media?.sourceUrl ?? attributes?.url ?? '';
  if (src === '') return null;

  // INTRINSIC dimensions, from the media library and never from the attributes.
  const width = media?.mediaDetails?.width ?? null;
  const height = media?.mediaDetails?.height ?? null;

  // The block's own alt overrides the library's, because core/image reads it off
  // the <img alt> in the saved markup and an editor may have set it per-insertion.
  // Empty string is CORRECT for a decorative image and is not the same as
  // missing — Key Concept 6. `next/image` makes alt required so it cannot be
  // absent; what it cannot do is stop you passing a filename.
  const alt = attributes?.alt ?? media?.altText ?? '';

  return (
    <figure data-block={block.__typename} className="my-6">
      {width !== null && height !== null ? (
        // The primary path. Intrinsic width/height become the rendered
        // <img width height>, the browser reserves the box, and CLS is 0.
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          sizes={SIZES}
          className="h-auto w-full rounded-md"
        />
      ) : (
        // No mediaDetails: an external image, or an attachment whose metadata
        // never regenerated. `fill` needs a positioned parent with a ratio, and
        // the ratio is a guess — so this crops. A crop is a worse failure than a
        // tall image, which is why it is the fallback and not the default.
        <div className={`relative w-full ${FALLBACK_RATIO}`}>
          <Image src={src} alt={alt} fill sizes={SIZES} className="rounded-md object-cover" />
        </div>
      )}

      {/* A caption is rich text — an editor can bold a word or link a source —
          so it goes through the one sanitizer, and RichText renders nothing when
          the attribute is empty rather than an empty <figcaption>. */}
      <RichText
        as="figcaption"
        html={attributes?.caption}
        className="mt-2 text-sm text-muted-foreground [&_a]:underline"
      />
    </figure>
  );
}
```

### Step 4: Register it, then prove it with a throwaway post

```ts
// next-app/src/components/blocks/registry.ts — the import, added
import { CoreImage } from '@/components/blocks/CoreImage';
```

```ts
// next-app/src/components/blocks/registry.ts — the map, one row added
  CoreCode,
  CoreImage,
  BttIncidentCallout: IncidentCallout,
```

```bash
npm run verify
```

Nothing in the seed data contains a `core/image` block — `block_showcase()` has no image, and the
seeded posts carry *featured* images, which are a different thing. So make a probe, look at it,
and delete it, exactly as Lesson 14.3 did with its XSS post.

```bash
cd ../wordpress-headless

# A real seeded attachment, and its URL.
ATT=$(docker compose run --rm -T wpcli wp post list --post_type=attachment \
  --posts_per_page=1 --field=ID | tr -d '\r')
SRC=$(docker compose run --rm -T wpcli wp post get "$ATT" --field=guid | tr -d '\r')
echo "attachment $ATT at $SRC"

# Exactly the markup Gutenberg writes for core/image, so the block parses.
CONTENT=$(printf '<!-- wp:image {"id":%s,"sizeSlug":"large"} --><figure class="wp-block-image size-large"><img src="%s" alt="A seeded hero image" class="wp-image-%s"/><figcaption class="wp-element-caption">A caption with <strong>markup</strong>.</figcaption></figure><!-- /wp:image -->' "$ATT" "$SRC" "$ATT")

POST_ID=$(docker compose run --rm -T wpcli wp post create --porcelain \
  --post_type=post --post_status=publish \
  --post_title='Image probe (delete me)' --post_name=image-probe \
  --post_content="$CONTENT" | tr -d '\r')
echo "post $POST_ID"

cd ../next-app
curl -s http://localhost:3000/en/blog/image-probe > /tmp/probe.html

grep -o 'data-block="CoreImage"' /tmp/probe.html | wc -l
# Expected: 1
grep -o '/_next/image' /tmp/probe.html | wc -l
# Expected: 8 or more — one srcset entry per configured device width, plus the src
grep -o 'alt="A seeded hero image"' /tmp/probe.html | wc -l
# Expected: 1 — from the block attribute, which core/image read off the <img alt>
grep -o 'width="[0-9]*" height="[0-9]*"' /tmp/probe.html | head -1
# Expected: the attachment's INTRINSIC dimensions, from mediaDetails. This pair is
#           what reserves the box and keeps CLS at 0.
grep -o '<strong>markup</strong>' /tmp/probe.html | wc -l
# Expected: 1 — the caption went through RichText, so its markup survived and
#           anything dangerous in it would not have.
rm /tmp/probe.html

# Delete it. Ten posts is what the seeder produces and what Module 14's Starting
# State asserts; an eleventh drifts your corpus from CI's. --force, not trash.
cd ../wordpress-headless
docker compose run --rm wpcli wp post delete "$POST_ID" --force
docker compose run --rm wpcli wp post list --post_type=post --format=count
# Expected: 10
cd ../next-app
```

**Verify §4:**

- [ ] All five greps matched before you deleted the post. If `/_next/image` count was `0`, the
      URL's host is not in `remotePatterns` — Next renders the raw `src` and logs a warning in
      the dev server output. Read it.
- [ ] `wp post list --post_type=post --format=count` prints `10`.

### Step 5: Select the two `/hobt` images

Two anchored additions inside `hobtPromo`, both spreading the fragment that already exists.

```graphql
# next-app/src/graphql/hobt.graphql (fragment) — inside `hobtPromo`, next to
# `subheadline`. The Lesson 11.5 comment saying these are deliberately NOT
# selected comes out with the same edit: a comment stops being true the moment
# you change the thing it describes.
      heroImage {
        node {
          ...MediaFields
        }
      }
```

```graphql
# next-app/src/graphql/hobt.graphql (fragment) — inside `testimonials`, after `role`
        avatar {
          node {
            ...MediaFields
          }
        }
```

```bash
npm run codegen
# Expected: HobtPromoQuery now carries heroImage and testimonials[].avatar.
#           npm run type-check is still clean — nothing reads them YET, which is
#           the state Lesson 11.5 refused to ship. Step 6 is why that is allowed
#           to last for one commit and not one module.
```

### Step 6: Render them — `priority` on the hero, and only the hero

```tsx
// next-app/src/components/hobt/HobtHero.tsx — the imports, added
import Image from 'next/image';

import type { MediaFieldsFragment } from '@/gql/graphql';
```

```tsx
// next-app/src/components/hobt/HobtHero.tsx — the props type, one member added
  readonly heroImage: MediaFieldsFragment | null;
```

Binding the prop to the generated fragment type is Lesson 10.5's rule: the component's field set
and the query's field set become the same object, so "the query fetches something nothing
renders" is a compile error.

```tsx
// next-app/src/components/hobt/HobtHero.tsx — added after the <p>{subheadline}</p> block
      {/* THE LCP ELEMENT of /hobt, and the only image on this route with
          `priority`. Key Concept 5: it sets loading="eager" and
          fetchpriority="high" and emits a <link rel="preload">, all of which take
          bandwidth from something else. Six priorities is no priority.
          Both dimensions are required before rendering: without them there is no
          box to reserve, and the hero is exactly the element whose layout shift
          you would feel. */}
      {heroImage?.sourceUrl !== null &&
      heroImage?.sourceUrl !== undefined &&
      typeof heroImage.mediaDetails?.width === 'number' &&
      typeof heroImage.mediaDetails?.height === 'number' ? (
        <Image
          src={heroImage.sourceUrl}
          alt={heroImage.altText ?? ''}
          width={heroImage.mediaDetails.width}
          height={heroImage.mediaDetails.height}
          priority
          sizes="(min-width: 1024px) 1024px, 100vw"
          className="mt-10 h-auto w-full rounded-lg"
        />
      ) : null}
```

```tsx
// next-app/src/app/[locale]/hobt/page.tsx — the HobtHero call, one prop added
      <HobtHero
        locale={locale}
        headline={promo.headline}
        subheadline={promo.subheadline}
        priceUsd={promo.priceUsd}
        seatsLeft={promo.seatsLeft}
        heroImage={promo.heroImage?.node ?? null}
      >
```

Then the avatars — the fixed-size contrast from Key Concept 9.

```tsx
// next-app/src/components/hobt/HobtTestimonials.tsx — the imports and the row type
import Image from 'next/image';

import type { MediaFieldsFragment } from '@/gql/graphql';

type HobtTestimonial = {
  readonly quote: string | null;
  readonly author: string | null;
  readonly role: string | null;
  // The ACF image field is a CONNECTION, so the node is one level down. HobtHero
  // receives an already-unwrapped node because page.tsx can write
  // `promo.heroImage?.node`; an avatar is nested inside a repeater ROW, so there
  // is nowhere for the page to unwrap it and this component does it instead.
  readonly avatar: { readonly node: MediaFieldsFragment | null } | null;
};
```

```tsx
// next-app/src/components/hobt/HobtTestimonials.tsx — inside <figcaption>, before {t.author}
                {/* A FIXED size, so `sizes` is a fixed `40px` and the browser
                    chooses from imageSizes (48, 96) rather than from eight
                    device widths. No `priority`: twelve avatars, all below the
                    fold. `mediaDetails` is selected and ignored here, which is
                    honest overfetch — Key Concept 9's last row. */}
                {t.avatar?.node?.sourceUrl !== null && t.avatar?.node?.sourceUrl !== undefined ? (
                  <Image
                    src={t.avatar.node.sourceUrl}
                    // Decorative: the author's name is right next to it, so an
                    // alt would be announced twice. Empty string, not missing.
                    alt=""
                    width={40}
                    height={40}
                    sizes="40px"
                    className="mr-2 inline-block h-10 w-10 rounded-full object-cover align-middle"
                  />
                ) : null}
```

```bash
npm run codegen
npm run verify
```

**Verify §6:**

- [ ] `grep -c 'priority' src/components/hobt/HobtHero.tsx` is `1`. Exactly one image on this
      route asks to jump the queue.
- [ ] `grep -rc 'priority' src/components/blocks/CoreImage.tsx` is `0`.
- [ ] `/en/hobt` shows the hero image and the testimonial avatars, and DevTools → Network → Img
      shows the hero requested **before** the avatars.
- [ ] The page still has exactly one `<h1>` and both CTA bands. Adding an image did not move a
      heading, and Lesson 12.3's smoke spec asserts both.

### Step 7: Find the LCP element, and write it down

An unmeasured optimisation is a belief. Measure once, now, so Module 21 has something to compare
against.

```bash
npm run build
npm run start &
sleep 6
```

Then, in the browser, on `http://localhost:3000/en/hobt`:

1. DevTools → **Performance** → the gear → CPU **4× slowdown** and network **Fast 4G**. An
   unthrottled laptop measures your laptop, not your users.
2. Record, reload, stop.
3. In the **Timings** track, click the **LCP** marker. The Summary panel names the element.
4. Note the LCP **time** and the **element**.

```bash
# And the same fact non-interactively: the preload `priority` emitted.
curl -s http://localhost:3000/en/hobt | grep -o 'rel="preload"[^>]*as="image"' | head -1
# Expected: one match — the hero image, preloaded. If this is EMPTY, `priority` is
#           not on the element you think it is.
kill %1
```

`docs/perf-baseline.md` is **Module 21's file** and does not exist yet — Lesson 21.1 creates it,
and inventing it here would mean 21.1 either overwrites your numbers or has to merge them. So
the note goes in `docs/architecture.md`, which has existed since Lesson 01.2, with a pointer so
21.1 can find it:

```markdown
<!-- docs/architecture.md — append -->
## Image delivery (Lesson 14.5)

WordPress stores the originals; Next optimises on request. `remotePatterns` in
`next.config.ts` is the **only** place a media hostname appears, which is what makes Module 24's
move to an S3/R2 media subdomain a one-array change.

| Route | Image | `sizes` | `priority` |
|---|---|---|---|
| `/[locale]/hobt` | ACF `heroImage` | `(min-width: 1024px) 1024px, 100vw` | **yes** — the LCP element |
| `/[locale]/hobt` | testimonial `avatar` × N | `40px` | no |
| `/[locale]/blog/[slug]`, `/[locale]/[...slug]` | `core/image` blocks | `(min-width: 1024px) 720px, calc(100vw - 2rem)` | **no** — a block cannot know it is the LCP element |

`config`: `formats: ['image/avif', 'image/webp']`, `qualities: [75, 90]`,
`minimumCacheTTL: 2678400`. `deviceSizes` and `imageSizes` are left at their defaults.

**First measurement, for Module 21 to start from.** Record your own numbers:

- date, Next version, throttling used (4× CPU, Fast 4G)
- `/en/hobt` LCP element: _______  LCP time: _______ ms
- whether the hero appeared in the Network panel before the avatars

Lesson 21.1 creates `docs/perf-baseline.md` and should copy this row into it.
```

```bash
npm run verify
npm test -- --run
npx playwright test
git add -A
git commit -m "feat(next): next/image for core/image blocks and the HOBT hero"
```

---

## Verification

```bash
cd next-app
# `npm run dev` running in another terminal.

# 1. The gate
npm run verify
# Expected: exit 0, silent

# 2. The config carries the three new keys and the old allowlist
grep -c "formats: \['image/avif', 'image/webp'\]" next.config.ts
# Expected: 1
grep -c 'minimumCacheTTL' next.config.ts
# Expected: 1
grep -c "pathname: '/wp-content/uploads/\*\*'" next.config.ts
# Expected: 1 — Lesson 09.1's line, untouched.

# 3. The optimiser really is transcoding. Build the URL from a REAL attachment
#    rather than guessing one.
SRC=$(curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ mediaItems(first:1){ nodes { sourceUrl } } }"}' \
  | jq -r '.data.mediaItems.nodes[0].sourceUrl')
echo "$SRC"
# Expected: http://localhost:8080/wp-content/uploads/...

ENC=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$SRC")

curl -sI -H 'Accept: image/webp,*/*' \
  "http://localhost:3000/_next/image?url=$ENC&w=640&q=75" | grep -iE '^HTTP|^content-type'
# Expected: 200, and `content-type: image/webp`

curl -sI -H 'Accept: image/avif,image/webp,*/*' \
  "http://localhost:3000/_next/image?url=$ENC&w=640&q=75" | grep -iE '^content-type'
# Expected: image/avif — the `formats` preference list, choosing per request.

# 4. `priority` is on exactly one image, and it is the hero
grep -c 'priority' src/components/hobt/HobtHero.tsx
# Expected: 1
curl -s http://localhost:3000/en/hobt | grep -o 'rel="preload"[^>]*as="image"' | wc -l
# Expected: 1 — one preload in the document head. Six would be none.

# 5. The images render, and through the optimiser
curl -s http://localhost:3000/en/hobt | grep -o '/_next/image' | wc -l
# Expected: 9 or more — the hero's srcset entries plus one per avatar.
curl -s http://localhost:3000/en/hobt | grep -o 'sizes="40px"' | wc -l
# Expected: 1 or more — the fixed-size avatars, choosing from imageSizes.

# 6. NEGATIVE — the allowlist is not a wildcard. This is Lesson 09.1's decision
#    and this lesson's job is to keep it.
grep -c "hostname: '\*\*'" next.config.ts
# Expected: 0
grep -c "hostname: '\*'" next.config.ts
# Expected: 0

# 7. NEGATIVE — a host that is not in remotePatterns is REFUSED. This is the
#    open-image-proxy check, and it is proving Lesson 09.1's decision rather
#    than a new one.
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://localhost:3000/_next/image?url=https://example.com/x.jpg&w=640&q=75'
# Expected: 400
#           A 200 here means somebody widened the allowlist. Treat it as an
#           incident, not a lint failure.

# 8. NEGATIVE — an undeclared quality is refused too, which is what `qualities`
#    buys: q=1..100 are not a hundred cache keys per width per format.
curl -s -o /dev/null -w '%{http_code}\n' \
  "http://localhost:3000/_next/image?url=$ENC&w=640&q=42"
# Expected: 400. If it is 200, `qualities` is not in your config or your Next
#           version predates the key — check Task §1.

# 9. NEGATIVE — CoreImage does NOT take a priority prop. LCP priority is a
#    route-level decision, because a block does not know where on the page it is.
grep -c 'priority' src/components/blocks/CoreImage.tsx
# Expected: 0

# 10. NEGATIVE — no source file writes a raw <img>. next/image emits one at
#     runtime; nothing in src/ does. @next/next/no-img-element (Lesson 09.1) is
#     what enforces it, and this is the check that it is still on.
grep -rn '<img ' src/components/ src/app/ | wc -l
# Expected: 0
#           Every <img> in the rendered HTML comes from next/image, and every
#           <img> inside editor content was stripped by RichText's FORBID_TAGS.

# 11. NEGATIVE — the fragment and the registry are still locked together, and
#     nothing selects renderedHtml
grep -c '\.\.\. on ' src/graphql/fragments/editorBlocks.graphql
# Expected: 12 (13 if you built Lesson 13.5's stretch block)
grep -c 'attributes {' src/graphql/fragments/editorBlocks.graphql
# Expected: the same number as the line above
grep -rn 'renderedHtml' src/ | wc -l
# Expected: 0

# 12. NEGATIVE — dangerouslySetInnerHTML is still in exactly one file. CoreImage's
#     caption is rich text and went through RichText rather than growing a second.
grep -rl 'dangerouslySetInnerHTML' src/ | wc -l
# Expected: 1

# 13. NEGATIVE — both suites green. /hobt gained two images, and Lesson 12.3
#     addresses that page by heading and by CTA name.
npm test -- --run
# Expected: 0 failures
npx playwright test
# Expected: 0 failures, 13 passed

# 14. The seeded corpus is untouched — Task §4's probe post is gone
cd ../wordpress-headless
docker compose run --rm wpcli wp post list --post_type=post --format=count
# Expected: 10
```

If check 3 returns `content-type: image/jpeg`, Next served the original instead of transcoding:
either `formats` is missing, or the `Accept` header did not reach the server. If check 7 returns
`404` rather than `400`, you are on a version that validates differently — read the dev server
log, which names the reason, and the security property is unchanged either way.

## Control Questions

1. `hostname: '**'` and `hostname: 'localhost'` with no `pathname` are both wider than what this
   app uses. Describe the concrete attack each one enables, and say which of the two you could
   still defend in a code review and under what condition.
2. `CoreImage` reads `width` and `height` from `mediaItem.mediaDetails` and explicitly not from
   the block's own `width`/`height` attributes. Give both reasons, and say what the page looks
   like on the day an editor resizes an image in the editor and you read the attributes instead.
3. A colleague sets `sizes="100vw"` on every image in the app "so nothing is ever blurry".
   Quantify what that costs for the 40 px avatar on a 2× phone, and name the *other* failure
   mode `sizes` has that their change does not fix.
4. `priority` is on `HobtHero` and on nothing else. Explain the three mechanical things it does,
   then explain why adding it to `CoreImage` would make `/hobt` slower rather than faster.
5. Module 24 moves uploads to a media subdomain. List every file that has to change, then explain
   which single property of `sourceUrl` makes that list as short as it is.

## Learn More

- [`next/image` API reference](https://nextjs.org/docs/app/api-reference/components/image) — the
  full prop list; read `sizes`, `fill` and `priority` next to Key Concepts 3, 4 and 5
- [`images` configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/images)
  — `remotePatterns`, `formats`, `qualities`, `deviceSizes`, `imageSizes` and
  `minimumCacheTTL`, all in one page, including the defaults Key Concept 7 declines to change
- [Next.js — image optimisation](https://nextjs.org/docs/app/getting-started/images) — the
  framework's own walkthrough of the pipeline in Key Concept 2
- [MDN — responsive images](https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Responsive_images)
  — `srcset` and `sizes` from first principles. Worth an hour if `sizes` still feels like
  copy-paste
- [MDN — `<img sizes>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/img#sizes) —
  the exact grammar of the media-condition list, which is where the syntax errors hide
- [web.dev — Largest Contentful Paint](https://web.dev/articles/lcp) — what the LCP element
  actually is, which is the thing Task §7 asks you to identify
- [web.dev — optimise LCP](https://web.dev/articles/optimize-lcp) — the preload-and-eager
  strategy `priority` implements, and the "do not preload everything" section
- [web.dev — Cumulative Layout Shift](https://web.dev/articles/cls) — Key Concept 3's diagram,
  measured, with the aspect-ratio fix stated as the primary remedy
- [`wp_get_attachment_image()`](https://developer.wordpress.org/reference/functions/wp_get_attachment_image/)
  — the Classic function this component replaces, including the `alt` fallback behaviour Key
  Concept 6 warns about
