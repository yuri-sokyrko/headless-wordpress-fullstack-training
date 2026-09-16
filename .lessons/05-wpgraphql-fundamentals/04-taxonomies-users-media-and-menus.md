---
title: 'Taxonomies, Users, Media & Menus'
module: 5
lesson: 4
teaches: [taxonomy-queries, media-queries, menu-queries, content-node-interface, typename-narrowing]
produces: []
requires: [3.3, 5.2]
---

# Lesson 05.4 — Taxonomies, Users, Media & Menus

## Quick Overview

Not everything is a post. This lesson queries the other four things the front end needs: **terms**
(the scapegoat leaderboard and the severity facet), **users** (an incident's author, and the
`viewer` you will use in Module 15), **media** (featured images with their generated sizes, which
`next/image` needs in Module 14), and **menus** — the answer to "how do I do `wp_nav_menu()`
here?". The menu answer is `menuItems(where: { location: PRIMARY })`, returning a flat list with
`parentId` on each item that you assemble into a tree yourself.

The leaderboard is where Module 03's modelling decision cashes out. `scapegoats(where: {
orderby: COUNT, order: DESC })` reads the denormalised `wp_term_taxonomy.count` — one indexed
read, no grouped `COUNT(*)` over `wp_postmeta` — and you can prove it with the `EXPLAIN` skills
from Lesson 02.3. It also exposes the caveat honestly: `count` tracks published posts only, so
the pending incidents from Lesson 03.4 are invisible to it, which is correct here and would be
wrong in a moderation dashboard. Finally you query `tech_stack`'s cross-type connection, which
returns a `ContentNode` interface across `incident`, `tech_review` and `post`, and you narrow it
with `__typename` and one inline fragment per concrete type — the pattern Module 14's
`BlockRenderer` generalises.

By the end of this lesson you will have:

- `ScapegoatLeaderboard` ordered by term `count`, with `EXPLAIN` proof of the indexed read
- `ScapegoatBySlug` including the `scapegoatProfile` term field group from Lesson 04.3
- `SiteChrome` — `siteSettings` plus `menuItems(where: { location: PRIMARY })` in one request
- A media query returning `sourceUrl`, `altText`, `mediaDetails { width height }` and the
  registered sizes
- A `tech_stack` query across three post types, narrowed with `__typename` and inline fragments
- A written note on what `wp_term_taxonomy.count` does and does not count

## Classic WP Analogy

| Classic WordPress | WPGraphQL |
|---|---|
| `get_terms(['taxonomy' => 'scapegoat', 'orderby' => 'count'])` | `scapegoats(where: { orderby: COUNT })` |
| `get_term_meta()` / `get_field('tagline', 'scapegoat_' . $id)` | `scapegoat { scapegoatProfile { tagline } }` |
| `get_the_author_meta('display_name')` | `author { node { name } }` |
| `wp_get_attachment_image_src($id, 'large')` | `featuredImage { node { sourceUrl(size: LARGE) } }` |
| `wp_get_attachment_metadata()` | `mediaDetails { width height sizes { ... } }` |
| `wp_nav_menu(['theme_location' => 'primary'])` | `menuItems(where: { location: PRIMARY })` |
| `get_posts(['tax_query' => [...]])` across types | a `ContentNode` connection + `__typename` |

Read that table as a translation exercise, not a list of new features. Every left-hand entry is
a function you have called; every right-hand entry hits the same tables through the same core
APIs. `get_option('btt_site_settings')` becomes a root-query field. Registered image sizes are
still registered image sizes — `add_image_size()` in PHP is what makes `size: LARGE` available
in the schema, so the two halves of the course stay coupled in exactly one place.

**Where the analogy breaks down:** `wp_nav_menu()` does not return data, it returns **markup** —
a nested `<ul>` with classes, current-item detection, ARIA attributes and a walker you can
subclass. `menuItems` returns a flat list of records with `parentId`, and everything
`wp_nav_menu()` did for you is now yours to write in React: build the tree, decide the markup,
compute the active item from the current route, and get the accessibility right. That is the
single largest amount of previously-free functionality that decoupling takes away, and it is
worth knowing before Module 11 asks you to build the app shell. The compensation is real —
your navigation becomes a typed data structure a component can render however the design
requires, instead of markup you fight a walker to modify — but it is a rebuild, not a
translation.

---

## Key Concepts

### 1. Terms are nodes, with their own root fields and their own `where`

Every taxonomy you registered with `show_in_graphql` produces a pair of root fields named from
`graphql_single_name` and `graphql_plural_name`:

| Taxonomy | Single | Plural | Term type |
|---|---|---|---|
| `scapegoat` | `scapegoat(id:, idType:)` | `scapegoats(first:, where:)` | `Scapegoat` |
| `severity` | `severity(id:, idType:)` | `severities(first:, where:)` | `Severity` |
| `tech_stack` | `techStack(id:, idType:)` | `techStacks(first:, where:)` | `TechStack` |

Term connections are Relay connections exactly like post connections — `first`, `after`,
`pageInfo`, the same 100-item cap. Their `where` input maps onto `get_terms()`:

| `where` argument | `get_terms()` |
|---|---|
| `orderby: COUNT \| NAME \| SLUG \| TERM_ID \| DESCRIPTION` | `orderby` |
| `order: ASC \| DESC` | `order` |
| `hideEmpty: Boolean` | `hide_empty` |
| `slug: [String]` | `slug` |
| `include` / `exclude` | `include` / `exclude` |
| `search` / `nameLike` / `descriptionLike` | `search` / `name__like` / `description__like` |
| `childOf` / `parent` / `childless` | the hierarchy args |
| `objectIds: [ID]` | `object_ids` — terms attached to these posts |
| `padCounts` / `updateTermMetaCache` | `pad_counts` / `update_term_meta_cache` — the latter matters in Lesson 06.4 |

> **`hideEmpty` defaults to `false` in WPGraphQL**, which is the opposite of what `get_terms()`
> does in a theme. So a leaderboard query returns your ten seeded scapegoats even if two of them
> have never been blamed. That is usually what a leaderboard wants; a facet list usually wants
> `hideEmpty: true`, because a filter that returns nothing is worse than no filter.

### 2. The leaderboard, and exactly what `count` counts

This is the lesson where Module 03's modelling decision pays out. `scapegoat` is a taxonomy, so
WordPress maintains `wp_term_taxonomy.count` on every publish, unpublish and delete. The
leaderboard is therefore a read of a maintained integer:

```
scapegoats(where: { orderby: COUNT, order: DESC })  becomes
    SELECT t.name, t.slug, tt.count FROM wp_terms t
      INNER JOIN wp_term_taxonomy tt USING (term_id)
     WHERE tt.taxonomy = 'scapegoat' ORDER BY tt.count DESC LIMIT 20
    ── two small tables, an index on taxonomy, no scan

