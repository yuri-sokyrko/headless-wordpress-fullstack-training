---
title: 'Structured Data & Rich Results'
module: 19
lesson: 3
teaches: [json-ld, schema-org, rich-results, breadcrumb-list, review-schema, faq-page]
produces: ['next-app/src/lib/seo/jsonLd.ts']
requires: [19.2, 14.2]
---

# Lesson 19.3 — Structured Data & Rich Results

## Quick Overview

Structured data is the one part of SEO that is genuinely a data-modelling exercise, which is
why it belongs in a course about content models. You are not writing marketing copy; you are
publishing a machine-readable claim about what a page *is*. Blame The Tech has four page types
that map cleanly onto schema.org vocabulary: a blog post is an `Article`, a tech review is a
`Review` with a `Rating` (the ratings in `techReviewFields` were designed for this from
Module 04), the HOBT landing page has a genuine `FAQPage`, and every page sits somewhere in a
`BreadcrumbList`. The site itself is an `Organization`. Five types, all built from data you
already fetch for rendering.

This lesson builds typed builders — one function per schema type, each taking the same
codegen'd data the page component takes and returning a plain object — and renders them as a
single `<script type="application/ld+json">`. Two disciplines matter more than the syntax.
First, **never emit a node you cannot fully populate**: a `Review` without a `reviewRating`, or
an `Article` with a placeholder `author`, is worse than no markup, because Google treats
mismatched structured data as a quality signal against you. Second, **avoid schema spam** —
marking a testimonial block up as `Review` to farm stars is a manual-action risk, and the
satirical ratings on `/reviews` are opinions about companies, which is exactly what `Review`
is *for* and exactly why the `itemReviewed` type must be honest.

By the end of this lesson you will have:

- `src/lib/seo/jsonLd.ts` — typed builders for `Article`, `Review`, `BreadcrumbList`,
  `Organization` and `FAQPage`, each with a "return `null` if incomplete" guard
- A single `<JsonLd>` render path, so one page never emits two competing `@graph` blocks
- `Organization` emitted once from the root layout, with `sameAs` from `siteSettings.socialLinks`
- `Review` on `/reviews/[slug]` built from `techReviewFields`, with `itemReviewed` as a
  `SoftwareApplication` or `Organization` — decided, not guessed
- `FAQPage` on `/hobt`, sourced from an editor-composed block rather than a hard-coded array
- A Rich Results test pass for one URL of each type, with the report saved next to the lesson notes

## Classic WP Analogy

In Classic WordPress you almost never wrote JSON-LD by hand. Yoast built a `@graph` for you —
`WebSite`, `WebPage`, `Organization`, `Person`, `BreadcrumbList`, all wired together with
`@id` references — and you extended it, if at all, through the
`wpseo_schema_graph_pieces` filter or by registering a piece class. It was powerful and almost
completely opaque: you got correct output and no understanding of it.

`wp-graphql-yoast-seo` does expose that graph as `seo.schema.raw`, a JSON string, and it is
tempting to fetch it and dump it into a script tag. **Don't**, and this is the decision the
lesson turns on. Yoast's graph is built for the URL WordPress thinks the page lives at, which
is `localhost:8080` or your Fly.io hostname — not your public site. Every `@id`, every `url`,
every breadcrumb item points at the wrong origin. You would have to string-replace hostnames
inside a JSON blob you did not build, on every request, forever. Building the graph yourself
from typed data is more code and enormously less risk.

So this is the place where the analogy stops being a bridge and becomes a warning: **the
Classic answer was "let the plugin do it", and the headless answer is "you own this now".**
That is a real cost — a few hundred lines you did not have before — and the compensation is
that structured data stops being magic. You will be able to answer "why does this page claim
to be an `Article` written by nobody?" by reading one function.

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
