---
title: 'Fixing LCP & CLS'
module: 21
lesson: 2
teaches: [lcp-optimization, cls-prevention, next-font, image-priority, image-sizes, reserved-space]
produces: ['next-app/src/app/[locale]/layout.tsx', 'next-app/src/app/[locale]/hobt/page.tsx', 'next-app/src/components/layout/Header.tsx']
requires: [21.1, 14.5, 11.3]
---

# Lesson 21.2 — Fixing LCP & CLS

## Quick Overview

LCP and CLS belong in one lesson because they share a cause: **things arriving late and at an
unexpected size**. An image that starts downloading after the JavaScript has parsed is a slow
LCP. That same image, arriving without declared dimensions, is also a layout shift. A font that
swaps in at 800 ms shifts every line of text on the page. A `SessionMenu` whose three branches
are three different heights reflows the header the moment `/api/auth/session` resolves. Fix the
arrival order
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

### 1. One cause, two metrics

LCP and CLS are usually taught apart, which hides the fact that most real instances of both come
from the same event: **something arrives late, at a size nobody reserved.**

```
   an element arrives late …

   … and it is the biggest thing in the viewport   →  LCP is when it painted
   … and nothing reserved its space                →  CLS is what it pushed

   the same image, the same request, two metrics
```

Four late arrivals on this site, and which metric each one moves:

| Late arrival | LCP | CLS |
|---|---|---|
| The `/hobt` hero image, no `priority` | **yes** — the request starts after the parser reaches it | no — Lesson 14.5 gave it `width`/`height` |
| A webfont that swaps at 800 ms | sometimes — if the LCP element is text | **yes** — every line re-flows |
| The Turnstile iframe injected into an empty `<div>` | no | **yes** — 65 px of content appears below the fold line |
| `SessionMenu` resolving `/api/auth/session` | no | **yes** — if its box is not fixed |

So the two fixes are the same two questions asked of every region: **when does it start
downloading**, and **how much space is reserved before it arrives.**

### 2. LCP has four parts, and Module 18 already fixed one of them

LCP is not a single duration. It decomposes, and knowing which part is yours is the difference
between fixing it and guessing.

```
   |── TTFB ──|── resource load delay ──|── resource load time ──|── element render delay ──|
   0                                                                                     LCP

   TTFB                 server thinking + network. Module 18's ISR made this a cache read
   resource load delay  the gap between TTFB and the request STARTING. `priority` attacks this
   resource load time   the bytes on the wire. AVIF/WebP and `sizes` attack this (Lesson 14.5)
   element render delay downloaded but not painted — blocking CSS, a font that has not swapped
```

| Part | Who already owns it | What is left for this lesson |
|---|---|---|
| TTFB | **Module 18.** `/hobt` is `revalidate = false`, the three `[slug]` routes are ISR + tags | verify it did not regress; `/en/incidents` is `dynamic` and will always be worse |
| Resource load delay | Lesson 14.5's single `priority` per route | **verify** that the one `priority` is on the element the measurement named |
| Resource load time | Lesson 14.5's `formats`, `qualities` and `sizes` | tighten `sizes` **with arithmetic**, not with a guess |
| Element render delay | nobody yet | **`next/font`.** This is 21.2's headline |

That table is the reason this lesson does not start by editing images. Three of the four parts
were paid for in earlier modules, and the unpaid one is a typeface.

### 3. `priority` is three separate mechanisms, and they are not interchangeable

Lesson 14.5 §5 already argued that `priority` is scarce. What it did not spell out is that
`priority` bundles three browser features that people reach for individually and confuse:

| Mechanism | What it changes | Available without `priority` |
|---|---|---|
| `loading="eager"` | do not wait for the element to approach the viewport | `loading` attribute, any `<img>` |
| `fetchpriority="high"` | move this request ahead of other images in the queue | `fetchpriority` attribute |
| `<link rel="preload" as="image" imagesrcset=…>` in `<head>` | start the request before the `<img>` is parsed at all | a hand-written `<link>` |

Only the third changes *when discovery happens*, and that is the distinction that matters: an
image below 3 000 px of markup is helped by the preload and not at all by `fetchpriority`,
because its request has not been discovered yet; an image discovered early but queued behind
eight thumbnails is the reverse.

Which is why "mark everything `priority`" is worse than doing nothing: six preloads in `<head>`
compete with the CSS that decides which of the six is even visible, so the real LCP element
finishes **later** than with none. `priority` is a queue-jumping token. Handing one to everybody
abolishes the queue.

### 4. CLS is a session window, and that changes what counts as "fixed"

Restating Lesson 21.1 Key Concept 1 because it has a direct consequence here: shifts are grouped
into windows of at most **5 seconds**, and your CLS is the **worst** window.

Two consequences people get wrong. **A shift 10 seconds in still counts** — it opens a new
window, so "it only happens after the user has been reading a while" is not a defence. And
**position decides, not attention**: content below the fold moving does not score, and content
moving while the tab is backgrounded does not score either, because CLS only accumulates while
the page is visible.

So the reserved-space audit covers every region that can resolve at *any* point, not just during
load — every asynchronous island. Key Concept 8 enumerates them.

### 5. What `next/font` actually does

Four mechanical things, at build time, and each one removes a specific cost:

```
   A Google Fonts <link> in header.php          next/font/google
   ─────────────────────────────────────        ─────────────────────────────────────
   1. DNS lookup: fonts.googleapis.com          (none — same origin)
   2. TLS handshake to a 3rd party              (none)
   3. GET the CSS  → render-blocking            @font-face is INLINED in the <head>
   4. parse CSS, discover the font URL          the file is already known
   5. DNS + TLS to fonts.gstatic.com            (none — /_next/static/media/…)
   6. GET the .woff2                            preloaded from your own origin
   7. swap                                      swap, with a metric-matched fallback

   two third-party origins, ~5 round trips      zero third-party origins, 1 round trip
   the font URL is unknown until step 4         a <link rel=preload> is emitted at build
```

