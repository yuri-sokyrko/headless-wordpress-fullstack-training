---
title: 'Mapping Custom Blocks & the HOBT Funnel'
module: 14
lesson: 4
teaches: [custom-block-mapping, typed-attributes, client-island-in-rsc, editor-composed-pages, catch-all-route, resolving-block-references]
produces: ['next-app/src/components/blocks/IncidentCallout.tsx', 'next-app/src/components/blocks/BlameQuote.tsx', 'next-app/src/components/blocks/ScapegoatPicker.tsx', 'next-app/src/components/blocks/IncidentTicker.tsx', 'next-app/src/components/blocks/HobtCta.tsx', 'next-app/src/app/[locale]/[...slug]/page.tsx', 'next-app/src/app/[locale]/hobt/page.tsx', 'next-app/src/graphql/pages.graphql']
requires: [14.3, 13.4, 11.5]
---

# Lesson 14.4 — Mapping Custom Blocks & the HOBT Funnel

## Quick Overview

Five components, one per `btt/*` block from Module 13, and each one demonstrates a different
half of the pattern. `IncidentCallout` is the simple case: read typed attributes, render with
the `ui/` primitives, done. `BlameQuote` renders the children `BlockRenderer` handed it and
nothing else. `ScapegoatPicker` **resolves a reference** — the block stored only a term ID, so
the component looks the term up, which is why storing the ID rather than a copy in Lesson 13.3
was the right call. `IncidentTicker` re-runs the ticker's query in TypeScript rather than
touching the PHP output. And `HobtCta` is a **client island inside a Server Component tree**:
attributes become typed props, the props cross the boundary, and a Module 16 Server Action will
eventually be wired to the click.

Then the payoff. `/en/hobt` stops hard-coding its **body** and renders
`<BlockRenderer blocks={page.editorBlocks} />` between the hero and the module grid — the hero,
the two repeater sections and both CTA bands stay page-mounted, for reasons Key Concept 8
argues — and a `[...slug]` catch-all goes the whole way for every other WordPress page, which
is editor-composed end to end. Marketing reorders the HOBT body in Gutenberg, saves, and the
live site changes — no deploy, no code, no ticket. That is what the last two modules were for,
and it is worth taking the ninety seconds to actually do it and watch.

By the end of this lesson you will have:

- Five block components in `next-app/src/components/blocks/`, all registered and all exhaustively covered by the Lesson 14.2 check
- `ScapegoatPicker` resolving a stored term ID to live term data, verified by renaming the term without re-saving the post
- `IncidentTicker` running its own cache-tagged GraphQL query, with `renderedHtml` untouched
- `HobtCta` as a `'use client'` island receiving typed attributes as props, with its CTA still inert until Module 16
- `next-app/src/app/[locale]/hobt/page.tsx` rendering `editorBlocks` for its body, and `next-app/src/app/[locale]/[...slug]/page.tsx` rendering any WordPress page entirely from blocks

## Classic WP Analogy

You have delivered this feature before, and the Classic route to it was a page template plus
ACF flexible content:

| Classic WordPress | Here |
|---|---|
| `templates/hobt.php` with a fixed section order | `page.tsx` rendering `editorBlocks` in the editor's order |
| ACF flexible content layouts | Gutenberg blocks |
| `if (get_row_layout() === 'hero')` in a `while (have_rows())` loop | `switch (block.__typename)` in the registry |
| `get_template_part('parts/hero')` per layout | one component per block type |
| `page-{slug}.php` for one-off pages | the `[...slug]` catch-all plus a block set |
| `get_term($id)` to resolve a stored term reference | the same lookup, in `ScapegoatPicker` |

ACF flexible content is a genuinely good answer to this problem, and if you built the Classic
version of this page you built something close to what you are building now. The block version
wins on editor experience — the editor sees the page rather than a stack of collapsed field
groups — and on the fact that blocks are core, so the content survives a plugin decision.

The analogy breaks on **who guarantees the shape of the page**, and this is the shift that
changes how you write every component in this lesson. A page template knows there is exactly one
hero, that it is first, and that a CTA follows the module grid. An editor-composed page
guarantees none of it. A block component may be rendered first or last, twice, zero times, or
nested inside a `core/columns` an editor added on a whim. So every component here has to be
**self-contained**: no assumption about position, no `margin-top` that only works second, no
"this is the hero so it owns the page background", and no shared state between siblings. A
component that only looks right at the top of the page is a bug that will be reported as "the
CMS broke the design".

The second break is one the Lesson 13.5 deprecation work predicted: **attributes are whatever
was stored, not whatever your `block.json` currently declares.** A post published before an
attribute existed has no value for it, because block deprecations are lazy and never touch the
database. So each component reads its attributes defensively and renders a sensible default
rather than crashing — and the generated types help here, because Content Blocks types
attributes as nullable for exactly this reason.

The third is a happier one. `HobtCta` needs an `onClick`, which in a Classic build would mean an
enqueued script, a `wp_localize_script()` payload and a jQuery handler bound to a class name. Here
it is one `'use client'` directive on one leaf component: the block's attributes are already
typed props, they cross the boundary as serialisable values, and the surrounding page — layout,
hero, module grid, testimonials — stays entirely on the server. That is the shape Lesson 09.2
was preparing you for, arriving four modules later in its real form.

---

## Key Concepts

### 1. Five components, five different jobs

The five blocks were chosen in Module 13 so that each one forces a different pattern. Read this
table before you write any of them; it is the shape of the whole lesson.

| Component | Block | Job | Reads | Fetches | Client |
|---|---|---|---|---|---|
| `IncidentCallout` | `btt/incident-callout` | read attributes and render | `severity`, `incidentSlug`, `headline`, `body`, `tone` | no | no |
| `BlameQuote` | `btt/blame-quote` | render the children it was handed | `attribution` | no | no |
| `ScapegoatPicker` | `btt/scapegoat-picker` | **resolve a reference** | `termId` | **yes** — one term | no |
| `IncidentTicker` | `btt/incident-ticker` | **re-run a query** the PHP renderer also runs | `count`, `severities` | **yes** — a list | no |
| `HobtCta` | `btt/hobt-cta` | **cross the client boundary** — one `Button` from four attributes | `label`, `href`, `variant`, `leadSource` | no | **yes** |

The two that fetch are the interesting ones: a block component can be an `async` Server
Component with its own cache policy, which a Classic `render_callback` cannot — it shares the
page's single request and its single cache entry. And the two that do **not** fetch are the
majority case: most blocks are a function from typed attributes to JSX, and the engineering
lives in the exceptions.

### 2. Attributes are whatever was stored — the lazy-deprecation consequence

Lesson 13.5 changed `btt/incident-callout` to v2: the root element became `<aside>` and a new
attribute `tone: 'warning' | 'neutral'` appeared, with `deprecated[0]` holding v1's `save` and
a `migrate` that derives `tone` from `severity`.

Here is the part that catches people. **Deprecations are lazy and never touch the database.**

```
   the two seeded posts (blog-01, blog-02) and the HOBT page
   ─────────────────────────────────────────────────────────────────────
   post_content holds V1 markup:
     <!-- wp:btt/incident-callout {"incidentSlug":"…","severity":"s1-…"} -->
                                   ↑ no "tone" key. There never was one.
   an editor OPENS the post   →  Gutenberg runs deprecated[0].migrate()
                                 in MEMORY, shows v2, and the DB is unchanged
   an editor SAVES the post   →  now the DB has tone, and only now
   nobody opens the post      →  the DB keeps v1 FOREVER
```

So `editorBlocks` on an un-re-saved post returns the **old attribute set**. `tone` comes back
`null` — not `'neutral'`, because the default in `block.json` is only applied to blocks the
editor actually parsed with the current registration, and there is no `tone` key in the comment
for the resolver to read.

`IncidentCallout` therefore derives `tone` when it is absent, using the same rule as 13.5's
`migrate`:

```ts
// (illustration — the real thing is in Task §2)
const tone = attributes?.tone ?? (isSevere(attributes?.severity) ? 'warning' : 'neutral');
```

**The cost, stated plainly: that rule now lives in two places** — `migrate` in JavaScript inside
the plugin, and this component in TypeScript inside Next. They can drift, and nothing in either
toolchain will tell you. The mitigation is a test that asserts both produce the same tone for
all four severities, and it belongs in Lesson 23.5's contract tests. Write the duplication down
rather than pretending it is not there.

This generalises: **every attribute in this lesson is read defensively, with a default supplied
in the component.** Content Blocks types attributes as nullable for exactly this reason, and
`??` on every read is not defensive programming for its own sake — it is the type system
correctly describing a database that contains a decade of content models.

