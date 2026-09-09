---
title: 'MySQL & the WordPress Schema'
module: 2
lesson: 3
teaches: [wp-posts-schema, postmeta-eav, meta-query-self-join, explain-plans, autoload-options]
produces: []
requires: [2.2]
---

# Lesson 02.3 — MySQL & the WordPress Schema

## Quick Overview

You have written hundreds of `WP_Query` calls. This lesson is about what MySQL does with them.
Adminer is now running on `http://localhost:8081`, connected to the same `db` service WordPress
uses, and you are going to open `wp_posts`, `wp_postmeta`, `wp_terms`, `wp_term_taxonomy`,
`wp_term_relationships` and `wp_options`, read their indexes, and then run `EXPLAIN` on the SQL
that `WP_Query` generates for a `tax_query` and for a `meta_query`. The two plans do not look
alike, and the difference is the reason [appendix 03 §2](../appendix/03-content-model-reference.md#2-taxonomies)
makes `severity` a taxonomy instead of an ACF select.

The specific fact worth carrying out of this lesson: `wp_postmeta` is an
**entity-attribute-value** table with an index on `meta_key` (prefixed to 191 characters) and
**no index on `meta_value`**. Every meta condition is therefore a self-join plus a full scan of
the matched key's rows, and two meta conditions mean two self-joins. Add a `LIKE '%…%'` and the
prefix index stops helping at all. The second fact: `wp_options` rows whose `autoload` column
holds `yes`, `on`, `auto` or `auto-on` — WordPress 6.6 replaced the old `yes`/`no` pair, and a
query written against `'yes'` alone now matches **nothing** on 7.1 — are loaded in their entirety
on *every single request*, which in a headless build means every
GraphQL query pays for them — a 4 MB autoload set is a 4 MB tax on an API call that returns
three fields. You will measure both, in your own database, rather than take it on trust.

By the end of this lesson you will have:

- Adminer connected to the `db` service, with the WordPress schema browsable
- The index list for `wp_posts`, `wp_postmeta`, `wp_term_relationships` and `wp_options`, read
  from `SHOW INDEX`, not from memory
- Side-by-side `EXPLAIN` output for an equivalent `tax_query` and `meta_query`, with the row
  estimates and `key` columns compared
- A measured autoload size for your own install, and the query that produces it
- A written, one-sentence rule for when a facet belongs in a taxonomy and when it belongs in
  post meta

## Classic WP Analogy

You already know the API side of all of this. `get_post_meta()`, `update_post_meta()`,
`WP_Query` with `'meta_query' => [...]`, `wp_set_object_terms()`, `get_terms()` — you have used
every one. You also already know, at some level, that `wp_postmeta` "gets big", because you have
watched a plugin add fifty rows per post and you have seen a site slow down. What you probably
have not done is look at the query plan and see *why*, because Classic WordPress never forces
you to: `WP_Query` hides the SQL, the object cache hides the repetition, and a page-cached
front end hides the cost from users.

The mapping is direct and worth stating precisely. `wp_posts` is the row you think of as "the
post", with real indexes on `post_name`, and on the composite `(post_type, post_status,
post_date, ID)`. `wp_postmeta` is a bag of key/value strings pointed at a `post_id`, and it is
the reason `get_post_meta()` is cheap (one cached read of all a post's meta) while
`meta_query` is expensive (a join and a scan across all posts' meta). Taxonomies are three
normalised tables with the count denormalised into `wp_term_taxonomy.count` — which is exactly
why the blame leaderboard in this course is one indexed read instead of a grouped `COUNT(*)`.

**Where the analogy breaks down:** in Classic WordPress an expensive `meta_query` runs once per
page view behind a full-page cache, so a 300 ms query on a page that is cached for an hour is
invisible. In this architecture the same query runs behind a GraphQL resolver that may be
called several times per request, for several fields, from a Server Component that renders on
demand — and Module 06 will show you the same `meta_query` executing 40 times for a list of 40
incidents because a resolver did it per node. The schema knowledge you can safely leave implicit
in Classic WordPress becomes load-bearing here, which is why this lesson sits in Module 02 and
not in an appendix.

---

## Key Concepts

### 1. Twelve tables, and two completely different ways to attach data to a post

| Table | Rows grow with | What lives here |
|---|---|---|
| `wp_posts` | content | Posts, pages, attachments, revisions, menu items, **and every custom post type** |
| `wp_postmeta` | content × fields | Every `get_post_meta()` value, every ACF field, every plugin's per-post setting |
| `wp_terms` | terms | The term's name and slug, once |
| `wp_term_taxonomy` | term × taxonomy | Which taxonomy a term is in, its parent, and **its `count`** |
| `wp_term_relationships` | content × terms | The join table: which post has which term |
| `wp_termmeta` | term × fields | ACF term fields — [appendix 03 §4.2](../appendix/03-content-model-reference.md#42-scapegoat-profile) |
| `wp_users` / `wp_usermeta` | users, users × fields | Logins; and capabilities, as a serialised array |
| `wp_options` | settings | Site and plugin config, transients, the autoload set — §7 |

`wp_comments`, `wp_commentmeta` and `wp_links` complete the twelve; this front end never touches
them.

```
                    ┌──────────────────────────────────────┐
                    │ wp_posts   ID · post_type ·          │
                    │  post_status · post_name · post_date │
                    └──────┬───────────────────────┬───────┘
       ┌───────────────────▼────────┐   ┌──────────▼──────────────────────┐
       │ wp_postmeta   (EAV bag)    │   │ wp_term_relationships (join)    │
       │  post_id · meta_key ·      │   │  object_id · term_taxonomy_id   │
       │  meta_value  ← NO INDEX    │   └──────────┬──────────────────────┘
       └────────────────────────────┘   ┌──────────▼──────────────────────┐
                                        │ wp_term_taxonomy                │
                                        │  term_taxonomy_id · taxonomy ·  │
                                        │  term_id · parent · COUNT ──┐   │
                                        └──────────┬──────────────────┼───┘
                                        ┌──────────▼──────────────────▼───┐
                                        │ wp_terms   name · slug          │
                                        └─────────────────────────────────┘
