---
title: 'Variables, Fragments & Directives'
module: 5
lesson: 3
teaches: [graphql-variables, fragments, directives, named-operations, aliases]
produces: []
requires: [5.2]
---

# Lesson 05.3 — Variables, Fragments & Directives

## Quick Overview

Up to now your queries have had values typed into them. This lesson removes them. A **named
operation with variables** — `query IncidentBySlug($slug: ID!) { ... }` — is the only shape that
belongs in an application: the query text becomes a constant the client can hash, cache and
register as a persisted operation, while the values travel separately and typed. Interpolating a
slug into a query string is the GraphQL equivalent of concatenating a value into SQL, and it is
the reason variables get a whole lesson rather than a paragraph.

**Fragments** are the second half. `IncidentCardFields` names the field set that `/incidents`,
the scapegoat archive and the related-incidents sidebar all need, defined once and spread with
`...IncidentCardFields` wherever it is needed. That is not merely tidy — in Module 10 codegen
turns each fragment into its own TypeScript type, which becomes the props type of the React
component that renders it, so a fragment and a component end up being the same unit of design.
You will also meet **aliases**, for asking the same field twice with different arguments in one
request, and the `@include`/`@skip` **directives**, which conditionally fetch a field set based
on a boolean variable — useful, and also easy to overuse into a query nobody can read. You build
`IncidentBySlug`, `PostBySlug`, `PostsList`, `ReviewsList` and `ReviewBySlug` in this lesson,
all parameterised.

By the end of this lesson you will have:

- Every query from Lessons 05.1 and 05.2 rewritten as a named operation with typed variables
- A fragment library — at minimum `IncidentCardFields`, `IncidentDetailFields`,
  `SeoFields` and `MediaFields` — with each one used in more than one operation
- `IncidentBySlug`, `PostsList`, `PostBySlug`, `ReviewsList` and `ReviewBySlug` verified against
  seeded content
- One query using aliases to fetch two severity-filtered lists in a single request
- One query using `@include($withBlocks)` and a written note on when that is a good idea and
  when it is a smell
- All of it saved to the scratch `queries.graphql`, named to match the module README's table

## Classic WP Analogy

Variables are `$wpdb->prepare()`, and the analogy is close enough to be load-bearing. You already
know not to write `"WHERE post_name = '$slug'"` — you write `$wpdb->prepare("WHERE post_name =
%s", $slug)` because the query text and the data must not be the same string. GraphQL variables
are the same separation, for the same reason, with the same benefit: the server can parse and
plan the operation once, and the value cannot change the meaning of the operation.

Fragments are `get_template_part()`. In Classic WordPress you extract the markup for an incident
card into `template-parts/incident-card.php`, include it from the archive, the taxonomy archive
and the sidebar, and edit it in one place when the design changes. A fragment does exactly that
for the *data requirements* of that card: the fields it needs, named once, spread into every
operation that renders it. The pairing becomes literal in Module 14, where the fragment defines
the component's props.

**Where the analogy breaks down:** `get_template_part()` has no obligations. Include it anywhere,
and if it needs `get_field('downtime_minutes')` it just calls it, because it is inside the
process that has the data. A GraphQL fragment is **typed against a schema type** — a fragment on
`Incident` cannot be spread into a selection on `Post`, and the query is rejected at validation
if you try. That is a constraint your template parts never had, and it is exactly the constraint
that makes `tech_stack` spanning three post types interesting: a query for "everything tagged
React" returns a `ContentNode` interface, and you need `__typename` narrowing plus one fragment
per concrete type to render it. Lesson 05.4 walks that, and Module 14 turns it into a renderer.

---

## Key Concepts

### 1. Name every operation

An operation can be anonymous — `{ incidents { nodes { title } } }` — and in GraphiQL that is
fine for ten seconds of exploration. In an application it is never fine.

```graphql
query GetIncidents($first: Int!) { … }
─────┬──── ─────┬────── ─────┬──────
     │          │            └── variable declarations, typed
     │          └── the operation name
     └── the operation type: query | mutation
```

