<!-- docs/schema-notes.md -->

# WordPress schema notes — measured on my own install

Lesson 02.3. Every number below came from my database, not from the lesson text.

Measured on WordPress 7.1 / MySQL 8.4, against the Step 3 fixture: 200 published posts, 20
`post_tag` terms at 10 posts each, 600 custom meta rows (1 002 rows in `wp_postmeta` once
WordPress's own `_pingme` and `_encloseme` are counted), 400 term relationships — 200 tags plus
the default category `wp post generate` attaches. `ANALYZE TABLE` run immediately before every
plan below. Two deviations from the lesson text, both mine and neither a problem: I have 200
published posts rather than 201, because this install's "Hello world" is still an `auto-draft`;
and `wp db query` cannot run on this stack, so every statement went through the `db` container's
own MySQL client instead — see the note at the bottom.

## Indexes

`wp_postmeta` indexes, from Step 2: exactly three — `PRIMARY` on `meta_id`, `post_id` on
`post_id`, and `meta_key` on `meta_key` with `Sub_part` **191**. `wp_term_relationships`:
`PRIMARY` spanning `object_id` **then** `term_taxonomy_id`, plus a separate `term_taxonomy_id`
index, so both join directions are covered and both plans below reach it by index alone.
Columns I filter on that have no index: **`wp_postmeta.meta_value`** — the absence the whole
lesson is a consequence of — and `wp_term_taxonomy.count`, which is why the leaderboard sorts
with `Using filesort` even though it is reading twenty rows.

For contrast, `wp_posts` carries six indexes, including the composite `type_status_date`
(`post_type`, `post_status`, `post_date`, `ID`) that every `WP_Query` leans on, and `post_name`
at the same `Sub_part` of 191.

## Same intent, two models

|                               | `tax_query` (Step 4)         | `meta_query` (Step 5)   |
| ----------------------------- | ---------------------------- | ----------------------- |
| `key` on the filtering table  | `term_taxonomy_id`           | `meta_key`              |
| `rows`, product down the plan | 1 × 1 × 19 × 1 = **19**      | 200 × 1 = **200**       |
| `filtered` percentage         | —                            | **100.00** — see below  |
| `EXPLAIN ANALYZE` actual time | **0.0737 ms**                | **0.386 ms**            |

Same answer, ten rows each, and the meta version is **5× slower on 200 posts**. The ratio is the
point, not the milliseconds: the taxonomy plan enters `wp_term_relationships` by
`term_taxonomy_id` and reads 19 index entries — `Using index`, so it never touches the table —
while the meta plan reads all 200 `downtime_minutes` rows and only then applies
`CAST(meta_value AS SIGNED) > 60`. Both plans carry `Using temporary; Using filesort` for the
`ORDER BY p.post_date DESC`.

The `filtered` column did **not** behave as the lesson predicts. It reported `100.00` on the
`wp_postmeta` row, not a value well below 100, because MySQL 8.4 does not fold the `CAST`
comparison into that estimate — it plans for the `meta_key` lookup alone and treats the value
test as a post-read filter it cannot cost. `EXPLAIN ANALYZE` tells the truth the estimate hides:
`Index lookup on m using meta_key … rows=200`, then `Filter: … rows=181`. Nineteen rows read and
thrown away, on a fixture this small. Read `EXPLAIN ANALYZE`'s `rows=` at each nesting level, not
`filtered`, when you want to know what is being wasted.

## Self-joins, the leaderboard, autoload

One meta clause produced **1** `wp_postmeta` plan row; three produced **3** — `mt1`, `mt2`, `mt3`,
four plan rows in total with `wp_posts`. `mt1` is entered by `meta_key` (200 rows), `mt2` and
`mt3` by `post_id` (4 rows each), all three with `Using where`. The row product down that plan is
200 × 1 × 4 × 4 = **3 200**, against the **200** posts that actually exist: a 16× read
amplification to answer one question, and it grows with clause count rather than with the answer.
The `meta_key LIKE '%status%'` plan collapsed to `type: ALL`, `key: NULL`, `rows: 1002` — the
entire table, because a leading wildcard makes the `meta_key(191)` prefix unusable.

The `wp_term_taxonomy.count` leaderboard took **0.0346 ms**; the `COUNT(*)` version took
**0.851 ms**, with `Extra` of **`Using where; Using index; Using temporary; Using filesort`**.
That is **~25× slower** for an identical answer. The shapes explain it: the denormalised query
scans 21 term rows and is bounded by my **term count**, while the computed one walks 204 posts,
does an index lookup into `wp_postmeta` for each, aggregates ~1 000 rows through a temporary
table and returns 4 groups — bounded by my **content volume**. Adding posts changes only the
second number.

Autoloaded options: **120**, totalling **42 354** bytes on a bare install, largest being
**`_transient_wp_core_block_css_files` at 23 776 bytes** — 56% of the total on its own, with
`_transient_wp_styles_for_blocks` (11 341) taking most of the rest. Both are transients, so the
real steady-state figure is smaller than it looks. That is meaningfully above the 26 428 bytes
across 118 options the lesson records for a fresh 7.1, which is worth knowing before I read my
Module 13 number as a regression. The autoload column splits `on: 102`, `auto: 18`, `off: 30` —
no row anywhere says `yes`. `wp_options.option_name` is `varchar(191)`, table charset `utf8mb4`,
collation `utf8mb4_unicode_520_ci`. Re-measure after Modules 03, 05 and 13; ceiling ~800 000.

## My rule, in one sentence

If I will ever **filter, list, count or build a URL by** a facet, it is a taxonomy — the join is
index-only in both directions and the count is already denormalised; post meta is for values I
only **display or sort within a set some other clause has already narrowed**, because every meta
predicate is a full read of one `meta_key`'s rows followed by an unindexed value test, and a
second predicate is a second self-join rather than a second condition.

## What I would have got wrong

I would have trusted `Cardinality` in `SHOW INDEX` as a row count. Before I rebuilt the fixture,
`wp_term_relationships` reported a cardinality of 201 while the table held **zero rows** — those
were statistics left over from a previous fixture that a `down -v` had since destroyed. Index
statistics are a snapshot from the last `ANALYZE TABLE`, not a measurement, and the optimiser
plans against that snapshot. That is the real reason Step 3 ends with `ANALYZE TABLE` and not a
piece of ceremony: skip it and every plan in this document would have been reasoning about a
table that no longer exists.

Second, smaller, same shape: I assumed `filtered` was the column that would expose the meta
model's cost. It read `100.00`. The cost was visible only in `EXPLAIN ANALYZE`'s actual row
counts.

## Note on how these were measured

`wp db query` does not work on this stack, so none of the above came through it. `wp db *`
shells out to the `mysql` binary, and in `wordpress:cli-php8.4` that binary is MariaDB's client,
which has no `caching_sha2_password` plugin — the auth method MySQL 8.4 gives every account by
default now that `--default-authentication-plugin` has been removed from the server. Every other
WP-CLI command is unaffected, because those go through PHP's mysqlnd. I ran each statement in the
`db` container instead, where the real MySQL client lives:

```bash
bttsql() {
  docker compose exec -T db sh -c \
    'MYSQL_PWD="$MYSQL_PASSWORD" mysql -u"$MYSQL_USER" -D"$MYSQL_DATABASE" -t' <<< "$*"
}
bttsql "SHOW INDEX FROM wp_postmeta;"
```

Reading the credentials from the container's own environment keeps the database password out of
my shell history and off the process command line.