the same leaderboard if `scapegoat` were an SCF field would be
    SELECT m.meta_value, COUNT(*) c FROM wp_postmeta m
      INNER JOIN wp_posts p ON p.ID = m.post_id
     WHERE m.meta_key = 'scapegoat' AND p.post_status = 'publish'
     GROUP BY m.meta_value ORDER BY c DESC LIMIT 20
    ── a scan of wp_postmeta, a temporary table, a filesort
```

You proved that difference with `EXPLAIN` in Lesson 02.3; Step 2 of the Task has you prove it
again against the real leaderboard so the number is yours rather than mine.

Now the caveat, because a denormalised counter is only as honest as its definition:

| `count` includes | `count` excludes |
|---|---|
| Posts with a **published** status, of every post type attached to the taxonomy | `pending` incidents — the whole moderation queue from Lesson 03.4 |
| | `draft`, `private`, `trash` |
| | Anything the current user can see but the public cannot |

For a public leaderboard that is exactly right: blame is only real once it is published. For a
**moderation dashboard** it would be wrong, and no argument to `scapegoats` fixes it — you would
need a custom field running its own counting query. Knowing which of those two you are building
before you pick the field is the entire skill.

### 3. Term field groups: SCF on something that is not a post

`Scapegoat Profile` from [appendix 03 §4.2](../appendix/03-content-model-reference.md#42-scapegoat-profile)
is an SCF field group whose location rule is `taxonomy == scapegoat`. WPGraphQL for SCF exposes it
as a field on the term type:

```graphql
scapegoat(id: "the-intern", idType: SLUG) {
  name
  count
  scapegoatProfile {
    tagline
    defensiveness
    isSentient
    firstBlamedOn
    officialExcuse
    avatar { node { sourceUrl altText } }    # note the edge hop
  }
}
```

Two details will trip you:

| Detail | Why |
|---|---|
| `avatar { node { … } }` | An SCF image field is a **connection**, typed `AcfMediaItemConnectionEdge`. The extra `node` hop is the edge, and Lesson 05.2 §2 explains why it exists. |
| Values live in `wp_termmeta`, not `wp_postmeta` | Same EAV shape, same absence of a value index. A leaderboard sorted by `defensiveness` would be the slow query again — which is why the leaderboard sorts by `count`. |

### 4. One taxonomy, three post types: the `ContentNode` interface

`tech_stack` is attached to `incident`, `tech_review` and `post`. So "everything tagged React"
cannot be a list of one type, and WPGraphQL answers it with `contentNodes`, a connection to the
`ContentNode` **interface**:

```graphql
query TechStackContent($slug: ID!, $first: Int!) {
  techStack(id: $slug, idType: SLUG) {
    name
    contentNodes(first: $first, where: { contentTypes: [INCIDENT, TECH_REVIEW, POST] }) {
      nodes {
        __typename
        id
        uri
        ... on Incident   { title incidentDetails { downtimeMinutes } }
        ... on TechReview { title techReviewFields { ratingOverall verdict } }
        ... on Post       { title excerpt }
      }
    }
  }
}
```

`id` and `uri` can be selected outside any inline fragment because they are declared on the
interface; `title` needs a fragment because `ContentNode` does not promise it (a media item is a
content node too). And `__typename` is what makes the result renderable — Lesson 05.3 §5, and the
pattern Lesson 14.2 generalises into `BlockRenderer`.

The `where: { contentTypes: [...] }` argument is the taxonomy connection's equivalent of
`post_type` in `WP_Query`. Leave it out and you get every attached type, including any you add
later — which is a nice default until a new post type appears in a component that has no branch
for it. Being explicit is a cheap way to fail loudly instead of rendering blanks.

### 5. Users: assume everything you select is public

`author { node { name } }` replaces `get_the_author_meta('display_name')`, and the mechanics are
unremarkable. The interesting part is what WPGraphQL will and will not hand to an anonymous
caller. The `User` model is **restricted by default**: unless the requester has `list_users`,
only an allowlist of fields resolves and everything else returns `null`.

| Resolves for anonymous callers | Requires `list_users` |
|---|---|
| `id`, `databaseId`, `name`, `slug`, `uri`, `url` | `email` |
| `firstName`, `lastName`, `description` | `username` |
| `isRestricted` — the flag that tells you it happened | `roles`, `capabilities`, `registeredDate` |

Three consequences worth internalising:

> **`User.slug` is `user_nicename`, and on a lot of sites that is the login name.** Publishing it
> hands an attacker a list of valid usernames, which is the first half of credential stuffing.
> This is one reason [appendix 03 §4.1](../appendix/03-content-model-reference.md#41-incident-details)
> puts a denormalised `reporter_display_name` on the incident: a public reporter's identity on the
> front end is a string the reporter chose, not a WordPress user record joined at render time.

`viewer` is the other user field you will use, and it behaves differently on purpose: it returns
**the currently authenticated user or `null`**, never an error. From an anonymous request it is
`null`, which is why Module 15 uses it as the cheapest possible "am I logged in?" probe. It is
also the reason a `users` connection looks empty from `curl` and full in GraphiQL — anonymous
callers only see users with published posts.

### 6. Media: three ways to ask for an image, and one name collision

`add_image_size()` in PHP is still what makes a size exist. The schema simply exposes what
WordPress generated:

```graphql
featuredImage { node {
  altText
  sourceUrl                       # the full size
  large: sourceUrl(size: LARGE)   # one named size — needs an alias to sit beside the above
  srcSet(size: LARGE)             # the srcset ATTRIBUTE — one comma-separated string
  sizes(size: LARGE)              # the sizes ATTRIBUTE — also a string
  mediaDetails {
    width height
    sizes { name width height sourceUrl }   # the LIST of generated files
  }
} }
```

| Field | Returns | Use it for |
|---|---|---|
| `sourceUrl(size:)` | one URL | An `<img src>`, or `next/image`'s `src` |
| `mediaDetails { width height }` | the intrinsic dimensions | **`next/image` requires these** — they are how it reserves space and prevents layout shift (Lesson 14.5) |
| `mediaDetails { sizes { … } }` | a list of `{ name, width, height, sourceUrl }` | Picking a size yourself, or building a custom `<picture>` |
| `srcSet(size:)` | `"url 300w, url 768w, …"` | Handing a browser-ready attribute straight through |
| `sizes(size:)` | `"(max-width: 300px) 100vw, 300px"` | The companion attribute to `srcSet` |

> **`sizes` means two different things one level apart.** `mediaItem.sizes` is the HTML `sizes`
> **attribute** as a string; `mediaItem.mediaDetails.sizes` is the **list** of generated image
> files. They are not related, and confusing them produces a type error in Module 10 that reads
> like nonsense until you notice the nesting.

`Incident` has no `featuredImage` at all — `supports` in
[appendix 03 §1](../appendix/03-content-model-reference.md#supports) omits `thumbnail`. The
schema is generated from your registrations, so a missing field is a missing registration far
more often than it is a plugin bug.

### 7. The two things the theme used to do for you: menus and URI resolution

**`wp_nav_menu()` returned markup.** A nested `<ul>`, `menu-item-has-children` classes,
`current-menu-item` detection, `aria-current`, and a `Walker_Nav_Menu` you could subclass when the
design needed something else. `menuItems` returns records:

```graphql
menuItems(where: { location: PRIMARY }, first: 50) {
  nodes {
    id
    parentId          # null for top level — you build the tree
    order
    label
    uri
    target
    cssClasses
    connectedNode { node { __typename uri } }   # what this item points at, if anything
  }
}
```

| `wp_nav_menu()` gave you | Now you write it |
|---|---|
| Nested `<ul>`/`<li>` markup, and a walker to change it | Your own component tree — nothing to fight (Lesson 11.3) |
| The nesting itself | Group the flat list by `parentId` |
| `current-menu-item` and `aria-current="page"` | Compare `uri` with the current route, and set the attribute yourself |

That is the single largest amount of previously-free behaviour that decoupling takes away. What
you get back is a typed data structure and no walker; whether that is a good trade depends
entirely on how many hours of your life `Walker_Nav_Menu` has already taken.

Two preconditions, and both are silent when missing. `MenuLocationEnum`'s values come from
`register_nav_menus()` in the theme, which the `btt-headless` theme calls in Lesson 02.4 — no
registration, no `PRIMARY` value, and the query fails **validation** rather than returning
empty. And a menu is only visible to anonymous callers when it is **assigned to a
location**; an unassigned menu returns an empty connection with no error at all.

**`nodeByUri` replaces `url_to_postid()`**, and generalises it: it resolves any front-end path to
whatever node lives there — post, page, term archive, author archive, date archive.

```graphql
nodeByUri(uri: $uri) {
  __typename
  ... on Page      { id title }
  ... on Post      { id title }
  ... on Incident  { id title }
  ... on Scapegoat { id name description }
}
```

`url_to_postid()` only ever returned a post ID and returned `0` for a term archive. `nodeByUri`
runs WordPress's real rewrite parsing and tells you the type, which is exactly what a Next.js
`[...slug]` catch-all route needs in Module 09. It is also the field most sensitive to trailing
slashes: pass the URI in the form WordPress generates — check `uri` on the node itself if you are
unsure.

---

## Task

### Step 1: Create the primary menu

Menus are content, not code, so this is WP-CLI work rather than a file. The location must already
be registered by the `btt-headless` theme from Module 02.

```bash
cd wordpress-headless

