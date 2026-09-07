---
title: 'Organising Queries & Fragments'
module: 10
lesson: 5
teaches: [graphql-documents, graphql-fragments, fragment-colocation, one-query-per-route, overfetching]
produces: ['next-app/src/graphql/fragments/IncidentCardFields.graphql', 'next-app/src/graphql/fragments/IncidentDetailFields.graphql', 'next-app/src/graphql/fragments/MediaFields.graphql', 'next-app/src/graphql/fragments/PostCardFields.graphql', 'next-app/src/graphql/fragments/TechReviewCardFields.graphql', 'next-app/src/graphql/incidents.graphql', 'next-app/src/graphql/posts.graphql', 'next-app/src/graphql/reviews.graphql', 'next-app/src/graphql/scapegoats.graphql', 'next-app/src/graphql/siteSettings.graphql']
requires: [10.2]
---

# Lesson 10.5 — Organising Queries & Fragments

## Quick Overview

By now the app has a dozen GraphQL documents, several of which select the same eight incident
fields with small variations, and at least one of which selects fields nobody renders. This
lesson restructures `src/graphql/` around two rules: **one query document per route**, and
**one fragment per component that needs data**. A fragment names a set of fields on a specific
type, so `IncidentCardFields` lives next to the query that uses it, gets composed into the list
query and the detail query alike, and gives codegen a type whose name matches the component
that consumes it.

This is the lesson that makes overfetching visible. A GraphQL query is a bill you present to
WordPress, and every field on it costs a resolver call — sometimes a `get_post_meta()`,
sometimes an ACF field lookup, occasionally an N+1 that Module 06's DataLoader work is holding
back. You will read the WPGraphQL query log for one page, find the fields nobody renders, and
delete them. Doing that once, deliberately, is worth more than any amount of caching, and it is
the habit Module 21 assumes you have when it measures Core Web Vitals.

By the end of this lesson you will have:

- `next-app/src/graphql/fragments/IncidentCardFields.graphql` and sibling fragments, one per data-consuming component
- One document per route in `next-app/src/graphql/`, each named for its operation
- `siteSettings.graphql` fetched once in the root layout and memoized, not re-fetched per page
- At least three unused fields deleted, with the before-and-after resolver count recorded
- A naming convention written down: operation names, fragment names, and the file each lives in

## Classic WP Analogy

Fragments are template parts that declare their own data requirements. That sentence is the
whole analogy, and it is worth unpacking, because the second half is the part WordPress cannot
do:

| Classic WordPress | GraphQL |
|---|---|
| `template-parts/card-incident.php` | `fragment IncidentCardFields on Incident { … }` |
| `get_template_part('template-parts/card','incident')` | `...IncidentCardFields` spread into a query |
| One `WP_Query` per template, hand-tuned per archive | one operation document per route |
| `'fields' => 'ids'` to avoid hydrating full posts | selecting only the fields you render |
| `update_post_meta_cache()` priming meta for a loop | a fragment ensuring one query fetches everything the component needs |
| A central `class BTT_Queries` holding your query args | `src/graphql/` holding your documents |

If you have ever built an archive template, watched Query Monitor report six hundred queries,
and fixed it by priming the meta cache, you already have the instinct this lesson formalises:
**decide what data a page needs in one place, then render.** The reason WordPress archives go
wrong is that template parts fetch their own data lazily, one `get_post_meta()` at a time, deep
inside the loop. A fragment cannot do that. It declares its fields, they get composed into the
one query the route fires, and the component receives them as props.

The analogy breaks in the direction you want it to. A template part can silently depend on
`global $post`, on a meta field nobody documented, or on a filter another plugin added — which
is why moving a template part into a different context breaks it in ways that are hard to
diagnose. A fragment is typed and bound to a GraphQL type: `IncidentCardFields on Incident`
cannot be spread into a `Post` selection, and the component that consumes it receives a type
generated from exactly the fields the fragment requested. Read a field the fragment did not
ask for and it is a compile error, not a `null` at runtime. That property is worth stating
plainly, because it is the whole reason fragments beat "one big query file": the data contract
lives next to the component that depends on it, and the compiler enforces it.

The remaining break is a cost, honestly stated: fragments make it very easy to build a query
that is correct, typed, and enormous. Nothing about the mechanism stops you spreading eleven
fragments into one document and asking WordPress for four hundred fields. Codegen will type all
of them, TypeScript will be perfectly happy, and the page will take two seconds. The compiler
checks that you *can* read a field, never that you *should have asked for it*.

---

## Key Concepts

### 1. A fragment is a named field set on a specific type

Three words carry the weight: **named**, **field set**, **on a type**.

```graphql
# (illustration) — the type binding is the half people forget
fragment IncidentCardFields on Incident {
  id
  title
  slug
}
```

