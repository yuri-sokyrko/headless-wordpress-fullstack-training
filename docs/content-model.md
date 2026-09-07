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