| What it does | Consequence |
|---|---|
| Downloads the font file at **build** time | no build-time-unknown URL, no runtime fetch of a third party |
| Self-hosts it under `/_next/static/media/` | one origin, your cache headers, your `immutable` |
| Inlines the `@font-face` into the document head | no render-blocking stylesheet from another origin |
| Emits a `<link rel="preload">` for the file | the request starts with the document, not after the CSS |

And the reason a Google Fonts `<link>` is not merely slower: **it is a third party in your
critical path, and it sees every one of your visitors' IP addresses.** Whether that is a
compliance problem depends on where you operate, and a German court has already decided that it
can be — which is a sentence your legal team will care about more than the five round trips.

The cost of `next/font/google`, stated plainly and not hidden: **your build now needs network
access to `fonts.gstatic.com`.** An offline or air-gapped CI runner cannot build the app. The
reversal is `next/font/local` with a committed `.woff2`, which also gives Lesson 19.2's
`opengraph-image` route a file it can read from disk — a debt 19.2 explicitly booked against this
module and which this lesson does **not** pay. Task §2 records it as an open item rather than
pretending otherwise.

### 6. Font metrics, and why a mismatched fallback is a guaranteed shift

`display: 'swap'` means: render immediately in the fallback, then repaint in the real font when it
arrives. That is the right choice — the alternative, `block`, shows invisible text for up to
three seconds — but it guarantees two paints of the same text.

The shift comes from the two typefaces having different **metrics**: units per em, ascent,
descent, line gap, and above all average advance width. Different metrics mean a different line
height and a different number of words per line, which means every block below the text moves.

```
   fallback: Arial            real font: a 1.35 line-height webfont
   ───────────────────────    ────────────────────────────────────────
   "Blame The Tech is a"      "Blame The Tech is a satirical"      ← different wrap point
   "satirical incident"       "incident tracker"                   ← one line shorter
   "tracker"
   [ the <h2> below moves up 24px ]                                 ← that is your CLS
```

The fix is to make the fallback *pretend* to have the real font's metrics, via the CSS
`size-adjust`, `ascent-override`, `descent-override` and `line-gap-override` descriptors on a
synthetic `@font-face`. Computing those four by hand means reading them out of the font binary.

`next/font` does it for you: **`adjustFontFallback` defaults to `true`** for `next/font/google`,
so Next reads the real metrics at build time, generates an Arial-based fallback with the
overrides applied, and puts it ahead of your own `fallback` array. The residual shift is usually
too small to register.

| Option | Effect | When you would change it |
|---|---|---|
| `adjustFontFallback: true` (default) | metric-matched Arial fallback, generated | leave it |
| `adjustFontFallback: false` | your `fallback` array, unadjusted | you have a licensed fallback with matching metrics already |
| `fallback: ['system-ui', 'arial']` | what is used if the file 404s entirely | always set it; it is free |

### 7. Subsets, and the failure mode that has no error message

A Google font is published as several **subsets** — `latin`, `latin-ext`, `cyrillic`,
`cyrillic-ext`, `greek`, and so on — each one a separate file with its own `unicode-range`.
`next/font/google` requires you to name the ones you want — and what naming them actually
controls is **preloading**, not downloading. Measured on Next 15.5.25: Inter emits seven `.woff2`
files whichever subsets you name; what changes is how many of them are written as `*.p.woff2` and
given a `<link rel="preload">`.

Which this app needs, and why:

| Locale | Characters | Subset |
|---|---|---|
| `en` | ASCII | `latin` |
| `de` | `ä ö ü ß` — all inside U+0000–U+00FF | `latin`. **Not** `latin-ext` |
| `uk` | `і ї є ґ` — U+0454, U+0456, U+0457, U+0490–0491 | `cyrillic`, which covers U+0400–045F **and** U+0490–0491 |

So `subsets: ['latin', 'cyrillic']` is the complete and minimal set for these three locales.
`cyrillic-ext` is not needed: it carries historic Slavonic glyphs and the hryvnia sign `₴`, and
this app prices in USD (`priceUsd`, appendix 03 §4.4). Add it the day a price is displayed in
hryvnia and not before — every subset is another file in the critical path.

**The failure mode is silence, and it is subtler than it looks.** Ship `subsets: ['latin']` and
`/uk` still gets Inter — the Cyrillic `@font-face` and its file ship regardless, which is the part
worth measuring rather than assuming. What you lose is the preload: Cyrillic is then discovered
late, from the CSS, so `/uk` alone pays a flash of unstyled text and the shift that follows it,
on the locale you are least likely to be reading. Nothing warns you: not the build, not
TypeScript, not ESLint, not Lighthouse. Which is why Verification counts the **preloaded** files
rather than trusting a visual check — the plain `.woff2` count cannot fail. Module 20's README
predicted it: "Cyrillic exposes a `next/font` subset you forgot to include".

### 8. The asynchronous regions on this site, audited rather than assumed

The interesting part of this lesson is that **two of the four regions you would expect to be CLS
sources are not**, and finding that out is the work.

| Region | Where | Resolves | Shifts? |
|---|---|---|---|
| `SessionMenu` | `Header` (Lesson 18.1) | `/api/auth/session`, on mount | **yes** — see below |
| Turnstile widget | `LeadForm` (Lesson 16.3) | `api.js`, `afterInteractive` | **yes** — 65 px, from an empty `<div>` |
| `seatsLeft` urgency badge | `HobtHero` (Lesson 11.5) | never — server-rendered from ACF | **no** |
| `core/embed` iframe | nowhere | never — not in the registry | **no** |

**`SessionMenu` is a shift this course created two modules ago, knowingly.** Lesson 18.1 moved the
session read out of the root layout so the routes could be static, accepted "one frame in which a
signed-in user sees the anonymous affordance", and reserved space with `min-w-[9rem]`. That
reservation is width-only, and the three branches are not dimensionally equal:

| Branch | Rendered | Height | Width |
|---|---|---|---|
| unresolved | `<span aria-hidden className="h-8 w-full" />` | 32 px | ≥ 144 px |
| signed out | a bare `<Link className="text-sm underline">` | ~20 px | ~60 px |
| signed in | a name span (hidden below `sm`) plus a `<form>` with an `sm` `Button` | 32 px | **unbounded** — a long display name grows it |

