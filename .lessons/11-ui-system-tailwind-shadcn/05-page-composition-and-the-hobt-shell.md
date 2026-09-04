---
title: 'Page Composition & the HOBT Shell'
module: 11
lesson: 5
teaches: [component-composition, children-prop, acf-driven-sections, inert-cta, landing-page-layout]
produces: ['next-app/src/app/[locale]/hobt/page.tsx', 'next-app/src/components/hobt/HobtHero.tsx', 'next-app/src/components/hobt/HobtModules.tsx', 'next-app/src/components/hobt/HobtTestimonials.tsx', 'next-app/src/components/hobt/HobtCtaBand.tsx']
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