docker compose run --rm wpcli wp menu location list
```

**Verify §1a:**

- [ ] A location with slug `primary` is listed. Lesson 02.4's `after_setup_theme` callback
      registers it. If the list is empty, `btt-headless` is not the active theme, or that
      `register_nav_menus()` call is missing — fix it there before continuing, because
      `MenuLocationEnum` will have no `PRIMARY` value and every menu query in this lesson will
      fail validation rather than return empty.

```bash
docker compose run --rm wpcli wp menu create "Primary"
docker compose run --rm wpcli wp menu location assign primary primary

INCIDENTS_ITEM=$(docker compose run --rm wpcli wp menu item add-custom primary "Incidents" /incidents/ --porcelain | tr -d '\r')
docker compose run --rm wpcli wp menu item add-custom primary "Scapegoats" /scapegoats/
docker compose run --rm wpcli wp menu item add-custom primary "Reviews" /reviews/
docker compose run --rm wpcli wp menu item add-custom primary "Blog" /blog/

# One child item, so you have a real tree to assemble in Module 11
docker compose run --rm wpcli wp menu item add-custom primary "Catastrophic only" \
  "/incidents/?severity=s1-catastrophic" --parent-id="$INCIDENTS_ITEM"

docker compose run --rm wpcli wp menu item list primary
```

**Verify §1b:**

- [ ] Five items, one of them with a non-zero parent.

### Step 2: Build `ScapegoatLeaderboard`, then prove it is an indexed read

```graphql
# queries.graphql — scratch. Feeds /scapegoats in Module 09.
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