So the box changes height when a signed-out visitor's fetch resolves, and changes width past the
floor for a long display name. The header's own `h-16` caps the vertical damage, but the nav items
to its left still move horizontally, and horizontal movement is layout shift. The structural fix
is Task §4: **put the reserved box in the Server Component parent, not inside the island.** A
reservation inside the island is only as good as its least careful branch, and there will be more
branches.

**`seatsLeft` and `core/embed` are the two candidates that turn out not to be shifts at all.**
`seatsLeft` comes from the ISR'd `hobtPromo` query and renders on the server as
`typeof seatsLeft === 'number' ? … : null` (Lesson 11.5 §4), so it is either in the first byte or
absent from it — there is no arrival to reserve for. `core/embed` is not one of the twelve block
types in the registry, so it falls through to `UnknownBlock`, which renders `null` in production;
and `RichText` names `iframe` in both its `ALLOWED_TAGS` omission and its `FORBID_TAGS` list, so
an `<iframe>` inside editor HTML is stripped. An embed on this site produces no layout, therefore
no shift.

Which does not mean there is nothing to do — it means the work is **a rule rather than a fix**,
and Task §7 writes it where it will be enforced.

### 9. The honest reversal: a wrong skeleton is worse than no skeleton

Reserving space is not unconditionally correct, and Lesson 20.4 already made the opposite call
deliberately. `UntranslatedNotice` is wrapped in `<Suspense fallback={null}>` with this comment:

> `fallback={null}` is correct here and would be wrong for the switcher: the notice is absent on
> almost every request, so reserving space for it would introduce the layout shift Module 21
> measures.

That is right, and it generalises:

| The region | Reserve space? |
|---|---|
| Almost always present, known size | **yes.** A fixed box |
| Almost always present, unknown size | yes — reserve the *common* size and let the rare case shift |
| Almost always **absent** | **no.** Reserving space means a permanent hole plus a shift when it fills |
| Present or absent, unknowable | no. Render it in a position where it displaces nothing — an overlay, or the end of the document |

A skeleton whose height does not match its replacement does not remove a shift, it adds a second
one: the skeleton appears, then something taller replaces it. One shift beats two. Audit
skeletons against the real thing, not against the design mock.

### 10. `deviceSizes`: declining to trim it, and the measurement that would change that

Lesson 14.5 left `images.deviceSizes` and `imageSizes` at their defaults with a note that "Module
21 may trim them, **with numbers**." This lesson does not trim them, and the reason is that the
argument *for* trimming is suggestive rather than measured.

The suggestive part: WordPress's `big_image_size_threshold` defaults to 2560 px, so an upload
larger than that is downscaled and the media library never holds a 3840 px original. The `3840`
entry in `deviceSizes` therefore describes a width no `srcset` on this site can usefully offer.

Why that is not enough to act on: `big_image_size_threshold` is **filterable**, so a plugin or a
`functions.php` line can raise it; and even if no original is that wide, the optimiser *upscales*
rather than refusing, so a 3× device can still request `w=3840`. Both links in the chain are
assumptions.

The measurement that would settle it: count the distinct `w=` values actually requested against
`/_next/image` over a real traffic sample, which needs traffic, which needs Module 24. Until then
the default costs cache storage and the trim risks the blurry-image failure from Lesson 14.5 §4 —
and of those two, storage is the cheaper mistake. Recorded as an open item, with the exact
measurement named, which is the difference between deferring and forgetting.

---

## Task

### Step 1: Read your baseline and pick one target

You cannot claim an improvement without a before-number, and Lesson 21.1 produced one. Open
`docs/perf-baseline.md`, find the worst LCP and the worst CLS in the six-route table, and write
the two route names down. Everything below is aimed at those two.

```bash
# next-app
cd next-app
grep -n '^| `/en' ../docs/perf-baseline.md
# Expected: six rows with real numbers. If any cell is still `______`, stop and
#           finish Lesson 21.1 — there is nothing here to subtract from.
```

Then confirm what Lesson 14.5 already shipped, because this lesson **verifies** the image work
rather than redoing it:

```bash
# next-app
grep -c 'sizes=' src/components/blocks/CoreImage.tsx
# Expected: 2 — both <Image> branches, from Lesson 14.5
grep -c 'sizes=' src/components/hobt/HobtHero.tsx
# Expected: 1
grep -c 'sizes=' src/components/hobt/HobtTestimonials.tsx
# Expected: 1
grep -cE '^[[:space:]]+priority[[:space:]]*$' src/components/hobt/HobtHero.tsx
# Expected: 1 — the JSX prop. ANCHOR the pattern: a loose `grep -c priority`
#           also matches Lesson 14.5's comment explaining it, which is why
#           14.5's own check on this file returns 2 rather than the 1 it claims.
grep -cE '^[[:space:]]+priority[[:space:]]*$' src/components/blocks/CoreImage.tsx
# Expected: 0 — a block cannot know it is the LCP element. Lesson 14.5 §5.
```

**Verify §1:**

- [ ] You have named one route as the LCP target and one as the CLS target, with their current
      numbers.
- [ ] All six greps return the expected counts. If the anchored `priority` pattern matches twice
      in one file, Lesson 14.5's rule has already been broken and that is your first fix.

### Step 2: Add `next/font` to the root layout

This is the headload of the lesson and it is one import plus one attribute.

```tsx
// next-app/src/app/[locale]/layout.tsx — the font, declared at module scope
// MODULE SCOPE, not inside the component. next/font resolves at BUILD time:
// Next downloads the file, self-hosts it under /_next/static/media/, inlines
// the @font-face and emits a <link rel="preload">. Calling this per render
// would be meaningless — there is nothing to call at runtime.
import { Inter } from 'next/font/google';