> **One key can appear from outside `block.json` entirely.** WordPress 6.5's block-rename feature
> writes `{"metadata":{"name":"Editor's label"}}` into the comment, so a renamed `core/paragraph`
> carries an attribute nothing declared. Nothing breaks — it is not in the generated type and you
> are not selecting it — but it is the cleanest example of "whatever was stored". The `btt/*`
> blocks cannot acquire it: Lesson 13.5 sets `supports.renaming: false` on all six.

### 3. `ScapegoatPicker` resolves a reference, and the tag it cannot build

Lesson 13.3 stored a **term ID** rather than a copy of the term's name and tagline. That was the
right call — rename the scapegoat and every block referencing it updates, with nobody re-saving
a post — and this component is where the bill for it arrives: the block has an ID and needs a
name.

```graphql
# (illustration — Task §3 writes the real document)
query ScapegoatById($id: ID!) {
  scapegoat(id: $id, idType: DATABASE_ID) { name slug count scapegoatProfile { tagline } }
}
```

The interesting problem is the **cache tag**, and it is worth thinking through rather than
copying. Lesson 10.3's `termTag(taxonomy, slug)` builds `scapegoat:the-intern` — and the
component does not have the slug until the response arrives, which is after the tag had to be
attached. Three options:

| Option | Cost | Verdict |
|---|---|---|
| Two fetches: ID → slug, then the tagged read | Two WordPress round trips per picker block, per page | ❌ |
| No tag at all, just a `revalidate` window | The tag can never be added retroactively (Lesson 10.3), and Module 18 gets no handle at all | ❌ |
| **`termTag('scapegoat', String(termId))`** — an **ID-keyed** tag, plus a `revalidate` window | Module 18's PHP webhook currently builds slug-keyed tags, so this tag is never invalidated **until** the webhook also sends the ID-keyed form | ✅ |

Take the third. A tag costs nothing to attach and cannot be added later, so attach it now, note
in `docs/api-contract.md` that Module 18's webhook owes one extra `revalidateTag` per term
change, and set the window so the page is correct without it. The string is still built by
`tags.ts` — `termTag('scapegoat', String(termId))` yields `scapegoat:4`.

The window is **60 seconds**, matching `/hobt`'s route segment. A fetch cached for an hour under
a page cached for a minute re-renders from stale data and looks exactly like the page cache
failing.

> **Where this is visible, and where it is not.** Task §8 renames a term and watches `/en/hobt`
> update. Do the same on `/en/blog/blog-01` and nothing happens for an hour: the fetch cache
> expired, but the **route segment** cache is `3600` there. Two caches, two lifetimes — Lesson
> 10.3 Key Concept 1.

### 4. `IncidentTicker` re-runs the query, in TypeScript

`btt/incident-ticker` is the one block with a `render.php`. WordPress runs PHP for it at render
time and produces HTML. This course does not use that HTML — Lesson 14.1's decision record — so
the ticker's query is re-implemented on the Next side.

```
   WordPress                                Next
   ────────────────────────────────         ─────────────────────────────────────
   render.php                               IncidentTicker.tsx
     WP_Query( severity IN …, N )             fetchGraphQL(IncidentTickerDocument,
     echoes <ul>                                { first, severities },
                                                { revalidate: 300,
   used by: the editor preview and             tags: [listTag('incident')] })
   any Classic front end                    used by: the React front end
```

Nine lines of TypeScript, and a **divergence risk Lesson 13.4 already named**: two
implementations of one query, in two languages. Change `render.php` to exclude `s4-cosmetic`
without changing this component and the editor preview and the live site disagree — with the
editor convinced the site is broken while every test passes.

The mitigations, in order of what they buy:

| Mitigation | Buys you |
|---|---|
| A contract test asserting both return the same slugs for the same attributes | ✅ the real answer. Lesson 23.5 |
| A comment in both files pointing at the other | cheap, and it works on whoever reads before editing |
| Deleting `render.php` | tempting, and it breaks the editor preview, which is the one thing `render.php` is genuinely for |

Take the first two. Not the third: a dynamic block with no server render is invisible in
Gutenberg, and an editor who cannot see what they inserted will insert it twice.

Also note the defaults. `count` and `severities` have `block.json` defaults of `5` and
`['s1-catastrophic', 's2-major']`, and a block serialised at its defaults **omits them** — so the
component re-declares both. Same duplication as Key Concept 2's `tone`, same treatment: written
down, tested in Module 23.

### 5. Self-containedness — the "the CMS broke the design" bug

A page template knows there is one hero, that it is first, and that the CTA follows the grid.
An editor-composed page guarantees none of it, so every component here obeys four rules — each
of which exists because breaking it produces a specific, real bug report.

| Rule | Concrete failure if you break it |
|---|---|
| No assumption about **position** | A component with `mt-0 first:mt-0`-style logic collides with the hero when an editor puts it first, and leaves a gap when they put it third |
| No **one-sided** vertical margin | `margin-top: 4rem` on every block gives you 8 rem between two of them and 4 rem at the top of the body. Use symmetric `my-*`, or own the gap in the renderer |
| No **shared state** between siblings | Two `IncidentTicker` blocks on one page must not fight over a "which is expanded" flag. There is no such flag, and there must not be |
| No assumption about **count** | An editor can insert the same block twice, or zero times. Anything a component derives an `id` from must therefore come from `clientId`, because two instances sharing one `id` is an accessibility bug and an invalid document |

The general form: **a component that only looks right in one position is a bug reported as "the
CMS broke the design"** — by the person who moved the block, who is not wrong. The
counter-example is deliberate: `HobtHero` **does** assume it is first, which is exactly why it
stays page-mounted rather than becoming a block. Key Concept 8.

### 6. The client island: `'use client'` on the leaf

`HobtCta` is the only file in `src/components/blocks/` with a `'use client'` directive, and
Verification asserts that the count is exactly one.

```
   [locale]/hobt/page.tsx                   server
   ├── HobtHero                             server
   │   └── HobtCtaBand                      server  (page-mounted, Lesson 11.5)
   ├── BlockRenderer                        server  ← no directive, Lesson 14.2
   │   ├── CoreHeading                      server
   │   ├── IncidentCallout                  server
   │   ├── ScapegoatPicker      async       server, its own fetch
   │   ├── IncidentTicker       async       server, its own fetch
   │   └── HobtCta         'use client'  ───┼──▶ CLIENT. The boundary stops here.
   │       └── Button                       │    ui/button.tsx has no directive
   ├── HobtModules                          │    and is compiled into the CLIENT
   ├── HobtTestimonials                     │    graph anyway, because its
   └── section > HobtCtaBand                server  importer is a client component
```

Two facts about that boundary are easy to get wrong.

**What crosses is data, not code.** `block` and `locale` are serialised into the RSC payload,
which works because every attribute is a `string`, `number`, `boolean` or `null`. It would
**not** work for a function, a `Date`, a `Map`, a class instance or a server-constructed React
element. Block attributes are JSON by construction, which makes them unusually good island
props.

**`Button` becomes client code too.** `src/components/ui/button.tsx` has no directive, but it is
imported by a client component, so it is compiled into the client graph. `'use client'` marks a
boundary, not a file: everything imported *below* it goes client-side. Which is exactly why
Lesson 14.2's rule about `BlockRenderer` matters — if `HobtCta` could import the renderer, the
whole registry would follow it into the browser. It is also why `HobtCta` renders one `Button`
and not `HobtCtaBand`: the smallest possible thing below the boundary is the cheapest boundary
you can have.

The Classic comparison, because this is where headless earns its keep:

| Classic WordPress | Here |
|---|---|
| `wp_enqueue_script('btt-cta', …, ['jquery'])` | the import graph decides what ships |
| `wp_localize_script('btt-cta', 'bttCta', ['label' => …])` | typed props, checked at compile time |
| `jQuery('.wp-block-btt-hobt-cta').on('click', …)` | an `onClick` on the element itself |
| A class name as the contract between PHP and JS | no contract needed; there is one component |
| Two instances on a page share one global config object | two instances, two props objects, no globals |

The third row bites hardest in Classic: binding on a class name means the PHP that renders the
class and the JS that queries it must agree forever, with nothing checking. Same category of bug
as `name` versus `__typename` in Lesson 14.2, gone for the same reason.

**The honest cost:** `HobtCta` ships client JavaScript today and has no interactivity to show for
it — roughly a kilobyte for nothing. The alternative is adding the directive in Lesson 16.3 and
discovering *then* that something below it does not survive the boundary. Paying it now, with the
number in Module 21's baseline, is the trade this course makes.

### 7. `[...slug]`, route specificity, and a scoped `generateStaticParams`