```

Both paths hang off `wp_posts.ID`. The left one is a bag of untyped strings with no index on the
value. The right one is a normalised join, indexed in both directions, carrying a pre-computed
count. **When you choose between an ACF select and a taxonomy, that diagram is the choice you
are making** — and the rest of this lesson is the evidence.

### 2. `wp_posts` — the only content table with indexes you can rely on

| Index | Columns | What it serves |
|---|---|---|
| `PRIMARY` | `ID` | `get_post()`, and every join from a meta or term table |
| `type_status_date` | `post_type`, `post_status`, `post_date`, `ID` | **The main query.** "Published incidents, newest first" is one range scan. |
| `post_name` | `post_name(191)` | Permalinks — `nodeByUri`, `incident(id: "dns", idType: SLUG)` |
| `post_parent` | `post_parent` | Page hierarchies, attachment-to-post |
| `post_author` | `post_author` | "Incidents by this reporter" |

`type_status_date` is the one to memorise, because its **column order** is why `WP_Query` is
fast for the queries WordPress was designed around. A composite index is usable left to right
and no further: filtering on `post_type` + `post_status` and ordering by `post_date` uses all
four columns; filtering on `post_date` *without* `post_type` uses none of them.

> **This is the good news, and it deserves saying before the bad news.** Headless changes
> nothing here. WPGraphQL builds a `WP_Query`, `WP_Query` builds SQL, and that SQL uses
> `type_status_date` exactly as it always did. Your instinct that "list published posts of a
> type, newest first" is cheap is correct, and it stays correct.

### 3. `wp_postmeta` is an EAV table, and that is the whole problem

**Entity-attribute-value** means one *row* per field instead of one column per field.

```
wp_posts                        wp_postmeta
┌──────┬───────────┐            ┌─────────┬─────────┬──────────────────────┬────────────┐
│ ID   │ post_title│            │ meta_id │ post_id │ meta_key             │ meta_value │
├──────┼───────────┤            ├─────────┼─────────┼──────────────────────┼────────────┤
│ 412  │ DNS again │◀───────────│  8801   │   412   │ downtime_minutes     │ 240        │
└──────┴───────────┘        ┌───│  8802   │   412   │ estimated_cost_usd   │ 18000      │
                            ├───│  8803   │   412   │ resolution_status    │ blamed     │
                            └───│  8804   │   412   │ _edit_lock           │ 1712…      │
                                └─────────┴─────────┴──────────────────────┴────────────┘
```

One incident with the nine fields from
[appendix 03 §4.1](../appendix/03-content-model-reference.md#41-incident-details) is one row in
`wp_posts` and **nine or more** in `wp_postmeta`, plus whatever core and your plugins add. EAV
buys one genuinely valuable thing: you can add a field without a migration. That is why
WordPress uses it, why ACF is possible at all, and why "just add a custom field" has never
required a schema change in twenty years. The price is paid at read time in two currencies:
`meta_value` is `LONGTEXT`, so there is no type and numeric comparison needs a cast; and
`meta_value` has **no index**, because the column is too large to index without a prefix and a
prefix is worthless for ranges or `LIKE '%…%'`.

`wp_usermeta` and `wp_termmeta` are the same shape with different owners. Capabilities live in
`wp_usermeta` as a serialised array under `wp_capabilities` — which is why the role matrix in
[appendix 03 §6](../appendix/03-content-model-reference.md#6-roles-and-capabilities) is enforced
in PHP rather than by a constraint, and why "which users are `incident_reporter`?" is an
unindexed `LIKE '%incident_reporter%'`.

> **`get_post_meta()` is cheap; `meta_query` is not.** They feel like the same feature and they
> are not remotely the same query. `get_post_meta($id, 'downtime_minutes', true)` is **one**
> lookup on the indexed `post_id`, and it pulls *all* of that post's meta into the object cache
> in one go — every further field on the same post is free. `'meta_query' => [['key' =>
> 'downtime_minutes', 'value' => 60, 'compare' => '>']]` is a join across every post's meta with
> a comparison on an unindexed column. One is a point read. The other is a scan.

### 4. The indexes that exist, and the one that does not

`wp_postmeta` has exactly three indexes. Know all three by name.

| Index | Definition | Serves | Cannot serve |
|---|---|---|---|
| `PRIMARY` | `meta_id` | nothing you write | — |
| `post_id` | `post_id` | `get_post_meta()`, the join from `wp_posts` | anything about key or value |
| `meta_key` | `meta_key(191)` | narrowing to one attribute | anything about the value |

There is **no index on `meta_value`**, in any WordPress version, deliberately. Every meta filter
therefore decomposes into two operations:

```
1. Use meta_key(191)  →  find the N rows whose key is 'downtime_minutes'      INDEXED
2. Scan those N rows  →  test  meta_value > 60  on each one                   NOT INDEXED
```

Step 2 is linear in the number of posts that have the field. Forty incidents is forty rows and
nobody notices; forty thousand is forty thousand row reads plus a cast, per query, per *GraphQL*
request — which Module 06 will show can be several per page render. Two aggravations make it
worse than the arithmetic suggests: `meta_key(191)` is a **prefix** index, so the entry is not
the whole value and MySQL may still need the row to confirm a match; and `meta_query` with
`'type' => 'NUMERIC'` emits `CAST(meta_value AS SIGNED)`, and a function on a column makes the
predicate non-sargable — so even a hypothetical `meta_value` index could not be used.

> **Do not "fix" this with an index.** `ALTER TABLE wp_postmeta ADD INDEX (meta_value(20))` is
> the first thing every search result suggests. It helps equality on short values, does nothing
> for ranges or leading wildcards, adds write cost to the highest-write table in WordPress, and
> gets silently dropped by the next core upgrade that runs `dbDelta()`. Model the data correctly
> instead — §9.

### 5. The `meta_query` self-join trap: three clauses, three joins

`wp_postmeta` holds one attribute per row, so a filter on *two* attributes cannot be expressed
against one row — `meta_key = 'environment' AND meta_key = 'resolution_status'` is never true.
`WP_Query` therefore joins `wp_postmeta` **once per meta clause**, aliased `mt1`, `mt2`, `mt3`:

```
'meta_query' => [                     FROM wp_posts p
  ['key'=>'environment',                INNER JOIN wp_postmeta mt1 ON p.ID = mt1.post_id
   'value'=>'production'],              INNER JOIN wp_postmeta mt2 ON p.ID = mt2.post_id
  ['key'=>'resolution_status',          INNER JOIN wp_postmeta mt3 ON p.ID = mt3.post_id
   'value'=>'open'],                   WHERE p.post_type = 'incident'
  ['key'=>'downtime_minutes',            AND mt1.meta_key='environment'
   'value'=>60, 'compare'=>'>',          AND mt1.meta_value='production'
   'type'=>'NUMERIC'],                   AND mt2.meta_key='resolution_status'
]                                        AND mt2.meta_value='open'
                                         AND mt3.meta_key='downtime_minutes'
                                         AND CAST(mt3.meta_value AS SIGNED) > 60