const bttSans = Inter({
  // latin covers en AND de: ä ö ü ß all live below U+0100, so `latin-ext` is
  // not needed. cyrillic covers uk: U+0400-045F plus U+0490-0491, which is
  // where і ї є ґ are. `cyrillic-ext` carries historic Slavonic glyphs and ₴,
  // and this app prices in USD — add it the day a price is shown in hryvnia.
  //
  // Omitting `cyrillic` fails SILENTLY: /uk renders Cyrillic from the fallback
  // font, so /uk gets two typefaces and two sets of metrics on one page, and
  // nothing — not the build, not tsc, not ESLint, not Lighthouse — says so.
  // Key Concept 7, and Verification greps for this literal string.
  subsets: ['latin', 'cyrillic'],

  // Render immediately in the fallback, repaint when the file lands. `block`
  // would show invisible text for up to 3s, which is a worse trade on a site
  // whose LCP element is sometimes a headline.
  display: 'swap',

  // adjustFontFallback is TRUE by default and is left at its default on
  // purpose: Next reads Inter's real metrics at build time and generates an
  // Arial-based fallback with size-adjust/ascent-override applied, so the swap
  // costs almost no CLS. Setting it to false means hand-computing four
  // descriptors from the font binary. Key Concept 6.
  //
  // `fallback` is what applies if the self-hosted file 404s entirely.
  fallback: ['system-ui', 'arial'],

  // Both handles are taken: `.className` sets font-family directly and is what
  // Step 3 puts on <html>; `.variable` exposes --font-btt-sans so a future
  // Tailwind theme key or a component can reach it without importing this file.
  variable: '--font-btt-sans',
});
```

**Verify §2:**

- [ ] `npm run build` succeeds. It now makes a network request to `fonts.gstatic.com` at build
      time — the cost named in Key Concept 5. On an offline runner this step is where the build
      fails, and the reversal is `next/font/local`.
- [ ] `ls .next/static/media/*.p.woff2 | wc -l` is `2` — one **preloaded** file per named
      subset. Count the `.p.` files, not the plain `.woff2` ones: Inter emits seven of those
      whatever you declare, so that count cannot tell a correct config from a wrong one.
- [ ] Lesson 19.2's OG-image debt is still open. It asked for a **local** font file it could read
      from disk, and a `next/font/google` file has no stable path. Write it into
      `docs/perf-baseline.md`'s open items in Step 8 rather than leaving it in a comment.

### Step 3: Make the font apply, and prove nothing third-party survives

One attribute on the element Lesson 20.3 already shows verbatim. `lang` has been there since
09.1 and `dir` since 20.3; neither changes.

```tsx
// next-app/src/app/[locale]/layout.tsx — the <html> element, one attribute added
    <html lang={locale} dir={dirOf(locale)} className={`${bttSans.className} ${bttSans.variable}`}>
```

`.className` is a generated class that sets `font-family` directly. That beats Tailwind's
preflight, which sets `font-family` on the `html` element selector — a class selector wins on
specificity, so there is nothing to configure in `globals.css` and nothing to add to
`tailwind.config.ts`, which exists for exactly one reason (the `typography` key) and should keep
existing for one reason.

> **Two notes for later lessons.** If you would rather drive it through Tailwind, the shape is
> `@theme inline { --font-sans: var(--font-btt-sans); }` in `src/app/[locale]/globals.css`,
> alongside the bridge block Lesson 11.1 already put there — and read 11.1 Key Concept 3 first,
> because plain `@theme` and `@theme inline` behave differently here. And if a later lesson adds a
> theme class to `<html>`, it composes into this template literal; it does not replace it.

Now the check that matters, on the built HTML rather than on the source:

```bash
# next-app
npm run build && npm start &
sleep 6

curl -s http://localhost:3000/en | grep -o 'fonts.googleapis.com\|fonts.gstatic.com' | wc -l
# Expected: 0 — self-hosted means no third-party origin in the document
curl -s http://localhost:3000/en | grep -o 'rel="preload"[^>]*as="font"' | head -2
# Expected: at least one match, pointing at /_next/static/media/…woff2
curl -s http://localhost:3000/uk/incidents | grep -o 'rel="preload"[^>]*as="font"' | wc -l
# Expected: the same count as /en. The subsets are declared once, for every
#           locale. NOTE this is not an assertion on its own — it is equally
#           equal with only `latin` declared. The check that discriminates is
#           the `*.p.woff2` count in Verify §2.
ls .next/static/media/*.p.woff2 | wc -l
# Expected: 2 — latin and cyrillic, preloaded. This one CAN fail: drop
#           `cyrillic` from the config and it becomes 1.
```

**Verify §3:**

- [ ] Zero references to either Google Fonts origin in the built HTML of all three locales.
- [ ] A `<link rel="preload" as="font">` is present, and its `href` is on your own origin.
- [ ] `/uk/incidents` renders Ukrainian text in the same typeface as `/en/incidents`. It will do
      so **even with `cyrillic` missing** — that is what makes this failure quiet. What a missing
      subset costs is the preload, so the tell is the `*.p.woff2` count and a first paint of `/uk`
      that flashes.

### Step 4: Move the header's reserved box into the Server Component

Key Concept 8 established that `SessionMenu`'s three branches have three different heights and an
unbounded width. The fix is not a better `min-w` inside the island; it is a fixed box in the
parent, which is a promise the island cannot break.

```tsx
// next-app/src/components/layout/Header.tsx — the <SessionMenu /> call, wrapped
        {/* The reservation lives HERE, in a Server Component, and not inside
            SessionMenu. Lesson 18.1's `min-w-[9rem]` reserved width only, and
            its three branches differ in height as well: a 32px placeholder, a
            ~20px bare link, and a 32px form. A reservation inside the island is
            only as good as its least careful branch, and 22.2 is about to add
            branches. The height matches the `sm` Button from Lesson 11.2, and
            the width is the same 9rem 18.1 chose — now hard rather than a
            floor, so a long display name truncates. Key Concept 8. */}
        <div className="ml-4 flex h-8 w-36 shrink-0 items-center justify-end overflow-hidden">
          <SessionMenu locale={locale} />
        </div>
```

```tsx
// next-app/src/components/layout/SessionMenu.tsx — the wrapper div, geometry removed
// The parent owns the box now, so this element fills it instead of asserting a
// floor of its own. `truncate` is what stops a long displayName from pushing
// the nav: it is clipped inside a fixed box rather than growing it.
    <div className="flex h-full w-full items-center justify-end gap-2">