One catch-all route renders every WordPress page: `src/app/[locale]/[...slug]/page.tsx`.

**Specific routes win, and you should prove it rather than trust it.** Next resolves a URL
against static segments first, then dynamic ones, then catch-alls. So:

| URL | Matched by | Not matched by |
|---|---|---|
| `/en/hobt` | `[locale]/hobt/page.tsx` | `[locale]/[...slug]` |
| `/en/blog/blog-01` | `[locale]/blog/[slug]/page.tsx` | `[locale]/[...slug]` |
| `/en/about` | `[locale]/[...slug]` | — |
| `/en/incidents/no-such-thing` | `[locale]/incidents/[slug]` → `notFound()` | `[locale]/[...slug]` |

That last row matters more than it looks. Without it a typo'd incident slug falls through to
the catch-all, asks WordPress for a *page* at `/incidents/no-such-thing/`, and 404s anyway —
through the wrong route, with the wrong copy, while Lesson 12.3's smoke spec asserts the heading
"No such incident." Specificity keeps that assertion true, and Verification checks it.

For the seeded `hobt` page this means the dedicated route wins, always, and the WordPress page is
reachable only through it — intended here (Key Concept 8), and a genuine footgun in general: an
editor who creates a page called "Blog" gets a URL that renders your blog archive instead, with
no warning anywhere. The `RESERVED` set in the route file is the mitigation, so at least
`generateStaticParams` does not claim to pre-render pages it cannot reach.

**`generateStaticParams` is scoped, not exhaustive.** It asks for the first 50 pages. Anything
outside the set still renders — `dynamicParams` defaults to `true`, so an unlisted URI is
rendered on demand and then cached. The function is a *pre-warming hint*, not a whitelist.

Exhaustive (every page, every locale) buys nothing here and costs build time; empty
(`return []`) makes the first visitor to every page pay. **Scoped** is the middle, and Lesson
18.1 makes the decision properly with numbers across every route. Today it is 50, because that
is more than the three seeded pages and small enough that the build stays fast.

### 8. Two editing surfaces on one page

**This lesson replaces the hard-coded body of `/hobt`, not the page.** Everything Lesson 11.5
wrote stays where it was; one `<BlockRenderer>` is inserted after the hero.

```
   <HobtHero … priceUsd seatsLeft>           page-mounted, unchanged from 11.5
     <HobtCtaBand idPrefix="hero" … />       page-mounted, unchanged
   </HobtHero>
   <BlockRenderer blocks={editorBlocks} />   ← THE ONLY NEW LINE. The editor's.
   <HobtModules modules={promo.modules} />   page-mounted, unchanged
   <HobtTestimonials testimonials={…} />     page-mounted, unchanged
   <section aria-labelledby="hobt-closing-heading">
     <HobtCtaBand idPrefix="closing" … />    page-mounted, unchanged
   </section>
```

Four things stayed page-mounted, and each has its own reason:

| Stayed page-mounted | Why |
|---|---|
| `HobtHero` | `priceUsd` and `seatsLeft` are **commerce data**. They must be queryable — Module 19's structured data reads the price — and an editor must not be able to reorder the price below the testimonials. It is also the LCP element that gets `priority` in Lesson 14.5 |
| Both `HobtCtaBand` instances | **Commercial furniture.** `startNowUrl` and `demoBookingUrl` are field-group data with no block representation, and *where the offer appears* on a paid landing page is a product decision rather than an editorial one. Lesson 12.3 asserts two of each control on this route for exactly that reason |
| `HobtModules` | an ACF repeater with **no block representation**. There is no `btt/modules` block, and inventing one to move a field group into the body would be work with no buyer |
| `HobtTestimonials` | the same, plus the avatars Lesson 14.5 adds |

So an editor-composed page and a field-group-composed page are **not** mutually exclusive, and a
commercial landing page is the realistic case where both belong: commerce facts in a field group
so they are queryable and cannot be reordered into the wrong place, narrative in blocks between
them so marketing can rewrite it without a ticket.

**The cost, stated plainly: two editing surfaces on one page is a real tax on editors.** To
change the price they use the sidebar field group, to change the narrative they use the block
canvas, and nothing in wp-admin explains which is which. They will edit the wrong one and be
right to be annoyed. Mitigations, none free: a `theme.json` palette limiting what is insertable
on that template, a note in the field group's instructions, or a custom sidebar panel — this
course does the second, in one sentence. **You would not choose this hybrid for a purely
editorial page**; you choose it when some of the content is a commercial commitment.

**`src/app/[locale]/[...slug]/page.tsx` is the pure case.** A title and `BlockRenderer`, no field
group — so on `/en/about` an editor can reorder, add and delete *anything* and the whole page
obeys. That is where "reorder it in Gutenberg and reload" has its full effect, and Task §8 does
it on both routes so you feel the difference. Read the two files side by side once you have
written both; the contrast is the teaching point.

### 9. Nothing is invalidated yet, and the module README is honest about it

The payoff exercise in Task §8 says "reorder the body in Gutenberg and reload". Be precise
about what actually happens, because the difference is two modules of work.

```
   TODAY (Modules 14–17)                     AFTER MODULE 18
   ─────────────────────────────────         ─────────────────────────────────
   editor saves in Gutenberg                 editor saves in Gutenberg
        │                                         │
        │  nothing tells Next                     │  save_post fires a signed
        │                                         │  POST to /api/revalidate
        ▼                                         ▼
   the page is stale until its                revalidateTag('page:hobt')
   revalidate window elapses:                      │
   60 s on /hobt, 3600 s elsewhere                 ▼
        │                                     next request re-renders
        ▼
   next request AFTER the window
   re-renders and the change appears
```

So the ninety-second exercise is genuinely ninety seconds on `/hobt`, and it is an hour on
`/en/blog/blog-01`. Say that out loud when you demonstrate this to someone, because "no deploy
needed" and "instant" are different claims and only the first one is true today.

Two lessons close the gap. **Module 16** calls `revalidateTag(pageTag('hobt'))` after a
successful lead submission, so an action *your app* performs invalidates immediately. **Module
18** is the WordPress webhook, so an action *WordPress* performs does too — the harder half,
because the PHP tag and the `tags.ts` tag have to be the same string, which is why 10.3 made
`tags.ts` the only place one is constructed.

---

## Task

Five components, five registry rows, three documents and four route files, in dependency order
— so `npm run type-check` is red only between §1 and §5, for exactly the reason Lesson 14.2
designed it to be.

### Step 1: Extend the fragment, then regenerate

An anchored addition to the file from Lesson 14.1, after the `CoreCode` inline fragment.

```graphql
# next-app/src/graphql/fragments/editorBlocks.graphql — added after `... on CoreCode`
    # `tone` arrives from Lesson 13.5's v2 attributes. If codegen says it is not a
    # field on BttIncidentCalloutAttributes, you have not done 13.5's deprecation
    # yet — go and do it, because Key Concept 2 is about that exact attribute.
    ... on BttIncidentCallout {
      attributes {
        severity
        incidentSlug
        headline
        body
        tone
      }
    }
    ... on BttBlameQuote {
      attributes {
        attribution
      }
    }
    ... on BttScapegoatPicker {
      attributes {
        termId
      }
    }
    ... on BttIncidentTicker {
      attributes {
        count
        severities
      }
    }
    ... on BttHobtCta {
      attributes {
        label
        href
        variant
        leadSource
      }
    }
```

```bash
cd next-app
npm run codegen
npm run type-check
# Expected: TS1360, naming BttIncidentCallout as missing from BlockRegistry.
#           Layer 1 of Lesson 14.2's check, from the fragment side. Steps 2-5 fix it
#           by writing components, not by editing the check.
```

> **Skipped Lesson 13.5's stretch block?** Then `BttTechVerdictCard` is not in your schema and
> there is nothing to add: the markup is still in `post_content` and renders through
> `UnknownBlock` — a red box on `blog-01`, `blog-02` and `/hobt` in development, nothing in
> production. **If you did build it**, add a sixth inline fragment selecting
> `attributes { reviewSlug verdict }` plus a `TechVerdictCard.tsx` that renders the verdict in a
> `<Card>` with a `next/link` to `/{locale}/reviews/{reviewSlug}` — same shape as
> `IncidentCallout`, and the compiler names it the moment you forget the registry row.

**Verify §1:**

- [ ] The fragment now has **eleven** `... on` lines and **eleven** `attributes {` lines
      (twelve of each if you added the verdict card). The two counts are always equal.
- [ ] `npm run codegen` succeeded. A failure naming `tone` means Lesson 13.5's v2 attribute does
      not exist in your `block.json`.