Now the proof. Run both plans and compare them:

```bash
# 2a. What the leaderboard actually does — read a maintained counter
docker compose run --rm wpcli wp db query "EXPLAIN SELECT t.name, t.slug, tt.count
  FROM wp_terms t
  INNER JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id
  WHERE tt.taxonomy = 'scapegoat'
  ORDER BY tt.count DESC
  LIMIT 20;"

# 2b. What you would have to run if scapegoat were an SCF select instead of a taxonomy
docker compose run --rm wpcli wp db query "EXPLAIN SELECT m.meta_value, COUNT(*) AS c
  FROM wp_postmeta m
  INNER JOIN wp_posts p ON p.ID = m.post_id
  WHERE m.meta_key = 'scapegoat' AND p.post_status = 'publish'
  GROUP BY m.meta_value
  ORDER BY c DESC
  LIMIT 20;"
```

**Verify §2:**

- [ ] 2a touches only `wp_terms` and `wp_term_taxonomy`, with a small `rows` estimate.
- [ ] 2b shows `Using temporary; Using filesort` in `Extra`, and a `rows` estimate in the
      thousands — it has to visit every `wp_postmeta` row with that key.
- [ ] Write both `rows` numbers in your notes. This is the paragraph you quote the next time
      someone proposes "just put it in a custom field".