```

```tsx
// next-app/src/components/layout/SessionMenu.tsx — the name span, one class added
          <span className="hidden truncate text-sm text-muted-foreground sm:inline">
```

**Verify §4:**

- [ ] `grep -c 'min-w-\[9rem\]' src/components/layout/SessionMenu.tsx` returns `0`, and
      `grep -c 'w-36' src/components/layout/Header.tsx` returns `1`. Exactly one owner of the
      geometry.
- [ ] `grep -c 'console' src/components/layout/SessionMenu.tsx` still returns `0` — Lesson 18.1's
      constraint, and Lesson 12.3's smoke suite fails on any console output.
- [ ] In DevTools, with the network throttled, the nav items to the left of the box do **not**
      move when the session fetch resolves. Both signed in and signed out.
- [ ] `npx playwright test` still passes. `SessionMenu` is addressed by accessible name, not by
      layout, so a geometry change should not touch a single spec — and if it does, that spec was
      asserting the wrong thing.

### Step 5: Reserve the Turnstile box, which is the real third-party shift

Lesson 16.3 loads Cloudflare's `api.js` with `strategy="afterInteractive"` — correct, and it means
the widget's `<div>` is **empty in the server HTML** and stays empty until the script runs and
injects an iframe. Everything below it then moves down by the widget's height.

```tsx
// next-app/src/components/hobt/LeadForm.tsx — the Turnstile container, sized
        {/* EMPTY in the server HTML. Cloudflare's api.js is afterInteractive
            (Lesson 16.3), so this div gains a ~300x65 iframe a few hundred ms
            after first paint, and everything below it — the submit button, and
            on /hobt the whole footer CTA band — moves. Reserving the box makes
            that shift zero.
            300x65 is the `normal` widget. `compact` is 150x140 and `flexible`
            is width-responsive at 65px tall, so this number is coupled to a
            data-size we are not setting. Erring TALL leaves a gap, which is
            ugly; erring short is CLS. Verify against Cloudflare's current docs
            when you touch this, because they have changed it before. */}
        <div
          className="cf-turnstile min-h-[65px] w-[300px] max-w-full"
          data-sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
          data-response-field-name="turnstileToken"
          data-theme="auto"
        />
```

Then the route-level reservation, on the one page that mounts the form inline. `/hobt` renders
`LeadForm` twice — once inside `GetDemoDialog` and once always-visible at `#lead`, which Lesson
16.3 added for the JavaScript-off path — and Lesson 21.3 is about to wrap the dialog's copy in
`next/dynamic`. Its placeholder needs a height, and that height should be decided once, here.

```tsx
// next-app/src/app/[locale]/hobt/page.tsx — the #lead section, given a floor
      {/* min-h is measured, not guessed: render the form, read its height off
          the box model in DevTools, round UP to the nearest Tailwind step, and
          write the number you measured into docs/perf-baseline.md. This floor
          is also the height Lesson 21.3's next/dynamic placeholder uses, so it
          is decided once and cited rather than duplicated. */}
      <section id="lead" className="min-h-[34rem] scroll-mt-20">
```

**Verify §5:**

- [ ] `curl -s http://localhost:3000/en/hobt | grep -c 'cf-turnstile'` returns `1`, and it
      carries the sizing classes. **One, not two**: Radix does not mount a closed `DialogContent`,
      so the dialog's copy of `LeadForm` is not in the server HTML at all — which is also why
      Lesson 21.3's `next/dynamic` on it costs nothing in markup.
- [ ] In DevTools, throttled, the footer CTA band does **not** move when the Turnstile iframe
      appears.
- [ ] The `min-h` on `#lead` is a number you measured. If the form is shorter than the floor you
      have a visible gap; if it is taller, the floor is doing nothing.
- [ ] `grep -rn 'cf-turnstile' src/ | grep -vc 'min-h'` returns `0` — every Turnstile container is
      sized. Grep, because a second form will be added one day.

### Step 6: Verify `priority` and tighten `sizes` with arithmetic

This lesson does not introduce either. It checks that the one `priority` is on the element the
measurement named, and that `sizes` matches the layout the app actually has.

The arithmetic, which is the only acceptable basis for a change here. The root layout's `<main>`
is `mx-auto max-w-6xl px-4` — `max-w-6xl` is 72 rem = 1152 px, less 1 rem of padding each side, so
the content column is **1120 px** at any viewport ≥ 1152 px. Lesson 14.5 wrote
`(min-width: 1024px) 1024px, 100vw` for the hero, which under-declares by 96 px on a wide
viewport: the browser is told 1024 and lays the image out at 1120, so on a 1× display it picks the
1080 entry and upscales it slightly.

```tsx
// next-app/src/components/hobt/HobtHero.tsx — the hero's `sizes`, corrected
          // 1120px = max-w-6xl (72rem/1152px) minus px-4 on both sides. The
          // middle clause covers 1024-1151px, where the container is still
          // viewport-width minus the same 2rem. Lesson 14.5 wrote a flat
          // 1024px, which under-declared by 96px and made a 1x wide display
          // upscale the 1080 entry. Measured, not guessed — Key Concept 2.
          sizes="(min-width: 1152px) 1120px, (min-width: 1024px) calc(100vw - 2rem), 100vw"
```

Then confirm the LCP element with the same procedure Lesson 21.1 used, on both target routes, and
answer one question per route: **is the element carrying `priority` the element Lighthouse named?**

| If | Then |
|---|---|
| Yes | nothing to change. Record it and move on |
| No, and the named element is an image in a route file | move the `priority` |
| No, and the named element is an image inside a `core/image` block | the honest fix is a `priority` prop threaded from the route through `BlockRenderer`, exactly as Lesson 14.5 §5 said. Do **not** put it inside `CoreImage` |
| No, and the named element is text | it is a font or a blocking-CSS problem, and Steps 2–3 already addressed it. Re-measure before doing anything else |

**Verify §6:**