`on Incident` is not documentation. It is a constraint the server enforces at validation time
and codegen enforces at compile time. Spread `IncidentCardFields` into a selection on `Post` and
the whole document fails validation — not that field, the **document**, including the operations
that were fine. Verification check 7 makes you see that error.

| Property | Consequence |
|---|---|
| Named | one definition, many spread sites, one edit |
| A field set | it is not a value, a filter, or a variable — only fields |
| Bound to a type | it cannot be spread where it does not apply |
| Deduplicated at execution | spreading the same fragment twice costs nothing |
| Flattened in the response | `{ ...IncidentCardFields }` returns a plain object, not a nested one |

That last row is worth stating because it surprises people once: a fragment is a **source-level**
abstraction. The response JSON contains the fields, at the level you spread them, with no trace
that a fragment was involved. Nothing about the wire format changes.

### 2. Fragment colocation, and the type that is named after it

The rule: **the fragment lives next to the component that consumes it, and the generated type is
the component's props type.**

```
   src/graphql/fragments/IncidentCardFields.graphql
        │  fragment IncidentCardFields on Incident { … }
        │
        ├──▶ npm run codegen  ──▶  src/gql/graphql.ts
        │                            export type IncidentCardFieldsFragment = { … }
        │
        └──▶ src/components/incidents/IncidentCard.tsx
                 { readonly incident: IncidentCardFieldsFragment }
```

Follow what that buys, because it is more than tidiness. The component declares the fields it
needs, in one place. Codegen turns that declaration into a type. The component's props are that
type. So:

- Read a field the fragment did not request and it is a **compile error**, not a runtime `null`.
- Add a field to the card's markup and the compiler tells you to add it to the fragment.
- Delete a field from the fragment and the compiler lists every place that read it.
- The route document does not have to know what the card needs — it spreads the fragment.

That last point is the structural one. Without fragments, adding a field to the card means
editing the card **and** every query that feeds a card, and forgetting one gives you a card that
renders `undefined` on exactly one route.

| Classic WordPress template part | GraphQL fragment |
|---|---|
| Declares its markup | declares its markup **and its data** |
| Gets data from `global $post` and `get_post_meta()` | gets data from props, typed |
| Moving it to a new context may break it silently | moving it is a compile error or nothing |
| Data requirements are discovered by reading the body | data requirements are the fragment |

### 3. One document file per domain, named for the route that owns it

Six files, and the mapping is deliberate:

| File | Operations | Route |
|---|---|---|
| `incidents.graphql` | `IncidentsList`, `IncidentBySlug`, `HomepageFeeds` | `/[locale]/incidents`, `/[locale]/incidents/[slug]`, `/[locale]` |
| `posts.graphql` | `PostsList`, `PostBySlug` | `/[locale]/blog`, `/[locale]/blog/[slug]` |
| `reviews.graphql` | `ReviewsList`, `ReviewBySlug` | `/[locale]/reviews`, `/[locale]/reviews/[slug]` |
| `scapegoats.graphql` | `ScapegoatLeaderboard` | `/[locale]/scapegoats` |
| `siteSettings.graphql` | `SiteChrome` | the root layout |
| `menu.graphql` | `PrimaryMenu` | the header — **Lesson 11.3 writes this one** |

Two operations share a file when they are the same route's list and detail, because they share a
fragment and a field vocabulary and they change together. `HomepageFeeds` lives in
`incidents.graphql` for the same reason rather than earning a `home.graphql`: it selects nothing
but incidents, it spreads `IncidentCardFields`, and splitting it out would put one incident
field set in two files. When Lesson 11.5 and Module 14 give the homepage sections of its own,
that calculation changes and it earns a file.

The verdict, and the cost:

| | One document per route file | All documents in one file | Inline in each `.tsx` |
|---|---|---|---|
| `ls` gives you the query inventory | ✅ | ❌ | ❌ |
| A route change touches one file | ✅ | ❌ | ✅ |
| Fragment reuse is obvious | ✅ | ✅ | ❌ |
| Understanding a route needs one file | ❌ **two** | ❌ | ✅ |
| Verdict | ✅ | ❌ | ❌ |

The cost, stated plainly: you open two files to understand a route. That is the price of having
an auditable inventory of every field this front end asks WordPress for, and Key Concept 6 is
what you buy with it.

### 4. Fragment composition, and the depth budget it spends

`IncidentDetailFields` spreads `IncidentCardFields` and adds the fields only a detail page needs.
The detail page therefore cannot drift from the card: change the card's field set and the detail
query follows.

Now be precise about depth, because the folklore is wrong in both directions. Lesson 06.4
installed a depth limit of **10** for callers without `manage_options`, and:

- A fragment **spread does not add a depth level of its own.** The spread's selections are
  counted at the depth of the spread site, exactly as if you had typed them there.
