---
title: 'Page Composition & the HOBT Shell'
module: 11
lesson: 5
teaches: [component-composition, children-prop, acf-driven-sections, inert-cta, landing-page-layout]
produces: ['next-app/src/app/[locale]/hobt/page.tsx', 'next-app/src/components/hobt/HobtHero.tsx', 'next-app/src/components/hobt/HobtModules.tsx', 'next-app/src/components/hobt/HobtTestimonials.tsx', 'next-app/src/components/hobt/HobtCtaBand.tsx', 'next-app/src/graphql/hobt.graphql']
requires: [11.4, 10.5]
---

# Lesson 11.5 — Page Composition & the HOBT Shell

## Quick Overview

HOBT — *How To Omit Blaming Tech* — is the fictional course Blame The Tech upsells, and its
landing page is the most commercially important route in the app. This lesson builds it: a hero
with a headline, subheadline and urgency badge, a module grid, a testimonial section, and two
calls to action. Every value comes from the `hobtPromo` ACF field group, so the copy is the
editor's, and the section components are thin.

Two deliberate incompletenesses. First, **every CTA is inert.** "Get Demo" opens nothing and
"Start Now" links nowhere useful, because lead capture needs a Server Action, Zod validation,
rate limiting and Turnstile, and all of that is Module 16. Rendering a button that silently
does nothing is uncomfortable, and it is still better than shipping an unvalidated form.
Second, **the section order is hard-coded in `page.tsx`.** That is exactly the constraint
Module 14 removes: once blocks are data, marketing reorders the page in Gutenberg and the
front end obeys with no deploy. Building the hard-coded version first is what makes the block
version feel like a release rather than a refactor.

By the end of this lesson you will have:

- `next-app/src/app/[locale]/hobt/page.tsx` — the landing route, querying `hobtPromo` with a short `revalidate`
- `next-app/src/components/hobt/HobtHero.tsx` with the `seatsLeft` urgency badge
- `next-app/src/components/hobt/HobtModules.tsx` and `HobtTestimonials.tsx`, both rendering ACF repeaters
- `next-app/src/components/hobt/HobtCtaBand.tsx` — a reusable CTA band whose buttons are visibly present and deliberately inert
- A composition pattern using `children` and slot props, applied so no section component knows where it sits on the page

## Classic WP Analogy

This is a page template with ACF fields, which is a thing you have built many times:

| Classic WordPress | Here |
|---|---|
| `templates/hobt.php` selected in Page Attributes | `src/app/[locale]/hobt/page.tsx` |
| `get_field('headline')` | `page.hobtPromo.headline` from the query |
| `have_rows('modules')` / `the_row()` / `get_sub_field()` | `modules.map(m => …)` |
| `get_template_part('parts/hero')` per section | `<HobtHero … />` per section |
| `if (get_field('seats_left') < 20)` for the badge | the same condition, in JSX |
| A flexible-content field for reorderable sections | Gutenberg blocks — Lesson 14.4 |