- [ ] `grep -c 'priority' src/components/hobt/HobtHero.tsx` is still `1`.
- [ ] `curl -s http://localhost:3000/en/hobt | grep -o 'rel="preload"[^>]*as="image"' | wc -l` is
      `1`. One image preload per route, not six.
- [ ] The `sizes` change is justified by the container arithmetic above and by a Network-panel
      reading of the `w=` actually requested — not by preference.

### Step 7: Write the embed rule where it can be enforced

Key Concept 8 found that `core/embed` produces no layout today, because it is not one of the
registry's twelve block types and `RichText` strips `<iframe>` twice over. So there is nothing to
fix and there **is** something to write down, because the day somebody maps `CoreEmbed` is the day
this becomes a real shift on every blog post.

Prove the current state first, then record the rule:

```bash
# next-app
grep -c 'CoreEmbed' src/components/blocks/registry.ts
# Expected: 0 — not mapped. An embed falls through to UnknownBlock, which is a
#           dev-only warning and `null` in production.
grep -c "'iframe'" src/components/blocks/RichText.tsx
# Expected: 1 — the FORBID_TAGS entry from Lesson 14.3. Quoted, because a loose
#           grep also matches that file's prose comments.
grep -c 'ALLOWED_TAGS' src/components/blocks/RichText.tsx
# Expected: 1 — and read the list: `iframe` is absent from it, so both layers
#           agree. Lesson 14.3 explains why that redundancy is deliberate.
```

The rule, for `docs/perf-baseline.md` in Step 8: **a block component that renders an element whose
height is not known from its own props must reserve space before it renders.** For an embed that
means an `aspect-video` wrapper (16:9 is what `core/embed` produces for every video provider) and
a `loading="lazy"` iframe. The enforcement point is the registry's exhaustiveness check, not a
convention: adding `CoreEmbed` to the registry requires adding the inline fragment, and a reviewer
looking at that diff has the rule in front of them.

**Verify §7:**

- [ ] All three greps match. If `CoreEmbed` is in your registry, you built Lesson 13.5's stretch
      block or somebody added it — go and reserve space for it before finishing this step.
- [ ] The rule is in `docs/perf-baseline.md`, not only in this lesson.

### Step 8: Re-measure, and write down what moved

```bash
# next-app
npm run build && npm start &
sleep 6
```

Repeat Lesson 21.1's procedure exactly: mobile preset, CPU 4×, Fast 4G, three runs per route,
median of each metric. Same tool, same version, or the comparison is not a comparison.

```markdown
<!-- docs/perf-baseline.md — append -->
## LCP and CLS, before and after (Lesson 21.2)

Re-measured: ______  ·  same tool, device preset and throttling as Lesson 21.1.

| Route | LCP before | LCP after | CLS before | CLS after |
|---|---|---|---|---|
| `/en` | ______ | ______ | ______ | ______ |
| `/en/incidents` | ______ | ______ | ______ | ______ |
| `/en/incidents/incident-01` | ______ | ______ | ______ | ______ |
| `/en/reviews/review-01` | ______ | ______ | ______ | ______ |
| `/en/blog/blog-01` | ______ | ______ | ______ | ______ |
| `/en/hobt` | ______ | ______ | ______ | ______ |
| `/uk/incidents` | ______ | ______ | ______ | ______ |

What changed, and what did not:

| Change | Expected effect | Measured effect |
|---|---|---|
| `next/font/google`, `subsets: ['latin','cyrillic']`, `display: 'swap'` | removes two third-party origins from the critical path; near-zero swap shift via `adjustFontFallback` | ______ |
| Reserved header box moved into `Header.tsx` | removes the horizontal shift when `/api/auth/session` resolves | ______ |
| Turnstile container sized `300x65` | removes ~65 px of shift on `/hobt` | ______ |
| `#lead` `min-h`, measured at ______ | stabilises the section Lesson 21.3 will defer | ______ |
| Hero `sizes` widened to 1120 px | the `w=` actually requested changes from ______ to ______ | ______ |

**Regions audited and deliberately NOT changed:**

- `seatsLeft` badge — server-rendered from ACF; present in the first byte or absent from it.
  No arrival, nothing to reserve.
- `core/embed` — not in the block registry, and `RichText` strips `<iframe>` in both
  `ALLOWED_TAGS` and `FORBID_TAGS`. Produces no layout, therefore no shift. The rule for the day
  someone maps it: reserve a 16:9 box before rendering the iframe, and put it in `BlockRenderer`'s
  registry diff where a reviewer will see it.
- `UntranslatedNotice` — Lesson 20.4's `fallback={null}` is correct and stays. The notice is
  absent on almost every request, so reserving space for it would add a permanent hole and a shift
  when it fills.
- `images.deviceSizes` / `imageSizes` — left at their defaults. Lesson 14.5 allowed a trim "with
  numbers" and there are none: `big_image_size_threshold` makes a 3840 px original unlikely but it
  is filterable, and the optimiser upscales rather than refusing. The measurement that would
  settle it is the distinct `w=` values requested against `/_next/image` over a real traffic
  sample, which needs Module 24.

**Open items:**

- Lesson 19.2 booked a **local** font file against this module so `opengraph-image` could read
  one from disk. `next/font/google` self-hosts but exposes no stable path, so the debt is still
  open. The fix is a committed `.woff2` plus `next/font/local`, which would also remove the
  build-time dependency on `fonts.gstatic.com`.
- The build now needs network access to `fonts.gstatic.com`. An offline CI runner cannot build.
```

```bash
# next-app
npm run verify
npm test -- --run
npx playwright test
cd ..
git add -A
git commit -m "perf: next/font, reserved async regions, measured sizes"
cd next-app
```

**Verify §8:**

- [ ] Every `______` in the two tables is a number, including the ones that got worse. A
      regression you recorded is a finding; one you did not is a lie by omission.
- [ ] `/uk/incidents` is in the table. It is the locale where the subset mistake shows.
- [ ] The "audited and NOT changed" list is present. Four decisions declined, each with a reason,
      is the part of this document Lesson 21.4 will cite when someone asks why the budget is
      where it is.

---

## Verification

```bash
cd next-app
# A production build is running: `npm run build && npm start`.