### Step 3: `ScapegoatBySlug`, including the term field group

```graphql
# queries.graphql — scratch. Feeds /scapegoats/[slug].
query ScapegoatBySlug($slug: ID!, $first: Int!, $after: String) {
  scapegoat(id: $slug, idType: SLUG) {
    id
    name
    slug
    description
    count
    uri
    scapegoatProfile {
      tagline
      defensiveness
      isSentient
      officialExcuse
      avatar {
        node {
          ...MediaFields
        }
      }
    }
    incidents(first: $first, after: $after, where: { status: PUBLISH }) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ...IncidentCardFields
      }
    }
  }
}
```

**Verify §3:**

- [ ] `scapegoatProfile` is present and not entirely `null`. All-`null` means the SCF group is
      missing `show_in_graphql` — Lesson 04.3.
- [ ] `avatar` needs the `node` hop. Try it without and read the validation error once.

### Step 4: Cross three post types with one query

```graphql
# queries.graphql — scratch. The "everything tagged X" page.
query TechStackContent($slug: ID!, $first: Int!) {
  techStack(id: $slug, idType: SLUG) {
    name
    slug
    count
    contentNodes(first: $first, where: { contentTypes: [INCIDENT, TECH_REVIEW, POST] }) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        __typename
        id
        uri
        date
        ... on Incident { title incidentDetails { downtimeMinutes } }
        ... on TechReview { title techReviewFields { ratingOverall verdict } }
        ... on Post { title excerpt }
      }
    }
  }
}
```

Run it with `{ "slug": "react", "first": 20 }`.

**Verify §4:**

- [ ] Every node has a `__typename`, and at least two distinct values appear. If only one does,
      pick a stack term that is genuinely used across types —
      `docker compose run --rm wpcli wp term list tech_stack --fields=slug,count` will tell you which.
- [ ] Remove `__typename` and re-run. The data is still there and the response is much harder to
      read — that is what the generated TypeScript feels like without it.

### Step 5: Media, at every level of detail

```graphql
# queries.graphql — scratch. What Lesson 14.5 hands to next/image.
query MediaLibrarySample($first: Int!) {
  mediaItems(first: $first) {
    nodes {
      id
      altText
      mimeType
      sourceUrl
      thumb: sourceUrl(size: THUMBNAIL)
      large: sourceUrl(size: LARGE)
      srcSet(size: LARGE)
      sizes(size: LARGE)
      mediaDetails {
        width
        height
        sizes { name width height sourceUrl }
      }
    }
  }
}
```