The ACF repeater comparison is worth dwelling on because it is where the generated types bite.
`have_rows()` / `get_sub_field()` returns whatever is there and PHP shrugs at a missing key. The
`modules` and `testimonials` repeaters arrive from WPGraphQL as **lists of generated object
types**, not lists of strings — `HobtPromoModules`, with `title`, `summary` and
`durationMinutes` each independently nullable, because ACF cannot promise a sub-field was
filled. Every field is fixed by
[the content model contract](../appendix/03-content-model-reference.md#44-hobt-promo), and the
nullability is not codegen being pedantic: an editor who adds a row and saves before typing
produces exactly that shape.

The analogy breaks on **who controls the layout**, and this is the point of the whole lesson.
A page template plus a flexible-content field genuinely does let an editor reorder sections —
ACF flexible content is a real answer to that problem, and if this were a Classic build it
would be a reasonable one. What you have built here is worse than that: the field group
supplies the content and `page.tsx` dictates the order, so moving the testimonials above the
module grid is a code change and a deploy. Naming that gap now, while it is fresh, is what
makes Module 14 land. The cost, stated plainly: this route is currently less editable than the
Classic WordPress equivalent, and it stays that way for three modules.

The smaller break is the inert CTA. In a Classic build you would have wired a form to
`admin-post.php` in the same afternoon, nonce and all, and it would work. Here the correct
implementation needs a Server Action, a Zod schema, a rate limiter and a bot check, so the
honest move is to render the button and leave it dead rather than ship a `<form action="/api/lead">`
that nothing validates. Module 16 collects that debt.

---

## Key Concepts

### 1. Three composition patterns, and which one this app uses

React has no `get_template_part()`. What it has instead is three ways for one component to
accept another, and picking wrongly makes a page hard to change later.

| Pattern | Looks like | Good for | Cost |
|---|---|---|---|
| **`children`** | `<Section><Cta /></Section>` | one obvious slot; the parent does not care what goes in it | only one slot |
| **Slot props** | `<Section title={…} actions={<Cta />} />` | several named slots, each optional | the prop list grows, and `ReactNode` props are invisible to codegen |
| **Compound components** | `<Card><Card.Header/><Card.Body/></Card>` | a family that shares implicit context | the most machinery; a wrong nesting fails at runtime, not compile time |
| Verdict for `/hobt` | **`children` for the one slot, plain data props for everything else** | | |

`/hobt` uses `children` exactly once — the hero accepts a CTA band as its child — and plain
data props everywhere else. That is not minimalism for its own sake: a section whose inputs are
plain data is a section Module 14 can construct from a block's attributes. A section whose
inputs include `ReactNode` cannot be, because a Gutenberg block attribute is JSON.

> **This is the rule Module 14 depends on, so it is worth stating now.** Every section
> component on this page takes serialisable data and, at most, `children`. The moment one of
> them needs `icon={<Flame />}` you have made it unbuildable from a block.

### 2. A section must not know where it sits

The temptation on a landing page is enormous, because designs describe themselves that way:
"the first band is dark", "the last CTA is bigger", "alternate the background". Every one of
those becomes a prop like `isFirst`, `index` or `variant="dark"` chosen by where the component
appears — and every one of them makes the page unreorderable.

```
❌ THE SECTION KNOWS                      ✅ THE SECTION IS TOLD
<HobtHero isFirst />                      <HobtHero />
<HobtModules index={1} />                 <HobtModules heading="What you learn" />
<HobtCtaBand variant="closing" />         <HobtCtaBand heading="Ready?" />

reordering means editing every prop       reordering means moving two lines
Module 14 cannot construct these from     Module 14 hands each one its own
a block, because a block does not know    block attributes and nothing else
its own index
```

`HobtCtaBand` is the test case, and this lesson uses it twice on purpose: once inside the hero,
once as the closing band, with different headings and identical everything else. If it renders
correctly in both places with no positional prop, the constraint holds.

There is one prop that looks positional and is not: `idPrefix`. It exists because the component
renders an `id` for `aria-describedby`, two instances would collide, and a Server Component
cannot call `useId()`. The page supplies `"hero"` and `"closing"` — but the component's
*rendering* does not vary with the value, which is the line that matters.

### 3. ACF repeaters, now with consequences

Lesson 07.4 modelled the `pros`/`cons` repeaters as object lists rather than string arrays.
`/hobt` is where the same shape starts costing you branches. `modules` and `testimonials` are
repeaters on the `HOBT Promo` field group —
[appendix 03 §4.4](../appendix/03-content-model-reference.md#44-hobt-promo) has the field
names — and codegen types them like this:

```
modules: Array<{
  title:           string | null
  summary:         string | null
  durationMinutes: number | null
} | null> | null
        ▲          ▲                    ▲
        │          │                    └── the LIST can be null: field group empty
        │          └── each ROW can be null
        └── each SUB-FIELD can be null, independently of its siblings
```

Three levels of nullability, and none of them is codegen being pedantic:

| Null | Produced by |
|---|---|
| the whole list | the field group has never been saved on this page |
| a row | ACF's own row bookkeeping, and a row deleted concurrently |
| a sub-field | **an editor who added a row and hit Save before typing** |

That last one is the common case, not an edge case. It happens every single time someone builds
a page top to bottom in one session. So every section component branches on the sub-field, not
just on the row — and a module card with a title and no summary renders the title.

### 4. `{seatsLeft && …}` renders a bare `0`, and `0` is the value that matters most

Lesson 08.2 introduced this trap. `/hobt` is where it becomes a business problem.

```tsx
// (illustration) HobtHero.tsx — three ways to render a count, one of them wrong
{seatsLeft && <Badge>{seatsLeft} seats left</Badge>}
// ❌ seatsLeft === 0  → renders the NUMBER 0 into the DOM, next to nothing else
// ❌ seatsLeft === null → renders nothing, correctly, by accident

{seatsLeft ? <Badge>{seatsLeft} seats left</Badge> : null}
// ❌ seatsLeft === 0  → renders nothing. "Sold out" silently disappears.

{typeof seatsLeft === 'number' ? <Badge>{seatsLeft} seats left</Badge> : null}
// ✅ 0 → "0 seats left". null → nothing. Both deliberate.
```

`&&` returns its left operand when that operand is falsy, and React renders the number `0` as
text — it only skips `false`, `null` and `undefined`. So the first version puts a stray `0` on
your landing page, and the second version hides the single most conversion-relevant fact the
page has. `typeof x === 'number'` is the version that distinguishes "no data" from "zero", and
on this page that distinction is the whole point of the field.

> **The same trap has a sibling, and it bites on every list in this app.**
> `{rows.length && <ul>…</ul>}` renders a bare `0` for an empty array, because `0` is falsy
> and `&&` hands it straight to React. That is why every section in this lesson writes
> `rows.length === 0 ? <EmptyState/> : <ul>…</ul>` — an explicit comparison, both branches
> named. If you find yourself typing `&&` in JSX, ask what the left operand is when there is
> no data: `undefined` and `null` are safe, `0` and `''` are not.

### 5. Why `/hobt` revalidates in 60 seconds when everything else takes an hour

`seatsLeft` is the reason, and it is a genuine content-freshness requirement rather than a
performance preference. Lesson 10.3's policy table records it:

| Route | `revalidate` | Because |
|---|---|---|
| the shell (menu, site settings) | `3600` | changes when an editor changes it, and Module 18's tag will handle that |
| `/incidents`, `/blog`, `/reviews` | `3600` | published content; the tag covers a new post |
| **`/hobt`** | **`60`** | **a stale seat count is a stale promise** |

"Only 3 seats left" that is actually zero is worse than a slightly slow page, and the failure is
commercial rather than technical. Sixty seconds is the number the policy table picked; it is a
trade, and the cost is that `/hobt` is rebuilt up to sixty times an hour whether anything changed
or not. Module 18's `page:hobt` tag makes the interval a fallback rather than the mechanism —
and until then it *is* the mechanism, which is why it is short.

Note that both a route-segment `export const revalidate = 60` and the `revalidate` option on
the `fetch` appear in Step 6. They are different things: the segment value bounds how long the
rendered page may be reused, and the fetch value bounds how long the GraphQL response may be
reused. A long fetch cache under a short page cache re-renders the page from stale data, which
looks exactly like the page cache not working.

### 6. The inert CTA, argued honestly

Both calls to action on this page render and do nothing. That is uncomfortable and it is the
right call, so here is the argument rather than the assertion.

In a Classic build this would have been an afternoon: a `<form action="admin-post.php">`, a
`wp_nonce_field()`, an `admin_post_btt_lead` hook, `sanitize_email()`, `$wpdb->insert()`, a
redirect. It would work, and it would be roughly as secure as the ecosystem average.

Here the correct implementation needs all of this:

| Piece | Where it lands |
|---|---|
| A Server Action with `'use server'` | Lesson 16.2 |
| A Zod schema validating at the boundary | Lesson 16.1 |
| The `submitHobtLead` mutation and the `X-BTT-App-Token` credential | Module 06 built it; Lesson 16.3 calls it |
| A rate limiter, because a public write endpoint is a public write endpoint | Lesson 16.2 builds it; 16.3 uses it |
| A bot check | Lesson 16.3 |
| The `wp_btt_leads` table, PII-minimised, `ip_hash` as an HMAC | specified in appendix 03 §5; created by Lesson 16.3 |

| | Ship an unvalidated form now | Render an inert button now |
|---|---|---|
| Works for a user | ✅ | ❌ |
| Accepts unvalidated input into a database | ❌ **yes** | ✅ no |
| Rate limited | ❌ | ✅ trivially |
| Honest about its state | ❌ silently broken | ✅ visibly unfinished |
| Verdict | ❌ | **✅** |

So: no `<form>` on this page, no `onClick`, no `fetch`. A button with a visible explanation
next to it. Check 5 of `## Verification` asserts that no `<form>` ships from this route, and
that is the most important check in the lesson.

> ⚠️ **Do not add a `<form>` here "just to see it work".** A `<form>` with no `action` posts to
> the current URL on submit, which in the App Router means a `GET` back to `/en/hobt` with the
> field values in the query string — so the lead's email address lands in the access log, the
> CDN cache key and the browser history. That is a data-protection incident produced by an
> afternoon of curiosity, and it is a great deal easier to not do than to undo.

And there is an accessibility half, which ties back to Lesson 11.4. A `disabled` attribute
removes a control from the tab order — so a keyboard user never reaches the button, never
reaches its explanation, and has no way to discover that the feature exists but is not ready.
`aria-disabled="true"` keeps it focusable and announces it as unavailable, and
`aria-describedby` points at the sentence that says why. **A disabled control needs an
accessible explanation, not just a disabled attribute.**

### 7. `asChild` on `Button` so "Start Now" is one `<a>`

`startNowUrl` is an external checkout URL. It must be a link — a real `<a href>` that
middle-clicks, opens in a new tab, and shows its target in the status bar.

```tsx
// (illustration) HobtCtaBand.tsx — the same visual, two very different DOMs
<Button><a href={url}>Start Now</a></Button>
// ❌ <button><a>…</a></button> — invalid HTML, two tab stops, announced twice,
//    and the focus ring is on the button while the click target is the anchor

<Button asChild><a href={url}>Start Now</a></Button>
// ✅ <a href class="…button classes…">Start Now</a> — one element, one tab stop
```

Key Concept 7 of Lesson 11.2 covered the mechanism; this is the first place it matters to a
user. Note that "Start Now" is `<a href>` and not `next/link`: the target is off-site, so
client-side navigation has nothing to do.

### 8. Who controls the layout — the actual subject of this lesson

Everything above is craft. This is the architecture, and it is the one place in Module 11 where
the headless version is **worse** than the Classic one.

An ACF flexible-content field genuinely solves the reordering problem. An editor drags a
"testimonials" layout above a "modules" layout, saves, and the page changes. If Blame The Tech
were a Classic build, that would be a reasonable and complete answer.

| | ACF flexible content (Classic) | This route, today | Module 14 |
|---|---|---|---|
| Editor changes the copy | ✅ save | ✅ save | ✅ save |
| Editor adds a testimonial | ✅ save | ✅ save | ✅ save |
| Editor **reorders sections** | ✅ save | ❌ code change + deploy | ✅ save |
| Editor adds a new kind of section | ⚠️ if the layout exists | ❌ code change + deploy | ⚠️ if the block exists |
| Front end can be a React component | ❌ PHP partial | ✅ | ✅ |
| Section order is reviewable in a diff | ❌ it is database rows | ✅ it is `page.tsx` | ⚠️ it is post content |

**The cost, stated plainly: `/hobt` is currently less editable than the Classic WordPress
equivalent, and it stays that way for three modules.** Marketing cannot move the testimonials
above the module grid without a pull request.

Building the hard-coded version first is deliberate, and the reason is that Module 14 is a large
conceptual jump — blocks as data, a discriminated union, a renderer registry, `never`
exhaustiveness. Arriving at it having felt this constraint makes it land as a release. Arriving
at it cold makes it feel like a refactor of code that already worked.

It is also worth being precise about what Module 14 does and does not give back, because
"editors can reorder the page" is not the same promise as ACF flexible content. Blocks move the
order into `post_content`, which means it is versioned by WordPress's own revisions and
previewable through Lesson 17.2's draft mode — both better than ACF rows. It also means the
order is no longer reviewable in a pull request, because it is no longer code. That is the
trade, and it is the right one for a marketing page and the wrong one for, say, a checkout
flow. The question to ask about any piece of layout is who should be allowed to change it
without a deploy, and `/hobt` is the clearest yes in the whole application.

---

## Task

### Step 1: Find the real URI, then write the document

Do not assume the path. The HOBT page is seeded with the `templates/hobt.php` page template
([appendix 03 §9](../appendix/03-content-model-reference.md#9-seed-data)), and its `uri` is
whatever WordPress generated — including the leading and trailing slashes, which
`page(idType: URI)` is fussy about.

```bash
cd ../wordpress-headless

# Ask WordPress, do not guess. Note the `uri` EXACTLY as printed.
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ pages(first: 20) { nodes { slug uri title } } }"}' | jq '.data.pages.nodes'
# Expected: a node with slug "hobt". Its `uri` is probably "/hobt/" — use the
#           printed value, not this sentence.

# GraphQL reports failure with HTTP 200 and an `errors` array, so check `.errors`
# rather than the status code.
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ pages(first: 1) { nodes { uri } } }"}' | jq '.errors'
# Expected: null

# Confirm the page template, because `hobtPromo` only appears on pages using it
docker compose run --rm wpcli wp post list --post_type=page --fields=ID,post_name,post_title
docker compose run --rm wpcli wp post meta get <ID-of-the-hobt-page> _wp_page_template
# Expected: templates/hobt.php
```

```graphql
# next-app/src/graphql/hobt.graphql
# One document per route, per Lesson 10.5's convention. The URI is a VARIABLE so
# the page owns the value and the document stays reusable.
#
# `heroImage` and each testimonial's `avatar` are deliberately NOT selected.
# Rendering them properly needs `next/image`, `remotePatterns` in next.config.ts
# and `mediaDetails { width height }` — all of which land in Lesson 14.5. A field
# you select and do not render is a resolver call you pay for and waste, which is
# exactly what Lesson 10.5 taught you to delete.
query HobtPromo($uri: ID!) {
  page(id: $uri, idType: URI) {
    id
    title
    hobtPromo {
      headline
      subheadline
      priceUsd
      seatsLeft
      demoBookingUrl
      startNowUrl
      modules {
        title
        summary
        durationMinutes
      }
      testimonials {
        quote
        author
        role
      }
    }
  }
}
```

```bash
cd ../next-app
npm run codegen
# Expected: HobtPromoDocument and HobtPromoQuery exported from src/gql/graphql.ts
```

**Verify §1:**

- [ ] `grep -c 'HobtPromoDocument' src/gql/graphql.ts` returns `1` or more.
- [ ] The generated `modules` type has `Array<… | null> | null`. If any level is non-nullable,
      the ACF field group is not registered the way appendix 03 §4.4 describes.

### Step 2: Write the hero

```tsx
// next-app/src/components/hobt/HobtHero.tsx
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';

export function HobtHero({
  locale,
  headline,
  subheadline,
  priceUsd,
  seatsLeft,
  children,
}: {
  readonly locale: string;
  readonly headline: string | null;
  readonly subheadline: string | null;
  readonly priceUsd: number | null;
  readonly seatsLeft: number | null;
  // The one `children` slot on this page. Key Concept 1: the hero does not care
  // what goes here, and the page decides.
  readonly children?: ReactNode;
}) {
  // `locale` is why page.tsx awaits params. Module 20 makes this matter; today
  // it is the difference between "$1,499" and a bare number.
  const price =
    typeof priceUsd === 'number'
      ? new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: 0,
        }).format(priceUsd)
      : null;

  return (
    // A named region, so it is a real landmark rather than a decorative
    // <section> — Lesson 11.4 Key Concept 2.
    <section aria-labelledby="hobt-hero-heading" className="py-12 sm:py-20">
      <div className="flex flex-wrap items-center gap-3">
        {/* typeof, not `&&` and not a ternary on truthiness. Key Concept 4:
            "0 seats left" is the value that matters most and both of the
            shorter spellings get it wrong. */}
        {typeof seatsLeft === 'number' ? (
          <Badge variant="s1-catastrophic">{seatsLeft} seats left</Badge>
        ) : null}
        {price !== null ? <span className="text-sm text-muted-foreground">{price}</span> : null}
      </div>

      {/* The page's only <h1>. Falls back rather than rendering an empty
          heading, which jsx-a11y/heading-has-content would reject anyway. */}
      <h1
        id="hobt-hero-heading"
        className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl"
      >
        {headline ?? 'How To Omit Blaming Tech'}
      </h1>

      {subheadline !== null && subheadline !== '' ? (
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{subheadline}</p>
      ) : null}

      {children !== undefined ? <div className="mt-8">{children}</div> : null}
    </section>
  );
}
```

### Step 3: Write the module grid

```tsx
// next-app/src/components/hobt/HobtModules.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type HobtModule = {
  readonly title: string | null;
  readonly summary: string | null;
  readonly durationMinutes: number | null;
};

export function HobtModules({
  heading,
  modules,
}: {
  readonly heading: string;
  // Three levels of null, exactly as codegen types it. Key Concept 3.
  readonly modules: readonly (HobtModule | null)[] | null;
}) {
  // Drop null rows once, at the top, so the JSX below has one shape to handle.
  const rows = (modules ?? []).filter((m): m is HobtModule => m !== null);

  return (
    <section aria-labelledby="hobt-modules-heading" className="border-t border-border py-12">
      <h2 id="hobt-modules-heading" className="text-2xl font-semibold tracking-tight">
        {heading}
      </h2>

      {rows.length === 0 ? (
        // The empty state. A section with no rows renders a sentence, not an
        // empty grid with a stray gap — and never nothing at all, because
        // "nothing rendered" is indistinguishable from "the query broke".
        <p className="mt-4 text-sm text-muted-foreground">
          The curriculum is being finalised. Check back shortly.
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((module, i) => (
            // No stable id on an ACF repeater row, so the index is the honest
            // key here. It is safe because this list is never reordered
            // client-side — see Lesson 08.2 on when an index key is a bug.
            <li key={`${module.title ?? 'module'}-${i}`}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="text-lg">{module.title ?? 'Untitled module'}</CardTitle>
                  {typeof module.durationMinutes === 'number' ? (
                    <p className="text-xs text-muted-foreground">
                      {module.durationMinutes} min
                    </p>
                  ) : null}
                </CardHeader>
                {/* A sub-field is null independently of its siblings: an editor
                    who typed a title and saved produces exactly this row. */}
                {module.summary !== null && module.summary !== '' ? (
                  <CardContent className="text-sm text-muted-foreground">
                    {module.summary}
                  </CardContent>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

### Step 4: Write the testimonials

```tsx
// next-app/src/components/hobt/HobtTestimonials.tsx
type HobtTestimonial = {
  readonly quote: string | null;
  readonly author: string | null;
  readonly role: string | null;
};

export function HobtTestimonials({
  heading,
  testimonials,
}: {
  readonly heading: string;
  readonly testimonials: readonly (HobtTestimonial | null)[] | null;
}) {
  // A testimonial with no quote is not a testimonial, so the filter drops rows
  // on a sub-field as well as on the row itself. Not every section can do that
  // — HobtModules keeps a row with only a title — and deciding which sub-field
  // is load-bearing is the section's own business.
  const rows = (testimonials ?? []).filter(
    (t): t is HobtTestimonial => t !== null && t.quote !== null && t.quote !== ''
  );

  if (rows.length === 0) {
    return (
      <section aria-labelledby="hobt-testimonials-heading" className="border-t border-border py-12">
        <h2 id="hobt-testimonials-heading" className="text-2xl font-semibold tracking-tight">
          {heading}
        </h2>
        <p className="mt-4 text-sm text-muted-foreground">No testimonials yet.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="hobt-testimonials-heading" className="border-t border-border py-12">
      <h2 id="hobt-testimonials-heading" className="text-2xl font-semibold tracking-tight">
        {heading}
      </h2>

      <ul className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        {rows.map((t, i) => (
          <li key={`${t.author ?? 'anon'}-${i}`}>
            {/* <blockquote> + <figcaption> inside a <figure> is the semantic
                pairing for "a quote and who said it". A <div> would need ARIA
                to say the same thing — Lesson 11.4 Key Concept 1. */}
            <figure className="rounded-lg border border-border bg-card p-6">
              <blockquote className="text-sm leading-relaxed">{t.quote}</blockquote>
              {t.author !== null && t.author !== '' ? (
                <figcaption className="mt-4 text-sm font-medium">
                  {t.author}
                  {t.role !== null && t.role !== '' ? (
                    <span className="font-normal text-muted-foreground"> — {t.role}</span>
                  ) : null}
                </figcaption>
              ) : null}
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

### Step 5: Write the CTA band — reusable, and inert

```tsx
// next-app/src/components/hobt/HobtCtaBand.tsx
import { Button } from '@/components/ui/button';

export function HobtCtaBand({
  idPrefix,
  heading,
  blurb,
  startNowUrl,
  demoBookingUrl,
}: {
  // An identity, not a place. The component renders identically whichever
  // value it gets — Key Concept 2.
  readonly idPrefix: string;
  readonly heading: string;
  readonly blurb: string | null;
  readonly startNowUrl: string | null;
  readonly demoBookingUrl: string | null;
}) {
  const noteId = `${idPrefix}-demo-note`;

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <p className="text-lg font-semibold tracking-tight">{heading}</p>
      {blurb !== null && blurb !== '' ? (
        <p className="mt-2 text-sm text-muted-foreground">{blurb}</p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {/* START NOW — a real link when the URL exists. asChild so this renders
            ONE <a>, not an anchor inside a button (Lesson 11.2 Key Concept 7).
            Plain <a href>, not next/link: the target is off-site. */}
        {startNowUrl !== null && startNowUrl !== '' ? (
          <Button asChild variant="blame" size="xl">
            <a href={startNowUrl} rel="noopener noreferrer">
              Start Now
            </a>
          </Button>
        ) : null}

        {/* GET DEMO — deliberately inert. No <form>, no onClick, no fetch.
            `aria-disabled` rather than `disabled`: a disabled control leaves the
            tab order, so a keyboard user would never reach the button OR the
            sentence explaining it. Lesson 11.4 Key Concept 1. */}
        {demoBookingUrl !== null && demoBookingUrl !== '' ? (
          <Button variant="outline" size="xl" aria-disabled="true" aria-describedby={noteId}>
            Get Demo
          </Button>
        ) : null}
      </div>

      {demoBookingUrl !== null && demoBookingUrl !== '' ? (
        // VISIBLE, not just announced. A control that does nothing needs a
        // reason a sighted mouse user can also read.
        <p id={noteId} className="mt-3 text-xs text-muted-foreground">
          Demo booking opens in Module 16, once the lead form is validated and rate limited.
        </p>
      ) : null}
    </div>
  );
}
```

### Step 6: Compose the route

```tsx
// next-app/src/app/[locale]/hobt/page.tsx
import { notFound } from 'next/navigation';

import { HobtCtaBand } from '@/components/hobt/HobtCtaBand';
import { HobtHero } from '@/components/hobt/HobtHero';
import { HobtModules } from '@/components/hobt/HobtModules';
import { HobtTestimonials } from '@/components/hobt/HobtTestimonials';
import { HobtPromoDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { pageTag } from '@/lib/graphql/tags';

// The ROUTE-SEGMENT cache: how long the rendered page may be reused. 60s because
// `seatsLeft` drives a live badge — Lesson 10.3's policy table. Everything else
// in the app is 3600.
export const revalidate = 60;

// From Step 1, read out of WordPress rather than assumed.
const HOBT_URI = '/hobt/';

export default async function HobtPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  // Next 16: params is a Promise.
  const { locale } = await params;

  const data = await fetchGraphQL(
    HobtPromoDocument,
    { uri: HOBT_URI },
    // The DATA cache: how long the GraphQL response may be reused. Matching the
    // segment value keeps the two honest — a long fetch cache under a short page
    // cache re-renders from stale data and looks like the page cache failing.
    { revalidate: 60, tags: [pageTag('hobt')] }
  );

  const promo = data.page?.hobtPromo;

  // Two different failures, one response. No page at that URI, or a page whose
  // field group was never saved — neither can render, and a 404 is honest.
  // Lesson 10.4's not-found.tsx renders it.
  if (data.page == null || promo == null) notFound();

  return (
    <>
      <HobtHero
        locale={locale}
        headline={promo.headline}
        subheadline={promo.subheadline}
        priceUsd={promo.priceUsd}
        seatsLeft={promo.seatsLeft}
      >
        {/* HobtCtaBand, instance one — inside the hero, via `children`. */}
        <HobtCtaBand
          idPrefix="hero"
          heading="Stop blaming DNS. Start shipping."
          blurb={null}
          startNowUrl={promo.startNowUrl}
          demoBookingUrl={promo.demoBookingUrl}
        />
      </HobtHero>

      {/* SECTION ORDER IS HARD-CODED HERE, and that is the debt. Moving
          HobtTestimonials above HobtModules is a code change and a deploy.
          Lesson 14.4 replaces this list with a BlockRenderer over
          `editorBlocks`, and then marketing reorders it in Gutenberg. */}
      <HobtModules heading="What you will learn" modules={promo.modules} />

      <HobtTestimonials heading="What graduates say" testimonials={promo.testimonials} />

      <section aria-labelledby="hobt-closing-heading" className="border-t border-border py-12">
        <h2 id="hobt-closing-heading" className="sr-only">
          Get started
        </h2>
        {/* HobtCtaBand, instance two — same component, different props, no
            positional flag anywhere. That is Key Concept 2, proved. */}
        <HobtCtaBand
          idPrefix="closing"
          heading="Ready to omit blaming tech?"
          blurb="Nine modules. One incident-free quarter. Probably."
          startNowUrl={promo.startNowUrl}
          demoBookingUrl={promo.demoBookingUrl}
        />
      </section>
    </>
  );
}
```

**Verify §6:**

- [ ] `http://localhost:3000/en/hobt` returns `200` and shows the headline from
      the `hobtPromo` field group, not a hard-coded string.
- [ ] There is exactly one `<h1>`, and it is the headline.
- [ ] Both CTA bands render. Their `aria-describedby` values differ (`hero-demo-note` and
      `closing-demo-note`) — if they are identical, `idPrefix` is not being used.

### Step 7: Record the two new `aria-*` attributes, and what is still owed

`docs/accessibility.md` from Lesson 11.4 has a rule: every lesson that adds an `aria-*`
attribute adds a row. This lesson added two.

```markdown
<!-- docs/accessibility.md — append to the "Every aria-* in src/, and why" table -->
| `aria-disabled="true"` | `hobt/HobtCtaBand.tsx` | keeps the inert "Get Demo" focusable and announced as unavailable; `disabled` would remove it from the tab order along with the sentence explaining it | no — `disabled` has the wrong behaviour here, deliberately |
| `aria-describedby` | `hobt/HobtCtaBand.tsx` | ties the inert CTA to its visible explanation | no |
| `aria-labelledby` on `<section>` | the four `hobt/` sections | a `<section>` with no accessible name is not a landmark at all | no |
```

And the closing note. Write it into the same file as a "known gaps" addition, because the point
of naming a debt is that someone can find it later:

```markdown
<!-- docs/accessibility.md — append to "Known gaps, owned by a later module" -->
| `/hobt` body order is hard-coded in `page.tsx`; editors cannot reorder it | Module 14 (Lesson 14.4) |
| Both `/hobt` CTAs are inert; no lead capture exists | Module 16 (Lessons 16.1–16.3) |
```

Exactly what changes later, so there is no ambiguity when you get there:

| Module 14 changes | Module 16 changes |
|---|---|
| `page.tsx` stops naming the BODY sections; `BlockRenderer` walks `editorBlocks` | "Get Demo" opens a `Dialog` with a validated form |
| `HobtCtaBand` gains a registry entry via the `btt/hobt-cta` block; `HobtHero`, `HobtModules` and `HobtTestimonials` stay page-mounted, because `priceUsd`, `seatsLeft` and the two repeaters are field-group data with no block representation | `aria-disabled` and the explanatory sentence are deleted |
| `heroImage` and testimonial avatars start rendering, via `next/image` | `src/actions/leads.ts` writes to `wp_btt_leads` |
| The `hobtPromo` field group becomes one source among several | `revalidateTag(pageTag('hobt'))` fires after a successful submit |

Nothing in the section components themselves needs to change for either. That is what Key
Concept 2 bought.

> **Write the debt down where the next person will trip over it.** The comment above the
> section list in `page.tsx` is not decoration — it is the only place a reader of that file
> learns that the order is a deliberate constraint rather than an oversight. A hard-coded
> layout with a comment naming its replacement is a decision; the same layout without the
> comment is a bug that nobody has noticed yet.

---

## Verification

```bash
cd next-app

# 1. The route answers
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/hobt
# Expected: 200

# 2. The content is the editor's, from the hobtPromo field group
curl -s http://localhost:3000/en/hobt | grep -o '<h1[^>]*>[^<]*' | head -1
# Expected: the `headline` value from ACF, not "How To Omit Blaming Tech"
#           (which is the fallback for a null headline)

# 3. Exactly one <h1>
curl -s http://localhost:3000/en/hobt | grep -o '<h1' | wc -l
# Expected: 1

# 4. The seats badge and the price are both present
# React's SSR output is not pretty-printed, so `grep -c` (which counts LINES)
# would report 1 no matter how many times a string appears. Count OCCURRENCES.
curl -s http://localhost:3000/en/hobt | grep -o 'seats left' | wc -l
# Expected: 1
curl -s http://localhost:3000/en/hobt | grep -oE '\$[0-9,]+'| head -1
# Expected: the priceUsd value, currency-formatted — e.g. $1,499

# 5. THE MOST IMPORTANT CHECK IN THE LESSON. No form ships from this route.
curl -s http://localhost:3000/en/hobt | grep -o '<form' | wc -l
# Expected: 0

# 6. NEGATIVE — and no client-side handler smuggled one in either
grep -rn 'onClick\|onSubmit\|<form' src/components/hobt/
# Expected: no output

# 7. NEGATIVE — no section component knows where it sits
grep -rn 'isFirst\|isLast\|index=\|variant="dark"' src/components/hobt/
# Expected: no output

# 8. The CTA band really is used twice, with distinct ids
curl -s http://localhost:3000/en/hobt | grep -o 'demo-note' | wc -l
# Expected: 4  — two aria-describedby attributes and two matching id attributes
curl -s http://localhost:3000/en/hobt | grep -o 'aria-describedby="[a-z-]*"' | sort -u
# Expected: aria-describedby="closing-demo-note"
#           aria-describedby="hero-demo-note"

# 9. The inert control is announced as unavailable, not removed from the tab order
curl -s http://localhost:3000/en/hobt | grep -o 'aria-disabled="true"' | wc -l
# Expected: 2 — one per CTA band
curl -s http://localhost:3000/en/hobt | grep -o '<button disabled' | wc -l
# Expected: 0 — `disabled` would take the button out of the tab order

# 10. Types, lint, and the build's rendering strategy for this route
npm run type-check
# Expected: no errors
npm run lint
# Expected: no errors
npm run build | grep -E 'Route \(app\)|Revalidate|hobt'
# Expected: a row for /[locale]/hobt with a revalidate of 1m (60 seconds)

# 11. NEGATIVE — zero seats renders "0 seats left", not a bare 0 and not nothing.
#     `seats_left` is the ACF field name from appendix 03 §4.4, and ACF stores it
#     under exactly that meta key.
cd ../wordpress-headless
HOBT_ID=$(docker compose run --rm wpcli wp post list --post_type=page \
  --name=hobt --field=ID | tr -d '\r')
docker compose run --rm wpcli wp post meta get "$HOBT_ID" seats_left
# Expected: the current value — write it down, you are restoring it below
docker compose run --rm wpcli wp post meta update "$HOBT_ID" seats_left 0
docker compose run --rm wpcli wp post meta get "$HOBT_ID" seats_left
# Expected: 0

# Wait out the 60-second revalidate window, then look again
cd ../next-app
curl -s http://localhost:3000/en/hobt | grep -o '0 seats left'
# Expected: 0 seats left
curl -s http://localhost:3000/en/hobt | grep -o '>0<' | wc -l
# Expected: 0 — a bare zero rendered on its own means `&&` crept back in

# 12. NEGATIVE — an empty repeater renders the empty state, not a broken grid.
#     An ACF repeater stores its ROW COUNT in the parent meta key, so setting it
#     to 0 is how you empty one from the command line.
cd ../wordpress-headless
docker compose run --rm wpcli wp post meta get "$HOBT_ID" testimonials
# Expected: the row count — write it down
docker compose run --rm wpcli wp post meta update "$HOBT_ID" testimonials 0
cd ../next-app
curl -s http://localhost:3000/en/hobt | grep -o 'No testimonials yet' | wc -l
# Expected: 1
curl -s http://localhost:3000/en/hobt | grep -o 'What graduates say' | wc -l
# Expected: 1 — the heading survives; only the grid is replaced

# 13. Restore both values so Module 12's fixtures stay deterministic
cd ../wordpress-headless
# Use the two numbers you wrote down in checks 11 and 12.
docker compose run --rm wpcli wp post meta update "$HOBT_ID" seats_left <original>
docker compose run --rm wpcli wp post meta update "$HOBT_ID" testimonials <original>

# 14. NEGATIVE — notFound() is reachable. Point the document at a URI no page
#     owns and the route must 404, not render an empty shell.
cd ../next-app
sed -i.bak "s|const HOBT_URI = '/hobt/';|const HOBT_URI = '/no-such-page/';|" \
  'src/app/[locale]/hobt/page.tsx'
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/hobt
# Expected: 404 — `data.page` came back null and notFound() fired
mv 'src/app/[locale]/hobt/page.tsx.bak' 'src/app/[locale]/hobt/page.tsx'
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/hobt
# Expected: 200
```

## Control Questions

1. `{typeof seatsLeft === 'number' ? … : null}` rather than `{seatsLeft && …}` or
   `{seatsLeft ? … : null}`. Describe what each of the three renders when `seatsLeft` is `0` and
   when it is `null`, and say which one is a commercial bug rather than a cosmetic one.
2. `HobtCtaBand` takes `idPrefix` and the page passes `"hero"` and `"closing"`. Argue that this
   is not a positional prop, and name the React API you would have used instead if the component
   were a Client Component.
3. "Get Demo" uses `aria-disabled="true"` rather than the `disabled` attribute. State what
   `disabled` would remove, and explain why that makes the visible explanation next to the button
   useless to the user who most needs it.
4. `page.tsx` sets `export const revalidate = 60` **and** passes `revalidate: 60` to
   `fetchGraphQL`. Explain what each one caches, and predict the symptom if the fetch value were
   `3600` and the segment value stayed `60`.
5. `/hobt` is described as less editable than an ACF flexible-content page template would have
   been. Name the one editorial operation that is worse, say which lesson restores it, and
   explain why building the hard-coded version first is a pedagogical choice rather than a
   shortcut.

## Learn More

- [React: passing props to a component](https://react.dev/learn/passing-props-to-a-component) —
  `children` and slot props, which is the whole of Key Concept 1
- [React: conditional rendering](https://react.dev/learn/conditional-rendering#logical-and-operator-)
  — React's own warning about `&&` and falsy left operands, which is Key Concept 4
- [Next.js: `revalidate`](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config#revalidate)
  — the route-segment option, and how it interacts with per-`fetch` caching
- [Next.js: `notFound`](https://nextjs.org/docs/app/api-reference/functions/not-found) — what it
  throws, and which boundary catches it
- [WPGraphQL: `nodeByUri` and URI lookups](https://www.wpgraphql.com/docs/wpgraphql-vs-wp-rest-api)
  — why `idType: URI` is fussy about trailing slashes
- [ACF: repeater field](https://www.advancedcustomfields.com/resources/repeater/) — the row-count
  meta key that check 12 sets to zero, and why sub-fields are independently empty
- [MDN: `<figure>` and `<figcaption>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/figure)
  — the semantic pairing `HobtTestimonials` uses instead of ARIA
- [MDN: `Intl.NumberFormat`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat)
  — the currency formatting that makes `locale` load-bearing in Module 20
- [WAI-ARIA: `aria-disabled`](https://www.w3.org/TR/wai-aria-1.2/#aria-disabled) — the exact
  difference from the HTML `disabled` attribute