```

Three clauses, three joins of the same table, each an indexed key lookup followed by an
unindexed scan. A fourth facet adds a fourth join. The optimiser's estimate is the product of
its per-join estimates, and because `meta_value` has no useful statistics those estimates are
frequently wrong — which is how you get a plan that looks fine and runs for two seconds. The
taxonomy expression of the same idea is one join, on integers, fully indexed, because
`wp_term_relationships` has `PRIMARY KEY (object_id, term_taxonomy_id)` plus a
`term_taxonomy_id` index:

```
'tax_query' => [                      FROM wp_posts p
  ['taxonomy'=>'severity',              INNER JOIN wp_term_relationships tr1
   'field'=>'slug',                            ON p.ID = tr1.object_id
   'terms'=>'s1-catastrophic'],        WHERE p.post_type = 'incident'
]                                        AND tr1.term_taxonomy_id IN (7)
```

That `IN (7)` came from a separate cheap lookup against `wp_terms`. You will measure both plans
in the Task, and the row estimates will not be close.

### 6. Taxonomies: three tables, and a count that is already computed

| Table | One row per | Why separate |
|---|---|---|
| `wp_terms` | **term** | Name and slug exist once, even if the term is used in two taxonomies |
| `wp_term_taxonomy` | **term in a taxonomy** | Holds `taxonomy`, `parent`, `description` and `count` |
| `wp_term_relationships` | **post ↔ term** | The many-to-many join |

`wp_term_relationships` references `term_taxonomy_id`, **not** `term_id`. That indirection is why
the split exists: one term row can be "React" in `tech_stack` and "React" elsewhere, with
independent counts. And it gives you the column that pays for this lesson:

```
wp_term_taxonomy
┌──────────────────┬───────────┬─────────┬───────┐
│ term_taxonomy_id │ taxonomy  │ term_id │ count │
├──────────────────┼───────────┼─────────┼───────┤
│ 12               │ scapegoat │ 12      │  17   │  ← already computed
│ 13               │ scapegoat │ 13      │   9   │  ← maintained on save
│ 14               │ scapegoat │ 14      │  31   │  ← ORDER BY count is one read
└──────────────────┴───────────┴─────────┴───────┘
```

WordPress maintains `count` whenever terms are assigned or removed, so the **blame leaderboard**
is `SELECT t.name, tt.count … ORDER BY tt.count DESC LIMIT 10` — ten rows out of a table with
tens of rows in it, no aggregation, no scan of content. The `wp_postmeta` equivalent is a
`COUNT(*)` grouped over every meta row with that key, and it grows with your *content* instead
of with your *term list*.

> **`count` is denormalised, which means it can be wrong.** Anything writing term relationships
> without `wp_set_object_terms()` — including the raw `INSERT` in Step 3 — leaves it stale. The
> repair is `docker compose run --rm wpcli wp term recount <taxonomy>`. Remember it: in
> Module 12 a seeder that bypasses the API produces a leaderboard that is quietly wrong.

### 7. `wp_options`, `autoload`, and the hot path of every GraphQL request

`wp_options` is four columns — `option_id`, `option_name VARCHAR(191)`,
`option_value LONGTEXT`, `autoload` — and one behaviour. On **every** WordPress request, before
any of your code runs, `wp_load_alloptions()` executes:

```sql
-- wp-includes/option.php, inside wp_load_alloptions(). The IN list is built by
-- wp_autoload_values_to_autoload(), which returns exactly these four values on 7.1.
-- Pre-6.6 this read `autoload = 'yes'`; that predicate now matches zero rows.
SELECT option_name, option_value FROM wp_options
 WHERE autoload IN ( 'yes', 'on', 'auto', 'auto-on' );
