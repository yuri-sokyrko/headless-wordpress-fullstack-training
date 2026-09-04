---
title: 'Fetching WordPress Data in a Server Component'
module: 9
lesson: 3
teaches: [async-server-components, server-side-fetch, hand-written-response-types, type-drift, html-blob-rendering]
produces: ['next-app/src/types/graphql-responses.ts', 'next-app/src/app/[locale]/incidents/page.tsx', 'next-app/src/app/[locale]/incidents/[slug]/page.tsx']
requires: [9.2, 5.5]
---

# Lesson 09.3 — Fetching WordPress Data in a Server Component

## Quick Overview

This is the lesson where the fixtures go away and Blame The Tech starts showing real content.
A Server Component can be declared `async` and `await` anything, so fetching WordPress data is
a `fetch` call to `POST /graphql` written directly inside the component that renders the
result. No `useEffect`, no loading flag, no client-side request, no CORS. The browser receives
finished HTML and never learns that a GraphQL endpoint was involved.

The second half of this lesson is deliberately built to fail. To hand a fetch result to
TypeScript you need a type for it, and you do not have codegen yet — so you will **hand-write
the response types by reading the GraphiQL result panel**, twice: once for the incidents list
and once for a single incident by slug. Then you will get one of them subtly wrong, exactly the
way everyone gets it wrong in production, and watch `npm run type-check` pass on a type that
does not match the schema. TypeScript will happily compile a lie, because a hand-written
interface is an assertion about data you did not check. Do not fix it by hand. Lesson 10.2
deletes every one of these types in a single commit, and this lesson is the argument for why
that commit is worth its churn.

By the end of this lesson you will have:

- `next-app/src/types/graphql-responses.ts` — two hand-written response types, `IncidentsQueryResponse` and `IncidentBySlugQueryResponse`
- `next-app/src/app/[locale]/incidents/page.tsx` — the list route on live WPGraphQL data
- `next-app/src/app/[locale]/incidents/[slug]/page.tsx` — one incident, with its body rendered as an HTML blob from `content`
- A route that typechecks clean and crashes at runtime, because `downtimeMinutes` is nullable in the schema and not in your type
- A written note listing every hand-written type in the repo, for Lesson 10.2 to delete

## Classic WP Analogy

You are writing the same code you have always written, one layer further out:

```
single-incident.php                        src/app/[locale]/incidents/[slug]/page.tsx
──────────────────────────────────────     ──────────────────────────────────────────
$q = new WP_Query([                        const data = await fetch(endpoint, {
  'post_type' => 'incident',                 method: 'POST',
  'name'      => get_query_var('name'),      body: JSON.stringify({ query, variables }),
]);                                        }).then(r => r.json());

if (!$q->have_posts()) { get_404(); }      if (!data.incident) notFound();
$q->the_post();
the_title();                               <h1>{incident.title}</h1>
the_content();                             <div dangerouslySetInnerHTML={{ __html:
                                              incident.content ?? '' }} />
```

The shape is identical: read the slug from the URL, ask the data layer for one record, 404 if
there is nothing, render the fields. `the_content()` and `dangerouslySetInnerHTML` are even
doing the same job — dumping stored post HTML into the page — and both are the reason your
front end currently has no idea what a block is.

The analogy breaks on **who checks the data**. `WP_Query` returns `WP_Post` objects that
WordPress constructed and guarantees; if a field is missing you get `null` and PHP tells you
at the point of use. A GraphQL response is untyped JSON, and the type you write over it is a
promise you are making to the compiler, not a check the compiler performs. Get the promise
wrong — say a nullable `Float` as `number` — and TypeScript will confidently let you call
`.toFixed(0)` on `null`, and the page will 500 in production for exactly the incidents where
an editor left the field blank. This is the specific failure that makes codegen worth a whole
lesson in Module 10: generated types are derived from the committed schema, so they cannot
disagree with it.

The second break is the one to keep in mind for the next five modules: **`the_content()` is a
dead end in a headless build.** In Classic WordPress it is fine, because the theme's CSS was
written for the classes WordPress emits and the links are ordinary server-rendered anchors.
Here that blob arrives with `wp-block-*` classes Tailwind has never compiled, raw `<a>` tags
that skip client-side navigation, and `<img>` tags that skip image optimisation. You are going
to render it that way for five modules anyway, because the fix only makes sense once you have
felt the problem. Module 14 removes it.

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