**Verify §5:**

- [ ] `mediaDetails.width` and `height` are integers on every node. Any `null` there will become
      a `next/image` runtime error in Module 14 — fix the upload now, not then.
- [ ] `srcSet` is a comma-separated **string** while `mediaDetails.sizes` is a **list**, and the
      aliases were required to ask for `sourceUrl` more than once.

### Step 6: `SiteChrome` — everything the root layout needs, in one request

```graphql
# queries.graphql — scratch. Fetched once in the root layout in Module 11.
query SiteChrome {
  generalSettings {
    title
    description
  }
  siteSettings {
    siteChrome {
      siteTagline
      primaryCtaLabel
      primaryCtaUrl
      incidentSubmissionOpen
      socialLinks { network url }
    }
  }
  menuItems(where: { location: PRIMARY }, first: 50) {
    nodes {
      id
      parentId
      order
      label
      uri
      target
      cssClasses
    }
  }
}
```

**Verify §6:**

- [ ] `menuItems.nodes` has five entries, one with a non-null `parentId`.
- [ ] `siteSettings` is populated from the SCF options page in Lesson 04.3. If it is `null`, the
      options page is missing `show_in_graphql`.
- [ ] Run it with `curl` as well as in GraphiQL. An **anonymous** caller must see the menu — if
      GraphiQL shows items and `curl` shows an empty list, the menu is not assigned to a location.

### Step 7: Resolve an arbitrary URI

```graphql
# queries.graphql — scratch. The engine of the [...slug] catch-all route in Module 09.
query NodeByUri($uri: String!) {
  nodeByUri(uri: $uri) {
    __typename
    id
    uri
    ... on Page { title }
    ... on Post { title }
    ... on Incident { title }
    ... on Scapegoat { name description }
  }
}
```

Run it four times: a page URI, a blog post URI, an incident URI and `/scapegoats/the-intern/`.

**Verify §7:**

- [ ] All four resolve, and `__typename` differs across them.
- [ ] A URI that does not exist returns `null` with no `errors` array — which is the signal your
      route handler turns into a `notFound()` in Module 09.

### Step 8: Save your work

`ScapegoatLeaderboard`, `ScapegoatBySlug`, `TechStackContent`, `MediaLibrarySample`, `SiteChrome`
and `NodeByUri` all belong in the scratch file — which completes the operation table in the
[module README](README.md). Lesson 05.5 is writes.

---

## Verification