# 1. The gate
npm run verify
# Expected: exit 0, silent

# 2. next/font is declared once, at module scope, in the one root layout
grep -c "from 'next/font/google'" 'src/app/[locale]/layout.tsx'
# Expected: 1
grep -c 'bttSans' 'src/app/[locale]/layout.tsx'
# Expected: 2 — the declaration and the <html> className

# 3. THE CYRILLIC CHECK. This is the one failure in the lesson with no error
#    message: subsets: ['latin'] alone renders /uk from the fallback font, with
#    two sets of metrics on one page, and nothing anywhere reports it.
grep -c "'cyrillic'" 'src/app/[locale]/layout.tsx'
# Expected: 1 — quoted, because the comment block above it says the word four
#           more times and a loose grep would count those.
grep -c "subsets: \['latin', 'cyrillic'\]" 'src/app/[locale]/layout.tsx'
# Expected: 1

# 4. NEGATIVE — no third-party font origin survives in the built HTML, in any
#    locale. This is what "self-hosted" has to mean to be worth anything.
for l in en uk de; do
  printf '%s %s\n' "$l" "$(curl -s "http://localhost:3000/$l" \
    | grep -c 'fonts.googleapis.com\|fonts.gstatic.com')"
done
# Expected: en 0, uk 0, de 0

# 5. NEGATIVE — and nothing in source asks for one either, including the
#    stylesheet Module 11 owns
grep -rn 'fonts.googleapis.com\|@import url(' src/ | wc -l
# Expected: 0

# 6. The font is preloaded from your own origin, once per subset
curl -s http://localhost:3000/en | grep -o 'rel="preload"[^>]*as="font"' | wc -l
# Expected: 1 or more
curl -s http://localhost:3000/en | grep -o 'as="font"[^>]*crossorigin' | wc -l
# Expected: 1 or more — a preloaded font needs crossorigin even same-origin;
#           without it the browser fetches it twice. next/font emits it.
curl -s http://localhost:3000/en | grep -c '_next/static/media'
# Expected: 1 or more — the self-hosted file, on your origin

# 7. The @font-face is inlined rather than fetched from a stylesheet
curl -s http://localhost:3000/en | grep -c 'font-face'
# Expected: 1 or more. Zero means the declaration went into a separate CSS
#           file, which is one more request in the critical path.

# 8. NEGATIVE — `priority` is still on exactly one element, and still not in a
#    block component. Lesson 14.5's rule, re-asserted because this is the
#    lesson most likely to break it.
grep -cE '^[[:space:]]+priority[[:space:]]*$' src/components/hobt/HobtHero.tsx
# Expected: 1 — the JSX prop, anchored. Lesson 14.5's own check greps loosely
#           and therefore claims 1 where the file returns 2; the second match is
#           its own explanatory comment. Report that, do not edit the file.
grep -rcE '^[[:space:]]+priority[[:space:]]*$' src/components/blocks/ | grep -v ':0$'
# Expected: no output — zero JSX `priority` props anywhere under blocks/
curl -s http://localhost:3000/en/hobt | grep -o 'rel="preload"[^>]*as="image"' | wc -l
# Expected: 1 — six preloads would be none

# 9. `sizes` is present on every next/image, and the hero's is the measured one
grep -rn 'sizes=' src/components/blocks/CoreImage.tsx src/components/hobt/HobtHero.tsx \
  src/components/hobt/HobtTestimonials.tsx | wc -l
# Expected: 4 — two in CoreImage (both <Image> branches), one each elsewhere
grep -c 'sizes="(min-width: 1152px) 1120px' src/components/hobt/HobtHero.tsx
# Expected: 1 — max-w-6xl minus px-4, arithmetic from the layout. Match the
#           attribute, not the number: the comment above it says 1120px too.

# 10. NEGATIVE — the header box has exactly one owner. Two reservations that
#     disagree is worse than one that is wrong, because you cannot tell which
#     one is in effect by reading either file.
grep -c 'min-w-\[9rem\]' src/components/layout/SessionMenu.tsx
# Expected: 0
grep -c 'w-36' src/components/layout/Header.tsx
# Expected: 1

# 11. The header does not change height or width between server HTML and the
#     hydrated DOM. Compare the served markup with the box after hydration.
curl -s http://localhost:3000/en | grep -o 'h-8 w-36[^"]*' | head -1
# Expected: one match — the reserved box is in the SERVER HTML, so the space
#           exists before any JavaScript runs. If this is empty, the box is
#           being created by the island and reserves nothing.
curl -s http://localhost:3000/en | grep -c 'class="sticky top-0'
# Expected: 1 — one header, and its own h-16 is unchanged

# 12. Every Turnstile container is sized
curl -s http://localhost:3000/en/hobt | grep -c 'cf-turnstile'
# Expected: 1 — the inline #lead copy only. Radix does not mount a closed
#           DialogContent, so the dialog's LeadForm is absent from the server
#           HTML. A 2 would mean somebody added `forceMount`.
grep -rn 'cf-turnstile' src/ | grep -vc 'min-h'
# Expected: 0 — grep rather than eye, because a second form will exist one day

# 13. NEGATIVE — core/embed still produces no layout, so there is no shift to
#     fix and the rule is written down instead. Both defence layers hold.
grep -c 'CoreEmbed' src/components/blocks/registry.ts
# Expected: 0
grep -c "'iframe'" src/components/blocks/RichText.tsx
# Expected: 1 — the FORBID_TAGS entry. It is absent from ALLOWED_TAGS too.
grep -rn '<iframe' src/components/ src/app/ | wc -l
# Expected: 0 — nothing in this app renders an iframe of its own

# 14. NEGATIVE — dangerouslySetInnerHTML is still in exactly one file. Reserving
#     space for an embed would have been the tempting reason to grow a second.
grep -rl 'dangerouslySetInnerHTML' src/ | wc -l
# Expected: 1