- **Nesting adds depth**, wherever it is written. `incident { severities { nodes { name } } }`
  is four levels whether those levels live in the operation or in three chained fragments.

So a five-fragment chain is not automatically a depth violation — but a chain where each link
adds two levels of connection nesting reaches ten quickly, and the failure arrives as an HTTP
200 with an `errors` array (Lesson 10.4), from the server, in production, for a document that
compiled perfectly. Verification check 8 reproduces it.

```
   depth 1  incident
   depth 2    incidentDetails
   depth 2    severities
   depth 3      nodes
   depth 4        name          ← IncidentCardFields' deepest point
   depth 2    author
   depth 3      node
   depth 4        posts         ← the field this lesson DELETES
   depth 5          nodes
```

That is the practical argument for the third deletion in the overfetching audit: the `author`
edge was not just unused, it was four levels of the budget spent on a field the content model
explicitly denormalised into `reporterDisplayName` so you would not need it.

### 5. Fragment masking, revisited

Lesson 10.2 set `presetConfig: { fragmentMasking: false }` and promised to come back. Here is
what you turned off.

With masking **on**, a fragment's generated type is opaque — `FragmentType<typeof
IncidentCardFieldsFragmentDoc>` — and a component must call `getFragmentData()` to read it. The
component therefore *cannot* read a field its own fragment did not request, even if the parent
query happened to fetch it.

| | Masking off (this course) | Masking on |
|---|---|---|
| Component props | the plain generated object type | an opaque `FragmentType<…>` |
| Reading a field | `incident.title` | `getFragmentData(Doc, incident).title` |
| Reading a field the fragment did not request | compiles if the **parent** query fetched it | **impossible** |
| Learning curve | none beyond fragments themselves | an indirection before fragments are understood |
| Right for | a course, a small team, a codebase you can read | forty components and six people |

The property masking buys is real and it is not about typing: it stops a component developing an
undeclared dependency on a field some *other* part of the query happened to include. That
dependency then breaks the day someone optimises the other part — which is exactly Key Concept
6's deletion exercise, arriving as a bug instead of a compile error.

**Turn it on when** the codebase has more components than you can hold in your head, more than
one person editing queries, and at least one incident caused by a deleted field. Turn it on by
flipping one line in `codegen.ts`, regenerating, and fixing the compile errors, which is a
day of work and not a migration.

### 6. Overfetching made visible, and the compiler's honest limit

Every field on a query is a bill you present to WordPress.

| Field kind | What it costs on the WordPress side |
|---|---|
| `title`, `slug`, `date` | already in the `wp_posts` row the resolver loaded |
| `incidentDetails { … }` | ACF field lookups, i.e. `get_post_meta()` per field |
| `severities { nodes { … } }` | a term query per node — the N+1 Lesson 06.4 measured |
| `author { node { … } }` | a user lookup per node, plus whatever hangs off it |
| `blameScore` | a **computed** field: severity weight × confidence × downtime, resolved per node |
| `content` | the post body, which for a long incident dwarfs every other field in bytes |

None of that is visible from the TypeScript side, and this is the honest limit worth stating
plainly:

> **The compiler checks that you *can* read a field. It never checks that you *should have asked
> for it*.** A query with forty unused fields typechecks, generates clean types, passes lint,
> and takes two seconds. There is no tool in this stack that will tell you a field is
> unrendered — only reading the component and reading the query, together, will. That is why
> this lesson has an audit step rather than a linter.

The audit is a habit, not a one-off: after any restructuring, take one route, list the fields the
query asks for, list the fields the components render, and delete the difference. Module 21
assumes you have this habit when it starts measuring Core Web Vitals, because a 40 kB JSON
response is a slower page before any JavaScript runs.

**Be honest about the instrument, too.** WPGraphQL's Query Analyzer and the `extensions.debug`
array are genuinely useful and their output format is version-sensitive, so this course does not
build an assertion on either. What is reproducible is: the response **byte count** (exact and
deterministic), the **WordPress request count** from the Apache access log, and the **field
count** in your own document. Those three are enough to prove a deletion helped, and none of
them will change shape under you when a plugin updates.

### 7. The naming convention, written down

Generated names are derived mechanically, so your names decide what your types are called. Get
this consistent once and the generated code reads like something a human wrote.

| Thing | Convention | Example |
|---|---|---|
| Operation | `PascalCase`, no `Query` suffix — codegen adds one | `IncidentsList` |
| Fragment | `PascalCase` + `Fields` | `IncidentCardFields` |
| Route document file | `camelCase`, named for the domain the route owns | `incidents.graphql`, `siteSettings.graphql` |
| Fragment file | `PascalCase`, **exactly** the fragment name | `IncidentCardFields.graphql` |
| Generated result type | operation + `Query` | `IncidentsListQuery` |
| Generated variables type | operation + `QueryVariables` | `IncidentsListQueryVariables` |
| Generated document | operation + `Document` | `IncidentsListDocument` |
| Generated fragment type | fragment + `Fragment` | `IncidentCardFieldsFragment` |
| Generated fragment document | fragment + `FragmentDoc` | `IncidentCardFieldsFragmentDoc` |

Two rules that are not obvious and both cost time when broken. **A fragment file's name must
match its fragment**, because that is the only way `grep` finds the definition from a spread
site. And **operation names must be globally unique across every document**, not merely within a
file — codegen builds one namespace from all of them, so two `PostsList` operations in two files
is a generation error, not a scoping win.

### 8. `@include` and `@skip`, and why the course barely uses them

Lesson 05.3 introduced both. Two directives, both taking a `Boolean`, both evaluated before the
field resolves:

```graphql
# (illustration) — legal, and usually the wrong shape
query IncidentBySlug($slug: ID!, $withTrace: Boolean!) {
  incident(id: $slug, idType: SLUG) {
    incidentDetails {
      stackTrace @include(if: $withTrace)
    }
  }
}
```

Why this course uses them almost nowhere:

| Reason | Detail |
|---|---|
| A conditional field is usually two operations | if two callers want different fields, they want different queries, and two named documents read better than one with a mode flag |
| Codegen types it as nullable either way | `stackTrace` becomes `Maybe<string>` whether or not you passed `true`. You gained no type information |
| It splits your cache | `{ withTrace: true }` and `{ withTrace: false }` are different request bodies, so two cache entries for one page |
| It hides cost behind a boolean | the expensive branch is invisible at the call site |
| Where it *is* right | one field set, one route, a genuine runtime condition — Module 17's preview mode is the plausible case |

The verdict: **prefer two named operations over one parameterised one.** The exception is a
condition that genuinely varies per request within one route, and even then, name the variable
after the condition rather than after the field.

---

## Task

### Step 1: Split the fragment library into files

```bash
cd next-app
mkdir -p src/graphql/fragments
```

Five fragments, five files, each named for its fragment. These are the Lesson 05.3 definitions,
with the audit's deletions already applied — Step 6 measures what they were worth.

```graphql
# next-app/src/graphql/fragments/MediaFields.graphql
# width/height stay: Module 21 needs them for next/image and its CLS work.
fragment MediaFields on MediaItem {
  id
  altText
  sourceUrl
  mediaDetails {
    width
    height
  }
}
```

```graphql
# next-app/src/graphql/fragments/IncidentCardFields.graphql
# Consumed by src/components/incidents/IncidentCard.tsx. Its props type is
# IncidentCardFieldsFragment — add a field to the card, add it here.
fragment IncidentCardFields on Incident {
  id
  title
  slug
  date
  severities(first: 1) {
    nodes {
      name
      slug
    }
  }
  scapegoats(first: 1) {
    nodes {
      name
      slug
    }
  }
  incidentDetails {
    downtimeMinutes
    environment
  }
}
```

```graphql
# next-app/src/graphql/fragments/IncidentDetailFields.graphql
# Composition: spreads the card's field set, so the detail page cannot drift from it.
# `author { node { name } }` DELETED in this lesson — see the audit in Step 6.
fragment IncidentDetailFields on Incident {
  ...IncidentCardFields
  content
  incidentDetails {
    occurredAt
    estimatedCostUsd
    resolutionStatus
    blameConfidence
    stackTrace
    reporterDisplayName
    isVerified
  }
}
```

```graphql
# next-app/src/graphql/fragments/PostCardFields.graphql
fragment PostCardFields on Post {
  id
  title
  slug
  date
  excerpt
  featuredImage {
    node {
      ...MediaFields
    }
  }
}
```

```graphql
# next-app/src/graphql/fragments/TechReviewCardFields.graphql
fragment TechReviewCardFields on TechReview {
  id
  title
  slug
  featuredImage {
    node {
      ...MediaFields
    }
  }
  techReviewFields {
    companyName
    ratingOverall
    verdict
  }
}
```

> **A fragment may spread another fragment from a different file, and you write no import.**
> Codegen concatenates every document it found into one namespace before it validates — which
> is why operation and fragment names must be globally unique, and why a fragment on a type that
> does not exist yet fails the whole build rather than one file. That is also why Lesson 05.3
> told you to keep `SeoFields` commented out until Module 19 installs the plugin that defines
> `NodeWithSeo`.

### Step 2: Restructure the route documents

`incidents.graphql` is rewritten around the fragments. Note what disappears: the repeated field
set, `databaseId`, and `blameScore`.

```graphql
# next-app/src/graphql/incidents.graphql
# /[locale]/incidents, /[locale]/incidents/[slug], and the homepage feeds.
# Fields deleted in Lesson 10.5's audit: databaseId (nothing renders a WP integer id),
# blameScore (a computed field the card does not display).

