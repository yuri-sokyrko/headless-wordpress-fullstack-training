# Appendix 05 — GraphQL Cheatsheet

Syntax reference for WPGraphQL as this app uses it. For *what* the fields are, see
[appendix 03](03-content-model-reference.md).

Try everything here in GraphiQL first: <http://localhost:8080/wp-admin/admin.php?page=graphiql-ide>

---

## 1. Anatomy

```graphql
query IncidentsList($first: Int!) {                      # operation type, name, variables
  incidents(first: $first, where: { status: PUBLISH }) {   # field + arguments
    nodes {                                              # selection set
      id
      title
      slug
    }
  }
}
```

| Part | Rule |
|---|---|
| Operation type | `query`, `mutation`. (`subscription` — WPGraphQL does not support it.) |
| Operation name | **Always name it.** Codegen derives the TypeScript type name from it, and it shows up in logs. `GetIncidents` → `GetIncidentsQuery`. |
| Variables | Declared with types. `!` means non-null. Never string-interpolate a value into a query. |
| Selection set | Leaf scalars must be selected explicitly. There is no `SELECT *`. |

## 2. Connections and pagination

Every list in WPGraphQL is a Relay connection.

```graphql
query GetIncidentsPage($first: Int!, $after: String) {
  incidents(first: $first, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {          # the shortcut — use this
      id
      title
    }
    edges {          # the long form — only when you need edge metadata
      cursor
      node { id title }
    }
  }
}
```

| Classic | GraphQL |
|---|---|
| `'posts_per_page' => 10` | `first: 10` |
| `'paged' => 2` | `after: $endCursor` from the previous page |
| `'order' => 'DESC'` | `where: { orderby: { field: DATE, order: DESC } }` |
| `found_posts` | `pageInfo` + a separate count field if you registered one |

> **Cursors, not offsets.** An offset re-scans rows and drifts when content is inserted
> mid-list — page 2 can show you a row you already saw on page 1. A cursor points at a
> position, so it stays correct. Lesson 05.2.

> **Always pass an explicit `first`.** An unbounded connection is a denial-of-service waiting
> to happen. This project caps it server-side too, via
> `graphql_connection_max_query_amount`, and `@graphql-eslint` fails the build if you forget.

Backwards pagination exists (`last` / `before`) but this app does not use it.

## 3. Variables

```graphql
query GetIncidentBySlug($slug: ID!) {
  incident(id: $slug, idType: SLUG) {
    title
  }
}
```

```json
{ "slug": "coffee-machine-took-down-prod" }
```

`idType` matters constantly in WPGraphQL: `SLUG`, `DATABASE_ID`, `ID` (the global relay ID),
`URI`. Passing a slug without `idType: SLUG` returns `null` and looks like missing content.

## 4. Fragments

Reusable selection sets. The headless equivalent of `get_template_part()` — and the reason a
component and its query stay in sync.

```graphql
fragment IncidentCardFields on Incident {
  id
  title
  slug
  date
  severities(first: 1) { nodes { name slug } }
  scapegoats(first: 1) { nodes { name slug } }
}

query GetIncidents($first: Int!) {
  incidents(first: $first) {
    nodes {
      ...IncidentCardFields
    }
  }
}
```

**Convention in this project:** one fragment per component that renders data, named
`<ComponentName>Fields`, colocated in `next-app/src/graphql/fragments/`. If `IncidentCard`
needs a new field, you add it to the fragment and every query using that component gets it.

### Inline fragments — narrowing a union or interface

Required whenever the field returns something polymorphic. This is how `editorBlocks` and
`tech_stack`'s `contentNodes` work.

```graphql
query GetTaggedContent($slug: ID!) {
  techStack(id: $slug, idType: SLUG) {
    contentNodes(first: 20) {
      nodes {
        __typename          # ALWAYS select this — it is the discriminator
        ... on Incident   { title slug incidentDetails { downtimeMinutes } }
        ... on Post       { title slug excerpt }
        ... on TechReview { title slug techReviewFields { ratingOverall } }
      }
    }
  }
}
```

> **`__typename` is not optional in this codebase.** Codegen turns it into a literal type,
> which is what makes the TypeScript `switch` narrow correctly. Without it you get a wide
> union and no type safety — the `BlockRenderer` in Lesson 14.2 depends on this entirely.

## 5. Aliases

Same field, twice, with different arguments.

```graphql
query GetHomepageFeeds {
  # `severityIn` is the ONE narrow taxonomy where-arg this project registers
  # (Lesson 06.1 §9). `where: { taxQuery: … }` is NOT a real argument here — the
  # extension providing it is not installed, and an unregistered input key is a
  # validation error with `data: null`, not an empty list. Lesson 05.2 §6.
  catastrophic: incidents(first: 3, where: { severityIn: ["s1-catastrophic"] }) {
    nodes { ...IncidentCardFields }
  }
  recent: incidents(first: 6) {
    nodes { ...IncidentCardFields }
  }
}
```

Both arrive in one round trip, and TypeScript gives you `data.catastrophic` and `data.recent`.

## 6. Directives

```graphql
query GetIncident($slug: ID!, $withTrace: Boolean!) {
  incident(id: $slug, idType: SLUG) {
    title
    incidentDetails {
      stackTrace @include(if: $withTrace)
    }
  }
}
```

`@include(if:)` and `@skip(if:)` are the only two in core GraphQL. Useful for one component
that renders in a compact and a full variant without maintaining two queries.

## 7. Mutations

```graphql
mutation CreateIncident($input: CreateIncidentInput!) {
  createIncident(input: $input) {
    clientMutationId
    incident {
      id
      slug
      status
    }
  }
}
```

