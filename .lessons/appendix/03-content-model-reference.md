# Appendix 03 — Content Model Reference

**This is a contract.** Every module from 03 onward cites it. Field names, GraphQL names,
term slugs and capability names here are **final** — a lesson that disagrees with this file is
wrong, not the other way round.

Keep this open in a second tab while you work through Modules 03–06 and 13–16.

Everything registered here lives in the plugin you build in Module 03,
`wordpress-headless/wp-content/plugins/blame-the-tech-core/`. Nothing goes in a theme's
`functions.php` — see Lesson 03.1 for why.

---

## 1. Post types

| Post type | `graphql_single_name` | `graphql_plural_name` | Authored by | Rewrite | Notes |
|---|---|---|---|---|---|
| `post` (core) | `Post` | `Posts` | editors | `blog` | The satirical blog. Rewrite base changed from `/` to `/blog`. |
| `page` (core) | `Page` | `Pages` | editors | — | Rendered by the Next `[...slug]` catch-all. Hosts the HOBT landing page. |
| `incident` | `Incident` | `Incidents` | **public users** | `incidents` | The core user-generated type. `capability_type: 'incident'`, `map_meta_cap: true`. |
| `tech_review` | `TechReview` | `TechReviews` | editors only | `reviews` | Satirical company reviews. |

