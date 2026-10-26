<!-- docs/content-model.md -->

# Blame The Tech — content model map

My own map from product surface to content model. The authoritative contract is
`.lessons/appendix/03-content-model-reference.md`; this file is how I hold it in my head.
Where the two disagree, the appendix wins.

## Section to content model

| Section         | Route                                      | Post type                                            | Taxonomies                            | ACF field group                         | Custom table   |
| --------------- | ------------------------------------------ | ---------------------------------------------------- | ------------------------------------- | --------------------------------------- | -------------- |
| Incidents index | `/[locale]/incidents`                      | `incident`                                           | `scapegoat`, `severity`, `tech_stack` | `Incident Details`                      | —              |
| Incident detail | `/[locale]/incidents/[slug]`               | `incident`                                           | `scapegoat`, `severity`, `tech_stack` | `Incident Details`                      | —              |
| Scapegoats      | `/[locale]/scapegoats`                     | — (term archive, lists `incident`)                   | `scapegoat`                           | `Scapegoat Profile` (on the _taxonomy_) | —              |
| Blog            | `/[locale]/blog`                           | `post` (core, rewrite base moved to `/blog`)         | `tech_stack`                          | —                                       | —              |
| Tech reviews    | `/[locale]/reviews`                        | `tech_review`                                        | `tech_stack`                          | `Tech Review Fields`                    | —              |
| HOBT promo      | `/[locale]/hobt`                           | `page` (core, `page_template == templates/hobt.php`) | —                                     | `HOBT Promo`                            | `wp_btt_leads` |
| Auth            | `/[locale]/login`, `/register`, `/account` | — none: users are `wp_users` rows, not content       | —                                     | —                                       | —              |

Two notes on rows that surprised me:

- **Scapegoats has no post type.** The index and the detail page are both driven by
  `scapegoat` _terms_, and the editorial content on them comes from an ACF field group attached
  to the taxonomy rather than to a post. The incidents listed underneath are `incident` posts
  pulled in by term.
- **Auth is the only row that is empty all the way across.** Login, registration and the
  account page never touch a post type, a taxonomy or a field group. They operate on core
  users, the custom `incident_reporter` role, and the JWT that `login` /
  `refreshJwtAuthToken` issue. `users_can_register` stays off; signups go through the
  `registerDeveloper` mutation, which assigns the role explicitly.

`Site Settings` is not in the table because it is not a section — it is an ACF options page
exposed on the root query and fetched once in the root layout. Navigation is not in it either;
menus come from core WordPress via `menuItems(where: { location: PRIMARY })`.

## The one thing that is not a post

`wp_btt_leads` — a real MySQL table created with `dbDelta()` on plugin activation. HOBT leads
are not a `hobt_lead` post type because a post type sits one careless `show_in_rest` or
`show_in_graphql` flag away from publishing every lead address, whereas a bespoke table is
simply not reachable by WordPress's content APIs, and because the uniqueness this data needs —
one row per `(email, source)` pair — is a database constraint that posts and postmeta have no
way to express. The second reason is cheaper to state and just as decisive: eight fields per
lead would otherwise become eight unindexed `wp_postmeta` rows per lead.

`submitHobtLead` is the only mutation permitted to write to it. It is a server-to-server call
gated on the `X-BTT-App-Token` header, it re-validates every field regardless of what the Next
side already checked, and it stores `ip_hash` as an HMAC so the raw address is never persisted
or logged.

## Why `scapegoat` is a taxonomy

Blame is a label, not an entity with a life of its own. An incident pointing at DNS is the same
kind of statement as a post being filed under a category, so the natural fit is a term applied
to a post rather than a second post type joined through a relationship field. The practical
payoff shows up on the leaderboard: WordPress keeps a running tally in
`wp_term_taxonomy.count`, so ranking scapegoats by how often they have been blamed reads an
already-maintained integer. Model the same thing as an ACF relationship and the leaderboard has
to walk every `wp_postmeta` row holding a blame reference and tally them at request time,
against a `meta_value` column no index can help with. What I give up is that a term is a thin
object — no revision history, no editor-composed body, no block content. Here that gap is
covered by the `Scapegoat Profile` field group, which carries the avatar, tagline, official
excuse and defensiveness score, and that is genuinely all the scapegoat pages need. If they
ever needed real long-form editorial writing with an audit trail, this is the decision I would
have to reopen.

## Open questions

Things I do not understand yet. Each one names the module that should answer it.

- `tech_stack` is attached to three post types, so a "everything tagged React" page gets back a
  mixed connection. How do I actually query and render that — does the `ContentNode` interface
  plus `__typename` narrowing come out of codegen as a usable discriminated union, or do I
  hand-write the narrowing? I expect **Module 05** for the query shape and **Module 10** for
  whether the generated types are honest about it.
- `downtime_minutes` and `estimated_cost_usd` stay in post meta, which means a range filter on
  the incidents index is a `meta_query` against an unindexed column while the severity filter is
  an indexed `tax_query` join. At what row count does that actually start hurting, and what is
  the fix the course sanctions? I expect **Module 06** (N+1 and query limits), with the
  `EXPLAIN` groundwork from **Module 02**.
- `is_verified` exists in the GraphQL schema and is silently discarded by `createIncident`. I
  can see why the field is exposed for reading, but I do not yet know how that discard is
  written so that it cannot be forgotten — a filtered input type, or an unconditional
  server-side overwrite? I expect **Module 06** for the mutation and **Module 15** for the
  capability matrix enforced end to end.

