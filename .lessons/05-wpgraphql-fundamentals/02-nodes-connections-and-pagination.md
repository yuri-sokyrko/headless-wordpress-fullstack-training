---
title: 'Nodes, Connections & Pagination'
module: 5
lesson: 2
teaches: [relay-connections, nodes-and-edges, cursor-pagination, where-args, page-info]
produces: []
requires: [5.1]
---

# Lesson 05.2 — Nodes, Connections & Pagination

## Quick Overview

Every list in WPGraphQL is a **connection**, and connections follow the Relay specification:
`nodes` for the plain list, `edges` for the list with per-item metadata including a `cursor`,
and `pageInfo` with `hasNextPage` and `endCursor`. The shape looks like ceremony until you need
the thing it exists for — stable pagination over a dataset that changes while a user is reading
it. This lesson builds `IncidentsList`, the query behind `/incidents`, with a working "load more"
and its facets reached by traversing from the term — §6 is about why they are not `where`
arguments.

Cursor pagination is the concept to actually absorb. `offset`-based paging asks for "rows 20 to
29", which is wrong the moment a row is inserted or deleted above the window — a user clicking
to page two silently skips or repeats an item, and nobody notices until a customer complains.
A cursor says "the ten after *this specific item*", which is stable under insertion and is also
what lets the database use an index instead of counting rows it will discard. The trade is
stated plainly: cursors do not give you numbered pages, so a "page 7 of 12" UI needs
`offsetPagination` or a separate count, and this course chooses infinite-style paging on
`/incidents` partly because of it. You also learn `where` arguments, which are the parts of
`WP_Query` WPGraphQL chose to expose as connection inputs — and §6 is about the parts it
deliberately did not.

By the end of this lesson you will have:

- `IncidentsList` returning 10 incidents with `pageInfo`, plus a severity facet reached by
  traversing from the term
- A working "next page" round trip using `after: $endCursor`, proving pagination is stable
- A demonstration of `offset` paging breaking when a post is inserted mid-read, and the same
  case handled correctly by a cursor
- The `nodes` versus `edges` distinction written down, with a case where you genuinely need
  `edges`
- A term traversal reproducing a `tax_query` you wrote in Module 03, with matching results
- The query saved as a named operation in your scratch `queries.graphql`

## Classic WP Analogy

You have built this exact list many times. `WP_Query` with `posts_per_page => 10` and `paged =>
get_query_var('paged')`, `tax_query` for the facets, `paginate_links()` at the bottom, and
`found_posts` for the count. WPGraphQL's connection arguments map onto that almost one for one:
`first` is `posts_per_page`, `where` carries `orderby`, `search`, `status`, `dateQuery` and the
core taxonomy arguments — but **not** `tax_query`, which is §6 — and `pageInfo.hasNextPage` is
`$query->max_num_pages > $paged`. The resolver builds
a `WP_Query`, so the query plans you learned to read in Lesson 02.3 are the plans still running.

`edges` and `nodes` are the one genuinely new vocabulary item. Think of `nodes` as
`$query->posts` — the plain array you loop — and `edges` as the same list with a wrapper per
item that carries relationship metadata: the `cursor`, and for some connections extra fields
about *how* the item is related. In Classic WordPress there is no equivalent because there is no
place to hang per-item relationship data; you would have kept it in a parallel array and hoped
the indexes matched.

**Where the analogy breaks down:** `paged => 2` is a number you can put in a URL, bookmark,
share, and render as a "Page 2" link, and `paginate_links()` gives you the whole numbered
control for free because `found_posts` tells you how many pages exist. A cursor is an opaque
base64 string that means "after this item in this ordering" — it is not shareable in any
meaningful way, it does not survive a change of sort order, and it cannot tell you how many
pages there are without a separate count query that costs a full `COUNT(*)`. You gain stability
and index-friendly queries; you lose numbered pages. That is a real trade and the course makes
it deliberately rather than by accident.

---

## Key Concepts

### 1. Every list is a connection, and a connection has four parts