| What the name buys you | Where it lands |
|---|---|
| The generated TypeScript type name | `GetIncidents` → `GetIncidentsQuery` and `GetIncidentsQueryVariables` (Lesson 10.2) |
| A readable identifier in logs and traces | WPGraphQL logs `operationName`; so does every APM tool |
| A key for persisted queries | Module 24's allowlist is keyed by operation, and an anonymous operation cannot be allowlisted |

> **An anonymous operation is only legal when it is the only operation in the document.** Two of
> them, or one beside a named one, is a hard validation error. That rule alone converts most
> people.

**The convention in this project:** `<Verb><Thing>` for the operation, matching the table in the
[module README](README.md) — `IncidentsList`, `IncidentBySlug`, `ScapegoatLeaderboard`,
`SiteChrome`. No `Query` suffix; codegen adds one. Fragments get the component's name plus
`Fields` — that convention is §4.

### 2. Variables: the query text is a constant, the values travel beside it

This is `$wpdb->prepare()` with a different syntax and the same reasoning.

```graphql
# ❌ Never. The value is now part of the query text.
query { incident(id: "coffee-machine-took-down-prod", idType: SLUG) { title } }

# ✅ The query text is a constant. The value is data.
query IncidentBySlug($slug: ID!) {
  incident(id: $slug, idType: SLUG) { title }
}
```

```json
{ "slug": "coffee-machine-took-down-prod" }
```

Be precise about *why*, because the SQL analogy is close but not identical. Interpolating a value
into a GraphQL query is not classic injection — a string value cannot become a new selection set,
because the parser reads it as a `StringValue` node. What it breaks is everything built on the
assumption that the query text is stable:

| Interpolation breaks | Concretely |
|---|---|
| Codegen | `graphql-codegen` reads static documents from your source. A template literal with a `${}` in it is not a document it can type. |
| Caching, everywhere | A distinct query string per value means a distinct cache key per value — at the CDN, in the Data Cache, and in any client normalising by document. |
| Persisted queries | The allowlist is a hash of the query text. One hash per value is not an allowlist. |
| Escaping, eventually | The moment a value contains a `"` or a newline, you are hand-writing a GraphQL string escaper. That is the bug you were avoiding. |

Variable syntax you will use daily:

| Declaration | Means |
|---|---|
| `$first: Int!` | Required. Omitting it is a validation error before execution. |
| `$after: String` | Optional and nullable. Absent and explicit `null` behave the same here. |
| `$first: Int! = 10` | Required type with a default — the caller may omit it. |
| `$slug: ID!` | `ID` is a string that happens to identify something. WPGraphQL's node arguments use it. |

Declared-and-unused is also an error (`Variable "$x" is never used`), which is a small gift: it
catches the half-finished refactor before it ships.

### 3. `idType`, and the `null` that looks like missing content

Every single-node field takes `id` plus `idType`, and **`idType` has no safe default for your
purposes**. Get it wrong and you receive `data.incident: null` with no `errors` array — which
looks exactly like "that incident does not exist" and sends you to check the database instead of
the query.

```graphql
# ❌ Returns null. WPGraphQL tried to read "coffee-…" as a global relay ID.
incident(id: "coffee-machine-took-down-prod") { title }

# ✅
incident(id: "coffee-machine-took-down-prod", idType: SLUG) { title }
```

The values, and this is where it gets interesting:

| `idType` | `id` you pass | Notes |
|---|---|---|
| `ID` | the opaque global ID, `base64("post:412")` | The **default**. Only useful when you already hold one from a previous response. |
| `DATABASE_ID` | `412` | The `wp_posts.ID` you have always used. |
| `SLUG` | `coffee-machine-took-down-prod` | **Only exists on non-hierarchical types.** |
| `URI` | `/incidents/coffee-machine-took-down-prod/` | The permalink path. Works for everything addressable. |
| `SOURCE_URL` | a media file URL | `MediaItem` only. |

> **`Page` has no `SLUG`.** WPGraphQL registers a separate `IdType` enum per post type and only
> adds `SLUG` for **non-hierarchical** types, because a slug is not unique when pages nest —
> `/about/team` and `/careers/team` are both `team`. So `incident(id: $slug, idType: SLUG)` is
> valid and `page(id: $slug, idType: SLUG)` does not compile. For pages use `idType: URI`, or use
> `nodeByUri` and let WordPress resolve it (Lesson 05.4).

### 4. Fragments are `get_template_part()` for data requirements