## Block attributes (Lesson 13.2)

Module 14 reads these over GraphQL. Attribute names, types and defaults are the contract
between the two toolchains; nothing is imported across it (`docs/architecture.md`).

### `btt/incident-callout` — GraphQL type `BttIncidentCallout`

| Attribute      | Type     | Default    | `source`              | Lives in          | Notes                                                                          |
| -------------- | -------- | ---------- | --------------------- | ----------------- | ------------------------------------------------------------------------------ |
| `severity`     | `string` | `s3-minor` | —                     | the block comment | one of the four `severity` term slugs (appendix 03 §2)                         |
| `incidentSlug` | `string` | `""`       | —                     | the block comment | slug of an `incident` post. **Not validated.** A dangling slug renders no link |
| `headline`     | `string` | —          | `html`, selector `h3` | the markup        | plain text; `allowedFormats: []`                                               |
| `body`         | `string` | —          | `html`, selector `p`  | the markup        | HTML. Bold, italic and link only. **Sanitize before rendering** (Lesson 14.3)  |

An attribute at its default is **omitted** from the serialised comment, so a consumer must
apply these defaults itself.

### `btt/blame-quote` — GraphQL type `BttBlameQuote`

| Attribute     | Type     | Default | `source` | Lives in          | Notes                                                                 |
| ------------- | -------- | ------- | -------- | ----------------- | --------------------------------------------------------------------- |
| `attribution` | `string` | `""`    | —        | the block comment | plain text. **The front end renders it** — `save()` emits no `<cite>` |

Content is **inner blocks**, not attributes: `core/paragraph` and `core/list` only
(`allowedBlocks`). `save()` emits `<blockquote>` + `<InnerBlocks.Content />`, so the children
serialise themselves and arrive in Module 14 as sibling nodes with a `parentClientId`.
`templateLock: false`, written explicitly, so the block does not inherit an ancestor's lock.

### `btt/scapegoat-picker` — GraphQL type `BttScapegoatPicker`

| Attribute | Type     | Default | `source` | Lives in          | Notes                                         |
| --------- | -------- | ------- | -------- | ----------------- | --------------------------------------------- |
| `termId`  | `number` | `0`     | —        | the block comment | a `scapegoat` term ID. `0` means "not chosen" |

`save()` returns `null`, so the serialised form is the self-closing comment and the block
contributes **no HTML** to `post_content`. It is not a dynamic block: no `render.php`, no
`render_callback`, so `the_content()` prints nothing for it.

**No denormalised term data is stored** — no name, no slug, no avatar. Lesson 14.4 resolves
`termId` to a term through WPGraphQL and pays one extra query for it. Renaming the term is
therefore correct everywhere immediately; see the walkthrough in Lesson 13.3 Key Concept 8.

### `btt/incident-ticker` — GraphQL type `BttIncidentTicker`

| Attribute    | Type       | Default                          | `source` | Lives in          | Notes                                                               |
| ------------ | ---------- | -------------------------------- | -------- | ----------------- | ------------------------------------------------------------------- |
| `count`      | `number`   | `5`                              | —        | the block comment | clamped to 1–20 in `render.php`; Module 14 clamps too               |
| `severities` | `string[]` | `["s1-catastrophic","s2-major"]` | —        | the block comment | subset of the four `severity` slugs. An empty array renders nothing |

**Dynamic**: `render: file:./render.php`, `save()` absent. The comment is the whole serialised
form. The selection logic is implemented twice — `render.php` and Lesson 14.4's
`IncidentTicker.tsx` — and only the second one is consumed by visitors. See Lesson 13.4 Key
Concept 6 for why the alternatives are worse.

### `btt/hobt-cta` — GraphQL type `BttHobtCta`

| Attribute    | Type     | Default            | `source` | Lives in          | Notes                                                                                                                                                                               |
| ------------ | -------- | ------------------ | -------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`      | `string` | `"Get Demo"`       | —        | the block comment | plain text                                                                                                                                                                          |
| `href`       | `string` | `""`               | —        | the block comment | path or absolute URL. **Not validated**                                                                                                                                             |
| `variant`    | `string` | `"primary"`        | —        | the block comment | `enum`: `primary` \| `outline`. Enforced on the PHP render path only                                                                                                                |
| `leadSource` | `string` | `"hobt-cta-block"` | —        | the block comment | `enum`, **kebab-case**: `hobt-hero` \| `hobt-cta-block` \| `hobt-footer` \| `incident-sidebar`. Maps to the `LeadSource` GraphQL enum (`HOBT_CTA_BLOCK`) in Module 16, in one place |

`save()` returns `null` and there is **no** renderer, so `the_content()` prints nothing for this
block. Attributes at their default are omitted from the comment — the seeded fixture is
`{"label":"Stop blaming the tech","href":"/hobt"}` with no `variant` and no `leadSource`.

## `editorBlocks` (Lesson 14.1)

The body of every editor-composed node is `editorBlocks(flat: true)`: an ordered, flat list
where each entry carries `__typename`, `clientId`, `parentClientId`, `name` and its own typed
`attributes`. `parentClientId` is the tree; the array order is the document order.

- Every attribute is **nullable**, because an attribute at its default is omitted from the
  serialised comment entirely.
- `src/graphql/fragments/editorBlocks.graphql` is the single fragment. Its inline fragments
  **are** the set of blocks this app renders.
- Blocks registered in JavaScript but not in PHP have no concrete type and arrive as the bare
  interface.