WPGraphQL implements the [Relay Cursor Connections
specification](https://relay.dev/graphql/connections.htm) for every list in the schema. That is
not WordPress being fancy — it is the convention the whole GraphQL ecosystem paginates with, and
it is why Apollo, urql and `graphql-codegen` all understand your API without configuration.

```
incidents(first: 3) ─────────────────────────────────────────┐
                                                             │
  IncidentConnection                                         │
  ├── nodes:  [ Incident, Incident, Incident ]   ← the list you usually want
  ├── edges:  [ { cursor, node }, … ]            ← the list PLUS per-item metadata
  └── pageInfo:                                                │
        ├── hasNextPage:     true                              │
        ├── hasPreviousPage: false                             │
        ├── startCursor:     "YXJyYXljb25uZWN0aW9uOjQxMg=="    │
        └── endCursor:       "YXJyYXljb25uZWN0aW9uOjQwOA=="  ──┘ feed this back as `after`
```

| Part | Is | Classic equivalent |
|---|---|---|
| `nodes` | The plain array of objects | `$query->posts` |
| `edges` | One wrapper per item, carrying `cursor` and `node` | nothing — there was no place to hang per-item relationship data |
| `edges[].cursor` | An opaque position marker for that item | nothing |
| `pageInfo.hasNextPage` | Is there at least one more item after this page | `$query->max_num_pages > $paged` |
| `pageInfo.endCursor` | The cursor of the last item on this page | nothing — `paged + 1` was the whole mechanism |

### 2. `nodes` or `edges`: use `nodes`

`nodes` is a WPGraphQL convenience over the Relay shape, and it removes a level of nesting from
every list query in your application. Use it by default.

```graphql
# ✅ The default. Flatter, and the generated TypeScript is flatter too.
incidents(first: 10) { nodes { id title } }

# ❌ Not wrong, just noisier — `edges { node { … } }` for no benefit.
incidents(first: 10) { edges { node { id title } } }

# ✅ Correct use of edges: you need the per-item cursor.
incidents(first: 10) { edges { cursor node { id title } } }
```

Reach for `edges` in exactly two situations. The first is per-item cursors — you want to resume
from an arbitrary row rather than from the end of a page, for example restoring a reading
position. The second is **edge fields**: some connections carry data about the *relationship*
rather than about either end of it, and that data can only live on the edge. WPGraphQL for SCF
puts image relationships there — an SCF image field surfaces as
`AcfMediaItemConnectionEdge` in [appendix 03 §4.2](../appendix/03-content-model-reference.md#42-scapegoat-profile),
which is why `avatar { node { sourceUrl } }` has that extra hop.

> **The verdict for this project:** `nodes` everywhere, `edges` only when you are paginating from
> a stored position or reading an edge field. Module 10's fragments follow the same rule, so a
> component's fragment stays readable.

### 3. Cursors, not offsets — and the reason is correctness, not taste

An offset says **"rows 20 to 29"**. A cursor says **"the ten after this specific item"**. Those
are not two spellings of the same idea; they behave differently the moment the data changes.

```
OFFSET PAGING, with one insert between the two requests
────────────────────────────────────────────────────────────────────────
t=0   page 1  LIMIT 5 OFFSET 0   →  [ A  B  C  D  E ]
t=1   someone publishes NEW, which sorts to the top
t=2   page 2  LIMIT 5 OFFSET 5   →  [ E  F  G  H  I ]
                                      ▲
                                      E again. The user saw it on page 1.
                                      Delete instead of insert and you skip
                                      a row entirely — silently.

CURSOR PAGING, same insert
────────────────────────────────────────────────────────────────────────
t=0   first: 5                   →  [ A  B  C  D  E ]  endCursor → E
t=1   someone publishes NEW
t=2   first: 5, after: cursor(E)  →  [ F  G  H  I  J ]
                                      No duplicate. No skip. NEW is simply
                                      not in this result set, because the
                                      question was "after E", not "row 6".
```

The correctness argument is the whole argument, and it is worth being precise about the
mechanism. An `OFFSET n` in MySQL does not skip to row `n`; the server **generates and discards
`n` rows** first, so page 500 of a list is genuinely more expensive than page 1. A cursor becomes
a `WHERE` clause instead, which an index can seek directly.

WPGraphQL's cursors are not magic and you should look inside one. A cursor is
`base64("arrayconnection:<databaseId>")` — decode one in Step 2 of the Task and you get
`arrayconnection:412`. The resolver then decodes it, loads that post, and adds a keyset
comparison to the `WP_Query`:

```sql
-- roughly what `after: cursor(412)` adds, for the default DATE DESC ordering
AND ( wp_posts.post_date < '2026-02-14 09:12:00'
      OR ( wp_posts.post_date = '2026-02-14 09:12:00' AND wp_posts.ID < 412 ) )
```

The `ID` tie-breaker is why two incidents published in the same second do not confuse the
pagination. And the `post_date` in that comparison is why **the cursor is only valid for the
ordering it was produced under** — change `orderby` and every cursor you are holding means
something else. Treat a cursor as belonging to the query that produced it.

The cost, stated plainly:

| You gain | You give up |
|---|---|
| No duplicates or skips under concurrent writes | Numbered pages — `?page=7` has no cursor equivalent |
| An indexed seek instead of a discarded-row scan | Deep-linking to a page; a cursor is not a URL you share |
| Stability while a user reads | A total count, unless you ask for one separately (§4) |

This is why `/incidents` in Module 09 is a "Load more" list and not a `1 2 3 … 12` pager. It is a
product decision forced by a technical one, made deliberately rather than discovered late.

### 4. The count you stopped paying for

In Classic WordPress you got `found_posts` for free, and `paginate_links()` used it to print
"Page 2 of 12". It was never free. `WP_Query` obtains it by adding `SQL_CALC_FOUND_ROWS` to the
main query, which forces MySQL to evaluate the **entire** matching set even though it returns ten
rows — and then a `SELECT FOUND_ROWS()` to read the number. On a big, filtered `wp_postmeta` join
that is the most expensive part of the request. The classic optimisation is to opt out:

```php
// The Classic WordPress trick you already know — no total, no full scan.
$q = new WP_Query( [ 'post_type' => 'incident', 'posts_per_page' => 10, 'no_found_rows' => true ] );
```

Relay connections make that opt-out the default. `hasNextPage` does not need a total: ask for
`first + 1` rows, and if the extra row exists there is a next page. One boolean, no count, no full
evaluation of the matching set.

| Question | Classic | GraphQL |
|---|---|---|
| Is there more? | `$paged < $query->max_num_pages` | `pageInfo.hasNextPage` — cheap |
| How many in total? | `$query->found_posts` — expensive | **not in `pageInfo`** — you must design for it |
| How many pages? | `max_num_pages` | derivable only from a total you do not have |

When you genuinely need a total, you have three options and they are not equal:

| Option | Cost | Use when |
|---|---|---|
| A denormalised counter — `wp_term_taxonomy.count` for term archives | **one indexed read**; WordPress maintains it | Always, when the count is per-term. This is exactly why `scapegoat` is a taxonomy — Lesson 03.3 and 05.4 |
| A custom root field running one `COUNT(*)` | one extra query, unfiltered by cursor | A headline number ("40 incidents and counting") |
| The `wp-graphql-offset-pagination` extension | brings back `OFFSET` **and** `SQL_CALC_FOUND_ROWS`, with the drift from §3 | A wp-admin-style table where jumping to page 7 is a requirement. Not in this app. |

### 5. Every connection needs an explicit, bounded `first`

Ask for a connection with no `first` and WPGraphQL supplies 10. Ask for `first: 500` and you get
100 — the cap from `graphql_connection_max_query_amount`. Both numbers are real, and relying on
either is still wrong:

| Behaviour | Detail |
|---|---|
| No `first` or `last` | Defaults to **10**, via the `graphql_connection_default_query_amount` filter |
| `first` above the cap | **Silently truncated to 100.** No error. A `graphql_debug` notice appears in `extensions` only when debug mode is on |
| `first: -1` | A `UserError` — negative amounts are rejected |
| `first` **and** `last` together | A `UserError` — pick a direction |

Silent truncation is the trap. A component asking for `first: 250` renders 100 items, looks
plausible, and is quietly wrong until someone counts. So:

> **Write the bound in the query, where a reviewer can see it.** A default is a global that
> someone else can change; a `first: 12` next to a grid that renders twelve cards is a
> self-documenting contract. This is a stated project rule in
> [appendix 05 §2](../appendix/05-graphql-cheatsheet.md#2-connections-and-pagination), and
> `@graphql-eslint` enforces it once the committed documents exist in Module 10.

The real denial-of-service is not one big number, it is **nesting**, because the counts multiply:

```
incidents(first: 100) {           100 posts
  nodes {
    scapegoats(first: 100) {        × 100 terms   = 10 000 term rows
      nodes {
        contentNodes(first: 100) {    × 100 posts = 1 000 000 nodes
          nodes { title }
```

Each level is individually within the cap. Together they are a request that costs the server
minutes and the caller one round trip. That asymmetry — cheap to ask, expensive to answer — is the
security property that makes a query language different from a set of endpoints, and it is why
Lesson 06.4 adds a depth limit and a complexity budget on top of the per-connection cap.

### 6. `where` arguments are the argument array, with one gap

`where` carries what you used to put in the `WP_Query` array. The full set for a post connection,
verified against the schema you now have:

| `where` argument | Type | `WP_Query` equivalent |
|---|---|---|
| `search` | `String` | `s` |
| `status` / `stati` | `PostStatusEnum` / `[PostStatusEnum]` | `post_status` |
| `orderby` | `[PostObjectsConnectionOrderbyInput]` | `orderby` + `order` |
| `dateQuery` | `DateQueryInput` | `date_query` |
| `in` / `notIn` | `[ID]` | `post__in` / `post__not_in` |
| `name` / `nameIn` | `String` / `[String]` | `name` / `post_name__in` |
| `parent` / `parentIn` / `parentNotIn` | `ID` / `[ID]` | `post_parent*` |
| `author` / `authorName` / `authorIn` / `authorNotIn` | `Int` / `String` / `[ID]` | `author*` |
| `title` | `String` | `title` |
| `hasPassword` / `password` | `Boolean` / `String` | `has_password` / `post_password` |
| `contentTypes` | `[ContentTypeEnum]` | `post_type`, on multi-type connections |
| `categoryName` / `categoryId` / `categoryIn` / `tag` / `tagSlugIn` / … | assorted | `category*` / `tag*` — **core taxonomies only** |

Read the last row twice. **Core WPGraphQL ships taxonomy `where` arguments for `category` and
`post_tag` and nothing else. There is no `taxQuery` and no `metaQuery`.** That is deliberate on
the plugin's part: a generic `tax_query` builder exposed on a public endpoint lets any caller
construct arbitrary joins, and a generic `meta_query` builder lets them construct arbitrary
unindexed scans. WPGraphQL declines to hand that out by default, and this project agrees.

So how do you filter incidents by `severity` or `scapegoat`? Three routes, with a verdict:

| Route | Shape | Verdict |
|---|---|---|
| **Traverse from the term** | `scapegoat(id: $slug, idType: SLUG) { incidents(first: 10) { … } }` | ✅ **Use this for single-facet pages** — `/scapegoats/[slug]`, `/incidents?severity=…`. Zero extra plugins; core does an indexed `tax_query`. Cannot AND two taxonomies. |
| **A generic `taxQuery` extension** | `where: { taxQuery: { taxArray: [ … ] } }` | ❌ Not installed. It re-opens exactly the surface core closed, and it is not in the plugin inventory in [appendix 03 §8](../appendix/03-content-model-reference.md#8-plugin-inventory). |
| **Register a narrow argument yourself** | `where: { severityIn: $severities }` | ✅ **What this project does, in Lesson 06.1** — but exactly **one** argument, not three. `register_graphql_fields()` on `RootQueryToIncidentConnectionWhereArgs`, plus a `graphql_post_object_connection_query_args` filter that intersects the incoming slugs with the closed severity set and maps them to one `tax_query` clause. |

Rows two and three look similar and are not. The extension hands out a *builder*: any taxonomy,
any value, any operator, nested, from an anonymous caller. Row three hands out a *filter*: one
taxonomy, four values, one operator, and a server-side intersection against the closed term set
so no caller-supplied string reaches `WP_Query`. That is the difference between reviewing every
query plan your endpoint can produce and reviewing none of them.

**One argument and not three, and the reason is a defect class rather than taste.**
`severityIn` has two callers — `HomepageFeeds` in Lesson 10.5 and `IncidentTicker` in
Lesson 14.4, both of which need severity on a *root* connection, which traversal cannot give
them. `scapegoatIn` and `techStackIn` would have none: `/incidents` narrows by those two in the
client, in Lesson 09.2's `IncidentBrowser`, and every single-facet page traverses from the term.
An argument nothing sends is schema you version, document and deprecate for free. Until
Lesson 06.1, and for the whole of this lesson, facet by **traversal** — Step 5. Nothing else
exists yet, and an unregistered input key is a validation error with `data: null`, not an empty
list.

### 7. Ordering, and why it belongs in the query

```graphql
incidents(
  first: 10
  where: { orderby: { field: DATE, order: DESC }, status: PUBLISH }
)
```

`orderby` takes a **list** of `{ field, order }` pairs, so multi-key sorts are expressible;
passing a single object is coerced into a one-element list. `PostObjectsConnectionOrderbyEnum`
offers `DATE`, `MODIFIED`, `TITLE`, `SLUG`, `AUTHOR`, `COMMENT_COUNT`, `MENU_ORDER`, `IN`,
`PARENT` and a couple more — all of them columns on `wp_posts` or an explicit ordering. There is
no `META_VALUE` option, for the same reason there is no `metaQuery`: sorting by
`estimated_cost_usd` means a filesort over an unindexed `wp_postmeta` column, and the schema does
not offer a foot-gun it cannot make fast.

Two rules follow, and both cost people an afternoon when broken:

1. **Ordering must be stable, or cursors lie.** `DATE DESC` plus the implicit `ID` tie-breaker is
   stable. `RAND` would make cursors meaningless.
2. **A cursor belongs to its ordering.** Hold an `endCursor` from a `DATE DESC` page, then re-run
   with `TITLE ASC` and the same cursor, and you get a coherent-looking, entirely wrong page.
   When the sort changes, drop the cursors and start from page one.

---

## Task

### Step 1: Look at all four parts of a connection at once

In GraphiQL (<http://localhost:8080/wp-admin/admin.php?page=graphiql-ide>), run this. It is the
only time in the course you will ask for `nodes` and `edges` together — the point is to see that
they are two views of one result.

```graphql
# queries.graphql — scratch. Exploration only; do not keep this one.
query ConnectionAnatomy {
  incidents(first: 3, where: { status: PUBLISH, orderby: { field: DATE, order: DESC } }) {
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
    nodes {
      databaseId
      slug
    }
    edges {
      cursor
      node {
        slug
      }
    }
  }
}
```

**Verify §1:**

- [ ] `nodes` and `edges[].node` contain the same three incidents in the same order.
- [ ] `pageInfo.endCursor` is identical to the `cursor` of the third edge.
- [ ] `hasNextPage` is `true` and `hasPreviousPage` is `false`.

### Step 2: Decode a cursor

A cursor is opaque **by contract**, not by encryption. Look inside one once, so you understand
what you are holding, and then never parse one in application code.

```bash
CURSOR=$(curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first: 1) { pageInfo { endCursor } nodes { databaseId } } }"}' \
  | jq -r '.data.incidents.pageInfo.endCursor')

echo "$CURSOR"
echo -n "$CURSOR" | base64 -d; echo
```

**Verify §2:**

- [ ] The decoded value is `arrayconnection:<n>`.
- [ ] `<n>` equals the `databaseId` of the returned incident.

> **Never build, parse or store a cursor in the front end.** It is an implementation detail of the
> connection that produced it. The moment your code does `base64decode(cursor)`, you are coupled
> to WPGraphQL's internals and a plugin update can break your pagination.

### Step 3: Page forward with `after`

```bash
# Page 1 — remember the endCursor
P1=$(curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"query($first:Int!,$after:String){ incidents(first:$first, after:$after, where:{status:PUBLISH, orderby:{field:DATE, order:DESC}}) { pageInfo{ hasNextPage endCursor } nodes{ slug } } }","variables":{"first":5}}')

echo "$P1" | jq -r '.data.incidents.nodes[].slug'
CUR=$(echo "$P1" | jq -r '.data.incidents.pageInfo.endCursor')

# Page 2 — same operation, one more variable
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d "$(jq -cn --arg after "$CUR" '{query:"query($first:Int!,$after:String){ incidents(first:$first, after:$after, where:{status:PUBLISH, orderby:{field:DATE, order:DESC}}) { pageInfo{ hasNextPage endCursor } nodes{ slug } } }", variables:{first:5, after:$after}}')" \
  | jq -r '.data.incidents.nodes[].slug'
```

**Verify §3:**

- [ ] Ten distinct slugs across the two pages, with **no repeats**.
- [ ] The query text was byte-identical for both pages. Only the variables changed — that is the
      property Lesson 05.3 and Module 10's persisted queries both depend on.

### Step 4: Watch offset paging drift, and cursor paging not

This is the demonstration that makes §3 concrete. The WordPress REST API pages by offset, so use
it as the counter-example against the same data.

```bash
# 4a. REST page 1 (offset 0). Note the LAST slug.
curl -s 'http://localhost:8080/wp-json/wp/v2/incident?per_page=5&page=1&_fields=slug' | jq -r '.[].slug'

# 4b. GraphQL page 1. Note the endCursor.
G1=$(curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:5, where:{status:PUBLISH, orderby:{field:DATE, order:DESC}}) { pageInfo{ endCursor } nodes{ slug } } }"}')
echo "$G1" | jq -r '.data.incidents.nodes[].slug'
CUR=$(echo "$G1" | jq -r '.data.incidents.pageInfo.endCursor')

# 4c. Somebody publishes an incident while your user is reading page 1.
NEW_ID=$(docker compose run --rm wpcli wp post create \
  --post_type=incident --post_status=publish \
  --post_title="Someone Deployed On A Friday" --porcelain | tr -d '\r')
echo "inserted post $NEW_ID"

# 4d. REST page 2 (offset 5) — the last slug from 4a is back.
curl -s 'http://localhost:8080/wp-json/wp/v2/incident?per_page=5&page=2&_fields=slug' | jq -r '.[].slug'

# 4e. GraphQL page 2 (after the cursor) — no repeat.
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d "$(jq -cn --arg a "$CUR" '{query:"query($a:String){ incidents(first:5, after:$a, where:{status:PUBLISH, orderby:{field:DATE, order:DESC}}) { nodes{ slug } } }", variables:{a:$a}}')" \
  | jq -r '.data.incidents.nodes[].slug'

# 4f. Clean up. The seed count must return to 40.
docker compose run --rm wpcli wp post delete "$NEW_ID" --force
docker compose run --rm wpcli wp post list --post_type=incident --format=count
```

**Verify §4:**

- [ ] In 4d, the **last slug from 4a appears again** as the first item of REST page 2.
- [ ] In 4e, none of the five slugs from the GraphQL page 1 appear again.
- [ ] After 4f the incident count is `40` again.

### Step 5: Build the two list operations

`IncidentsList` is the front end's `/incidents` query. Right now it carries `first`, `after`,
`search`, `status` and `orderby`; Lesson 06.1 adds the three facet arguments and you will come
back and extend it.

```graphql
# queries.graphql — scratch. Keep both of these; Lesson 10.2 commits them.

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
      id
      databaseId
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
  }
}

query IncidentsByScapegoat($slug: ID!, $first: Int!, $after: String) {
  scapegoat(id: $slug, idType: SLUG) {
    name
    slug
    count
    incidents(first: $first, after: $after, where: { status: PUBLISH }) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        slug
      }
    }
  }
}
```

Run `IncidentsList` with `{ "first": 10 }`, then with `{ "first": 10, "search": "dns" }`, then
`IncidentsByScapegoat` with `{ "slug": "the-intern", "first": 5 }`.

**Verify §5:**

- [ ] `IncidentsList` returns 10 nodes and `hasNextPage: true`.
- [ ] The `search` variant returns fewer nodes than the unfiltered one.
- [ ] `IncidentsByScapegoat` returns a non-null `scapegoat`, and `count` matches the number of
      published incidents you can page through. If `scapegoat` is `null`, you passed a slug
      without `idType: SLUG` — that trap gets its own section in Lesson 05.3.

### Step 6: Meet the cap, and notice it does not tell you

```bash
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first: 500) { nodes { slug } } }"}' \
  | jq '{returned: (.data.incidents.nodes | length), errors: .errors}'
```

**Verify §6:**

- [ ] `returned` is at most 100 — not 500, and not 40-plus-an-error.
- [ ] `errors` is `null`. **The truncation is silent.** Write that down; it is the reason every
      query in this course states its own bound.

### Step 7: Save your work

Both operations from Step 5 belong in your scratch `queries.graphql` under the names the module
README's table uses. Delete `ConnectionAnatomy` — it was a teaching query, not an application
query.

---

## Verification

```bash
cd wordpress-headless

# 1. The connection returns all four parts, and edges agree with nodes
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:3, where:{status:PUBLISH}) { pageInfo{ hasNextPage endCursor } nodes{ slug } edges{ cursor node{ slug } } } }"}' \
  | jq -c '{nodes: [.data.incidents.nodes[].slug], edges: [.data.incidents.edges[].node.slug], hasNext: .data.incidents.pageInfo.hasNextPage}'
# Expected: nodes and edges are the same three slugs, in the same order; hasNext true

# 2. endCursor decodes to arrayconnection:<databaseId> of the last node
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:1) { pageInfo{ endCursor } nodes{ databaseId } } }"}' \
  | jq -r '"\(.data.incidents.pageInfo.endCursor) \(.data.incidents.nodes[0].databaseId)"' \
  | while read -r c id; do echo "$(echo -n "$c" | base64 -d) vs $id"; done
# Expected: arrayconnection:<id> vs <id>   — the two numbers match

# 3. Two pages, ten distinct slugs, no overlap
A=$(curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:5, where:{status:PUBLISH, orderby:{field:DATE,order:DESC}}) { pageInfo{ endCursor } nodes{ slug } } }"}')
CUR=$(echo "$A" | jq -r '.data.incidents.pageInfo.endCursor')
B=$(curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d "$(jq -cn --arg a "$CUR" '{query:"query($a:String){ incidents(first:5, after:$a, where:{status:PUBLISH, orderby:{field:DATE,order:DESC}}) { nodes{ slug } } }", variables:{a:$a}}')")
{ echo "$A" | jq -r '.data.incidents.nodes[].slug'; echo "$B" | jq -r '.data.incidents.nodes[].slug'; } | sort | uniq -d
# Expected: no output — no slug appears twice

# 4. hasNextPage is false on the last page (40 seeded incidents, 40 requested)
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:40, where:{status:PUBLISH}) { pageInfo{ hasNextPage } nodes{ slug } } }"}' \
  | jq -c '{count: (.data.incidents.nodes | length), hasNext: .data.incidents.pageInfo.hasNextPage}'
# Expected: {"count":40,"hasNext":false}

# 5. NEGATIVE — first: 500 is silently capped at 100 and raises NO error
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first: 500) { nodes { slug } } }"}' \
  | jq '{returned: (.data.incidents.nodes | length), errors: .errors}'
# Expected: returned <= 100 and errors null. Silent truncation is the point.

# 6. NEGATIVE — a negative amount IS an error
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first: -1) { nodes { slug } } }"}' | jq -r '.errors[0].message'
# Expected: first must be a positive integer.

# 7. NEGATIVE — first and last together are rejected
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first: 5, last: 5) { nodes { slug } } }"}' | jq -r '.errors[0].message'
# Expected: a message saying `first` and `last` cannot be used together

# 8. NEGATIVE — there is no taxQuery argument in this schema (Key Concept 6)
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:1, where:{ taxQuery: { relation: AND } }) { nodes{ slug } } }"}' \
  | jq -r '.errors[0].message'
# Expected: Field "taxQuery" is not defined by type
#           "RootQueryToIncidentConnectionWhereArgs". Did you mean "dateQuery"?
#           That stays true forever — Lesson 06.1 §9 adds ONE argument, `severityIn`, to
#           that same input type, and never a taxQuery. Until then, facet by traversal.

# 9. Faceting by traversal works, and the term count agrees with the connection
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ scapegoat(id: \"the-intern\", idType: SLUG) { count incidents(first: 100, where:{status:PUBLISH}) { nodes { slug } } } }"}' \
  | jq -c '{termCount: .data.scapegoat.count, returned: (.data.scapegoat.incidents.nodes | length)}'
# Expected: termCount equals returned

# 10. Ordering is honoured — DESC and ASC are mirror images
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ desc: incidents(first:3, where:{orderby:{field:DATE,order:DESC}}) { nodes{ slug } } asc: incidents(first:3, where:{orderby:{field:DATE,order:ASC}}) { nodes{ slug } } }"}' \
  | jq -c '{desc: [.data.desc.nodes[].slug], asc: [.data.asc.nodes[].slug]}'
# Expected: two different sets of three slugs

# 11. A cursor from one ordering is meaningless in another — prove it to yourself
D=$(curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ incidents(first:5, where:{orderby:{field:DATE,order:DESC}}) { pageInfo{ endCursor } } }"}' | jq -r '.data.incidents.pageInfo.endCursor')
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d "$(jq -cn --arg a "$D" '{query:"query($a:String){ incidents(first:5, after:$a, where:{orderby:{field:TITLE,order:ASC}}) { nodes{ slug title } } }", variables:{a:$a}}')" \
  | jq -r '.data.incidents.nodes[].title'
# Expected: a page that is internally consistent but is NOT "the next five by title" —
#           possibly even empty. No error is raised anywhere. This is why a change of
#           sort order must reset pagination to the first page.

# 12. Your scratch file has both operations, named as the module README expects
cd .. && grep -c -E '^query (IncidentsList|IncidentsByScapegoat)' queries.graphql
# Expected: 2
```

## Control Questions

1. A user loads page 1 of `/incidents`, and while they read it an editor unpublishes the third
   item. Describe what the cursor-paginated "load more" returns, and what an offset-paginated one
   would have returned.
2. `pageInfo` has no `total`. Name the two costs of adding one, and say which of the three
   options in Key Concept 4 you would choose for a "40 incidents and counting" headline, and why.
3. `incidents(first: 500)` returns 100 items and no error. Explain why silence is worse than an
   error here, and name the filter you would use to change the cap.
4. Core WPGraphQL exposes `categoryName` but no `severityIn`. Explain the security reasoning
   behind that asymmetry, then say why Lesson 06.1 can safely register `severityIn` when the
   generic `taxQuery` extension is refused, and how the other two facets get done without it.
5. You hold an `endCursor` produced under `orderby: { field: DATE, order: DESC }` and reuse it
   with `TITLE, ASC`. What does the server do, what does the user see, and what should the client
   have done when the sort control changed?

## Learn More

- [Relay Cursor Connections specification](https://relay.dev/graphql/connections.htm) — the
  source of `edges`, `nodes`, `pageInfo` and the `first`/`after` contract; short and worth reading
  in full once
- [GraphQL — Pagination](https://graphql.org/learn/pagination/) — why the community converged on
  cursors, with the plain-offset alternatives shown honestly
- [WPGraphQL — Connections](https://www.wpgraphql.com/docs/connections) — WPGraphQL's own
  treatment, including the arguments available on each connection type. The separate
  Pagination-and-Cursors page it used to link is gone; for where `arrayconnection:` actually comes
  from, base64-decode a cursor from your own response, which Verification check 4 has you do
- [`WP_Query` — Pagination Parameters](https://developer.wordpress.org/reference/classes/wp_query/#pagination-parameters) —
  `no_found_rows`, `offset`, `paged`; the Classic side of Key Concept 4
- [MySQL — LIMIT Query Optimization](https://dev.mysql.com/doc/refman/8.0/en/limit-optimization.html) —
  the paragraph explaining why `LIMIT 10 OFFSET 100000` is slow, which is the whole argument for
  keyset pagination
- [`wp-graphql-offset-pagination`](https://github.com/valu-digital/wp-graphql-offset-pagination) —
  read the README to see exactly what you would be buying back, and at what price