```bash
cd wordpress-headless

# 1. The leaderboard is ordered by count, descending
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ scapegoats(first: 10, where: { orderby: COUNT, order: DESC }) { nodes { slug count } } }"}' \
  | jq -c '[.data.scapegoats.nodes[] | {slug, count}]'
# Expected: 10 terms, counts non-increasing, summing to 40 across all ten

# 2. NEGATIVE — count excludes pending posts, so the moderation queue is invisible here
docker compose run --rm wpcli wp post list --post_type=incident --post_status=pending --format=count
# Expected: whatever your seed created. Those posts are NOT in the counts above,
#           and no argument to `scapegoats` will include them.

# 3. The term field group resolves, including the image edge
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ scapegoat(id: \"the-intern\", idType: SLUG) { name scapegoatProfile { tagline defensiveness avatar { node { sourceUrl } } } } }"}' \
  | jq -c '.data.scapegoat'
# Expected: a tagline string and a numeric defensiveness (avatar may be null if unseeded)

# 4. The cross-type connection returns more than one __typename
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ techStack(id: \"react\", idType: SLUG) { contentNodes(first: 20) { nodes { __typename uri } } } }"}' \
  | jq -r '[.data.techStack.contentNodes.nodes[].__typename] | unique | @csv'
# Expected: at least two of "Incident","Post","TechReview"

# 5. NEGATIVE — a field that lives on a concrete type is not on the interface
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ techStack(id: \"react\", idType: SLUG) { contentNodes(first:1) { nodes { incidentDetails { downtimeMinutes } } } } }"}' \
  | jq -r '.errors[0].message'
# Expected: Cannot query field "incidentDetails" on type "ContentNode".
#           Narrow it with `... on Incident` instead.

# 6. Media has the dimensions next/image will require in Module 14
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ mediaItems(first: 3) { nodes { sourceUrl mediaDetails { width height sizes { name width } } srcSet(size: LARGE) } } }"}' \
  | jq -c '.data.mediaItems.nodes[0] | {w: .mediaDetails.width, h: .mediaDetails.height, sizeCount: (.mediaDetails.sizes|length), srcSetIsString: (.srcSet|type)}'
# Expected: numeric w and h, sizeCount >= 1, srcSetIsString "string"

# 7. Menu items come back to an ANONYMOUS caller, with the tree encoded as parentId
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ menuItems(where: { location: PRIMARY }, first: 50) { nodes { label uri parentId } } }"}' \
  | jq -c '{count: (.data.menuItems.nodes|length), children: [.data.menuItems.nodes[] | select(.parentId != null) | .label]}'
# Expected: count 5, children ["Catastrophic only"]
#           An empty list means the menu exists but is not assigned to a location.

# 8. NEGATIVE — a location the theme never registered fails validation
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ menuItems(where: { location: FOOTER_SOCIAL }, first: 5) { nodes { label } } }"}' \
  | jq -r '.errors[0].message'
# Expected: a "does not exist in \"MenuLocationEnum\" enum" validation error

# 9. NEGATIVE — email and username are withheld from anonymous callers
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ users(first: 3) { nodes { name slug email username isRestricted } } }"}' \
  | jq -c '.data.users.nodes'
# Expected: name and slug populated; email and username null; isRestricted true.
#           The same query in GraphiQL shows real values — that is your admin cookie,
#           not a permissive API.

# 10. NEGATIVE — viewer is null without a credential (and is NOT an error)
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ viewer { name } }"}' | jq -c '{viewer: .data.viewer, errors: .errors}'
# Expected: {"viewer":null,"errors":null} — Module 15 turns this into the session probe

# 11. nodeByUri resolves a term archive, which url_to_postid() never could
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ nodeByUri(uri: \"/scapegoats/the-intern/\") { __typename uri ... on Scapegoat { name count } } }"}' \
  | jq -c '.data.nodeByUri'
# Expected: __typename "Scapegoat", with a name and count

# 12. ...and an unknown URI is null, not an error — this becomes notFound() in Module 09
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ nodeByUri(uri: \"/definitely-not-a-real-path/\") { __typename } }"}' \
  | jq -c '{node: .data.nodeByUri, errors: .errors}'
# Expected: {"node":null,"errors":null}
```

## Control Questions

1. The blame leaderboard reads `wp_term_taxonomy.count`. Name the two states an incident can be
   in where that number is deliberately wrong for a moderator, and describe what you would build
   for a moderation dashboard instead.
2. `avatar { node { sourceUrl } }` has one more level than you would expect. Explain what the
   extra level is, and name one thing that could legitimately live on it.
3. `contentNodes` lets you select `uri` directly but not `title`. Explain why, in terms of the
   interface, and say what you must write to get the title of an incident in that list.
4. A `users` query returns `null` for `email` from `curl` and a real address in GraphiQL. Explain
   both results, and say which one is the bug.
5. `wp_nav_menu()` produced markup; `menuItems` produces records. List three specific behaviours
   you must now implement yourself, and name the two silent failure modes that make a menu query
   return nothing.

## Learn More

- [WPGraphQL — Custom Taxonomies](https://www.wpgraphql.com/docs/custom-taxonomies) — how your
  `graphql_single_name` becomes the root fields in Key Concept 1
- [WPGraphQL — Menus](https://www.wpgraphql.com/docs/menus) — the full `MenuItem` field list and
  the location enum, plus the "why is my menu empty" checklist
- [WPGraphQL — Media](https://www.wpgraphql.com/docs/media) — `sourceUrl`, `srcSet` and
  `mediaDetails`, in the plugin authors' own words
- [`get_terms()` reference](https://developer.wordpress.org/reference/functions/get_terms/) — the
  arguments the term `where` input maps onto, including `pad_counts` and `object_ids`
- [`Walker_Nav_Menu`](https://developer.wordpress.org/reference/classes/walker_nav_menu/) — one
  look at what you are no longer subclassing, before you decide how you feel about Key Concept 7
- [WPGraphQL — Interfaces](https://www.wpgraphql.com/docs/interfaces) — `ContentNode`,
  `UniformResourceIdentifiable` and how `nodeByUri` can return any of them