```

Every row is unserialised into PHP memory and held for the life of the request — a deliberate
optimisation, one query instead of two hundred `get_option()` round trips, that works beautifully
until the autoload set gets fat. It gets fat because deactivating a plugin does not remove its
options, and because plugins autoload cached API responses, licence blobs and image-optimisation
queues.

```
   POST /graphql  { incidents(first:20){ nodes{ title severity } } }
        │
        ▼   WordPress bootstrap — runs BEFORE WPGraphQL sees the query
   ┌────────────────────────────────────────────────────────────────────┐
   │  1. SELECT … WHERE autoload IN ('yes','on','auto',…)  ◀── the tax  │
   │  2. unserialize() every value                                     │
   │  3. load active plugins, theme, translations                      │
   │  4. THEN parse the document and resolve fields                    │
   └────────────────────────────────────────────────────────────────────┘
   A 4 MB autoload set is a 4 MB fixed cost on a query returning 2 KB of
   JSON. Every request. Including the ones that return `null`.
```

> **This is the cost headless makes visible and Classic WordPress hid.** A full-page cache in
> front of Classic WordPress meant the autoload query ran once an hour. A Server Component
> rendering on demand, Module 06's resolvers and Module 18's revalidation traffic all pay it per
> request. Measure yours in Step 8, keep it under roughly `800000` bytes, and re-run the query
> from [appendix 07 §3](../appendix/07-command-reference.md#3-database) after every module that
> installs a plugin.

Transients live here too unless an object cache is configured, and expired ones are not reliably
collected — so `wp transient delete --all` is real maintenance, not a debugging trick.

### 8. utf8mb4, and the 191-character ceiling that is everywhere

You have now seen 191 three times — `post_name(191)`, `meta_key(191)`,
`option_name VARCHAR(191)` — and 190 once, in
[appendix 03 §5](../appendix/03-content-model-reference.md#5-the-one-thing-that-is-not-a-post-wp_btt_leads).
The derivation: WordPress uses `utf8mb4`, real four-byte UTF-8, so emoji and every character
Module 20's Ukrainian and German content needs cost **up to 4 bytes**; the legacy InnoDB index
prefix limit for `COMPACT`/`REDUNDANT` row format is **767 bytes**; 767 ÷ 4 = 191.75, therefore
**191 characters**.

MySQL 8 with `DYNAMIC` row format allows 3072 bytes, so the constraint is historical — but core
still ships 191 because it must work on the oldest MySQL it supports, and a table you add should
match core rather than be clever. The `utf8mb4` half is not optional either: MySQL's `utf8` is a
three-byte encoding that cannot store an emoji, and a site called Blame The Tech will receive one
in its first hour. Hence `--character-set-server=utf8mb4` on the `db` service in Lesson 02.2.

### 9. Reading an `EXPLAIN` plan, and the rule this lesson exists to produce

| Column | Read it as | What you want |
|---|---|---|
| `table` | which table, in join order | the most selective first |
| `type` | how rows are found | `const` > `eq_ref` > `ref` > `range` > `index` > **`ALL`** (full scan) |
| `key` | which index was actually used | not `NULL` |
| `rows` | rows estimated **at this step** | as small as possible |
| `Extra` | the warnings | `Using index` good; `Using filesort`/`Using temporary` on a big `rows` count bad |

Two derived numbers matter more than any single column: the **product** of `rows` down the plan
is roughly the work done (two steps at 200 rows is 40,000 examinations, not 400), and **`rows`
versus rows actually returned** is your selectivity. `EXPLAIN FORMAT=JSON` adds a `filtered`
percentage; `EXPLAIN ANALYZE` executes the query and prints `rows=200 actual rows=12` side by
side, which is the form that ends arguments. Adminer on `http://localhost:8081` renders the plain
form as a table, which is why it is in the stack. All of which collapses into one rule:

**Put a facet in a taxonomy when users filter by it and the value comes from a known set. Put it
in post meta when it is per-post data you display but do not filter on, or when it is numeric or
a range.**