A fragment names a selection set on a type, and you spread it with `...`:

```graphql
fragment IncidentCardFields on Incident {
  id
  title
  slug
  date
  severities(first: 1) { nodes { name slug } }
  scapegoats(first: 1) { nodes { name slug } }
}

query IncidentsList($first: Int!) {
  incidents(first: $first) { nodes { ...IncidentCardFields } }
}
```

The archive, the scapegoat page and the related-incidents sidebar all render an incident card, and
all three now ask for exactly the same fields. Add `incidentDetails { downtimeMinutes }` to the
fragment and every consumer gets it, in one edit, the same way adding a field to
`template-parts/incident-card.php` used to change every place it was included.

**The convention in this project:** one fragment per component that renders data, named
`<ComponentName>Fields`, colocated with the component in `next-app/src/graphql/fragments/` from
Lesson 10.5. The payoff is structural — codegen turns each fragment into its own TypeScript type,
and that type becomes the component's props type, so "which fields does this component need?" has
exactly one answer that the compiler checks.

Three properties that have no `get_template_part()` equivalent:

| Property | Consequence |
|---|---|
| A fragment is **typed against a schema type** | `...IncidentCardFields` inside a selection on `Post` is a validation error, not a runtime surprise |
| Fragments **compose** | `IncidentDetailFields` can spread `IncidentCardFields`; the flattened set is what executes |
| Fragments are **deduplicated at execution** | Spreading the same fragment twice costs nothing extra |

### 5. Inline fragments, and why `__typename` is mandatory here

When a field returns an interface or a union, its type is only known per item. `tech_stack` spans
three post types, so `contentNodes` returns `ContentNode`, and you narrow with an inline fragment
per concrete type:

```graphql
techStack(id: $slug, idType: SLUG) {
  contentNodes(first: 20) {
    nodes {
      __typename                                  # the discriminator
      ... on Incident   { title slug incidentDetails { downtimeMinutes } }
      ... on Post       { title slug excerpt }
      ... on TechReview { title slug techReviewFields { ratingOverall } }
    }
  }
}
```

`__typename` is a meta-field available on every object type, and selecting it is what makes the
result usable on the other side:

```
        WITHOUT __typename                    WITH __typename
        ──────────────────                    ───────────────
TS:  { title?: string;                 TS:  | { __typename: "Incident";   title: string; … }
       slug?: string;                        | { __typename: "Post";       title: string; … }
       excerpt?: string;                     | { __typename: "TechReview"; title: string; … }
       incidentDetails?: … }
                                             switch (node.__typename) {
     Every field optional.                     case "Incident":   // node is narrowed here
     `switch` narrows nothing.                 case "TechReview": // and here
     No exhaustiveness check.                }
```