- [ ] `grep -c renderedHtml src/graphql/fragments/editorBlocks.graphql` is still `0`.

### Step 2: `IncidentCallout` and `BlameQuote` — attributes, and children

```tsx
// next-app/src/components/blocks/IncidentCallout.tsx
// The simple case: typed attributes in, JSX out, no fetch.
import Link from 'next/link';

import { RichText } from '@/components/blocks/RichText';
import type { BlockComponentProps } from '@/components/blocks/registry';
import { Badge } from '@/components/ui/badge';
import type { SeverityLevel } from '@/types/content';
import { SEVERITY_LABEL, SEVERITY_ORDER } from '@/types/content';

/**
 * `severity` is typed String on the wire — block.json has no enum concept, so the
 * SelectControl from Lesson 13.3 constrains the editor's UI and not the data.
 * `find` rather than a cast: this is a real runtime guard, and `s3-minor` is the
 * block.json default so an unrecognised value degrades to the same thing an
 * unset one does.
 */
function toSeverity(value: string | null | undefined): SeverityLevel {
  return SEVERITY_ORDER.find((slug) => slug === value) ?? 's3-minor';
}

/**
 * The SAME rule as Lesson 13.5's deprecated[0].migrate(). Duplicated in two
 * languages on purpose, because the two seeded posts hold v1 markup and nobody
 * re-saved them, so `tone` arrives null and has to be derived. Lesson 23.5 owns
 * the contract test that keeps the two copies honest. Key Concept 2.
 */
function toTone(tone: string | null | undefined, severity: SeverityLevel): 'warning' | 'neutral' {
  if (tone === 'warning' || tone === 'neutral') return tone;
  return severity === 's1-catastrophic' || severity === 's2-major' ? 'warning' : 'neutral';
}

export function IncidentCallout({ block, locale }: BlockComponentProps<'BttIncidentCallout'>) {
  const attributes = block.attributes;
  const severity = toSeverity(attributes?.severity);
  const tone = toTone(attributes?.tone, severity);
  const slug = attributes?.incidentSlug ?? '';

  // A <div>, even though Lesson 13.5's v2 save() emits <aside>. Those are allowed
  // to differ: save() output is what WordPress compares against post_content,
  // while this renders from attributes. The reason to differ is that <aside>
  // inside <main> is a `complementary` LANDMARK, an unnamed landmark is an axe
  // finding in Module 22, and two callouts on one page would need two distinct
  // names that no attribute supplies. A real <h3> says the same thing with no
  // ARIA. If you want the landmark, aria-labelledby on the headline's id is the
  // way — and it costs a row in docs/accessibility.md.
  return (
    <div
      data-block={block.__typename}
      // Symmetric margins, no `first:`/`last:` variants. Key Concept 5.
      className={`my-6 rounded-lg border-l-4 p-4 ${
        tone === 'warning' ? 'border-l-destructive bg-destructive/5' : 'border-l-border bg-muted/40'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={severity}>{SEVERITY_LABEL[severity]}</Badge>
        {slug !== '' ? (
          // A locale-prefixed next/link, which is cost 1 and cost 4 of rendering
          // renderedHtml, both avoided. This is what `locale` is a prop for.
          <Link
            href={`/${locale}/incidents/${slug}`}
            className="text-sm underline underline-offset-2"
          >
            {slug}
          </Link>
        ) : null}
      </div>

      {/* `headline` and `body` are source: 'html' attributes in Lesson 13.2, so
          they are rich text and go through the one sanitizer. h3 because the
          route owns h1 and CoreHeading clamps to h2 — Lesson 14.3 Key Concept 7. */}
      <RichText as="h3" html={attributes?.headline} className="mt-3 text-lg font-semibold" />
      <RichText as="p" html={attributes?.body} className="mt-1 text-sm [&_a]:underline" />
    </div>
  );
}
```

```tsx
// next-app/src/components/blocks/BlameQuote.tsx
// Renders the children BlockRenderer handed it, and nothing else. The block has
// InnerBlocks in the editor (Lesson 13.3) and this component never thinks about
// nesting — Lesson 14.2 Key Concept 9.
import { RichText } from '@/components/blocks/RichText';
import type { BlockComponentProps } from '@/components/blocks/registry';

export function BlameQuote({ block, children }: BlockComponentProps<'BttBlameQuote'>) {
  const attribution = block.attributes?.attribution;

  // save() emits <blockquote> with NO <cite> — the front end renders the
  // attribution, per the block contract. figure/figcaption/cite matches CoreQuote
  // and HobtTestimonials, and avoids a <footer> inside a <blockquote>.
  return (
    <figure data-block={block.__typename} className="my-6">
      <blockquote className="border-l-4 border-border pl-4 text-lg italic">{children}</blockquote>
      {attribution !== null && attribution !== undefined && attribution.trim() !== '' ? (
        <figcaption className="mt-2 pl-4 text-sm text-muted-foreground">
          — <RichText as="cite" html={attribution} className="not-italic" />
        </figcaption>
      ) : null}
    </figure>
  );
}
```

### Step 3: `ScapegoatPicker` and `IncidentTicker` — the two that fetch

Both need a document first — anchored additions to existing files.

```graphql
# next-app/src/graphql/scapegoats.graphql — appended
# For btt/scapegoat-picker (Lesson 14.4). The block stored a term ID, not a copy —
# Lesson 13.3 — so the component resolves it here. DATABASE_ID, because that is
# what the block has.
query ScapegoatById($id: ID!) {
  scapegoat(id: $id, idType: DATABASE_ID) {
    id
    name
    slug
    count
    scapegoatProfile {
      tagline
      defensiveness
    }
  }
}
```

```graphql
# next-app/src/graphql/incidents.graphql — appended
# For btt/incident-ticker (Lesson 14.4). This query is the TypeScript half of a
# pair: render.php in blame-the-tech-blocks runs the WP_Query equivalent for the
# editor preview. Change one, change the other — Lesson 23.5 has the contract test.
# `...IncidentCardFields` and not a new field set: the ticker renders title,
# severity, downtime and environment, which is exactly that fragment.
query IncidentTicker($first: Int!, $severities: [String!]!) {
  incidents(
    first: $first
    where: {
      status: PUBLISH
      orderby: { field: DATE, order: DESC }
      taxQuery: { taxArray: [{ taxonomy: SEVERITY, field: SLUG, terms: $severities }] }
    }
  ) {
    nodes {
      ...IncidentCardFields
    }
  }
}
```

```tsx
// next-app/src/components/blocks/ScapegoatPicker.tsx
// An async Server Component. A block component with its own fetch and its own
// cache policy is a capability a Classic render_callback does not have — it
// shares the page's request and the page's cache entry.
import Link from 'next/link';

import type { BlockComponentProps } from '@/components/blocks/registry';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScapegoatByIdDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { termTag } from '@/lib/graphql/tags';

export async function ScapegoatPicker({ block, locale }: BlockComponentProps<'BttScapegoatPicker'>) {
  const termId = block.attributes?.termId;

  // An editor who inserted the block and never opened the inspector. Render
  // nothing rather than fetching term 0 — Key Concept 2.
  if (typeof termId !== 'number') return null;

  const data = await fetchGraphQL(
    ScapegoatByIdDocument,
    { id: String(termId) },
    {
      // 60 s, matching /hobt's segment window. A fetch cached LONGER than the
      // page it sits inside re-renders from stale data and looks like the page
      // cache failing. Key Concept 3.
      revalidate: 60,
      // An ID-keyed tag, because the slug is not known until the response
      // arrives and a tag cannot be attached retroactively. Module 18's webhook
      // owes one extra revalidateTag per term change — recorded in
      // docs/api-contract.md in Step 8. Built by tags.ts, never hand-typed.
      tags: [termTag('scapegoat', String(termId))],
    }
  );

  const term = data.scapegoat;
  if (term == null) return null;

  return (
    <Card data-block={block.__typename} className="my-6">
      <CardHeader>
        <CardTitle className="text-lg">
          <Link href={`/${locale}/scapegoats`} className="underline underline-offset-2">
            {term.name}
          </Link>
        </CardTitle>
        {/* `count` is maintained by WordPress in wp_term_taxonomy, which is why
            `scapegoat` is a taxonomy and not a CPT — Lesson 05.4 proved it with
            EXPLAIN. It is also why the revalidate window is short. */}
        <Badge variant="outline">{term.count ?? 0} incidents blamed on this</Badge>
      </CardHeader>
      {term.scapegoatProfile?.tagline !== null && term.scapegoatProfile?.tagline !== undefined ? (
        <CardContent className="text-sm text-muted-foreground">
          {term.scapegoatProfile.tagline}
        </CardContent>
      ) : null}
    </Card>
  );
}
```

```tsx
// next-app/src/components/blocks/IncidentTicker.tsx
// The TypeScript half of the pair described in Key Concept 4. render.php in
// blame-the-tech-blocks/src/incident-ticker/ is the other half; it exists for the
// editor preview and its output is NEVER rendered here.
import Link from 'next/link';