# 15. NEGATIVE — no route became dynamic. Editing the root layout is the single
#     easiest way to lose every static route in the app, and next/font is
#     build-time so it must not have.
npm run build 2>&1 | sed -n '/Route (app)/,$p' > /tmp/btt-routes-212.txt
grep -cE '^[┌├└│] *ƒ +/\[locale\]' /tmp/btt-routes-212.txt
# Expected: 1 — /[locale]/incidents only, exactly as Lesson 18.1 left it
grep -c 'ƒ /\[locale\]/hobt' /tmp/btt-routes-212.txt
# Expected: 0

# 16. NEGATIVE — the layout's other tenants are untouched. Nine lessons share
#     this file and this one only added a font.
grep -c 'PreviewBanner' 'src/app/[locale]/layout.tsx'
# Expected: 1 — Lesson 17.2's
grep -c 'NextIntlClientProvider' 'src/app/[locale]/layout.tsx'
# Expected: 1 — Lesson 20.3's
grep -c 'metadataBase' 'src/app/[locale]/layout.tsx'
# Expected: 1 — Lesson 09.1's, which Lesson 19.2 audits rather than edits
grep -c 'lang={locale}' 'src/app/[locale]/layout.tsx'
# Expected: 1
grep -c 'dir={dirOf(locale)}' 'src/app/[locale]/layout.tsx'
# Expected: 1

# 17. The baseline records both directions
grep -c 'LCP and CLS, before and after (Lesson 21.2)' ../docs/perf-baseline.md
# Expected: 1
grep -c 'audited and deliberately NOT changed' ../docs/perf-baseline.md
# Expected: 1 — four declined decisions, each with a reason
grep -c '/uk/incidents' ../docs/perf-baseline.md
# Expected: 1 — the locale where the subset mistake would show

# 18. NEGATIVE — deviceSizes is still absent from the config, because there is
#     no measurement to trim it with. Lesson 14.5 allowed the trim WITH numbers.
grep -cE '^[[:space:]]*deviceSizes:' next.config.ts
# Expected: 0 — anchored on the KEY. Lesson 14.5 left a comment naming both
#           options and saying it declined to set them, so a loose grep counts
#           the comment and proves nothing.
grep -cE '^[[:space:]]*imageSizes:' next.config.ts
# Expected: 0

# 19. NEGATIVE — no locale was left behind, and no route regressed to a 404
for l in en uk de; do
  printf '%s %s\n' "$l" "$(curl -s -o /dev/null -w '%{http_code}' \
    "http://localhost:3000/$l/incidents")"
done
# Expected: en 200, uk 200, de 200

# 20. Both suites green. Geometry changed; accessible names did not, and Lesson
#     12.3's locators are role plus accessible name.
npm test -- --run
# Expected: 0 failures
npx playwright test
# Expected: 0 failures
```

If check 3 passes but `/uk` still renders a different typeface, open DevTools → Network → Font on
`/uk/incidents` and count the requests. Two font files is correct — one per subset. One file, plus
Cyrillic text rendered in `system-ui`, means the `cyrillic` subset was declared and the browser
still chose the fallback, which points at a `unicode-range` mismatch in your Next version rather
than at your config.

## Control Questions

1. Lesson 14.5 put `priority` on the `/hobt` hero and refused to give `CoreImage` a `priority`
   prop. Your measurement now names a `core/image` block as the LCP element on
   `/en/blog/blog-01`. Describe the mechanism you would use, explain why putting `priority`
   inside `CoreImage` would make `/hobt` slower rather than faster, and say what you would
   measure to prove the change worked.
2. `display: 'swap'` guarantees two paints of the same text, and `adjustFontFallback` is what
   keeps the second paint from moving anything. Explain what those four CSS descriptors actually
   override, then describe the visible result of setting `adjustFontFallback: false` while
   keeping `fallback: ['system-ui', 'arial']`.
3. Lesson 20.4 chose `<Suspense fallback={null}>` for `UntranslatedNotice` and this lesson chose a
   fixed box for `SessionMenu`. Both are asynchronous regions in the page chrome. Derive the rule
   that makes those two opposite decisions both correct, then apply it to a region this app does
   not have yet: a cookie-consent banner.
4. `seatsLeft` and `core/embed` were both expected to be layout-shift sources and neither is.
   For each, name the specific earlier decision that removed the shift, and say what would have
   to change in the codebase for it to come back.
5. The Turnstile container is reserved at 300 × 65 px, a number that belongs to Cloudflare and
   not to you. Explain the failure mode if Cloudflare changes it in each direction, say which
   direction you would rather be wrong in and why, and describe a reservation strategy that would
   not depend on their number at all — including what it costs.

## Learn More

- [web.dev — optimise LCP](https://web.dev/articles/optimize-lcp) — the four-part breakdown in
  Key Concept 2, with the diagnostic order Google recommends for each part
- [web.dev — optimise CLS](https://web.dev/articles/optimize-cls) — the reserved-space patterns,
  including the "images without dimensions" and "dynamically injected content" cases
- [web.dev — font best practices](https://web.dev/articles/font-best-practices) — `font-display`
  values compared, and why `swap` is the default recommendation rather than `optional`
- [Next.js — `next/font`](https://nextjs.org/docs/app/api-reference/components/font) — every
  option used in Task §2, including `adjustFontFallback`, `variable` and the local-font form
- [Next.js — optimising fonts](https://nextjs.org/docs/app/getting-started/fonts) — the
  build-time download and self-hosting behaviour Key Concept 5 describes, in the framework's words
- [MDN — `@font-face` `size-adjust`](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/size-adjust)
  — the descriptor `adjustFontFallback` generates for you, worth reading once so you know what it
  is doing on your behalf
- [Google Fonts — subsets and `unicode-range`](https://fonts.google.com/knowledge/glossary/unicode_range)
  — the ranges in Key Concept 7's table, which is how you confirm `cyrillic` covers `і ї є ґ`
- [Cloudflare Turnstile — client-side rendering](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/)
  — the widget sizes, so Task §5's 300 × 65 is checked rather than trusted
- [web.dev — `fetchpriority`](https://web.dev/articles/fetch-priority) — the three mechanisms in
  Key Concept 3, separated, with the "do not prioritise everything" measurement