query IncidentsList($first: Int!, $after: String, $search: String) {
  incidents(
    first: $first
    after: $after
    where: { status: PUBLISH, search: $search, orderby: { field: DATE, order: DESC } }
  ) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      ...IncidentCardFields
    }
  }
}

query IncidentBySlug($slug: ID!) {
  incident(id: $slug, idType: SLUG) {
    ...IncidentDetailFields
  }
}

# Aliases, so one request feeds two homepage sections. Lesson 05.3 Key Concept 6.
query HomepageFeeds($featuredCount: Int!, $recentCount: Int!) {
  catastrophic: incidents(
    first: $featuredCount
    where: { status: PUBLISH, taxQuery: { taxArray: [
      { taxonomy: SEVERITY, field: SLUG, terms: ["s1-catastrophic"] }
    ] } }
  ) {
    nodes {
      ...IncidentCardFields
    }
  }
  recent: incidents(first: $recentCount, where: { status: PUBLISH }) {
    nodes {
      ...IncidentCardFields
    }
  }
}
```

```graphql
# next-app/src/graphql/posts.graphql
# /[locale]/blog and /[locale]/blog/[slug]. `content` is still an HTML blob rendered
# with dangerouslySetInnerHTML — a NAMED, DATED debt taken on in Lesson 09.3 and paid
# off in Module 14, when WPGraphQL Content Blocks makes the body structured data.
query PostsList($first: Int!, $after: String) {
  posts(
    first: $first
    after: $after
    where: { status: PUBLISH, orderby: { field: DATE, order: DESC } }
  ) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      ...PostCardFields
    }
  }
}