import type { BlockComponentProps } from '@/components/blocks/registry';
import { Badge } from '@/components/ui/badge';
import { IncidentTickerDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { listTag } from '@/lib/graphql/tags';
import type { SeverityLevel } from '@/types/content';
import { SEVERITY_LABEL, SEVERITY_ORDER } from '@/types/content';

// The block.json defaults, re-declared. A block serialised at its defaults omits
// them from the comment entirely, so the component has to know them — the same
// duplication as `tone` in Key Concept 2, tested in Lesson 23.5.
const DEFAULT_COUNT = 5;
const DEFAULT_SEVERITIES: readonly SeverityLevel[] = ['s1-catastrophic', 's2-major'];

export async function IncidentTicker({ block, locale }: BlockComponentProps<'BttIncidentTicker'>) {
  const attributes = block.attributes;

  // Clamp, do not trust. `count` is a Float on the wire and an editor with the
  // number control can type 500.
  const rawCount = attributes?.count;
  const first =
    typeof rawCount === 'number' && rawCount >= 1 ? Math.min(Math.trunc(rawCount), 20) : DEFAULT_COUNT;

  // Drop nulls and anything that is not a real severity slug, then fall back.
  // An empty array here would produce a taxQuery matching nothing, which reads
  // as "the ticker is broken" rather than "the editor cleared the filter".
  const chosen = (attributes?.severities ?? [])
    .map((value) => SEVERITY_ORDER.find((slug) => slug === value))
    .filter((slug): slug is SeverityLevel => slug !== undefined);
  const severities = chosen.length > 0 ? chosen : DEFAULT_SEVERITIES;

  const data = await fetchGraphQL(
    IncidentTickerDocument,
    { first, severities: [...severities] },
    // The same policy as /[locale]/incidents in Lesson 10.3's table, for the same
    // reason: publishing an incident changes this list.
    { revalidate: 300, tags: [listTag('incident')] }
  );

  const rows = (data.incidents?.nodes ?? []).filter(
    (node): node is NonNullable<typeof node> => node !== null
  );
  if (rows.length === 0) return null;

  return (
    <section data-block={block.__typename} className="my-6 rounded-lg border border-border p-4">
      {/* h2 is wrong here — the body's headings are h2 and this is subordinate to
          whatever precedes it. h3, like IncidentCallout. */}
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Latest incidents
      </h3>
      <ul className="mt-3 divide-y divide-border">
        {rows.map((incident) => {
          const slug = incident.severities?.nodes[0]?.slug;
          const severity = SEVERITY_ORDER.find((value) => value === slug) ?? 's3-minor';

          return (
            <li key={incident.id} className="flex flex-wrap items-baseline gap-2 py-2 text-sm">
              <Badge variant={severity}>{SEVERITY_LABEL[severity]}</Badge>
              <Link
                href={`/${locale}/incidents/${incident.slug ?? ''}`}
                className="font-medium underline underline-offset-2"
              >
                {incident.title}
              </Link>
              <span className="text-muted-foreground">
                {incident.incidentDetails?.downtimeMinutes ?? 0} min
                {incident.incidentDetails?.environment !== null &&
                incident.incidentDetails?.environment !== undefined
                  ? ` · ${incident.incidentDetails.environment}`
                  : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

### Step 4: `HobtCta` — the client island

One block, one `Button`. The four attributes are the whole component: `label` is the accessible
name, `href` the target, `variant` the emphasis, `leadSource` a carrier for Module 16. It does
**not** render `HobtCtaBand` — that band is page-mounted furniture driven by the field group,
and Key Concept 8 says why.

```tsx
// next-app/src/components/blocks/HobtCta.tsx
'use client';
// THE ONLY 'use client' in src/components/blocks/, and Verification asserts the
// count is exactly one. The directive marks a BOUNDARY, not a file: ui/button.tsx
// has no directive of its own and is compiled into the client graph because this
// file imports it. Key Concept 6 — which is also why this renders ONE Button and
// not a whole band: the smallest thing below the boundary is the cheapest
// boundary.
//
// There is no onClick yet. Lesson 16.3 turns this into a Dialog trigger backed by
// a validated Server Action, and `leadSource` becomes the value it submits. The
// directive lands here now so the boundary is visible and the attribute
// serialisation is proved rather than assumed.
import Link from 'next/link';

import type { BlockComponentProps } from '@/components/blocks/registry';
import { Button } from '@/components/ui/button';

export function HobtCta({ block, locale }: BlockComponentProps<'BttHobtCta'>) {
  const attributes = block.attributes;
  const label = attributes?.label ?? 'Get Demo';
  const href = attributes?.href ?? '';

  // An editor inserted the block and never set a target. Render nothing: a CTA
  // that goes nowhere is worse than no CTA, and UnknownBlock is the wrong signal
  // — the block type IS known, its data is incomplete. Key Concept 2.
  if (href === '') return null;

  // `variant` maps onto Button's own variants. `blame` is the course's primary
  // CTA style from Lesson 11.2, and it is what HobtCtaBand's "Start Now" uses,
  // so a primary block CTA and a page-mounted one look like the same product.
  const variant = attributes?.variant === 'outline' ? 'outline' : 'blame';

  // Kebab-case, matching the wp_btt_leads.source column and the ACF select
  // convention. Module 16 maps it to the LeadSource GraphQL enum
  // (hobt-cta-block → HOBT_CTA_BLOCK) when it calls submitHobtLead. Carried as a
  // data attribute so it is inspectable now and wired up in Lesson 16.3.
  const leadSource = attributes?.leadSource ?? 'hobt-cta-block';

  // A site-relative href gets the locale prefix and next/link; anything else is
  // off-site and gets a plain anchor. The seeded block stores `/hobt`, so this
  // branch is exercised by real content — and it is costs 1 and 4 of Lesson
  // 14.1's renderedHtml argument, avoided, which is what `locale` is a prop for.
  const internal = href.startsWith('/') && !href.startsWith('//');

  return (
    <div data-block={block.__typename} data-lead-source={leadSource} className="my-8">
      {/* asChild, so this renders ONE anchor rather than an <a> inside a
          <button> — Lesson 11.2 Key Concept 7. */}
      <Button asChild variant={variant} size="xl">
        {internal ? (
          <Link href={`/${locale}${href}`}>{label}</Link>
        ) : (
          <a href={href} rel="noopener noreferrer">
            {label}
          </a>
        )}
      </Button>
    </div>
  );
}
```

> **"With its CTA still inert until Module 16" means the lead, not the link.** The Quick
> Overview's bullet is about `HobtCtaBand`'s "Get Demo" — a dialog trigger with no dialog behind
> it, which is why it carries `aria-disabled` and a visible explanation. This block's `Button` is
> plain navigation to the target an editor chose, so making *it* inert would be inventing a
> limitation. What is still missing is the **lead**: clicking this CTA records nothing anywhere,
> and `leadSource` is the attribute Lesson 16.3 finally submits.

> **This block does not touch the two `HobtCtaBand` instances, and that is the design.** Lesson
> 12.3's smoke spec asserts `getByRole('link', { name: 'Start Now' })` and
> `getByRole('button', { name: 'Get Demo' })` each have a count of **2** on `/en/hobt` — one
> pair from the hero band, one from the closing band, both page-mounted and both untouched by
> this module. The seeded block's `label` is "Stop blaming the tech", so it collides with
> neither accessible name. Verification asserts all three numbers.

### Step 5: Register all five, and go green

```ts
// next-app/src/components/blocks/registry.ts — the imports, added
import { BlameQuote } from '@/components/blocks/BlameQuote';
import { HobtCta } from '@/components/blocks/HobtCta';
import { IncidentCallout } from '@/components/blocks/IncidentCallout';
import { IncidentTicker } from '@/components/blocks/IncidentTicker';
import { ScapegoatPicker } from '@/components/blocks/ScapegoatPicker';
```

```ts
// next-app/src/components/blocks/registry.ts — the map, edited
export const blockRegistry = {
  CoreParagraph,
  CoreHeading,
  CoreList,
  CoreListItem,
  CoreQuote,
  CoreCode,
  BttIncidentCallout: IncidentCallout,
  BttBlameQuote: BlameQuote,
  BttScapegoatPicker: ScapegoatPicker,
  BttIncidentTicker: IncidentTicker,
  BttHobtCta: HobtCta,
  // 14.5 → CoreImage
} satisfies BlockRegistry;
```

Keys are `__typename`s, values are component names, and they differ on purpose. The mapped type
from Lesson 14.2 is what makes the pairing checked: `BttBlameQuote: IncidentCallout` is a
compile error, not a runtime surprise.

```bash
npm run verify
```

**Verify §5:**

- [ ] `npm run type-check` is silent. Step 1's `TS1360` is gone.
- [ ] `/en/blog/blog-01` shows the callout, the quote *with its nested paragraph*, the term card
      and the ticker. The nested "It worked on my machine." paragraph appears for the first time
      — `BlameQuote` renders its children, and Lesson 14.2's `UnknownBlock` did not.
- [ ] At most **one** red box remains on `blog-01`, and it is `btt/tech-verdict-card` unless you
      built Lesson 13.5's stretch block.

### Step 6: `pages.graphql` and the `[...slug]` catch-all

```graphql
# next-app/src/graphql/pages.graphql
# The [locale]/[...slug] catch-all (Lesson 14.4). `page(idType: URI)` is fussy
# about slashes — Lesson 11.5 Task §1 made you read the real value out of
# WordPress rather than guess it, and the route rebuilds the same shape.
query PageByUri($uri: ID!) {
  page(id: $uri, idType: URI) {
    id
    title
    uri
    ...EditorBlocks
  }
}

# generateStaticParams. `first: 50` is a SCOPE, not a limit on what renders: a page
# outside this set still renders on demand, because `dynamicParams` defaults to
# true. Lesson 18.1 decides how large the pre-rendered set should be, with numbers.
query PageUris($first: Int!) {
  pages(first: $first, where: { status: PUBLISH }) {
    nodes {
      id
      uri
    }
  }
}
```

```tsx
// next-app/src/app/[locale]/[...slug]/page.tsx
// Every WordPress page, rendered through the same BlockRenderer. This is the PURE
// case: a title and a block tree, no field group. Read it next to hobt/page.tsx —
// Key Concept 8 is the contrast between the two.
import { notFound } from 'next/navigation';

import { BlockRenderer } from '@/components/blocks/BlockRenderer';
import { PageByUriDocument, PageUrisDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { listTag, pageTag } from '@/lib/graphql/tags';

// Lesson 10.3's policy table. Pages change by editorial action, so 3600 until
// Module 18's webhook makes it immediate.
export const revalidate = 3600;

/**
 * First segments that a dedicated route file already owns. Next resolves the
 * specific segment first, so a WordPress page at one of these URIs is
 * unreachable through this route — excluding them here stops
 * generateStaticParams claiming to pre-render something it cannot. Key Concept 7.
 */
const RESERVED = new Set(['hobt', 'blog', 'incidents', 'reviews', 'scapegoats']);

export async function generateStaticParams(): Promise<Array<{ locale: string; slug: string[] }>> {
  const data = await fetchGraphQL(
    PageUrisDocument,
    { first: 50 },
    { revalidate: 3600, tags: [listTag('page')] }
  );

  return (data.pages?.nodes ?? [])
    .map((node) => (node?.uri ?? '').split('/').filter((segment) => segment !== ''))
    // length 0 is the front page, whose uri is "/". [locale]/page.tsx owns that,
    // and a catch-all cannot match zero segments anyway — [[...slug]] would.
    .filter((segments) => segments.length > 0 && !RESERVED.has(segments[0] ?? ''))
    .map((segments) => ({ locale: 'en', slug: segments }));
}

export default async function WordPressPage({
  params,
}: {
  readonly params: Promise<{ locale: string; slug: readonly string[] }>;
}) {
  // Next 15: params is a Promise, and every access is awaited.
  const { locale, slug } = await params;

  // Leading AND trailing slash, which is what WordPress stores in `uri`.
  const uri = `/${slug.join('/')}/`;

  // The LAST segment is the WordPress post_name, which is what Module 18's
  // webhook will build its tag from — pageTag('hobt') in Lesson 11.5, same shape.
  // noUncheckedIndexedAccess (Lesson 07.3) is why this needs the `??`.
  const name = slug[slug.length - 1] ?? 'index';

  const data = await fetchGraphQL(
    PageByUriDocument,
    { uri },
    { revalidate: 3600, tags: [pageTag(name), listTag('page')] }
  );

  // A URI with no page behind it. 404 rather than an empty shell, so Module 19
  // never puts it in a sitemap. Lesson 10.4's not-found.tsx renders it.
  if (data.page == null) notFound();

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">{data.page.title}</h1>
      <BlockRenderer blocks={data.page.editorBlocks} locale={locale} />
    </>
  );
}
```

```bash
npm run codegen && npm run type-check
```

**Verify §6:**

- [ ] `http://localhost:3000/en/about` returns 200 with "About" as its `<h1>` and the seeded
      paragraph below it.
- [ ] `http://localhost:3000/en/no-such-page` returns **404** and renders `not-found.tsx`.
- [ ] `http://localhost:3000/en/hobt` still renders the ACF headline, not a bare title —
      the dedicated route won. If you see a plain "HOBT" heading, you have a routing conflict,
      which should be impossible; check you did not put the catch-all above `[locale]`.

### Step 7: Rewrite `/hobt`, and remove the last two blobs

`hobt.graphql` first — one added line.

```graphql
# next-app/src/graphql/hobt.graphql (fragment) — ONE line added to HobtPromo,
# immediately after `title`. The whole `hobtPromo { … }` selection below it is
# untouched: commerce data an editor must not be able to reorder away — Key
# Concept 8.
    id
    title
    ...EditorBlocks
```

```tsx
// next-app/src/app/[locale]/hobt/page.tsx — the import, added
import { BlockRenderer } from '@/components/blocks/BlockRenderer';
```

The JSX edit is **one inserted line and one replaced comment**. Nothing Lesson 11.5 wrote
moves: both `HobtCtaBand` instances, `HobtModules` and `HobtTestimonials` stay exactly where
they are, for the reasons in Key Concept 8.

```tsx
// next-app/src/app/[locale]/hobt/page.tsx (fragment) — inserted immediately after
// the closing </HobtHero>, replacing the "SECTION ORDER IS HARD-CODED HERE" debt
// comment that Lesson 11.5 left in that exact spot. Delete a comment the moment
// it stops being true — Lesson 07.4.

      {/* THE BODY IS THE EDITOR'S NOW. Everything else on this page is still
          page-mounted on purpose: the hero and both CTA bands are commercial
          furniture, and the two repeaters are field-group data with no block
          representation. Key Concept 8. */}
      <BlockRenderer blocks={data.page.editorBlocks} locale={locale} />
```

That is the whole rewrite. If you find yourself deleting the closing
`<section aria-labelledby="hobt-closing-heading">`, stop: Lesson 12.3 counts the controls in it.

Now the last two blobs. Two document edits and two route edits, all anchored.

```graphql
# next-app/src/graphql/fragments/IncidentDetailFields.graphql (fragment) — the
# line `content` is DELETED and `...EditorBlocks` takes its place. The
# `incidentDetails { … }` selection below is untouched. Note that a fragment on
# Incident may spread a fragment defined on an INTERFACE: `incident` registers
# with `editor` support, so it implements NodeWithEditorBlocks.
  ...IncidentCardFields
  ...EditorBlocks
```

```graphql
# next-app/src/graphql/reviews.graphql (fragment) — inside ReviewBySlug, the line
# `content` is DELETED and `...EditorBlocks` takes its place. The
# `techReviewFields { … }` selection below is untouched.
    ...TechReviewCardFields
    ...EditorBlocks
```

In each of `src/app/[locale]/incidents/[slug]/page.tsx` and
`src/app/[locale]/reviews/[slug]/page.tsx`:

1. Add `import { BlockRenderer } from '@/components/blocks/BlockRenderer';`.
2. Add `locale` to the `await params` destructure.
3. **Delete** the `<div dangerouslySetInnerHTML={{ __html: … }} />` line and its debt comment,
   and put `<BlockRenderer blocks={incident.editorBlocks} locale={locale} />` in its place.

Nothing else moves. `stackTrace` stays in its `<pre>` as escaped text — it was never a blob and
Lesson 09.3 was right about it.

```bash
npm run codegen
npm run verify
```

**Verify §7:**

- [ ] `grep -rn 'dangerouslySetInnerHTML' src/app/` returns **nothing**. Three routes rendered
      the blob at the start of this module; zero do now.
- [ ] `/en/incidents/incident-01` and `/en/reviews/review-01` both return 200 and still show
      their ACF data. Only the body changed.
- [ ] Both routes still have exactly one `<h1>`, and it is still the incident title and the
      company name respectively. Lesson 12.3's smoke spec asserts both by name.

### Step 8: The ninety-second payoff, on both routes

Do it on `/hobt` first, because its 60-second window makes the demo watchable. Then do it on
`/en/about`, because that is where the whole page obeys.

```bash
# 1. Open the HOBT page in Gutenberg and MOVE A BLOCK.
open 'http://localhost:8080/wp-admin/edit.php?post_type=page'
#    Edit "How To Omit Blaming Tech", drag the btt/hobt-cta block above the
#    btt/incident-ticker block, and click Update.

# 2. Reload /en/hobt immediately. NOTHING CHANGES, and that is correct:
#    the route segment cache is 60 s and it has not elapsed.
curl -s http://localhost:3000/en/hobt | grep -o 'data-block="[A-Za-z]*"'

# 3. Wait out the window, then load TWICE. The first load after expiry serves
#    stale and re-renders in the background; the second serves the new order.
sleep 65
curl -s -o /dev/null http://localhost:3000/en/hobt
curl -s http://localhost:3000/en/hobt | grep -o 'data-block="[A-Za-z]*"'
# Expected: BttHobtCta now appears BEFORE BttIncidentTicker in the output.
#           No deploy, no code change, no ticket. And note what did NOT move:
#           the hero, both CTA bands, the module grid and the testimonials are
#           all still exactly where page.tsx puts them.
```

Now the pure case. On `/hobt` an editor owns the body; on `/en/about` they own everything.

```bash
# 4. Edit the "About" page in Gutenberg. Add a heading above the existing
#    paragraph, add a btt/incident-callout below it, then swap their order and
#    Update. There is no field group on this page and no hard-coded section: the
#    ENTIRE page is what you just composed.
open 'http://localhost:8080/wp-admin/edit.php?post_type=page'

# 5. /[...slug] carries `revalidate = 3600`, so there is nothing to wait out in
#    ninety seconds. Force a cold cache instead — the point of the exercise is
#    WHAT you can change without a deploy, not how fast the window is.
rm -rf .next && npm run dev &
sleep 12
curl -s http://localhost:3000/en/about | grep -o 'data-block="[A-Za-z]*"'
# Expected: your new order, and the only React that knows about it is
#           BlockRenderer. Module 18's webhook is what removes the `rm -rf`.
```

Then the term rename, which proves `ScapegoatPicker` resolved a reference rather than copying
one:

```bash
cd ../wordpress-headless
docker compose run --rm wpcli wp term update scapegoat \
  "$(docker compose run --rm -T wpcli wp term list scapegoat --slug=kubernetes --field=term_id | tr -d '\r')" \
  --name='Kubernetes (allegedly)'

cd ../next-app
sleep 65
curl -s -o /dev/null http://localhost:3000/en/hobt
curl -s http://localhost:3000/en/hobt | grep -c 'Kubernetes (allegedly)'
# Expected: 1 — and NOBODY RE-SAVED THE POST. The block stored a term ID, so the
#           name is resolved at render time. Lesson 13.3's decision, paying off.

# Put it back.
cd ../wordpress-headless
docker compose run --rm wpcli wp term update scapegoat \
  "$(docker compose run --rm -T wpcli wp term list scapegoat --slug=kubernetes --field=term_id | tr -d '\r')" \
  --name='Kubernetes'
cd ../next-app
```

> **Be honest about "instant" when you demo this.** The claim you have earned is **"no deploy
> needed"**. The claim you have *not* earned is "instant": the change appears when the revalidate
> window elapses — 60 s on `/hobt`, 3600 s on `/en/about` and `/en/blog/blog-01`. Module 18's
> webhook is what turns the second claim true, and Key Concept 9 draws the difference. Two
> claims, and only one of them is yours today.

Then the note that Module 18 needs, in the file that already holds this module's decisions:

```markdown
<!-- docs/api-contract.md — append -->
## Cache tags added in Lesson 14.4

| Fetch | `revalidate` | Tags |
|---|---|---|
| `PageByUri` (`[...slug]`) | 3600 | `page:<last-uri-segment>`, `pages` |
| `PageUris` (`generateStaticParams`) | 3600 | `pages` |
| `ScapegoatById` (`ScapegoatPicker`) | 60 | **`scapegoat:<termId>`** |
| `IncidentTicker` (`IncidentTicker`) | 300 | `incidents` |

**Module 18 owes one thing here.** `btt/scapegoat-picker` stores a term **ID**, so the component
cannot know the term's slug before the response arrives and therefore cannot attach
`termTag('scapegoat', slug)`. It attaches the ID-keyed form instead. The webhook must send
**both** for every term change:

    revalidateTag('scapegoat:the-intern')   // slug-keyed, for the leaderboard
    revalidateTag('scapegoat:4')            // ID-keyed, for the picker block

Until it does, a renamed term appears on a picker block after its 60-second window rather than
immediately. Both strings are built by `src/lib/graphql/tags.ts`; neither is typed by hand.
```

And the accessibility rows, because Lesson 11.4's standing rule applies to decisions as well as
to attributes:

```markdown
<!-- docs/accessibility.md — append to the "Editor-composed content" section -->
| Decision | Consequence |
|---|---|
| `IncidentCallout` renders a `<div>`, not the `<aside>` that Lesson 13.5's `save()` emits | `<aside>` inside `<main>` is a `complementary` landmark; an unnamed one is an axe finding and two callouts would need two distinct names no attribute supplies. The `<h3>` carries the meaning instead |
| `BlameQuote` and `CoreQuote` render `<figure>`/`<blockquote>`/`<figcaption>`/`<cite>` | The quote and its attribution are paired semantically, with no ARIA, and no `<footer>` appears inside a `<blockquote>` |
| `IncidentTicker` renders `<section>` + `<h3>` + `<ul>` | "list, 5 items" is announced, and the `<h3>` sits under the body's `<h2>` headings rather than competing with them |
| `HobtCta` renders one `Button asChild` wrapping one link | One anchor, not an anchor inside a button. Its accessible name is the block's `label`, so two CTA blocks are distinguishable by name rather than by position |
```

```bash
npm run verify
npm test -- --run
npx playwright test
git add -A
git commit -m "feat(next): five btt block components, the [...slug] catch-all, and an editor-composed /hobt"
```

---

## Verification

```bash
cd next-app
# `npm run dev` running in another terminal.

# 1. The gate
npm run verify
# Expected: exit 0, silent

# 2. /hobt renders as a React tree. THIS IS MODULE 15's STARTING STATE
#    ASSERTION, so it has to hold.
curl -s http://localhost:3000/en/hobt | grep -c 'data-block'
# Expected: a number greater than 0

curl -s http://localhost:3000/en/hobt | grep -o 'data-block="[A-Za-z]*"' | sort | uniq -c
# Expected, derived from block_showcase() in the Lesson 04.5 seeder:
#           1 BttBlameQuote        1 BttHobtCta          1 BttIncidentCallout
#           1 BttIncidentTicker    1 BttScapegoatPicker  1 CoreHeading
#           2 CoreParagraph        1 UnknownBlock
#         = 9 total in `npm run dev`. Two CoreParagraphs because BlameQuote now
#           renders the one nested inside it. The UnknownBlock is
#           btt/tech-verdict-card — it disappears if you built Lesson 13.5's
#           stretch block AND added its inline fragment, and it renders as
#           nothing at all in a production build either way.

# 3. Exactly one <h1> on /hobt, and it is still the ACF headline. HobtHero stayed
#    page-mounted precisely so this stays true — Key Concept 8.
curl -s http://localhost:3000/en/hobt | grep -o '<h1' | wc -l
# Expected: 1
curl -s http://localhost:3000/en/hobt | grep -c 'How To Omit Blaming Tech'
# Expected: 1 or more

# 4. NEGATIVE — Module 14 did NOT change the CTA counts. These are Lesson 12.3's
#    numbers: two HobtCtaBand instances, page-mounted, one in the hero and one in
#    the closing section, both untouched by this module. If either number moves,
#    `e2e/smoke.spec.ts`'s "/en/hobt shows both CTAs" test fails.
curl -s http://localhost:3000/en/hobt | grep -o 'Start Now' | wc -l
# Expected: 2
curl -s http://localhost:3000/en/hobt | grep -o 'Get Demo' | wc -l
# Expected: 2
curl -s http://localhost:3000/en/hobt | grep -o 'aria-disabled="true"' | wc -l
# Expected: 2 — still inert, until Module 16 deletes the attribute and the
#           sentence that explains it.
curl -s http://localhost:3000/en/hobt | grep -o 'Stop blaming the tech' | wc -l
# Expected: 1 — the btt/hobt-cta block's own Button. Its `label` collides with
#           neither accessible name above, which is why the counts hold.
curl -s http://localhost:3000/en/hobt | grep -c 'hobt-closing-heading'
# Expected: 1 or more — the closing <section> from Lesson 11.5 is STILL THERE.
#           Deleting it is the one edit that breaks Lesson 12.3.

# 5. The catch-all renders a WordPress page
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/about
# Expected: 200
curl -s http://localhost:3000/en/about | grep -o 'data-block="CoreParagraph"' | wc -l
# Expected: 1 — the About page is one seeded paragraph.

# 6. The picker resolved a reference rather than a copy: the term NAME appears on
#    the page and the term ID does not.
curl -s http://localhost:3000/en/hobt | grep -c 'Kubernetes'
# Expected: 1 or more
curl -s http://localhost:3000/en/hobt | grep -c 'incidents blamed on this'
# Expected: 1

# 7. The ticker ran its own query and rendered real incidents
curl -s http://localhost:3000/en/hobt | grep -o 'Latest incidents' | wc -l
# Expected: 1
curl -s http://localhost:3000/en/hobt | grep -o '/en/incidents/incident-' | wc -l
# Expected: 5 or more — the ticker's rows, plus the callout's link to incident-01.

# 8. NEGATIVE — the blob is gone from ALL THREE routes. The module started with
#    three hits; it ends with zero, and it stays zero for the rest of the course.
grep -rn 'dangerouslySetInnerHTML' src/app/ | wc -l
# Expected: 0
grep -rl 'dangerouslySetInnerHTML' src/ | wc -l
# Expected: 1 — still only RichText.tsx.

# 9. NEGATIVE — exactly ONE client component under blocks/, and it is HobtCta
grep -rl "'use client'" src/components/blocks/ | wc -l
# Expected: 1
grep -rl "'use client'" src/components/blocks/
# Expected: src/components/blocks/HobtCta.tsx
grep -c "'use client'" src/components/blocks/BlockRenderer.tsx
# Expected: 0 — the renderer is still a Server Component, which is the only
#           reason one interactive leaf costs one interactive leaf.

# 10. NEGATIVE — the ticker re-runs the query and does NOT ship render.php's output
grep -c 'renderedHtml' src/components/blocks/IncidentTicker.tsx
# Expected: 0
grep -c 'fetchGraphQL' src/components/blocks/IncidentTicker.tsx
# Expected: 1
grep -rn 'renderedHtml' src/ | wc -l
# Expected: 0

# 10b. And see what you are NOT shipping, so Key Concept 4's divergence risk is
#      concrete rather than theoretical. `do_blocks()` and not the WordPress
#      permalink: Lesson 02.4's btt-headless theme `template_redirect`s every
#      front-end hit to Next, so requesting the permalink gives you a 302.
cd ../wordpress-headless
docker compose run --rm -T wpcli wp eval \
  'echo do_blocks( "<!-- wp:btt/incident-ticker {\"count\":2} /-->" );' | head -20
# Expected: render.php's markup — a <ul> of two incidents, with WordPress class
#           names and raw <a href> values. Compare it with what IncidentTicker.tsx
#           emits. Two implementations, one query, and only a test keeps them
#           honest (Lesson 23.5).
curl -s -o /dev/null -w '%{http_code}\n' \
  "$(docker compose run --rm -T wpcli wp post list --post_type=post --name=blog-01 --field=url | tr -d '\r')"
# Expected: 302 — the theme redirect. This is why the check above uses do_blocks()
#           and never a WordPress-rendered page.
cd ../next-app

# 11. NEGATIVE — specific routes still beat the catch-all, so Lesson 12.3's
#     404 assertion still finds the incident copy and not the page copy
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/incidents/no-such-incident-ever
# Expected: 404
curl -s http://localhost:3000/en/incidents/no-such-incident-ever | grep -c 'No such incident'
# Expected: 1
#           If this prints 0, the request fell through to [...slug] and rendered
#           the generic not-found. Key Concept 7.

# 12. NEGATIVE — no block component opens a second landmark, and CoreQuote and
#     BlameQuote both avoided <footer> to keep this true
grep -rn '<main\|<header\|<footer' src/components/blocks/
# Expected: no output

# 13. NEGATIVE — no block component reaches for a position-dependent Tailwind
#     variant. `first:`, `last:` or `only:` on a block's own root is precisely the
#     "looks right in one position" bug from Key Concept 5, and it is invisible
#     until an editor moves the block.
grep -rn 'first:\|last:\|only:' src/components/blocks/
# Expected: no output
#     Vertical rhythm is symmetric instead: every root element uses `my-*` and
#     never `mt-*` alone, so two of the same block in a row do not double the gap.

# 14. NEGATIVE — both suites are green. /hobt was rewritten and two more routes
#     changed, and Lesson 12.3 asserts headings and CTA counts on all of them.
npm test -- --run
# Expected: 0 failures
npx playwright test
# Expected: 0 failures, 13 passed

# 15. The seeded corpus is untouched — no stray content from this lesson
cd ../wordpress-headless
docker compose run --rm wpcli wp post list --post_type=page --format=count
# Expected: 3
docker compose run --rm wpcli wp term list scapegoat --field=name --format=csv | grep -c 'allegedly'
# Expected: 0 — Task §8 put the term name back.
```

If check 2 shows `BttScapegoatPicker` missing while everything else is present, the term the
seeder referenced was deleted: `ScapegoatPicker` returns `null` when the term does not resolve,
which is correct and looks identical to "not registered". Re-run `wp blame seed` and try again.

## Control Questions

1. `btt/scapegoat-picker` stores a term ID and `ScapegoatPicker` attaches
   `termTag('scapegoat', String(termId))`. Explain why the component cannot attach
   `termTag('scapegoat', slug)` instead, and describe exactly what Module 18's webhook has to do
   for the ID-keyed tag to be worth anything.
2. `IncidentTicker` re-declares `count = 5` and `severities = ['s1-catastrophic', 's2-major']`,
   which are already the `block.json` defaults. Say why the component cannot read them from the
   response, and name the lesson that owns the test keeping the two copies in agreement.
3. `HobtCta` carries `'use client'` and `src/components/ui/button.tsx` does not, yet both run in
   the browser. Explain the mechanism, then say what would happen to the client bundle if
   `HobtCta` imported `BlockRenderer` instead of `Button`.
4. `/hobt` keeps `HobtHero`, **both** `HobtCtaBand` instances, `HobtModules` and
   `HobtTestimonials` page-mounted, while `[...slug]` is 100% blocks. Give the reason for each
   of the four, then state the cost the hybrid imposes on an editor and one concrete
   mitigation.
5. An editor creates a WordPress page titled "Blog" and publishes it. Describe what a visitor to
   `/en/blog` sees, why, and name the two places in this lesson's code that would have to change
   for the editor's page to be reachable at all.

## Learn More

- [Next.js — catch-all route segments](https://nextjs.org/docs/app/api-reference/file-conventions/dynamic-routes)
  — `[...slug]` versus `[[...slug]]`, and the resolution order Key Concept 7 depends on
- [Next.js — `generateStaticParams`](https://nextjs.org/docs/app/api-reference/functions/generate-static-params)
  — read the `dynamicParams` section, which is what makes a *scoped* param list safe
- [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
  — the "passing props from Server to Client Components" section is exactly Key Concept 6's
  serialisation rule
- [React — `'use client'`](https://react.dev/reference/rsc/use-client) — the directive marks a
  boundary and not a file, stated by the people who designed it
- [Block deprecations](https://developer.wordpress.org/block-editor/reference-guides/block-api/block-deprecation/)
  — the "deprecations are only applied on parse" behaviour that Key Concept 2 turns into a
  front-end consequence
- [`get_term()`](https://developer.wordpress.org/reference/functions/get_term/) — the Classic
  equivalent of `ScapegoatPicker`'s resolve step, useful for seeing what `render.php` would have
  done instead
- [WPGraphQL — `idType` on nodes and terms](https://www.wpgraphql.com/docs/default-types-and-fields/)
  — why `idType: DATABASE_ID` is needed for a term ID and a bare `id:` returns `null`
- [Next.js — `revalidateTag`](https://nextjs.org/docs/app/api-reference/functions/revalidateTag)
  — the function Key Concept 9's right-hand column is waiting for, and Module 18 calls
- [WordPress page templates and the template hierarchy](https://developer.wordpress.org/themes/templates/page-templates/)
  — worth rereading against Key Concept 8, because the hybrid page is the thing a page template
  could not express