Every WPGraphQL mutation takes a single `input` object and returns a payload object.

> **WPGraphQL does not authorise your custom mutations for you.** A mutation with no
> `current_user_can()` check in its `mutateAndGetPayload` is open to anyone who can reach the
> endpoint. This is the single most common headless WordPress security bug, and Lesson 06.2
> plus the review checklist in Lesson 24.8 both hunt for it.

Auth for this app's mutations:

| Mutation | Credential | Header |
|---|---|---|
| `login`, `refreshJwtAuthToken` | none (that is the point) | — |
| `createIncident` | user JWT | `Authorization: Bearer <jwt>` |
| `registerDeveloper`, `submitHobtLead` | app token | `X-BTT-App-Token: <token>` |

## 8. Errors

GraphQL returns **HTTP 200 with an `errors` array**. This surprises everyone once.

```json
{
  "data": { "incident": null },
  "errors": [
    { "message": "You are not allowed to do that.", "path": ["createIncident"] }
  ]
}
```

Consequences the course leans on:

- `res.ok` is meaningless. `fetch` will not throw. You must inspect `body.errors`.
- **Partial success is normal** — `data` can be populated *and* `errors` non-empty.
- `next-app/src/lib/graphql/client.ts` (Lesson 10.1) centralises this: it throws a typed
  `GraphQLRequestError` carrying the operation name, and **never surfaces the raw WordPress
  message to a user**, because those leak plugin names, file paths and occasionally SQL.

## 9. Query patterns this app actually uses

```graphql
# The nav — replaces wp_nav_menu()
query GetPrimaryMenu {
  menuItems(where: { location: PRIMARY }, first: 20) {
    nodes { id label uri parentId }
  }
}

# Site-wide settings from the ACF options page — fetched once in the root layout
query GetSiteSettings {
  siteSettings {
    siteChrome {
      siteTagline
      primaryCtaLabel
      primaryCtaUrl
      incidentSubmissionOpen
      socialLinks { network url }
    }
  }
}

# Resolve any URI to whatever lives there — replaces url_to_postid()
query GetNodeByUri($uri: String!) {
  nodeByUri(uri: $uri) {
    __typename
    ... on Page { id title }
    ... on Post { id title }
    ... on Incident { id title }
  }
}

# The blame leaderboard — `count` is maintained by WordPress, so this is an indexed read
query GetBlameLeaderboard {
  scapegoats(first: 20, where: { orderby: COUNT, order: DESC }) {
    nodes {
      name
      slug
      count
      scapegoatProfile { tagline defensiveness }
    }
  }
}

# The block tree — the structured replacement for the_content()
query GetPageBlocks($uri: String!) {
  nodeByUri(uri: $uri) {
    ... on Page {
      title
      ...EditorBlocks
    }
  }
}

# Locale-filtered list — every localised CONNECTION in this app takes this variable.
# A by-slug query does NOT: GraphQL rejects a declared-but-unused variable, so those
# select `language { code }` and compare it against the URL segment instead.
query GetGermanIncidents($language: LanguageCodeFilterEnum!) {
  incidents(first: 10, where: { status: PUBLISH, language: $language }) {
    nodes { slug language { code } }
  }
}

# Sibling lookup for the switcher and the hreflang cluster.
# `translations` returns SIBLINGS ONLY — never the node itself, so a three-language
# cluster gives two entries and you have to add the current node yourself.
query GetTranslations($slug: ID!) {
  incident(id: $slug, idType: SLUG) {
    language { code }
    translations { language { code } slug uri }
  }
}

# SEO, on every content query
fragment SeoFields on ContentNode {
  seo {
    title
    metaDesc
    canonical
    metaRobotsNoindex
    metaRobotsNofollow
    opengraphTitle
    opengraphDescription
    opengraphImage { ...MediaFields }
  }
}
```

## 10. Introspection

```bash
# List every type
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ __schema { types { name } } }"}' | jq '.data.__schema.types[].name'

# Inspect one type's fields
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"Incident\") { fields { name type { name kind } } } }"}' | jq
```

Introspection is how GraphiQL autocompletes and how codegen works.

> **Introspection is disabled in production** (Lesson 24.1), together with depth limits and
> persisted queries. Locally it stays on — you need it.

## 11. Common mistakes

| Symptom | Cause |
|---|---|
| `null` for content you can see in wp-admin | Missing `idType`, or the post type lacks `show_in_graphql`, or the post is not published and you did not pass `asPreview: true` |
| `Cannot query field "x" on type "Y"` | The field is not registered, or a plugin providing it is inactive. Re-check in GraphiQL. |
| ACF fields missing entirely | The field group has `show_in_graphql` off, or `graphql_field_name` is unset |
| A generated type is `any` | You forgot `__typename` on a polymorphic field, or you are looking at an ACF repeater and expecting `string[]` |
| Works in GraphiQL, fails from Next | GraphiQL is authenticated as your wp-admin session. Anonymous requests have fewer permissions — that is usually correct behaviour, not a bug. |
| The query is enormous and slow | An unbounded connection or an N+1 in a resolver. Turn on `SAVEQUERIES` and count. Lesson 06.4. |
| Empty `data` and a 200 | Read `errors`. `fetch` did not throw and never will. |
| `Field "taxQuery" is not defined by type "RootQueryToIncidentConnectionWhereArgs"` | You copied a query written against the `wp-graphql-tax-query` extension, which is not installed. Narrow with `severityIn` (Lesson 06.1 §9) or traverse from the term. |