Every type registers with:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/post-types.php
'show_in_graphql'      => true,
'show_in_rest'         => true,   // REQUIRED — the block editor does not work without it
'graphql_single_name'  => 'Incident',
'graphql_plural_name'  => 'Incidents',
```

> **`show_in_rest` is not optional even in a headless build.** The Gutenberg editor is a REST
> client. Turn REST off for a post type and the editor shows a white screen. Learners hit this
> constantly — the fix is not "disable Gutenberg", it is "leave REST on for the editor and
> simply don't consume REST from the front end".

`incident` keeps `publicly_queryable => true` so that permalink generation and
`preview_post_link` behave normally, even though the `btt-headless` theme redirects every
front-end hit to Next. The WP-rendered archive is never user-visible.

### `supports`

| Post type | `supports` |
|---|---|
| `post` | title, editor, excerpt, thumbnail, revisions, author, comments |
| `page` | title, editor, thumbnail, revisions, page-attributes |
| `incident` | title, editor, revisions, author, custom-fields |
| `tech_review` | title, editor, thumbnail, revisions |

---

## 2. Taxonomies

| Taxonomy | Object types | Hierarchical | `graphql_single_name` | `graphql_plural_name` | Rewrite |
|---|---|---|---|---|---|
| `scapegoat` | `incident` | no | `Scapegoat` | `Scapegoats` | `scapegoats` |
| `severity` | `incident` | no | `Severity` | `Severities` | `severity` |
| `tech_stack` | `incident`, `tech_review`, `post` | no | `TechStack` | `TechStacks` | `stack` |

### Why these are taxonomies and not ACF fields

Two modelling decisions carry real weight, and both are lessons rather than conveniences.

**`scapegoat` is a taxonomy, not a CPT with a relationship field.** "This incident blames that
thing" is classification. The payoff is that WordPress maintains `wp_term_taxonomy.count` for
you, so the blame leaderboard is **one indexed read** instead of a `COUNT(*)` grouped over
`wp_postmeta`. Term archives, term URLs and `tax_query` joins come free.

> **The cost, stated plainly:** terms have no revisions and no rich editorial body. The
> `Scapegoat Profile` ACF term field group in §4 covers everything this app actually needs, but
> if scapegoats ever needed long-form editorial content with revision history, this decision
> would have to be revisited. Model the relationship you have, not the one you might want.

**`severity` is a taxonomy with a locked term list, not an ACF select.** Filtering
`/incidents?severity=s1-catastrophic` becomes an indexed `tax_query` join rather than a
`meta_query` string comparison against an unindexed `meta_value` column. The term UI is locked
to radio buttons via `meta_box_cb` so editors cannot invent "S5 kinda bad".

Numeric and range facets — `downtime_minutes`, `estimated_cost_usd` — **cannot** be taxonomies
and stay in post meta. That is deliberate: it gives the course a genuinely correct design *and*
a genuinely realistic performance trap, which is where the Module 02 `EXPLAIN` lesson and the
Module 06 N+1 lesson both land.

`tech_stack` spans three post types on purpose. It forces you to handle WPGraphQL's
`ContentNode` interface and `__typename` narrowing when rendering "everything tagged React".

### Seeded terms

`scapegoat` — free-form, but these ten are created on plugin activation:

| Slug | Name |
|---|---|
| `the-intern` | The Intern |
| `mercury-retrograde` | Mercury Retrograde |
| `legacy-jquery` | Legacy jQuery |
| `dns` | DNS |
| `solar-flares` | Solar Flares |
| `the-cache` | The Cache |
| `daylight-saving-time` | Daylight Saving Time |
| `that-one-regex` | That One Regex |
| `kubernetes` | Kubernetes |
| `the-previous-contractor` | The Previous Contractor |

`severity` — **closed set.** Created on activation, term UI locked, never extended:

| Slug | Name | Meaning |
|---|---|---|
| `s1-catastrophic` | S1 — Catastrophic | Production is a smoking crater |
| `s2-major` | S2 — Major | Users noticed and tweeted |
| `s3-minor` | S3 — Minor | Users noticed, said nothing |
| `s4-cosmetic` | S4 — Cosmetic | Only you noticed |

`tech_stack` — free-form. Seeded: React, Next.js, WordPress, PHP, MySQL, AWS, Docker,
Kubernetes, jQuery, Redis.

---

## 3. Registered GraphQL enums

The plugin registers real GraphQL enums rather than leaking bare strings, so codegen produces
union types in TypeScript instead of `string`.

| Enum | Values |
|---|---|
| `IncidentEnvironment` | `PRODUCTION`, `STAGING`, `DEVELOPMENT`, `WORKS_ON_MY_MACHINE` |
| `IncidentResolutionStatus` | `OPEN`, `MITIGATED`, `BLAMED`, `WONTFIX` |
| `TechReviewVerdict` | `ADOPT`, `TRIAL`, `ASSESS`, `HOLD` |
| `LeadSource` | `HOBT_HERO`, `HOBT_CTA_BLOCK`, `HOBT_FOOTER`, `INCIDENT_SIDEBAR` |

GraphQL enum values are `SCREAMING_SNAKE_CASE` by convention; the underlying ACF select values
are `kebab-case`. The resolver maps between them. Lesson 06.1 covers why you do not just
expose the raw string.

---

## 4. ACF field groups

All field groups are registered with **ACF Local JSON** (`includes/acf-json/`), which means
the content model is **code, in git, and diffable** — not database rows.

> **This is the single highest-leverage decision in the whole pipeline.** Field groups as code
> means there is no DB migration step on deploy, which keeps the Fly.io `release_command` in
> Module 24 boring: `wp core update-db`, activate plugins, flush rewrites, done. Field groups
> in the database would mean an export/import step in every release, and a whole class of
> "works on staging" bugs.

### 4.1 `Incident Details`

Location: `post_type == incident`. `show_in_graphql: true`,
`graphql_field_name: incidentDetails`.

| ACF field name | Label | Type | GraphQL field | GraphQL type | Rules |
|---|---|---|---|---|---|
| `occurred_at` | Occurred at | Date Time Picker | `occurredAt` | `String` (ISO 8601) | required, ≤ now |
| `downtime_minutes` | Downtime (min) | Number | `downtimeMinutes` | `Float` | 0–100000 |
| `estimated_cost_usd` | Estimated cost (USD) | Number | `estimatedCostUsd` | `Float` | ≥ 0, optional |
| `environment` | Environment | Select | `environment` | `IncidentEnvironment` | `production` \| `staging` \| `development` \| `works-on-my-machine` |
| `resolution_status` | Resolution | Select | `resolutionStatus` | `IncidentResolutionStatus` | `open` \| `mitigated` \| `blamed` \| `wontfix` |
| `blame_confidence` | Blame confidence | Range 0–100 | `blameConfidence` | `Float` | default 73 |
| `stack_trace` | Stack trace | Textarea | `stackTrace` | `String` | rendered in `<pre>`, **escaped** — never `dangerouslySetInnerHTML` |
| `reporter_display_name` | Reporter (display) | Text | `reporterDisplayName` | `String` | denormalised; public reporters are not classic WP authors |
| `is_verified` | Verified by moderator | True/False | `isVerified` | `Boolean` | **read-only for non-editors; the mutation ignores any client-supplied value** |

> **`is_verified` is the field that teaches trust boundaries.** It is in the schema, it is
> writable in wp-admin by an editor, and the `createIncident` mutation silently discards it if
> a client sends it. A field being present in a GraphQL input type is not permission to set it.

### 4.2 `Scapegoat Profile`

Location: `taxonomy == scapegoat`. `graphql_field_name: scapegoatProfile`. This is the group
that teaches ACF **term** field groups through WPGraphQL for ACF.

| ACF field name | Type | GraphQL field | GraphQL type |
|---|---|---|---|
| `avatar` | Image (ID return format) | `avatar` | `AcfMediaItemConnectionEdge` |
| `tagline` | Text | `tagline` | `String` |
| `defensiveness` | Range 1–10 | `defensiveness` | `Float` |
| `first_blamed_on` | Date Picker | `firstBlamedOn` | `String` |
| `official_excuse` | Textarea | `officialExcuse` | `String` |
| `is_sentient` | True/False | `isSentient` | `Boolean` |

### 4.3 `Tech Review Fields`

Location: `post_type == tech_review`. `graphql_field_name: techReviewFields`.

| ACF field name | Type | GraphQL field | GraphQL type |
|---|---|---|---|
| `company_name` | Text | `companyName` | `String` |
| `logo` | Image | `logo` | `AcfMediaItemConnectionEdge` |
| `rating_overall` | Range 1–10 | `ratingOverall` | `Float` |
| `rating_dx` | Range 1–10 | `ratingDx` | `Float` |
| `rating_docs` | Range 1–10 | `ratingDocs` | `Float` |
| `rating_incident_response` | Range 1–10 | `ratingIncidentResponse` | `Float` |
| `verdict` | Select | `verdict` | `TechReviewVerdict` |
| `pros` | **Repeater** → `item` (Text) | `pros` | `[TechReviewFieldsPros]` |
| `cons` | **Repeater** → `item` (Text) | `cons` | `[TechReviewFieldsCons]` |
| `reviewed_at` | Date Picker | `reviewedAt` | `String` |

> **The repeaters are here on purpose.** ACF repeaters surface as generated object list types
> — `TechReviewFieldsPros`, not `string[]` — and that mismatch is the single most common "why
> is my generated type `any`?" moment in a headless WordPress build. Lesson 04.2 walks it.

### 4.4 `HOBT Promo`

Location: `page` **and** `page_template == templates/hobt.php`.
`graphql_field_name: hobtPromo`.

| ACF field name | Type | GraphQL field | Notes |
|---|---|---|---|
| `headline` | Text | `headline` | |
| `subheadline` | Textarea | `subheadline` | |
| `hero_image` | Image | `heroImage` | |
| `price_usd` | Number | `priceUsd` | |
| `seats_left` | Number | `seatsLeft` | drives the urgency badge — forces a shorter `revalidate` on `/hobt` |
| `demo_booking_url` | URL | `demoBookingUrl` | post-lead redirect |
| `start_now_url` | URL | `startNowUrl` | checkout / external |
| `modules` | Repeater → `title` (Text), `summary` (Textarea), `duration_minutes` (Number) | `modules` | |
| `testimonials` | Repeater → `quote` (Textarea), `author` (Text), `role` (Text), `avatar` (Image) | `testimonials` | |

### 4.5 `Site Settings` (options page)

`acf_add_options_page()` + `show_in_graphql`, page `graphql_field_name: siteSettings`, field
group `graphql_field_name: siteChrome` — **they must differ**, or both resolve to the type
`SiteSettings`, the second registration loses silently, and the fields land on an orphan
`SiteSettings_Fields` interface nothing implements. Reached as `siteSettings { siteChrome { … } }`
on the **root query**, so it can be fetched once in the root layout.

| ACF field name | Type | GraphQL field | Notes |
|---|---|---|---|
| `site_tagline` | Text | `siteTagline` | |
| `primary_cta_label` | Text | `primaryCtaLabel` | |
| `primary_cta_url` | URL | `primaryCtaUrl` | |
| `footer_blurb` | Textarea | `footerBlurb` | |
| `social_links` | Repeater → `network` (Select), `url` (URL) | `socialLinks` | |
| `btt_redirects` | Repeater → `from` (Text), `to` (Text), `permanent` (True/False) | `bttRedirects` | Read at **build** time by `next.config.ts` (Lesson 19.4), never by a page. Keep it to a few dozen rows — past that, middleware is the right home. |
| `incident_submission_open` | True/False | `incidentSubmissionOpen` | **a kill switch the Server Action must honour** |

Navigation is **not** in Site Settings — it comes from core WordPress menus via
`menuItems(where: { location: PRIMARY })`.

---

## 5. The one thing that is not a post: `wp_btt_leads`

HOBT "Get Demo" leads go into a **custom table**, created with `dbDelta()` on plugin
activation. Not a CPT.

```sql
CREATE TABLE {$wpdb->prefix}btt_leads (
  id           bigint(20) unsigned NOT NULL auto_increment,
  created_at   datetime            NOT NULL,
  email        varchar(190)        NOT NULL,  -- 190, not 255: utf8mb4 is 4 bytes/char and the
  full_name    varchar(190)        NOT NULL,  -- legacy InnoDB index prefix limit is 767 bytes.
  company      varchar(190)            NULL,  -- This is why WP core uses 191 everywhere.
  team_size    varchar(32)             NULL,
  source       varchar(64)         NOT NULL,  -- 'hobt-hero' | 'hobt-cta-block' | ...
  locale       varchar(10)         NOT NULL,
  consent      tinyint(1)          NOT NULL DEFAULT 0,
  ip_hash      char(64)                NULL,  -- HMAC-SHA256(ip, BTT_LEAD_IP_HMAC_KEY)
  user_agent   varchar(255)            NULL,  -- never the raw IP: PII minimisation
  PRIMARY KEY  (id),
  UNIQUE KEY uniq_email_source (email, source),
  KEY idx_created_at (created_at)
) {$charset_collate};
```

Why a custom table rather than a `hobt_lead` CPT:

| Reason | Detail |
|---|---|
| PII isolation | A CPT is one misconfigured `show_in_rest` or `show_in_graphql` away from leaking every lead. A custom table is invisible to WordPress's content APIs by construction. |
| No `wp_postmeta` bloat | 8 fields × N leads = 8N postmeta rows, all EAV, none indexed by value. |
| Real `$wpdb` practice | `dbDelta()`, `$wpdb->prepare()` with format specifiers, `$wpdb->insert()`, index design, `VARCHAR(190)`. This is the one place in the course you write actual SQL. |
| Correct uniqueness | `UNIQUE KEY (email, source)` is enforced by the database. There is no equivalent for a CPT. |

Lowercase types, `KEY` rather than `INDEX`, and **two spaces** after `PRIMARY KEY` are not
cosmetic: `dbDelta()` parses this string with regular expressions and compares the result to
what MySQL reports, and the two-space rule in particular is the one that silently breaks a
migration. Core's own `wp_get_db_schema()` is written in exactly this style, and Lesson 16.3
reproduces it.

Writes happen **only** through the custom WPGraphQL mutation `submitHobtLead`, which requires
the `X-BTT-App-Token` header (see [appendix 04](04-env-reference.md)) and re-validates every
field server-side. `ip_hash` is an HMAC, never a raw address, and the raw IP is never logged.

---

## 6. Roles and capabilities

`incident` registers with `capability_type => 'incident'` and `map_meta_cap => true`, which
generates `edit_incident`, `edit_incidents`, `publish_incidents`, `edit_others_incidents`,
`read_private_incidents` and `delete_incidents`.

| Role | `read` | `create_incidents` | `edit_incidents` (own) | `publish_incidents` | `edit_others_incidents` | `delete_incidents` |
|---|---|---|---|---|---|---|
| `incident_reporter` (custom — public signups) | ✓ | ✓ | ✓ while `pending` | ✗ | ✗ | ✗ |
| `contributor` (core) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `editor` (core) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `administrator` (core) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

> **Withholding `publish_incidents` is what makes moderation structural rather than
> procedural.** There is no code path by which a public user publishes an incident, because
> the capability does not exist for them. Compare that with a `if ($status === 'publish')`
> check somewhere in a mutation — one is enforced by WordPress's own authorisation layer, the
> other is enforced by you remembering to write it.

`incident_reporter` deliberately gets **no** `edit_posts`, so it cannot reach the block editor
and cannot upload media. The plugin also sets `show_admin_bar_front => false` for the role and
redirects it away from wp-admin on `admin_init` — public users have a front end, not a
dashboard.

`users_can_register` stays **off**. Registration goes through the custom `registerDeveloper`
mutation, which assigns `incident_reporter` explicitly. WPGraphQL's built-in `registerUser`
would use `get_option('default_role')` and would also require opening
`/wp-login.php?action=register` — one door, not two.

---

## 7. Custom GraphQL fields and mutations

Registered in Module 06.

| Name | Kind | On | Auth | Notes |
|---|---|---|---|---|
| `blameScore` | field → `Float` | `Incident` | public | Computed from severity weight × `blameConfidence` × `downtimeMinutes`. Teaches `register_graphql_field` and resolver caching. |
| `severityIn` | connection `where` arg → `[String]` | `RootQueryToIncidentConnectionWhereArgs` | public | The **only** taxonomy `where` argument this project registers. Incoming slugs are intersected with the closed severity set in §2, so an unrecognised slug narrows to zero rows rather than widening to all of them. There is no generic `taxQuery` — Lesson 05.2 §6. Consumers: `HomepageFeeds` (10.5) and `IncidentTicker` (14.4); every other facet traverses from the term. |
| `createIncident` | mutation | — | **user JWT**, `create_incidents` | Forces `post_status = 'pending'` and `post_author = get_current_user_id()`. Ignores `is_verified`. |
| `registerDeveloper` | mutation | — | **app token** (server-to-server) | Creates a user with role `incident_reporter`, `btt_verified = 0`, sends a verification mail. |
| `verifyDeveloper` | mutation | — | **app token** (server-to-server) | Module **15**, not 06. Consumes the single-use code `registerDeveloper` mailed, **sets the account password** — `registerDeveloper` generates one and never discloses it, so this is where the user first gets a usable credential — sets `btt_verified = 1`, and returns the same generic payload for a bad, expired or already-used code. |
| `submitHobtLead` | mutation | — | **app token** (server-to-server) | Inserts into `wp_btt_leads`. Honeypot + timing + Turnstile checked on the Next side, fields re-validated here. |

The two credentials are different things and must never be confused — see
[appendix 04 §4](04-env-reference.md#4-the-two-credentials).

Everything above except `verifyDeveloper` is registered in Module 06. `verifyDeveloper` is the
one addition Module 15 makes, because verification only becomes meaningful once a session
exists to gate.

---

## 8. Plugin inventory

| Plugin | Ours | Role |
|---|---|---|
| WPGraphQL | no | The schema |
| WPGraphQL JWT Authentication | no | `login`, `refreshJwtAuthToken`, `Authorization: Bearer` |
| WPGraphQL for ACF | no | ACF fields in the schema |
| WPGraphQL Content Blocks | no | Blocks as structured data |
| WPGraphQL Yoast SEO | no | `seo { ... }` on content nodes |
| WPGraphQL Polylang | no | `language`, `translations`, locale filtering |
| Advanced Custom Fields | no | The field groups in §4 |
| Yoast SEO | no | Editor-controlled metadata |
| Polylang | no | Multilingual content. **Free edition** — it translates post slugs but *not* CPT rewrite slugs, which is what decides Lesson 20.3's routing model |
| **`blame-the-tech-core`** | **yes** | §1–§7 — everything above |
| **`blame-the-tech-blocks`** | **yes** | The six Gutenberg blocks (Modules 13–14) |

Deliberately **not** installed: **`wp-graphql-tax-query`.** It would add
`where: { taxQuery: { taxArray: [ ... ] } }` to every post-object connection, which is a
taxonomy-join builder handed to anonymous callers — the surface core WPGraphQL declines to ship
and Lesson 05.2 §6 declines to re-open. Lesson 06.1 §9 registers one narrow, allowlisted
`severityIn` instead (§7). A query using `taxQuery` against this schema is a validation error,
and Lesson 23.5's `@graphql-eslint` gate fails the build on it.

Also deliberately **not** installed: **WPGraphQL CORS.** The browser never talks to `/graphql` —
only the Next.js server runtime does. That is a load-bearing architectural property, not an
accident: there is no GraphQL endpoint in the client bundle, therefore no CORS policy to get
wrong and no public introspection surface reachable from the app's own traffic. Lesson 15.1
states it explicitly.

---

## 9. Seed data

`wp blame seed --fresh` (Module 04, refined in Module 12) produces:

| Content | Count | Notes |
|---|---|---|
| Incidents | 40 en + 10 de + 5 uk = **55** | fixed slugs, fixed `post_date`, spread across all 4 severities and all 10 scapegoats. Translations are added by Lesson 20.1's final seeder phase — German slugs are `incident-NN-de`, Ukrainian are Cyrillic (`відмова-NN`). Before Module 20 the count is 40 |
| Tech reviews | 8 | one per verdict × 2. Slugs `review-01`…`review-08`, **`en` only** — reviews are not translated, so `/de/reviews/review-01` is the one path in the app that exercises Lesson 20.4's untranslated-content 307 |
| Blog posts | 10 en + 2 de = **12** | slugs `blog-01`…`blog-10` plus `blog-01-de`/`blog-02-de`. Two use every custom block, for the block-rendering E2E spec |
| Pages | 3 × 3 locales = **9** | Home, About, HOBT (with `templates/hobt.php`). German `startseite`/`ueber-uns`/`hobt-de`, Ukrainian `holovna`/`pro-nas`/`hobt-uk` |
| Users | 3 | `editor`, `reporter`, `e2e_agent` — **passwords from the environment, never literals in the seeder** |
| Scapegoat terms | 10 | §2 |
| Severity terms | 4 | §2 |
| Media | 12 | checked-in JPEGs, sideloaded with `wp media import --porcelain` |

Determinism rules (Lesson 12.4 covers all of them): fixed slugs never IDs, explicit
`post_date` and `post_date_gmt`, no `wp_rand`/`time()`/unseeded Faker, one fixed `WP_HOME` for
both seed and run, and Polylang translations linked **last** with
`pll_save_post_translations()`.

Taxonomy terms and media are deliberately **not** translated (Lesson 20.1), so the term counts
above are totals across all three languages and no attachment carries a language at all. The
cost, stated plainly: a German page shows English severity badges and scapegoat names, and the
leaderboard counts a translation as its own incident.

---

## 10. Where each module touches this file

| Module | Section it implements |
|---|---|
| 03 | §1, §2, §6 — post types, taxonomies, roles and capabilities |
| 04 | §4, §9 — ACF field groups as Local JSON, the seeder |
| 05 | §1–§4 as *queries* — reading everything above out of WPGraphQL |
| 06 | §3, §7 — enums, `blameScore`, the guarded mutations |
| 07 | §1–§4 as *TypeScript types* — hand-modelled before codegen exists |
| 13–14 | The six blocks (see the module READMEs) |
| 15 | §6, §7 — the capability matrix enforced end to end |
| 16 | §5, §7 — `submitHobtLead` and the leads table |
| 20 | §9 — Polylang translation groups on seeded content |
| 24 | §5 — `$wpdb->prepare()` and the leads admin list under review |