That is exactly why [appendix 03 §2](../appendix/03-content-model-reference.md#2-taxonomies)
models `severity` as a closed-list taxonomy rather than an ACF select, and `scapegoat` as a
taxonomy rather than a post type with a relationship field:

| Facet | Modelled as | Because |
|---|---|---|
| `severity` | taxonomy, locked terms | `/incidents?severity=s1-catastrophic` is one indexed integer join, not a string comparison against unindexed `meta_value` |
| `scapegoat` | taxonomy | The leaderboard is `ORDER BY wp_term_taxonomy.count` — §6 |
| `downtime_minutes`, `estimated_cost_usd` | post meta | Numeric ranges. **Cannot** be taxonomies — a term per minute is absurd |
| `resolution_status` | post meta (ACF select) | Set by moderators and displayed; not a public facet |

> **The cost, stated plainly:** a term has no revisions and no rich editorial body, and a locked
> term list means a fifth severity is a code change rather than an editor action. Both are real
> losses, and [appendix 03 §2](../appendix/03-content-model-reference.md#2-taxonomies) names them
> too — "model the relationship you have, not the one you might want." Keeping
> `downtime_minutes` in meta is not an apology either: it is a correct design that also contains
> a realistic performance trap, which is what makes Module 06's N+1 lesson land.

---

## Task

The custom post types do not exist yet — `incident`, `severity` and `scapegoat` arrive in
Module 03 — so this drill uses core `post` and `post_tag` as stand-ins. **The table structure is
identical**, which is the point: `wp_postmeta` neither knows nor cares what `post_type` a row
belongs to. [Appendix 07 §3](../appendix/07-command-reference.md#3-database) shows the same drill
written against `post_type='incident'`; run it again after Module 03 and confirm the plan shape
is unchanged. Run everything from `wordpress-headless/`.

### Step 1: Connect Adminer to the database

Open `http://localhost:8081`. System **MySQL**, Server `db` (pre-filled by
`ADMINER_DEFAULT_SERVER`), Username `btt`, Database `btt`, and for the password the value of
`WORDPRESS_DB_PASSWORD` in your gitignored `.env`. Copy it out of the file in your editor — do
not type it into a shell command, a lesson file, or anything that lands in `~/.zsh_history`.

**Verify §1:**

- [ ] The table list shows twelve `wp_*` tables.
- [ ] Clicking `wp_posts` then **Indexes** shows `type_status_date` and `post_name`.
- [ ] You connected as `btt`, not `root`. The application user has rights on the `btt` database
      only — the least-privilege boundary from Lesson 02.2 Step 3 — and using it keeps you honest.

### Step 2: Read the indexes from the database, not from memory

```bash
docker compose run --rm wpcli wp db query "SHOW INDEX FROM wp_posts;"
docker compose run --rm wpcli wp db query "SHOW INDEX FROM wp_postmeta;"
docker compose run --rm wpcli wp db query "SHOW INDEX FROM wp_term_relationships;"
```

Read `Key_name`, `Column_name` and `Sub_part`. `Sub_part` is the prefix length — you will see
`191` beside `post_name` and `meta_key`.

> **Every `wp db …` command prints a warning to stderr, and it is not your problem.**
> `WARNING: option --ssl-verify-server-cert is disabled, because of an insecure passwordless
> login.` comes from the MariaDB client shipped inside `wordpress:cli-php8.4` — WP-CLI hands it
> the credentials through a temporary defaults file, which the client reads as "no password on
> the command line". It appears on every `wp db query`, `wp db export` and `wp db import` for
> the rest of the course. Nothing is unencrypted that should not be: this is a localhost socket
> inside a Compose network. Read past it and look at the rows below.

**Verify §2:**

- [ ] `wp_postmeta` shows exactly three `Key_name` values: `PRIMARY`, `post_id`, `meta_key`.
- [ ] **No row of that output has `Column_name = meta_value`.** Look at it directly before you
      continue; the rest of the lesson is a consequence of this absence.
- [ ] `wp_term_relationships` shows `PRIMARY` spanning `object_id` and `term_taxonomy_id`, plus a
      separate `term_taxonomy_id` index — both join directions covered.

### Step 3: Build a fixture big enough for the planner to be honest

With one "Hello world" post every plan is a scan of three rows and they all look alike.

```bash
docker compose run --rm wpcli wp post generate --count=200 --post_type=post --post_status=publish
docker compose run --rm wpcli wp term generate post_tag --count=20
docker compose run --rm wpcli wp db query "SELECT COUNT(*) AS tags FROM wp_term_taxonomy WHERE taxonomy='post_tag';"
```


That must print `20`. Now attach three meta fields to every post in one statement — also the
clearest possible illustration of what a meta row *is*:

```bash
docker compose run --rm wpcli wp db query "INSERT INTO wp_postmeta (post_id, meta_key, meta_value)
  SELECT p.ID, k.mk, CASE k.mk
      WHEN 'downtime_minutes'   THEN (p.ID * 37) % 600
      WHEN 'estimated_cost_usd' THEN (p.ID * 911) % 90000
      ELSE ELT((p.ID % 4) + 1, 'open', 'mitigated', 'blamed', 'wontfix') END
    FROM wp_posts p JOIN (SELECT 'downtime_minutes' AS mk UNION ALL
      SELECT 'estimated_cost_usd' UNION ALL SELECT 'resolution_status') k
   WHERE p.post_type='post' AND p.post_status='publish';"
```

Then one tag per post, spread evenly with a window function:

```bash
docker compose run --rm wpcli wp db query "INSERT INTO wp_term_relationships (object_id, term_taxonomy_id, term_order)
  SELECT p.ID, t.term_taxonomy_id, 0 FROM wp_posts p
  JOIN (SELECT term_taxonomy_id, ROW_NUMBER() OVER (ORDER BY term_taxonomy_id) - 1 AS rn
        FROM wp_term_taxonomy WHERE taxonomy='post_tag') t
    ON t.rn = p.ID % 20
  WHERE p.post_type='post' AND p.post_status='publish';"
```

You just wrote term relationships without `wp_set_object_terms()`, so `wp_term_taxonomy.count`
is stale — the exact failure mode Key Concept 6 named. Repair it, flush the object cache, and
refresh the statistics the optimiser reasons about:

```bash
docker compose run --rm wpcli wp term recount post_tag
docker compose run --rm wpcli wp cache flush
docker compose run --rm wpcli wp db query "ANALYZE TABLE wp_posts, wp_postmeta, wp_term_relationships;"
```

**Verify §3:**

- [ ] `wp post list --post_type=post --post_status=publish --format=count` prints `201` — 200
      generated plus Hello world, and `SELECT COUNT(*) FROM wp_postmeta` is well over `600`.
- [ ] `wp term list post_tag --fields=slug,count --format=table` shows non-zero counts. **If
      every count is `0`, `wp term recount` did not run** — fix that before Step 7.
- [ ] You ran `ANALYZE TABLE`. Skip it and your first `EXPLAIN` reasons about statistics from
      when the tables were empty.

### Step 4: `EXPLAIN` the taxonomy filter

Tag names are randomly generated, so capture a real slug first, then plan the SQL a `tax_query`
produces:

```bash
SLUG=$(docker compose run --rm -T wpcli wp term list post_tag --field=slug | head -1 | tr -d '\r')
echo "$SLUG"

docker compose run --rm wpcli wp db query "EXPLAIN SELECT p.ID FROM wp_posts p
  INNER JOIN wp_term_relationships tr ON p.ID = tr.object_id
  INNER JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
  INNER JOIN wp_terms t ON t.term_id = tt.term_id
  WHERE p.post_type='post' AND p.post_status='publish'
    AND tt.taxonomy='post_tag' AND t.slug='$SLUG'
  ORDER BY p.post_date DESC LIMIT 10;"
```

Note the shape: `wp_terms` is reached by its `slug` index and returns one row, the two term
tables by `term_taxonomy_id`, and `wp_posts` by `PRIMARY`. Every step has a non-`NULL` `key`. Now
run the same statement twice more — once with `EXPLAIN ANALYZE` instead of `EXPLAIN`, once in
Adminer's **SQL command** tab — and write down the total `actual time` from the top line of the
`ANALYZE` output. You compare it in Step 7.

### Step 5: `EXPLAIN` the equivalent meta filter

Same intent — narrow 201 posts to a subset — expressed through meta. Run it with `EXPLAIN`, then
again with `EXPLAIN FORMAT=JSON` for the `filtered` percentage:

```bash
docker compose run --rm wpcli wp db query "EXPLAIN SELECT p.ID FROM wp_posts p
  INNER JOIN wp_postmeta m ON p.ID = m.post_id
  WHERE p.post_type='post' AND p.post_status='publish'
    AND m.meta_key='downtime_minutes'
    AND CAST(m.meta_value AS SIGNED) > 60
  ORDER BY p.post_date DESC LIMIT 10;"
```

**Verify §5:**

- [ ] On the `wp_postmeta` row of the plan, `key` is `meta_key` or `post_id` — **never
      `meta_value`**, because no such index exists.
- [ ] `Extra` on that row contains `Using where`: the plan saying "I read rows, then tested them".
- [ ] The `filtered` value in the JSON output is well below `100` — the optimiser telling you it
      expects to read many more rows than it keeps.
- [ ] The join order may differ from Step 4's or from a colleague's; statistics vary. What does
      not vary is that `wp_postmeta` is entered by `post_id` or `meta_key`, and the value test
      happens after the read.

> **Do not read a millisecond difference at this scale as the lesson.** With 201 posts both
> queries are sub-millisecond on a warm buffer pool. The lesson is the `key` column, the `rows`
> estimate and the `filtered` percentage — the numbers that scale linearly into a problem, and
> they are already telling you which one will.

### Step 6: Add clauses until you can see the self-joins

```bash
docker compose run --rm wpcli wp db query "EXPLAIN SELECT p.ID FROM wp_posts p
  INNER JOIN wp_postmeta mt1 ON p.ID = mt1.post_id
  INNER JOIN wp_postmeta mt2 ON p.ID = mt2.post_id
  INNER JOIN wp_postmeta mt3 ON p.ID = mt3.post_id
  WHERE p.post_type='post' AND p.post_status='publish'
    AND mt1.meta_key='resolution_status' AND mt1.meta_value='open'
    AND mt2.meta_key='downtime_minutes'  AND CAST(mt2.meta_value AS SIGNED) > 60
    AND mt3.meta_key='estimated_cost_usd' AND CAST(mt3.meta_value AS SIGNED) < 50000;"

docker compose run --rm wpcli wp db query "EXPLAIN SELECT COUNT(*) FROM wp_postmeta
  WHERE meta_key LIKE '%status%';"
```

Count the plan rows in the first — one per table reference — then multiply the `rows` column down
the plan and compare the product against the post count you actually have.

**Verify §6:**

- [ ] The first plan has **three** rows whose `table` is `mt1`, `mt2`, `mt3`, each with a `key` of
      `post_id` or `meta_key` and `Using where` in `Extra`.
- [ ] The `LIKE '%status%'` plan shows `type` of `index` or `ALL` with `rows` close to the whole
      table. A leading wildcard makes `meta_key(191)` unusable — the same shape as the capability
      lookup in Key Concept 3.

### Step 7: The leaderboard both ways, then your own autoload set

The denormalised count, then the same answer computed from scratch — which is what you would be
doing if `scapegoat` were an ACF field. Compare `actual rows`, `actual time` and `Using
temporary`: the first is bounded by your **term count**, the second by your **content volume**.

```bash
docker compose run --rm wpcli wp db query "EXPLAIN ANALYZE SELECT t.name, tt.count
  FROM wp_term_taxonomy tt JOIN wp_terms t ON t.term_id = tt.term_id
  WHERE tt.taxonomy='post_tag' ORDER BY tt.count DESC LIMIT 10;"

docker compose run --rm wpcli wp db query "EXPLAIN ANALYZE SELECT m.meta_value, COUNT(*) AS n
  FROM wp_postmeta m INNER JOIN wp_posts p ON p.ID = m.post_id
  WHERE m.meta_key='resolution_status' AND p.post_status='publish'
  GROUP BY m.meta_value ORDER BY n DESC LIMIT 10;"
```

Then measure the autoload set and confirm the charset ceiling:

```bash
docker compose run --rm wpcli wp db query "SELECT COUNT(*) AS autoloaded,
  SUM(LENGTH(option_value)) AS autoload_bytes FROM wp_options
  WHERE autoload IN ('yes','on','auto','auto-on');"

docker compose run --rm wpcli wp db query "SELECT option_name, autoload,
  LENGTH(option_value) AS bytes FROM wp_options
  WHERE autoload IN ('yes','on','auto','auto-on') ORDER BY bytes DESC LIMIT 5;"
docker compose run --rm wpcli wp db query "SHOW CREATE TABLE wp_options;"
```

**Verify §7:**

- [ ] `autoload_bytes` on a bare install is small — measured on a fresh 7.1 install it is
      **26 428 bytes across 118 options**, of which `_transient_wp_core_block_css_files` alone
      is 20 314. Write your own number down and re-measure after Modules 03, 05 and 13. Keep it
      under roughly `800000`.
- [ ] `autoloaded` is a number, not `NULL`. A `NULL` means you narrowed on `autoload='yes'`
      somewhere — that value no longer exists on 7.1. Key Concept 7.
- [ ] `SHOW CREATE TABLE wp_options` shows `option_name` as `varchar(191)` and the table charset
      as `utf8mb4`. That `191` is the number from Key Concept 8.

### Step 8: Write `docs/schema-notes.md`

Record what *your* database said. Numbers you measured yourself are the ones you still remember
in Module 06.

```markdown
<!-- docs/schema-notes.md -->
# WordPress schema notes — measured on my own install

Lesson 02.3. Every number below came from my database, not from the lesson text.

## Indexes

`wp_postmeta` indexes, from Step 2: FILL THIS IN. `wp_term_relationships`: FILL THIS IN.
Columns I filter on that have no index: FILL THIS IN

## Same intent, two models

| | `tax_query` (Step 4) | `meta_query` (Step 5) |
|---|---|---|
| `key` on the filtering table | `term_taxonomy_id` | FILL THIS IN |
| `rows`, product down the plan | FILL THIS IN | FILL THIS IN |
| `filtered` percentage | — | FILL THIS IN |
| `EXPLAIN ANALYZE` actual time | FILL THIS IN | FILL THIS IN |

## Self-joins, the leaderboard, autoload

One meta clause produced FILL THIS IN `wp_postmeta` plan rows; three produced FILL THIS IN.
The `wp_term_taxonomy.count` leaderboard took FILL THIS IN; the `COUNT(*)` version took
FILL THIS IN, with `Extra` of FILL THIS IN. Autoloaded options: FILL THIS IN, totalling
FILL THIS IN bytes on a bare install, largest being FILL THIS IN. Re-measure after Modules 03,
05 and 13.

## My rule, in one sentence

FILL THIS IN — when does a facet belong in a taxonomy, and when in post meta?

## What I would have got wrong

FILL THIS IN — one thing here that contradicted what you assumed.
```

**Verify §8:**

- [ ] No `FILL THIS IN` remains.
- [ ] The "My rule" sentence is yours, not a paraphrase of Key Concept 9.
- [ ] The autoload figure is a number, with units.

---

## Verification

```bash
cd wordpress-headless

# 1. The stack is up and Adminer is serving, which is how you read plans as a table
docker compose ps && curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8081/
# Expected: four services "running", db "(healthy)", then 200

# 2. THE NEGATIVE THIS LESSON IS BUILT ON: there is no index on meta_value
docker compose run --rm wpcli wp db query "SHOW INDEX FROM wp_postmeta WHERE Column_name='meta_value';"
# Expected: NO ROWS AT ALL — an empty result, not an error.

# 3. ...while exactly three indexes DO exist, and meta_key really is a 191 prefix
docker compose run --rm wpcli wp db query "SELECT INDEX_NAME, COLUMN_NAME, SUB_PART
  FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='btt' AND TABLE_NAME='wp_postmeta'
  ORDER BY INDEX_NAME;"
# Expected: three rows. ORDER BY INDEX_NAME sorts case-insensitively, so they
#           arrive meta_key/meta_key (SUB_PART 191), post_id/post_id, PRIMARY/meta_id.

# 4. The fixture exists, so the plans below mean something
docker compose run --rm wpcli wp db query "SELECT
  (SELECT COUNT(*) FROM wp_posts WHERE post_type='post' AND post_status='publish') AS posts,
  (SELECT COUNT(*) FROM wp_postmeta) AS meta_rows;"
# Expected: 201, and a meta_rows figure over 600

# 5. Three meta clauses produce THREE wp_postmeta references
docker compose run --rm wpcli wp db query "EXPLAIN SELECT p.ID FROM wp_posts p
  INNER JOIN wp_postmeta mt1 ON p.ID = mt1.post_id
  INNER JOIN wp_postmeta mt2 ON p.ID = mt2.post_id
  INNER JOIN wp_postmeta mt3 ON p.ID = mt3.post_id
  WHERE p.post_type='post' AND mt1.meta_key='resolution_status'
    AND mt2.meta_key='downtime_minutes' AND mt3.meta_key='estimated_cost_usd';" \
  | cut -f3 | grep -c '^mt[123]$'
# Expected: 3   — one plan row per meta clause. Three facets, three self-joins.
#           Count column 3 (`table`), not the whole line: the wp_posts row's
#           `ref` reads btt.mt1.post_id, so a plain grep -c prints 4 — and would
#           print 3 for a different join order, i.e. for the wrong reason.

# 6. NEGATIVE: a leading wildcard makes meta_key(191) unusable
docker compose run --rm wpcli wp db query "EXPLAIN SELECT COUNT(*) FROM wp_postmeta
  WHERE meta_key LIKE '%status%';"
# Expected: type "index" or "ALL", rows close to the whole table.
#           Re-run with  meta_key = 'resolution_status'  and it becomes
#           type "ref", key "meta_key", with a far smaller rows estimate.

# 7. Autoload size, and the charset ceiling
docker compose run --rm wpcli wp db query "SELECT SUM(LENGTH(option_value)) AS autoload_bytes,
  (SELECT CONCAT(CHARACTER_SET_NAME, ' ', CHARACTER_MAXIMUM_LENGTH)
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='btt'
       AND TABLE_NAME='wp_options' AND COLUMN_NAME='option_name') AS name_column
  FROM wp_options WHERE autoload IN ('yes','on','auto','auto-on');"
# Expected: roughly 26000 bytes across 118 options on a bare 7.1 install, and
#           "utf8mb4 191". A NULL autoload_bytes means the predicate matched no
#           rows — i.e. you wrote autoload='yes', which 6.6 removed.

# 8. Your notes exist and are finished
test -f ../docs/schema-notes.md && grep -c 'FILL THIS IN' ../docs/schema-notes.md
# Expected: 0   — non-zero means Step 9 is unfinished

# 9. Clean up the fixture, then confirm nothing was orphaned
docker compose run --rm wpcli sh -c 'wp post delete $(wp post list --post_type=post --post_status=any --posts_per_page=-1 --format=ids) --force'
docker compose run --rm wpcli sh -c 'wp term delete post_tag $(wp term list post_tag --field=term_id)'
docker compose run --rm wpcli wp cache flush
docker compose run --rm wpcli wp db query "SELECT
  (SELECT COUNT(*) FROM wp_posts WHERE post_type='post') AS posts_left,
  (SELECT COUNT(*) FROM wp_postmeta m LEFT JOIN wp_posts p ON p.ID = m.post_id
    WHERE p.ID IS NULL) AS orphan_meta;"
# Expected: 0   0 — wp post delete --force removed the meta with the posts. A raw
#           DELETE FROM wp_posts would have left 600 orphan rows behind.
docker compose run --rm wpcli wp option get blogname
# Expected: Blame The Tech
```

Check 2 is the one to remember. Everything else here — the self-joins, the `filtered` percentage,
the `CAST`, the decision to model `severity` as a taxonomy — is a consequence of one `SHOW INDEX`
query returning nothing.

## Control Questions

1. `get_post_meta($id, 'downtime_minutes', true)` is cheap and
   `'meta_query' => [['key' => 'downtime_minutes', 'value' => 60, 'compare' => '>']]` is not.
   Name the index each uses, say what happens *after* the index lookup in each case, and explain
   why a fourth meta clause costs more than a fourth field on `get_post_meta()`.
2. `severity` is a taxonomy with four locked terms; `downtime_minutes` is post meta. Both are
   things a user might filter on. Justify the split using the `key` and `rows` columns you saw in
   Steps 4 and 5, then name the one thing the taxonomy choice costs an editor.
3. Your `wp_options` autoload set is 3 MB and a page renders in 900 ms. Explain why the same
   3 MB was invisible on a Classic WordPress site behind a full-page cache, what specifically
   pays for it here, and which two commands you would run first.
4. `wp_term_taxonomy.count` is denormalised. Describe a sequence of operations that leaves it
   wrong, say which page of Blame The Tech would then show a wrong number, and give the command
   that repairs it.
5. `post_name` is indexed as `post_name(191)` and the leads table in
   [appendix 03 §5](../appendix/03-content-model-reference.md#5-the-one-thing-that-is-not-a-post-wp_btt_leads)
   uses `VARCHAR(190)`. Derive 191 from the charset and the legacy InnoDB prefix limit, then say
   what would break if that table used `VARCHAR(255)` with a `UNIQUE KEY` across two such columns.

## Learn More

- [MySQL: Optimizing Queries with EXPLAIN](https://dev.mysql.com/doc/refman/8.0/en/using-explain.html)
  — the authoritative reading of every column you looked at in Steps 4 to 7
- [MySQL: How MySQL Uses Indexes](https://dev.mysql.com/doc/refman/8.0/en/mysql-indexes.html) —
  the leftmost-prefix rules that make `type_status_date`'s column order matter
- [MySQL: InnoDB limits](https://dev.mysql.com/doc/refman/8.0/en/innodb-limits.html) — the index
  prefix limits behind the 191-character ceiling, from the source
- [`WP_Meta_Query` in the code reference](https://developer.wordpress.org/reference/classes/wp_meta_query/)
  — read `get_sql_for_clause()` and watch the `mt1`/`mt2` aliases being generated
- [`wp db` commands](https://developer.wordpress.org/cli/commands/db/) — everything you ran
  through `wp db query`, plus `wp db size`, which is worth knowing
- [Use The Index, Luke — functions in the WHERE clause](https://use-the-index-luke.com/sql/where-clause/functions)
  — why `CAST(meta_value AS SIGNED)` makes a predicate non-sargable, better explained than in the
  MySQL manual