query PostBySlug($slug: ID!) {
  post(id: $slug, idType: SLUG) {
    ...PostCardFields
    content
  }
}
```

```graphql
# next-app/src/graphql/reviews.graphql
# /[locale]/reviews and /[locale]/reviews/[slug]. `pros` and `cons` are ACF repeaters,
# so they arrive as object lists with an `item` field — not string arrays. Appendix 03.
query ReviewsList($first: Int!, $after: String) {
  techReviews(first: $first, after: $after, where: { status: PUBLISH }) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      ...TechReviewCardFields
    }
  }
}

query ReviewBySlug($slug: ID!) {
  techReview(id: $slug, idType: SLUG) {
    ...TechReviewCardFields
    content
    techReviewFields {
      ratingDx
      ratingDocs
      ratingIncidentResponse
      reviewedAt
      pros {
        item
      }
      cons {
        item
      }
    }
  }
}
```

```graphql
# next-app/src/graphql/scapegoats.graphql
# /[locale]/scapegoats. `count` is maintained by WordPress in wp_term_taxonomy, so the
# leaderboard is one indexed read rather than a grouped COUNT(*) — Lesson 05.4 proved it
# with EXPLAIN, and it is why `scapegoat` is a taxonomy and not a CPT.
query ScapegoatLeaderboard($first: Int!) {
  scapegoats(first: $first, where: { orderby: COUNT, order: DESC, hideEmpty: false }) {
    nodes {
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
}
```

**Verify §2:**

- [ ] No field set appears twice across `src/graphql/`. If it does, it wants to be a fragment.
- [ ] Every slug lookup is `id: $slug, idType: SLUG`. A bare `id:` returns `null` — Lesson 05.3.
- [ ] Operation names match the ones you have used since Lesson 05.2, exactly. Renaming one here
      renames a generated type and breaks a route.

### Step 3: Move the last inline documents out of the route files

Lesson 10.2 migrated the two incident routes and deliberately left the rest inline. **This is
the step that finishes that migration**, so after it no route file contains a GraphQL document
at all.

For each of `blog/page.tsx`, `blog/[slug]/page.tsx`, `reviews/page.tsx`,
`reviews/[slug]/page.tsx` and `scapegoats/page.tsx`:

1. Delete the `const …Document = untypedDocument<…>(\`…\`)` block. Its text now lives in
   Step 2's files.
2. Import the generated document instead: `import { PostsListDocument } from '@/gql/graphql';`
3. Delete the now-unused local response type and its import.

```tsx
// next-app/src/app/[locale]/blog/page.tsx — the imports, after the move
import { fetchGraphQL } from '@/lib/graphql/client';
import { listTag } from '@/lib/graphql/tags';
import { PostsListDocument } from '@/gql/graphql';

// …inside the component:
//   const data = await fetchGraphQL(
//     PostsListDocument,
//     { first: 10 },
//     { revalidate: 3600, tags: [listTag('post')] }
//   );
```

**Verify §3:**

- [ ] `grep -rnE '^\s*(query|fragment) [A-Z]' src/app/` returns **no output**. That single check
      is the strongest evidence in the lesson that the restructuring is complete.
- [ ] `grep -rn 'untypedDocument' src/` returns no output — the Lesson 10.1 escape hatch is gone
      from the codebase as well as from `client.ts`.

### Step 4: `siteSettings.graphql`, and the split from the menu

Lesson 05.4's scratch `SiteChrome` selected `generalSettings`, `siteSettings` **and**
`menuItems` in one document. It splits here, and only the first half is yours:

```graphql
# next-app/src/graphql/siteSettings.graphql
# Fetched once in the root layout and memoized, so every component that needs it may ask.
# The menuItems half of Lesson 05.4's SiteChrome moves to src/graphql/menu.graphql as
# `query PrimaryMenu` in Lesson 11.3 — see the note below for why they are two documents.
query SiteChrome {
  generalSettings {
    title
    description
  }
  siteSettings {
    siteTagline
    primaryCtaLabel
    primaryCtaUrl
    incidentSubmissionOpen
    footerBlurb
    socialLinks {
      network
      url
    }
  }
}
```

> **Two documents, because two documents means two cache tags.** One document would have made
> site settings and the primary menu a single cache entry, so an editor reordering the menu
> would expire the footer blurb and the CTA labels with it. Split, Module 18 can call
> `revalidateTag('menu:primary')` and leave `site-settings` alone. And the split costs nothing
> at runtime: request memoization (Lesson 10.3) means the layout and the header each asking once
> is still one WordPress request per document per render. Lesson 11.3 writes `menu.graphql` and
> says where it came from.

Wire it into the root layout, tagged `site-settings`:

```tsx
// next-app/src/app/[locale]/layout.tsx — the chrome fetch, added to the root layout
import { fetchGraphQL } from '@/lib/graphql/client';
import { siteTag } from '@/lib/graphql/tags';
import { SiteChromeDocument } from '@/gql/graphql';

// …inside the layout component:
//   const chrome = await fetchGraphQL(
//     SiteChromeDocument,
//     undefined,
//     { revalidate: 3600, tags: [siteTag()] }
//   );
```

`SiteChrome` takes no variables, which is why `fetchGraphQL`'s `variables` parameter is optional
and why `undefined` is passed positionally to reach the options argument.

**Verify §4:**

- [ ] `siteSettings` is not `null`. If it is, the ACF options page is missing `show_in_graphql` —
      see the content model contract, Site Settings.
- [ ] There is **no** `menuItems` selection in `siteSettings.graphql`.
- [ ] The layout renders the site title from `chrome.generalSettings?.title`, not from a literal.

### Step 5: Regenerate, and fix the types

```bash
npm run codegen
npm run type-check
```

The compile errors are the migration. The interesting one is `IncidentCard.tsx`: its props type
becomes the generated fragment type, and the prop **name** does not change, so no call site
moves.

```tsx
// next-app/src/components/incidents/IncidentCard.tsx — the props type, from the fragment
import type { IncidentCardFieldsFragment } from '@/gql/graphql';

export function IncidentCard({ incident }: { readonly incident: IncidentCardFieldsFragment }) {
  // One row of the <dl> no longer compiles: `incidentDetails.estimatedCostUsd`.
  //
  // Delete it. Lesson 08.2 put it there as a labelled debt and named this lesson as
  // where it comes out: the field moved into IncidentDetailFields in Step 3, because
  // an estimated cost is something you read on a detail page and not something you
  // scan a list for. The card's "No cost recorded" fallback goes with it.
  //
  // Everything else in this file is unchanged.
}
```

That single compile error is the whole argument for fragment colocation, so it is worth
saying out loud rather than just fixing. Between Lesson 08.2 and now, the card rendered a
field no fragment declared. Nothing caught it: `npm run type-check` was clean at every step,
because the *query* happened to select the field — Lesson 09.3 widened `IncidentsList` by hand
to satisfy a hand-written type, and nobody re-narrowed it. The field was fetched on every
incident in every list render for two modules, for one `<dd>`.

Binding the props type to a fragment is what makes that impossible to repeat. From here the
card's field set and the fragment's field set are the same object, so "the query fetches
something nothing renders" and "the component reads something the query never asked for" are
both compile errors rather than things you find by reading a log.

**Verify §5:**

- [ ] `npm run codegen` then `npm run codegen:check` are both silent.
- [ ] `grep -c 'IncidentCardFieldsFragment' src/gql/graphql.ts` is at least 1.
- [ ] `grep -c 'estimatedCostUsd' src/components/incidents/IncidentCard.tsx` is `0`. Lesson
      08.2's labelled debt is now paid.
- [ ] `npm run type-check` is silent.
- [ ] `src/gql/` shows changes in `git status`. Commit it separately, as Lesson 10.2 established.

### Step 6: The overfetching audit, measured

Three fields were deleted in Step 2. Now prove it was worth doing, with instruments that are
reproducible rather than pretty.

```bash
# The BEFORE query: the Lesson 10.2 field set, with databaseId, blameScore and the author
# edge. Ask WordPress directly, so nothing in Next is in the measurement.
read -r -d '' BEFORE <<'EOF'
{"query":"{ incidents(first:12,where:{status:PUBLISH}){ nodes{ id databaseId title slug date blameScore severities(first:1){nodes{name slug}} scapegoats(first:1){nodes{name slug}} incidentDetails{downtimeMinutes environment} author{node{name}} } } }"}
EOF

read -r -d '' AFTER <<'EOF'
{"query":"{ incidents(first:12,where:{status:PUBLISH}){ nodes{ id title slug date severities(first:1){nodes{name slug}} scapegoats(first:1){nodes{name slug}} incidentDetails{downtimeMinutes environment} } } }"}
EOF

measure() {
  for _ in 1 2 3; do
    curl -s -o /dev/null -w '%{size_download} bytes  %{time_total}s\n' \
      -X POST http://localhost:8080/graphql \
      -H 'Content-Type: application/json' -d "$1"
  done
}

echo "BEFORE:"; measure "$BEFORE"
echo "AFTER:";  measure "$AFTER"

# And the field count in your own document, which is exact
grep -cE '^\s+[a-z][A-Za-z]*$' src/graphql/incidents.graphql \
  src/graphql/fragments/IncidentCardFields.graphql
```

**Verify §6:**

- [ ] `size_download` is **smaller** for `AFTER`, by a stable number of bytes. This is the
      trustworthy measurement: it is exact, deterministic, and identical on every machine.
- [ ] `time_total` is *usually* smaller. Treat it as a hint, not a result — three runs on a
      laptop with Docker in the loop will disagree by more than the effect you are measuring.
      Take the minimum of the three, and only believe a difference you can reproduce.
- [ ] Write the three numbers down: bytes before, bytes after, fields removed. That is the
      before-and-after record, and Module 21 will want it as a baseline.
- [ ] Reflect once on the third deletion: `author { node { name } }` was four levels of the
      depth budget spent on data the content model had already denormalised into
      `reporterDisplayName`. Nothing in the type system was ever going to tell you that.

### Step 7: Write the convention down, then commit

Append Key Concept 7's table to `docs/api-contract.md` under a new
`## GraphQL naming conventions (Lesson 10.5)` heading, plus these three rules:

```markdown
- Operation and fragment names are a single global namespace. Two operations with the same
  name in two files is a codegen error, not a scoping win.
- A fragment file is named exactly for the fragment it contains, so a spread site can be
  traced with one `grep`.
- A field goes in a query when a component renders it, and comes out the moment one stops.
  The compiler will not tell you; the audit in Lesson 10.5 Step 6 is how you find out.
```

```bash
npm run verify
git add src/gql/
git commit -m "chore(next): regenerate codegen output for the fragment split"
git add -A
git commit -m "refactor(next): one document per route, fragments in their own files, three fields deleted"
```

---

## Verification

```bash
cd next-app

# 1. The document tree is exactly what it should be
ls src/graphql/
# Expected: fragments  incidents.graphql  posts.graphql  reviews.graphql
#           scapegoats.graphql  siteSettings.graphql
#           NOT menu.graphql — Lesson 11.3 writes that one
ls src/graphql/fragments/
# Expected: IncidentCardFields.graphql  IncidentDetailFields.graphql
#           MediaFields.graphql  PostCardFields.graphql  TechReviewCardFields.graphql

# 2. Every fragment file is named for its fragment
for f in src/graphql/fragments/*.graphql; do
  n=$(basename "$f" .graphql)
  grep -q "^fragment $n on " "$f" && echo "ok   $n" || echo "MISMATCH $n"
done
# Expected: five "ok" lines and no MISMATCH

# 3. Codegen is clean and the committed output is current
npm run codegen && npm run codegen:check
# Expected: no output from either
npm run type-check
# Expected: no output

# 4. The generated fragment types exist, named after the fragments
grep -c 'IncidentCardFieldsFragment\|IncidentDetailFieldsFragment\|MediaFieldsFragment' \
  src/gql/graphql.ts
# Expected: 3 or more

# 5. THE strongest single check — no document is left inline in a route file
grep -rnE '^\s*(query|fragment) [A-Z]' src/app/ ; echo "exit=$?"
# Expected: no matches, exit=1
grep -rn 'untypedDocument' src/ ; echo "exit=$?"
# Expected: no matches, exit=1

# 6. The audit's deletions are visible in the document, and in the response
grep -c 'databaseId\|blameScore' src/graphql/incidents.graphql
# Expected: 0
grep -c 'author' src/graphql/fragments/IncidentDetailFields.graphql
# Expected: 0
curl -s -o /dev/null -w 'after: %{size_download} bytes\n' -X POST \
  http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:12,where:{status:PUBLISH}){ nodes{ id title slug date severities(first:1){nodes{name slug}} scapegoats(first:1){nodes{name slug}} incidentDetails{downtimeMinutes environment} } } }"}'
# Expected: fewer bytes than the Step 6 BEFORE figure you wrote down

# 7. NEGATIVE — a fragment cannot be spread onto the wrong type.
#    Add the mistake, watch codegen refuse, revert.
cat > src/graphql/_wrong.graphql <<'EOF'
# next-app/src/graphql/_wrong.graphql — TEMPORARY. Reverted below.
query WrongSpread {
  posts(first: 1) {
    nodes {
      ...IncidentCardFields
    }
  }
}
EOF
npm run codegen 2>&1 | grep -c 'cannot be spread here\|can never be of type'
# Expected: 1 or more. Message shape:
#   Fragment "IncidentCardFields" cannot be spread here as objects of type
#   "Post" can never be of type "Incident".
rm src/graphql/_wrong.graphql
npm run codegen && npm run codegen:check
# Expected: no output — clean again

# 8. NEGATIVE — the depth limit is still the ceiling on fragment composition
curl -s -o /tmp/deep.json -w 'HTTP %{http_code}\n' -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:1){ nodes{ author{ node{ posts(first:1){ nodes{ author{ node{ posts(first:1){ nodes{ author{ node{ posts(first:1){ nodes{ author{ node{ posts(first:1){ nodes{ id } } } } } } } } } } } } } } } } } } }"}'
# Expected: HTTP 200 — a refusal delivered with a 200, as always
jq -r '.errors[0].message' /tmp/deep.json
# Expected: a message about query depth naming the limit 10

# 9. NEGATIVE — SiteChrome does not carry the menu
grep -c 'menuItems' src/graphql/siteSettings.graphql
# Expected: 0 — two documents, two cache tags

# 10. The app still renders every route
npm run build && npm run start & SERVER_PID=$!
sleep 6
for p in /en /en/incidents /en/blog /en/reviews /en/scapegoats; do
  printf '%s ' "$p"
  curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3000$p"
done
# Expected: 200 for all five
kill "$SERVER_PID"

# 11. The conventions are written down
grep -c 'GraphQL naming conventions' ../docs/api-contract.md
# Expected: 1
```

If check 7 prints `0`, read the codegen output before assuming the check is wrong: an error
mentioning "Unknown fragment" instead means `_wrong.graphql` was picked up but the fragments
were not, which points at the `documents` glob in `codegen.ts`.

## Control Questions

1. `IncidentCardFields on Incident` cannot be spread into a selection on `Post`. Say what fails,
   when it fails, and what happens to the *other* operations in the same document when it does.
2. `IncidentDetailFields` spreads `IncidentCardFields`. Explain why that composition does not by
   itself add a level to the depth count, and then describe a fragment chain that would breach
   Lesson 06.4's limit of 10.
3. Lesson 10.2 turned fragment masking off. Name the specific class of bug masking prevents, say
   why this course accepts that risk, and give the three conditions under which you would turn
   it on.
4. Three fields were deleted in this lesson. For each one, say what it cost WordPress to resolve
   and how you established that nothing rendered it — and then say why no compiler could have
   told you.
5. `SiteChrome` and `PrimaryMenu` are two documents rather than one. Give the cache argument for
   the split, and explain why the split adds no WordPress requests per render.

## Learn More

- [WPGraphQL — Fragments](https://www.wpgraphql.com/docs/fragments) — fragment usage against a
  WordPress schema, including interface and union narrowing you will need in Module 14
- [GraphQL — Queries and mutations](https://graphql.org/learn/queries/) — the fragments,
  aliases and directives sections, from the specification's own tutorial
- [The `client` preset](https://the-guild.dev/graphql/codegen/plugins/presets/preset-client) —
  the fragment-masking option this lesson revisited, and what `getFragmentData` looks like
- [GraphQL — best practices](https://graphql.org/learn/best-practices/) — read the
  server-side-batching section with Key Concept 6's cost table in mind
- [The GraphQL specification](https://spec.graphql.org/October2021/) — the fragment-spread
  type-condition rules, which is the formal version of "cannot be spread here"
- [Next.js — `fetch` API reference](https://nextjs.org/docs/app/api-reference/functions/fetch) —
  re-read the cache-key description alongside Key Concept 3's two-document argument
- [WordPress — `get_post_meta()`](https://developer.wordpress.org/reference/functions/get_post_meta/)
  — what an ACF field selection actually costs on the WordPress side, per field, per node