Codegen turns `__typename` into a **literal** type, and a literal type is what lets TypeScript
narrow a union in a `switch`. Drop it and you get a wide object with everything optional and no
exhaustiveness checking — which is the "why is my generated type useless?" moment in
[appendix 05 §11](../appendix/05-graphql-cheatsheet.md#11-common-mistakes).

> **`__typename` is not optional in this codebase.** The `BlockRenderer` in Lesson 14.2 is a
> `switch` over `__typename` that maps every block type to a React component, and its
> exhaustiveness check is the thing that tells you a newly-added block has no renderer. Without
> `__typename` that component cannot be written at all.

### 6. Aliases: the same field twice, in one round trip

A field can appear once per selection set unless you rename it:

```graphql
query HomepageFeeds {
  catastrophic: incidents(first: 3, where: { status: PUBLISH }) { nodes { ...IncidentCardFields } }
  recent:       incidents(first: 6, where: { status: PUBLISH }) { nodes { ...IncidentCardFields } }
}
```

One request, one waterfall step, and `data.catastrophic` / `data.recent` in TypeScript. The
Classic equivalent was three `WP_Query` objects in one template — same idea, except here it is
also one HTTP round trip instead of three.

Aliases also rename an awkward field into the name a component wants —
`cover: featuredImage { node { sourceUrl } }`. Use that sparingly: props that no longer resemble
the schema are harder to trace back when a field is deprecated.

### 7. `@include` and `@skip`, and when they are a smell

Two directives, both taking a `Boolean` argument, both evaluated before the field resolves:

```graphql
query IncidentBySlug($slug: ID!, $withTrace: Boolean!) {
  incident(id: $slug, idType: SLUG) {
    title
    incidentDetails {
      downtimeMinutes
      stackTrace @include(if: $withTrace)
    }
  }
}
```

`@include(if: false)` and `@skip(if: true)` are the same instruction. The field is not resolved,
so this is a genuine saving when the omitted branch is expensive — a whole `editorBlocks` tree,
say.

| Good use | Smell |
|---|---|
| One component, compact and full variants, differing by a few fields | Branching the query so hard that two shapes come back from one operation |
| Skipping an expensive subtree the current route does not render | Using it as a general-purpose conditional to avoid writing a second operation |

The hidden cost is in the types. A field under `@include` becomes **optional** in the generated
TypeScript, because the server genuinely might not return it — so every consumer needs a
narrowing check. Two clear operations with two clear types are often cheaper than one operation
with a boolean and a maybe-field.

---

## Task

### Step 1: Name and parameterise what you already have

Open your scratch `queries.graphql`. Every operation gets a name from the
[module README](README.md) table and typed variables in place of literals. `IncidentsList` and
`IncidentsByScapegoat` are already named — check they take `$first`, `$after` and `$search`
rather than numbers, and delete anything still anonymous.

### Step 2: Build `IncidentBySlug`

```graphql
# queries.graphql — scratch. Feeds /incidents/[slug] in Module 09.
query IncidentBySlug($slug: ID!) {
  incident(id: $slug, idType: SLUG) {
    id
    databaseId
    title
    slug
    date
    content
    severities(first: 1) {
      nodes {
        name
        slug
      }
    }
    incidentDetails {
      occurredAt
      downtimeMinutes
      environment
      resolutionStatus
      blameConfidence
      stackTrace
      isVerified
    }
  }
}
```

Run it with a slug you can see in `docker compose run --rm wpcli wp post list --post_type=incident --fields=post_name`.

**Verify §2:**

- [ ] `data.incident` is an object, not `null`.
- [ ] `incidentDetails` is populated. If every field is `null`, the ACF group is missing
      `show_in_graphql` — go back to Lesson 04.2.
- [ ] There is **no** `featuredImage` field on `Incident`. That is correct: `supports` in
      [appendix 03 §1](../appendix/03-content-model-reference.md#supports) omits `thumbnail`, and
      the schema is generated from your registration. A missing field is usually a missing
      `supports` entry, not a plugin bug.

### Step 3: Reproduce the `idType` trap on purpose

```bash
SLUG=$(docker compose run --rm wpcli wp post list --post_type=incident --field=post_name --posts_per_page=1 | tr -d '\r')
echo "using slug: $SLUG"

# 3a. Without idType — silently null
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d "$(jq -cn --arg s "$SLUG" '{query:"query($s:ID!){ incident(id:$s){ title } }", variables:{s:$s}}')" | jq -c

# 3b. With idType — the incident
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d "$(jq -cn --arg s "$SLUG" '{query:"query($s:ID!){ incident(id:$s, idType:SLUG){ title } }", variables:{s:$s}}')" | jq -c
```

**Verify §3:**

- [ ] 3a returns `{"data":{"incident":null}}` — **and no `errors` key**. Sit with that for a
      moment: the most common WPGraphQL bug produces a response that is indistinguishable from
      "not found".
- [ ] 3b returns the title.

### Step 4: Extract the fragment library

Add these to the top of your scratch file. Each one is used by more than one operation by the end
of this lesson.

```graphql
# queries.graphql — scratch. Fragment library. Lesson 10.5 splits these into
# next-app/src/graphql/fragments/, one file per component.

fragment MediaFields on MediaItem {
  id
  altText
  sourceUrl
  mediaDetails {
    width
    height
  }
}

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

fragment IncidentDetailFields on Incident {
  ...IncidentCardFields
  content
  author {
    node {
      name
    }
  }
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

Note `IncidentDetailFields` spreading `IncidentCardFields` — that is fragment composition, and the
detail page therefore cannot drift from the card.

> **`SeoFields` waits for Module 19.** The fragment in
> [appendix 05 §9](../appendix/05-graphql-cheatsheet.md#9-query-patterns-this-app-actually-uses)
> is declared `on NodeWithSeo`, an interface that only exists once WPGraphQL Yoast SEO is
> installed in Lesson 19.1. Write it into your scratch file now if you like, but keep it
> commented out — a fragment on a type that does not exist fails validation for the whole
> document, including the operations that were fine.

### Step 5: Build the remaining read operations on top of the fragments

```graphql
# queries.graphql — scratch. These four complete the Module 05 README's operation table.

query PostsList($first: Int!, $after: String) {
  posts(first: $first, after: $after, where: { status: PUBLISH, orderby: { field: DATE, order: DESC } }) {
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

**Verify §5:**

- [ ] All four run. `ReviewBySlug` returns `pros` and `cons` as **lists of objects with an `item`
      key**, not lists of strings. That mismatch is the ACF repeater shape from
      [appendix 03 §4.3](../appendix/03-content-model-reference.md#43-tech-review-fields), and it
      is worth seeing now rather than in Module 10 when a generated type surprises you.

### Step 6: One request, two feeds, using aliases

```graphql
# queries.graphql — scratch. Feeds the home page in Module 09.
query HomepageFeeds($featuredCount: Int!, $recentCount: Int!) {
  catastrophic: incidents(first: $featuredCount, where: { status: PUBLISH }) {
    nodes {
      ...IncidentCardFields
    }
  }
  recent: incidents(first: $recentCount, where: { status: PUBLISH, orderby: { field: DATE, order: DESC } }) {
    nodes {
      ...IncidentCardFields
    }
  }
}
```

Run it with `{ "featuredCount": 3, "recentCount": 6 }`.

**Verify §6:**

- [ ] The response has both `catastrophic` and `recent` at the top level of `data`.
- [ ] Removing the aliases and asking for `incidents` twice is a validation error. Try it once.

### Step 7: Add a directive, then decide whether you want it

```graphql
# queries.graphql — scratch. The @include variant of the detail query.
query IncidentBySlugConditional($slug: ID!, $withTrace: Boolean!) {
  incident(id: $slug, idType: SLUG) {
    ...IncidentDetailFields
    incidentDetails {
      stackTrace @include(if: $withTrace)
    }
  }
}
```

Run it twice, with `"withTrace": true` and `"withTrace": false`, and diff the two responses.

Then write one sentence in your notes: **would you ship this, or two operations?** For a field
this cheap the honest answer is "two operations, or just always fetch it". The directive earns
its keep when the conditional subtree is expensive — an entire `editorBlocks` tree on a page that
sometimes renders only a summary card.

### Step 8: Tidy the scratch file

`queries.graphql` should now hold five fragments plus `IncidentsList`, `IncidentsByScapegoat`,
`IncidentBySlug`, `PostsList`, `PostBySlug`, `ReviewsList`, `ReviewBySlug` and `HomepageFeeds` —
every one named, every one parameterised, and not one literal slug in the file.

---

## Verification

```bash
cd wordpress-headless
SLUG=$(docker compose run --rm wpcli wp post list --post_type=incident --field=post_name --posts_per_page=1 | tr -d '\r')
echo "slug under test: $SLUG"

# 1. A named operation with variables resolves the incident
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d "$(jq -cn --arg s "$SLUG" '{operationName:"IncidentBySlug", query:"query IncidentBySlug($s:ID!){ incident(id:$s, idType:SLUG){ title slug } }", variables:{s:$s}}')" \
  | jq -c '.data.incident'
# Expected: an object with a title and the slug you passed

# 2. NEGATIVE — the same query without idType returns null and NO errors
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d "$(jq -cn --arg s "$SLUG" '{query:"query($s:ID!){ incident(id:$s){ title } }", variables:{s:$s}}')" \
  | jq -c '{incident: .data.incident, errors: .errors}'
# Expected: {"incident":null,"errors":null}
#           Null with no error is the single most expensive WPGraphQL mistake.

# 3. NEGATIVE — a required variable that is not supplied is rejected before execution
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"query IncidentBySlug($slug: ID!){ incident(id:$slug, idType:SLUG){ title } }","variables":{}}' \
  | jq -r '.errors[0].message'
# Expected: Variable "$slug" of required type "ID!" was not provided.

# 4. NEGATIVE — a declared-but-unused variable is also rejected
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"query Unused($n: Int!){ generalSettings { title } }","variables":{"n":1}}' \
  | jq -r '.errors[0].message'
# Expected: Variable "$n" is never used in operation "Unused".

# 5. NEGATIVE — Page has no SLUG idType, because pages are hierarchical
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ page(id: \"about\", idType: SLUG) { title } }"}' | jq -r '.errors[0].message'
# Expected: a "Value \"SLUG\" does not exist in \"PageIdType\" enum" validation error

# 6. NEGATIVE — a fragment cannot be spread onto the wrong type
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"fragment F on Incident { title } { posts(first:1){ nodes{ ...F } } }"}' \
  | jq -r '.errors[0].message'
# Expected: a "Fragment cannot be spread here" error naming Incident and Post

# 7. Aliases put two shapes of the same field in one response
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ three: incidents(first:3){ nodes{ slug } } six: incidents(first:6){ nodes{ slug } } }"}' \
  | jq -c '{three: (.data.three.nodes|length), six: (.data.six.nodes|length)}'
# Expected: {"three":3,"six":6}

# 8. @include(if: false) removes the field from the response entirely; true brings it back
for T in false true; do
  curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
    -d "$(jq -cn --arg s "$SLUG" --argjson t "$T" '{query:"query($s:ID!,$t:Boolean!){ incident(id:$s, idType:SLUG){ incidentDetails{ downtimeMinutes stackTrace @include(if:$t) } } }", variables:{s:$s,t:$t}}')" \
    | jq -c "\"withTrace=$T\", (.data.incident.incidentDetails | keys)"
done
# Expected: withTrace=false lists only downtimeMinutes — stackTrace is ABSENT, not null.
#           withTrace=true lists both.

# 9. ACF repeaters are lists of objects, not lists of strings
RSLUG=$(docker compose run --rm wpcli wp post list --post_type=tech_review --field=post_name --posts_per_page=1 | tr -d '\r')
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d "$(jq -cn --arg s "$RSLUG" '{query:"query($s:ID!){ techReview(id:$s, idType:SLUG){ techReviewFields{ pros{ item } } } }", variables:{s:$s}}')" \
  | jq -c '.data.techReview.techReviewFields.pros'
# Expected: [{"item":"…"}, …] — objects, not strings

# 10. Your scratch file is fully named, fully parameterised, and has no literal ids left
cd .. && echo "fragments: $(grep -c '^fragment ' queries.graphql)  operations: $(grep -c '^query [A-Z]' queries.graphql)"
grep -nE '\(id: "' queries.graphql
# Expected: 5+ fragments, 8+ operations, and NO output from the grep
```

## Control Questions

1. `incident(id: "some-slug")` returns `null` with no `errors` array. Explain what the server
   actually did, why it is not an error by the specification, and the one argument that fixes it.
2. `page(id: "about", idType: SLUG)` fails validation while `incident(id: "x", idType: SLUG)`
   succeeds. Give the reason, and name the two `idType` values that work for a page.
3. Interpolating a slug into a query string cannot inject a new selection set. Give two concrete
   things it breaks anyway, one at build time and one at run time.
4. `__typename` is selected on every polymorphic field in this codebase. Describe what the
   generated TypeScript looks like without it, and name the Lesson 14.2 component that could not
   be written.
5. You need a compact and a full variant of the incident detail page. Argue for `@include` and
   then against it, and state which you would ship and what would change your mind.

## Learn More

- [GraphQL — Queries: variables, fragments, directives](https://graphql.org/learn/queries/) — the
  canonical reference for everything in this lesson, in about fifteen minutes
- [GraphQL — Validation](https://graphql.org/learn/validation/) — the checks that run before a
  single resolver does, which is why a typo costs you nothing but a 200 response
- [WPGraphQL — Fragments](https://www.wpgraphql.com/docs/fragments) — fragment usage in a
  WordPress schema, including interfaces and `contentNodes`
- [GraphQL Code Generator — client preset](https://the-guild.dev/graphql/codegen/plugins/presets/preset-client) —
  read this now to see exactly how operation and fragment names become TypeScript types in
  Lesson 10.2
