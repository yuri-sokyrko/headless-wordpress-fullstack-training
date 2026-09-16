---
title: 'Seed Data & Migrations'
module: 4
lesson: 5
teaches: [deterministic-seed-data, wp-cli-seeding, option-based-migrations, secrets-from-environment, media-sideloading]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/seed.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/migrations.php']
requires: [4.3, 4.4]
---

# Lesson 04.5 — Seed Data & Migrations

## Quick Overview

`wp blame seed --fresh` takes an empty database to a fully populated site: **40 incidents, 8
tech reviews, 10 blog posts, 3 pages, 3 users, 12 media items**, plus the terms already seeded
on activation, exactly as
[appendix 03 §9](../appendix/03-content-model-reference.md#9-seed-data) specifies. The incidents
spread across all four severities and all ten scapegoats so that every filter, facet and
leaderboard in the front end has something to show. Two of the blog posts use every custom
block, which is what Module 14's block-rendering end-to-end spec will assert against.

The word doing the work is **deterministic**. Every seeded item gets a fixed slug and an
explicit `post_date` and `post_date_gmt`. Nothing calls `wp_rand()`, `time()` or an unseeded
Faker. Nothing references a database ID, because IDs shift and slugs do not. Run the seeder
twice and you get byte-identical content, which is what makes the Playwright suite in Module 12
stable rather than intermittently red — a fixture that changes between runs produces flaky
tests, and flaky tests get deleted. The three seeded users take their passwords **from the
environment**, never from a literal in the seeder, because this file is committed and Module 12
runs it in CI. The lesson closes with a forward-only migration runner: a version number in
`wp_options`, a list of numbered steps, and a `wp blame migrate` that applies only what has not
run — the pattern for changes that genuinely cannot be made idempotent.

By the end of this lesson you will have:

- `includes/cli/seed.php` implementing `wp blame seed` with `--fresh`, producing the §9
  inventory exactly
- `includes/cli/migrations.php` — an option-versioned, forward-only runner behind
  `wp blame migrate`
- Twelve media items sideloaded with `wp media import --porcelain` from checked-in JPEGs
- Three users created with passwords read from environment variables, and a seeder that
  **fails loudly** if those variables are missing
- Byte-identical output from two consecutive `wp blame seed --fresh` runs
- A populated wp-admin: 40 incidents across 4 severities and 10 scapegoats, ready for Module 05
  to query

## Classic WP Analogy

Your Classic WordPress equivalent of this is a `.sql` dump, and you have almost certainly worked
that way: develop against a copy of production, `wp db export` before a risky change,
`wp search-replace` the domain after importing, and hand the file to a colleague over Slack when
they need the same data. It works, and for content-heavy client sites it is often still the right
answer. The tools here are ones you know too — `wp_insert_post`, `wp_set_object_terms`,
`update_field`, `wp_insert_user`, `media_sideload_image` — used from a command instead of from a
migration script or an admin page.

The trade against a `.sql` dump is worth stating plainly. A dump is faster to produce and
captures everything, including the things you forgot were there. A code seeder is slower to write
but it is diffable, reviewable, parameterisable, safe to commit, and it cannot contain a
customer's personal data by accident. For a course, a test suite and a CI pipeline the seeder
wins on every axis that matters; for a 40,000-post client site with fifteen years of history it
would not, and pretending otherwise would be dishonest.

**Where the analogy breaks down:** a `.sql` dump can contain secrets and PII, and it usually
does — `wp_users.user_pass` hashes, email addresses, order records, session tokens in
`wp_options`. Passing one around in Slack is a routine Classic WordPress workflow and a genuine
data incident. A committed seeder inverts the risk: it cannot leak data it never had, but it
*can* leak a secret if you type a password into it, and unlike a dump it lives in git forever
where a `.sql` file at least stayed out of the repository. Hence the rule that survives the rest
of the course — seed passwords come from the environment, the seeder errors out if they are
absent, and there is never a literal credential in a tracked file.

---

## Key Concepts

### 1. Seeder, migration, dump: three tools, three jobs

They overlap enough to be confused and differ enough that using the wrong one is expensive.

| | **Seeder** (`wp blame seed`) | **Migration** (`wp blame migrate`) | **Dump** (`wp db export`) |
|---|---|---|---|
| Answers | "give me the fixture content" | "bring this database's shape up to date" | "give me a copy of that database" |
| Runs | locally, and in CI | on **every** deploy | by hand, before something risky |
| Repeatable | yes, and byte-identical | yes, and does nothing the second time | n/a |
| In git | ✅ the code is | ✅ the code is | ❌ never — it contains PII |
| Reviewable | ✅ a diff | ✅ a diff | ❌ a binary-ish blob |
| Destructive | only with `--fresh` | never | on import, totally |
| Good for | tests, demos, a fresh clone | production data changes | rescuing real content |

**The verdict for this project: a code seeder for fixtures, a version-gated runner for
migrations, and dumps only for moving real content between environments.** The dump is the tool
you reach for least and the one with the sharpest edges — Key Concept 9.

The distinction that matters most is **destructiveness**. `wp blame seed --fresh` deletes and
recreates, which is exactly right in CI and exactly wrong in production, where two seconds of an
empty site is an outage. That is why `--fresh` is a flag and not the default, and why it prompts.

### 2. Determinism, and why it is the whole lesson

Run the seeder twice and the second run must produce the same content as the first: same slugs,
same dates, same term assignments, same ordering. Not "similar". The same.

The reason is Module 12. A Playwright spec that asserts "the first incident on the page is
`incident-01`" is stable if and only if the fixture is stable. A fixture that shifts between runs
produces a suite that fails one time in ten, and a suite that fails one time in ten gets
`test.skip`-ed and then deleted. **Flaky fixtures do not cause flaky tests; they cause the
deletion of tests.**

Five rules produce determinism. Each one is closing a specific hole, and Key Concepts 3 to 6 take
them in turn.

| Rule | Closes |
|---|---|
| 1. Identify by **slug**, never by id | auto-increment differs between a fresh seed and an imported dump |
| 2. Write `post_date` **and** `post_date_gmt` explicitly | WordPress derives the missing one from the site timezone |
| 3. No `wp_rand()`, no `time()`, no unseeded Faker | randomness is the definition of non-reproducible |
| 4. One fixed `WP_HOME` for seeding and for running | serialized option values embed the URL |
| 5. Media from checked-in files, intermediate sizes off | image encoders differ across GD builds and platforms |

### 3. Rules 1 and 2: identity and time

**Slugs, not ids.** A post id comes from `AUTO_INCREMENT`, which is a property of the *history* of
a table, not of its contents. Two databases with identical content have different ids the moment
anything was ever deleted:

```
   FRESH SEED                        SEED, RESET, SEED AGAIN
   ───────────────────────────       ─────────────────────────────────
   incident-01  → ID 12              incident-01  → ID 52
   incident-02  → ID 13              incident-02  → ID 53
   the-intern   → term_id 4          the-intern   → term_id 4   (not deleted)
   hero-hobt    → ID 51              hero-hobt    → ID 91
```

So every fixture reference in this seeder is a slug, and ids are resolved at seed time:
`get_page_by_path( 'incident-01', OBJECT, 'incident' )` for the upsert,
`get_term_by( 'slug', 'the-intern', 'scapegoat' )` for the term. The one place this bites hardest
is `btt/scapegoat-picker`, the Module 13 block that stores a **term id** in its attributes: the
seeder has to look the id up from the slug while writing the block markup, because a hard-coded
`"termId": 4` is a fixture that works on your machine and nowhere else.

> **The subtle version of rule 1 is the trash.** `wp_delete_post( $id )` without `true` moves the
> post to the trash, and a trashed post **keeps its slug reserved**. The next seed then gets
> `incident-01-2` from `wp_unique_post_slug()`, and every URL in your test suite is wrong. The
> reset in this lesson force-deletes for exactly that reason.

**Both date columns, explicitly.** `wp_posts` has four date columns and WordPress will fill in
whichever you leave out:

| You supply | WordPress does | Result |
|---|---|---|
| `post_date` only | derives `post_date_gmt` using the **site timezone** | the GMT column depends on an option, so two installs disagree |
| `post_date_gmt` only | derives `post_date` the same way | same problem, mirrored |
| **both** | uses both verbatim | ✅ identical rows on every machine |
| neither | uses `current_time()` | ✅✅ guaranteed different on every run |

The downstream damage is not just the column value. Relative-time rendering ("3 days ago") is
computed from it, and `orderby: DATE` ordering between two posts a minute apart flips when the
offset changes. This seeder pins the site timezone to `UTC` first and then writes both columns
from one fixed epoch, so the two are the same string and neither depends on state.

### 4. Rule 3: no randomness, but still varied data

"Deterministic" is often heard as "boring", and it does not have to be. Forty incidents that all
have 145 minutes of downtime make a useless demo and hide a class of front-end bug. You want
*variety* without *randomness*, and the trick is to derive from the index instead of from a
random source.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/seed.php (fragment)
// ❌ Varied, and different on every run
$downtime = wp_rand( 5, 480 );
$occurred = gmdate( 'Y-m-d H:i:s', time() - wp_rand( 0, 86400 * 90 ) );

// ✅ Varied, and identical on every run
$downtime = ( ( $i * 37 ) % 480 ) + 5;
$occurred = ( new \DateTimeImmutable( SEED_EPOCH ) )->modify( "+{$i} days" );
```

The multipliers are prime-ish on purpose: `$i * 37 % 480` walks the range without an obvious
pattern, where `$i * 10 % 480` would produce forty values in five distinct buckets. Coverage also
becomes something you can *state* rather than hope for — `$i % 4` over the severities gives
exactly ten incidents per severity, and `$i % 10` over the scapegoats gives exactly four per
scapegoat, which is what makes the term counts in
[appendix 03 §9](../appendix/03-content-model-reference.md#9-seed-data) sum to 40.

| Banned | Why | Replace with |
|---|---|---|
| `wp_rand()`, `rand()`, `mt_rand()` | non-reproducible by definition | arithmetic on the loop index |
| `time()`, `current_time()`, `date()` with no argument | the clock is different every run | a fixed epoch constant |
| `uniqid()`, `wp_generate_uuid4()` | same | a fixed slug |
| Faker with no seed | same, in bulk | Faker **with** a fixed seed, or a literal array |
| `array_rand()`, `shuffle()` | same | `$i % count()` |

Faker with `$faker->seed( 1234 )` is genuinely deterministic and a reasonable choice for a large
fixture. This course does not use it, for one reason worth naming: Faker's output is stable for a
given *version* of Faker, so a dependency bump silently rewrites your entire fixture. Arithmetic
on an index does not have a changelog.

### 5. Rule 4: one `WP_HOME`, because serialized values embed it

`WP_HOME` is fixed at `http://localhost:8080` for this whole course (appendix 04 §2), and the
seeder records the value it ran under so it can warn you when they diverge. The reason is that
absolute URLs end up in places you cannot `UPDATE` with a single statement:

| Where the URL ends up | Shape |
|---|---|
| `wp_options.home` / `siteurl` | a plain string — easy |
| `wp_posts.guid` on every attachment | a plain string |
| `post_content` on any post with a pasted absolute link | a plain string |
| **Any serialized option or meta value** | `s:23:"https://old.example.com"` — a string **with a byte-length prefix** |

That last row is the one that breaks things, and it is why Key Concept 9's `sed` is a trap rather
than a shortcut. It also means "just seed on one host and run on another" is not free: the fixture
you produce is tied to the URL you produced it under.

### 6. Rule 5: media from checked-in files, with sizes turned off

Twelve images, committed as JPEGs under `includes/cli/fixtures/media/`, sideloaded with
`wp media import`. Two decisions inside that sentence.

**They are checked in rather than downloaded.** A seeder that fetches placeholder images from an
image service needs network access in CI, gets rate-limited, and produces different bytes when the
service changes its font. Twelve small JPEGs in the repository have none of those properties.

**Intermediate sizes are disabled during the import**, by returning an empty array from
`intermediate_image_sizes_advanced`:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/seed.php (fragment)
add_filter( 'intermediate_image_sizes_advanced', static fn(): array => array() );
```

| With sizes | Without sizes |
|---|---|
| 12 originals + ~5 sizes each = ~72 files | 12 files |
| a `wp db export` carries ~72 rows of `_wp_attachment_metadata` | 12 |
| thumbnails are **byte-different** between GD versions, Imagick builds and platforms | nothing to differ |
| `next/image` needs them | ❌ it does not — it requests the original and resizes itself |

The last row is what makes this decision easy rather than a trade. In a Classic theme,
`the_post_thumbnail('medium')` needs WordPress's `medium` file to exist. Here Next's image
optimiser takes `sourceUrl` — the original — and produces its own sizes at its own breakpoints
(Module 21). WordPress's intermediate sizes would be generated, stored, backed up, and never
requested by anything.

> **`wp media regenerate` is how you undo this** if you ever do need the sizes — locally, for a
> theme preview, or because a plugin insists. It is not part of the seed, and it is not part of any
> deploy.

### 7. The rule that is not about determinism: passwords come from the environment

The seeder creates three users. Their passwords are read with `getenv()` and the seeder **errors
out** if a variable is missing.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/seed.php (fragment)
// ❌ Never. This file is committed, and a committed secret is compromised for ever.
$password = '<any literal, of any kind>';

// ✅ Read at run time, absent from the repository, absent from the image.
$password = (string) getenv( 'BTT_EDITOR_PASSWORD' );

if ( '' === $password ) {
	WP_CLI::error( 'BTT_EDITOR_PASSWORD is not set.' );
}
```

Four reasons this is a hard rule rather than a preference:

| Reason | Detail |
|---|---|
| Git is permanent | A secret committed once lives in the object database and in every clone. The remedy is rotation, not `git rm`. |
| CI runs this exact file | Module 12 runs `wp blame seed` in GitHub Actions. A literal password there is a credential in a public-ish log-producing environment. |
| The image ships it | Module 24 copies the plugin into a container image. `docker history` and every registry layer would carry it. |
| Fail loudly, not quietly | A seeder that invents a random password when the variable is missing produces three accounts nobody can log into, and no error. |

One nuance, so the rule stays usable. A password is required only to **create** an account. Run
the seeder against a database that already holds the three accounts and it will not ask, and it
will not touch their passwords — changing a credential is not a side effect a content seeder gets
to have when nobody asked for it. Supply a variable and it rotates that account to match; omit it
and the account is left exactly as it was. That is what lets Module 05 re-run
`wp blame seed --fresh` with no secrets in the environment at all.

And the corollary about *where* they do live: exported into the shell session that runs the seeder,
and passed into the container explicitly:

```bash
export BTT_EDITOR_PASSWORD="$(openssl rand -base64 24)"

docker compose run --rm \
  -e BTT_EDITOR_PASSWORD="$BTT_EDITOR_PASSWORD" \
  wpcli wp blame seed
```

Not in `.env`, because `.env` is `env_file`-mounted into four services that have no business
holding a user credential. Not in `~/.zshrc`, because that is a file on disk that outlives the
task. In the session, and in your password manager.

### 8. The migration runner: an option, an ordered list, and forward-only

Some changes cannot be made idempotent by a guard, because the guard would need information the
new state no longer has. Renaming `environment`'s value `prod` to `production` is the canonical
shape: run it twice and the second run finds nothing, which is fine — but you still need to know
whether it has run at all, and after the rename there is no way to tell a never-migrated database
from a fully-migrated one by looking at it.

```
   wp blame migrate
        │
        ├─▶ get_option('btt_db_version')  ──▶ 1
        │
        ├─▶ migrations() = [ 1 => …, 2 => …, 3 => … ]   ksort'ed
        │      1 ≤ 1   skip
        │      2 > 1   run migration_2_normalise_environment()
        │              └─▶ update_option('btt_db_version', 2)   ← after EACH step
        │      3 > 2   run migration_3_default_submission_switch()
        │              └─▶ update_option('btt_db_version', 3)
        │
        └─▶ Success: Database is now at version 3.
```

Five properties, each one load-bearing:

| Property | Why |
|---|---|
| The version lives in `wp_options`, with `autoload = false` | it is read once per deploy, never on the request path |
| Migrations are keyed by the version they bring the database **to** | so "which ones are pending" is a comparison, not bookkeeping |
| The option is written **after each step** | a crash in step 3 must not re-run steps 1 and 2 |
| **Forward only** — there is no `down()` | a `down()` you never test is a `down()` that does not work. Roll forward with a new migration |
| Each step is **still** individually idempotent | belt and braces: a partial write inside one step must not corrupt the retry |

Two things this runner deliberately is not. It is not the plugin activation hook — Lesson 03.1
established that `wp plugin activate` on an already-active plugin does **not** re-fire the hook, so
activation cannot be a migration mechanism. And it is not the seeder: migrations touch content that
already exists and may be real, so they never delete and never insert fixtures.

### 9. Dumps, `search-replace`, and the trap that eats `sed`

Pulling production content down is a real workflow and the tools are the ones you already know:

```bash
# On the production host, where `wp` is installed natively (Module 24 runs this
# through `fly ssh console`):
wp db export /tmp/prod.sql --add-drop-table

# Locally, where every `wp` goes through the wpcli service:
docker compose run --rm wpcli wp db import /tmp/prod.sql
docker compose run --rm wpcli wp search-replace \
  'https://blamethe.tech' 'http://localhost:8080' --all-tables --dry-run
```

`--dry-run` first, every time. It prints a table of how many replacements would happen per table,
which is the only cheap way to notice that you are about to rewrite 40,000 rows of `post_content`
you did not mean to touch.

Now the trap. A URL replacement over a SQL file looks like a job for `sed`, and it is not:

```
   PHP serialized value in wp_options.option_value
   ────────────────────────────────────────────────────────────────
   a:1:{s:4:"logo";s:23:"https://old.example.com";}
                            └┬┘ └──────────┬──────────┘
                             │             └── 23 bytes
                             └── the declared byte length

   after  sed 's|https://old.example.com|http://localhost:8080|g'
   ────────────────────────────────────────────────────────────────
   a:1:{s:4:"logo";s:23:"http://localhost:8080";}
                            └┬┘ └────────┬────────┘
                             │           └── 21 bytes
                             └── still says 23   ✗ MISMATCH
```

`unserialize()` on that string returns `false`. WordPress does not raise an error; `get_option()`
simply returns something falsy, and the consequence surfaces as "the theme options are empty",
"the widgets disappeared", or "the SCF options page is blank". The data is still in the row and it
is unreadable.

| Tool | Handles serialized values | Handles a `.sql` file | Verdict |
|---|---|---|---|
| `sed` on the dump | ❌ corrupts them | ✅ | ❌ never |
| `UPDATE … REPLACE()` in SQL | ❌ same corruption | n/a | ❌ never |
| `wp search-replace` | ✅ unserialize, replace, re-serialize | ✅ with `--export`/`--import` | ✅ **this** |
| `wp search-replace --precise` | ✅, and slower — PHP-side for every row | ✅ | ✅ when the fast path skips a table |

`wp search-replace` walks each column, detects serialized values, unserializes them, replaces
inside the structure, and re-serializes with correct lengths. It also handles nested structures and
base64-ish edge cases the regex approach cannot see. Use it, use `--dry-run`, and use
`--all-tables` rather than the default (which skips tables without the table prefix — including,
on some installs, the ones a plugin added).

> **A production dump is PII.** It contains email addresses, password hashes, and in this project
> the `wp_btt_leads` table. Import it, work with it, and delete it — do not leave it in
> `~/Downloads` and never commit it. That asymmetry is the strongest argument for the code seeder:
> a seeder cannot leak data it never had.

---
## Task

### Step 1: Generate the twelve fixture images, once, and commit them

They are checked in, not downloaded (Key Concept 6). Generate them with GD inside the
`wordpress` container so you need nothing installed on your host:

```bash
cd wordpress-headless
mkdir -p wp-content/plugins/blame-the-tech-core/includes/cli/fixtures/media

docker compose exec wordpress php -r '
$dir   = "/var/www/html/wp-content/plugins/blame-the-tech-core/includes/cli/fixtures/media";
$names = [
  "review-logo-01","review-logo-02","review-logo-03","review-logo-04",
  "review-logo-05","review-logo-06","review-logo-07","review-logo-08",
  "hero-home","hero-about","hero-hobt","avatar-the-intern",
];
foreach ( $names as $i => $name ) {
  $im = imagecreatetruecolor( 800, 600 );
  imagefilledrectangle( $im, 0, 0, 799, 599,
    imagecolorallocate( $im, ( 37 * $i + 30 ) % 256, ( 91 * $i + 70 ) % 256, ( 53 * $i + 110 ) % 256 ) );
  imagestring( $im, 5, 20, 20, $name, imagecolorallocate( $im, 255, 255, 255 ) );
  imagejpeg( $im, "$dir/$name.jpg", 82 );
  imagedestroy( $im );
}
echo count( $names ), " fixture images written", PHP_EOL;
'

ls -1 wp-content/plugins/blame-the-tech-core/includes/cli/fixtures/media | wc -l
```

**Verify §1:**

- [ ] `12`.
- [ ] `git status --short` shows twelve new `.jpg` files as **untracked and not ignored**. The
      root `.gitignore` excludes `wp-content/uploads/`, not this directory — media *fixtures* are
      source, media *uploads* are data.
- [ ] Commit them now: `git add -A && git commit -m "chore(seed): fixture images"`.

> **Generate once and commit; never regenerate on another machine.** JPEG encoders differ between
> GD builds, so a second `php -r` run elsewhere would produce different bytes for the same input
> and every reviewer would see twelve modified binaries in the diff. The committed files are the
> fixture; the command above is how they were made.

### Step 2: Write the migration runner

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/migrations.php
<?php
/**
 * Forward-only, version-gated schema migrations.
 *
 * Run by `wp blame migrate`, which Module 24's Fly.io release_command calls on
 * every deploy. Every step must be individually idempotent as well.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core\CLI;

use WP_CLI;

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
	return;
}

/** The version this CODE expects the database to be at. Bump when you add a step. */
const DB_VERSION = 3;

/** Legacy `environment` values migration 2 normalises. */
const LEGACY_ENVIRONMENTS = array(
	'prod'  => 'production',
	'stage' => 'staging',
	'dev'   => 'development',
	'womm'  => 'works-on-my-machine',
);

/**
 * Migrations keyed by the version they bring the database TO.
 *
 * Keys are contiguous integers from 1. Never renumber, never remove: a database
 * out there records that it has run up to N, and N must keep meaning this.
 *
 * @return array<int, callable-string>
 */
function migrations(): array {
	return array(
		1 => __NAMESPACE__ . '\\migration_1_backfill_blame_confidence',
		2 => __NAMESPACE__ . '\\migration_2_normalise_environment',
		3 => __NAMESPACE__ . '\\migration_3_default_submission_switch',
	);
}

/**
 * Apply every migration newer than the recorded version.
 *
 * @param bool $dry_run List what would run and change nothing.
 * @return array<int, int|null> version => rows changed, or null when dry.
 */
function run_migrations( bool $dry_run = false ): array {
	$current = (int) get_option( 'btt_db_version', 0 );
	$steps   = migrations();
	$applied = array();

	// Never trust the literal order of the array.
	ksort( $steps, SORT_NUMERIC );

	foreach ( $steps as $version => $callback ) {
		if ( $version <= $current ) {
			continue;
		}

		if ( $dry_run ) {
			$applied[ $version ] = null;
			continue;
		}

		if ( ! is_callable( $callback ) ) {
			WP_CLI::error( sprintf( 'Migration %d names a missing callable: %s', $version, $callback ) );
		}

		$applied[ $version ] = (int) call_user_func( $callback );

		// After EACH step, not once at the end. A failure in step 3 must not
		// make steps 1 and 2 run a second time on the retry.
		// autoload = false: read once per deploy, never on the request path.
		update_option( 'btt_db_version', $version, false );
	}

	return $applied;
}

/**
 * 1. Give every incident a blame_confidence, defaulting to the documented 73.
 *
 * Idempotent by construction: the query only matches rows where the key is
 * absent, so the second run finds nothing.
 */
function migration_1_backfill_blame_confidence(): int {
	$ids = get_posts(
		array(
			'post_type'      => 'incident',
			'post_status'    => 'any',
			'posts_per_page' => -1,
			'fields'         => 'ids',
			'orderby'        => 'ID',
			'order'          => 'ASC',
			'meta_query'     => array(
				array(
					'key'     => 'blame_confidence',
					'compare' => 'NOT EXISTS',
				),
			),
		)
	);

	foreach ( $ids as $id ) {
		update_post_meta( (int) $id, 'blame_confidence', 73 );
	}

	return count( $ids );
}

/**
 * 2. Rewrite abbreviated `environment` values to the contract's spelling.
 *
 * This is the shape that cannot be made self-detecting: after it has run there
 * is no way to distinguish a migrated database from one that never had legacy
 * values. Hence the version gate.
 */
function migration_2_normalise_environment(): int {
	global $wpdb;

	$changed = 0;

	foreach ( LEGACY_ENVIRONMENTS as $old => $new ) {
		// Table name from $wpdb, values through placeholders. Never string
		// interpolation into SQL. See Lesson 02.3 for why, and Module 16 for the
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = %s AND meta_value = %s",
				'environment',
				$old
			)
		);

		foreach ( $ids as $id ) {
			// update_post_meta(), not a raw UPDATE: it invalidates the object
			// cache and fires the hooks other code listens to.
			update_post_meta( (int) $id, 'environment', $new );
			++$changed;
		}
	}

	return $changed;
}

/**
 * 3. Default the incident-submission kill switch to OPEN when it has never been set.
 *
 * A missing SCF option reads as falsy, which would mean "submissions closed" —
 * the wrong direction to fail for a fresh install.
 */
function migration_3_default_submission_switch(): int {
	if ( ! function_exists( 'update_field' ) ) {
		// SCF absent. Nothing to do, and not an error: this step is about a
		// default value, not about a structural change.
		return 0;
	}

	// get_option() rather than get_field(), because get_field() would return the
	// field's own default for a missing row and we need to know whether the row
	// exists at all. SCF names options-page rows `options_<field_name>`.
	if ( false !== get_option( 'options_incident_submission_open', false ) ) {
		return 0;
	}

	update_field( 'incident_submission_open', true, 'option' );

	return 1;
}
```

### Step 3: Write the seeder

The longest file in the module, and every line of it is one of the rules from Key Concepts 2
to 7.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/seed.php
<?php
/**
 * Deterministic fixture content for `wp blame seed`.
 *
 * Every value here comes from a constant or from the loop index. Nothing reads
 * the clock, a random source, or a database id.
 *
 * Counts are fixed by appendix 03 section 9: 40 incidents, 8 reviews, 10 posts,
 * 3 pages, 3 users, 12 media.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core\CLI;

use WP_CLI;

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
	return;
}

/** Bumped whenever the fixture content changes shape. */
const SEED_VERSION = '1.0.0';

/** The seeder's only clock. Never time(), never current_time(). */
const SEED_EPOCH = '2024-09-02 08:00:00';

/** Stamped on everything the seeder creates, so reset deletes only its own work. */
const SEED_MARKER = '_btt_seeded';

/** Verdict values as stored — appendix 03 section 3. Lesson 06.1 maps them to an enum. */
const SEED_VERDICTS = array( 'adopt', 'trial', 'assess', 'hold' );

/** The three fixture accounts. Passwords come from the named environment variables. */
const SEED_USERS = array(
	'editor'    => array(
		'role'    => 'editor',
		'email'   => 'editor@blamethe.tech',
		'display' => 'Dana Editor',
		'env'     => 'BTT_EDITOR_PASSWORD',
	),
	'reporter'  => array(
		'role'    => 'incident_reporter',
		'email'   => 'reporter@blamethe.tech',
		'display' => 'Sam Reporter',
		'env'     => 'BTT_REPORTER_PASSWORD',
	),
	'e2e_agent' => array(
		'role'    => 'incident_reporter',
		'email'   => 'e2e@blamethe.tech',
		'display' => 'E2E Agent',
		'env'     => 'BTT_E2E_PASSWORD',
	),
);

/** slug => title, for the twelve checked-in JPEGs. The slug IS the filename. */
const SEED_MEDIA = array(
	'review-logo-01'    => 'Hyperscale Cloud Co logo',
	'review-logo-02'    => 'Monolith Systems logo',
	'review-logo-03'    => 'Serverless Nights logo',
	'review-logo-04'    => 'Deprecate.io logo',
	'review-logo-05'    => 'YAML Industries logo',
	'review-logo-06'    => 'Rewrite Rules Ltd logo',
	'review-logo-07'    => 'Eventual Consistency AG logo',
	'review-logo-08'    => 'Blameless Kubernetes logo',
	'hero-home'         => 'Home hero',
	'hero-about'        => 'About hero',
	'hero-hobt'         => 'HOBT hero',
	'avatar-the-intern' => 'The Intern',
);

/** Eight companies, in a fixed order matching review-logo-01..08. */
const SEED_COMPANIES = array(
	'Hyperscale Cloud Co',
	'Monolith Systems',
	'Serverless Nights',
	'Deprecate.io',
	'YAML Industries',
	'Rewrite Rules Ltd',
	'Eventual Consistency AG',
	'Blameless Kubernetes',
);

/** Ten headlines, cycled across the forty incidents and numbered. */
const SEED_HEADLINES = array(
	'Deployed on a Friday',
	'The certificate expired',
	'Someone rotated the wrong key',
	'The cron job ran twice',
	'A regex ate the payload',
	'The cache never invalidated',
	'DNS propagated to nowhere',
	'The migration ran backwards',
	'Autoscaling scaled to zero',
	'A leap second in the log parser',
);

/** Eight reporter display names, cycled. Denormalised — appendix 03 section 4.1. */
const SEED_REPORTERS = array(
	'Ada L.',
	'Grace H.',
	'Linus T.',
	'Barbara L.',
	'Ken T.',
	'Margaret H.',
	'Dennis R.',
	'Radia P.',
);

/**
 * A fixed date, offset from SEED_EPOCH, as BOTH date columns.
 *
 * DateInterval rather than modify(), so the return type is never false.
 *
 * @return array{post_date: string, post_date_gmt: string}
 */
function seed_date( int $days_after, int $hours_after = 0 ): array {
	$when = ( new \DateTimeImmutable( SEED_EPOCH, new \DateTimeZone( 'UTC' ) ) )
		->add( new \DateInterval( sprintf( 'P%dDT%dH', $days_after, $hours_after ) ) );

	$stamp = $when->format( 'Y-m-d H:i:s' );

	// Both columns, both UTC, both explicit. assert_seed_environment() has
	// already pinned the site timezone to UTC, so the two are the same string
	// and neither is derived from an option — Key Concept 3.
	return array(
		'post_date'     => $stamp,
		'post_date_gmt' => $stamp,
	);
}

/**
 * Resolve a term SLUG to its id. Slug in, id out — rule 1 from Key Concept 3.
 */
function term_id( string $slug, string $taxonomy ): int {
	$term = get_term_by( 'slug', $slug, $taxonomy );

	if ( ! $term instanceof \WP_Term ) {
		WP_CLI::error(
			sprintf(
				'Term "%s" is missing from %s. Re-activate blame-the-tech-core to seed terms (Lesson 03.3).',
				$slug,
				$taxonomy
			)
		);
	}

	return (int) $term->term_id;
}

/**
 * Create or update a post identified by its SLUG, never by an id.
 *
 * @param array<string, mixed> $postarr Arguments for wp_insert_post().
 */
function upsert_post( array $postarr ): int {
	$existing = get_page_by_path(
		(string) $postarr['post_name'],
		OBJECT,
		(string) $postarr['post_type']
	);

	if ( $existing instanceof \WP_Post ) {
		$postarr['ID'] = (int) $existing->ID;
	}

	// wp_insert_post() calls wp_unslash() on what you give it, so unslashed
	// input silently loses every backslash — which matters in a stack trace.
	$id = wp_insert_post( wp_slash( $postarr ), true );

	if ( is_wp_error( $id ) ) {
		WP_CLI::error( sprintf( 'Insert failed for %s: %s', $postarr['post_name'], $id->get_error_message() ) );
	}

	update_post_meta( (int) $id, SEED_MARKER, 1 );

	return (int) $id;
}

/**
 * Everything that must be true before a single row is written.
 */
function assert_seed_environment(): void {
	$missing = array();

	foreach ( SEED_USERS as $login => $spec ) {
		// A password is only REQUIRED to create an account. Re-seeding content
		// against a database that already holds the three accounts must not ask
		// for the credentials again — Module 05 re-runs this seeder without them,
		// and a seeder that demands a secret it does not need is a seeder people
		// work around.
		if ( get_user_by( 'login', $login ) instanceof \WP_User ) {
			continue;
		}

		if ( '' === (string) getenv( $spec['env'] ) ) {
			$missing[] = $spec['env'];
		}
	}

	if ( array() !== $missing ) {
		// Fail loudly. Inventing a password here would create three accounts
		// nobody can log into, with a green exit code.
		WP_CLI::error(
			'Missing password variables: ' . implode( ', ', $missing )
			. '. Export them into this shell and pass them through with -e. Never into a file.'
		);
	}

	// One clock. WordPress derives whichever date column you omit using the site
	// timezone, so two installs on different zones disagree. Write only if it
	// differs — the Module 03 idempotency rule.
	if ( 'UTC' !== (string) get_option( 'timezone_string' ) ) {
		update_option( 'timezone_string', 'UTC' );
		update_option( 'gmt_offset', 0 );
		WP_CLI::log( 'pinned the site timezone to UTC' );
	}

	// One home URL. Serialized option values embed it with a byte-length prefix,
	// so a fixture seeded under one WP_HOME is not portable to another without
	// `wp search-replace` — Key Concepts 5 and 9.
	$home     = untrailingslashit( (string) get_option( 'home' ) );
	$recorded = untrailingslashit( (string) get_option( 'btt_seed_home', '' ) );

	if ( '' !== $recorded && $recorded !== $home ) {
		WP_CLI::warning(
			sprintf(
				'This database was seeded under %1$s and is running under %2$s. Run: wp search-replace %1$s %2$s --all-tables',
				$recorded,
				$home
			)
		);
	}

	if ( $recorded !== $home ) {
		update_option( 'btt_seed_home', $home, false );
	}
}

/**
 * Create the three fixture accounts.
 *
 * @return array<string, int> login => user id
 */
function seed_users(): array {
	$ids = array();

	foreach ( SEED_USERS as $login => $spec ) {
		$password = (string) getenv( $spec['env'] );
		$existing = get_user_by( 'login', $login );

		if ( $existing instanceof \WP_User ) {
			$ids[ $login ] = (int) $existing->ID;

			// No variable supplied: leave the existing password alone. Changing
			// an account's password is not a side effect a content seeder gets
			// to have when it was not asked.
			if ( '' === $password ) {
				continue;
			}

			// Only write when something actually changed: wp_update_user() with
			// the same password still writes a NEW hash, because the salt is
			// random. That would make two identical seeds produce two different
			// wp_users rows.
			if ( ! wp_check_password( $password, $existing->user_pass, $existing->ID ) ) {
				wp_update_user(
					array(
						'ID'        => $existing->ID,
						'user_pass' => $password,
						'role'      => $spec['role'],
					)
				);
			}

			continue;
		}

		if ( '' === $password ) {
			// Unreachable if assert_seed_environment() ran, and it stays here
			// because "the caller checked" is not a guarantee.
			WP_CLI::error( sprintf( '%s is not set, so %s cannot be created.', $spec['env'], $login ) );
		}

		$id = wp_insert_user(
			array(
				'user_login'   => $login,
				'user_pass'    => $password,
				'user_email'   => $spec['email'],
				'display_name' => $spec['display'],
				'role'         => $spec['role'],
			)
		);

		if ( is_wp_error( $id ) ) {
			WP_CLI::error( sprintf( 'Could not create %s: %s', $login, $id->get_error_message() ) );
		}

		$ids[ $login ] = (int) $id;
	}

	// Every seeded account is a verified account. `registerDeveloper` (Lesson
	// 06.2) sets btt_verified = 0 on a self-registered developer, and Module 15
	// refuses `create_incidents` while that meta says '0'. A CLI-created account
	// has no such meta at all, and `'' == 0` is true in PHP — so writing 1 here
	// states the intent in the fixture rather than relying on the filter reading
	// an absent value the way you hoped. Idempotent: same value on every seed.
	foreach ( $ids as $id ) {
		update_user_meta( $id, 'btt_verified', 1 );
	}

	return $ids;
}

/** Turn off intermediate image sizes. Registered only for the duration of the seed. */
function no_intermediate_sizes(): array {
	return array();
}

/**
 * Sideload the twelve checked-in JPEGs.
 *
 * @return array<string, int> slug => attachment id
 */
function seed_media(): array {
	$dir = \Blame\Core\PLUGIN_DIR . '/includes/cli/fixtures/media';
	$ids = array();

	// launch => false below means `wp media import` runs IN THIS PROCESS, so
	// this filter applies to it. With launch => true it would not — that is the
	// whole reason for the flag. Key Concept 6.
	add_filter( 'intermediate_image_sizes_advanced', __NAMESPACE__ . '\\no_intermediate_sizes' );

	foreach ( SEED_MEDIA as $slug => $title ) {
		$existing = get_page_by_path( $slug, OBJECT, 'attachment' );

		if ( $existing instanceof \WP_Post ) {
			$ids[ $slug ] = (int) $existing->ID;
			continue;
		}

		$path = sprintf( '%s/%s.jpg', $dir, $slug );

		if ( ! is_readable( $path ) ) {
			WP_CLI::error( sprintf( 'Missing fixture image: %s. Re-run Step 1.', $path ) );
		}

		$id = (int) WP_CLI::runcommand(
			// esc_cmd() is WP-CLI's escapeshellarg wrapper. Titles contain spaces.
			\WP_CLI\Utils\esc_cmd( 'media import %s --porcelain --title=%s', $path, $title ),
			array(
				'return'     => true,
				'launch'     => false,
				'exit_error' => true,
			)
		);

		// Fixed slug. `wp media import` derives one from the filename, which is
		// usually the same and is not guaranteed to be.
		wp_update_post(
			array(
				'ID'        => $id,
				'post_name' => $slug,
			)
		);
		update_post_meta( $id, SEED_MARKER, 1 );

		$ids[ $slug ] = $id;
	}

	remove_filter( 'intermediate_image_sizes_advanced', __NAMESPACE__ . '\\no_intermediate_sizes' );

	return $ids;
}

/**
 * Forty incidents, ten per severity and four per scapegoat.
 *
 * @param array<string, int> $users From seed_users().
 */
function seed_incidents( array $users ): int {
	$scapegoats = array_keys( \Blame\Core\SCAPEGOAT_TERMS );
	$severities = array_keys( \Blame\Core\SEVERITY_TERMS );
	$stacks     = array_keys( \Blame\Core\TECH_STACK_TERMS );

	for ( $i = 0; $i < 40; $i++ ) {
		$occurred = seed_date( $i, 1 );
		$dates    = seed_date( $i, 3 );
		$headline = SEED_HEADLINES[ $i % 10 ];

		$id = upsert_post(
			array(
				'post_type'     => 'incident',
				'post_name'     => sprintf( 'incident-%02d', $i + 1 ),
				'post_title'    => sprintf( '%s (#%d)', $headline, $i + 1 ),
				// All forty PUBLISHED, so wp_term_taxonomy.count sums to 40 —
				// term counts only count public statuses (Lesson 03.3). Pending
				// and rejected fixtures are created per-test in Module 12.
				'post_status'   => 'publish',
				'post_author'   => $users['reporter'],
				'post_content'  => sprintf(
					'<!-- wp:paragraph --><p>%s. Nobody has owned up yet.</p><!-- /wp:paragraph -->',
					esc_html( $headline )
				),
				'post_date'     => $dates['post_date'],
				'post_date_gmt' => $dates['post_date_gmt'],
			)
		);

		// Term IDs, resolved from slugs. Passing a slug straight into
		// wp_set_object_terms() on a NON-hierarchical taxonomy would be read as
		// a term NAME and would create a duplicate term.
		wp_set_object_terms( $id, array( term_id( $severities[ $i % 4 ], 'severity' ) ), 'severity', false );
		wp_set_object_terms( $id, array( term_id( $scapegoats[ $i % 10 ], 'scapegoat' ) ), 'scapegoat', false );
		wp_set_object_terms( $id, array( term_id( $stacks[ ( $i * 3 ) % 10 ], 'tech_stack' ) ), 'tech_stack', false );

		// SCF field names fixed by appendix 03 section 4.1. update_field() writes
		// through the sanitisers registered in Lesson 03.4 — which is why
		// occurred_at has to be in the past or it is stored as ''.
		update_field( 'occurred_at', $occurred['post_date_gmt'], $id );
		update_field( 'downtime_minutes', ( ( $i * 37 ) % 480 ) + 5, $id );
		update_field( 'estimated_cost_usd', ( $i * 911 ) % 250000, $id );
		update_field( 'environment', \Blame\Core\INCIDENT_ENVIRONMENTS[ $i % 4 ], $id );
		update_field( 'resolution_status', \Blame\Core\INCIDENT_RESOLUTIONS[ ( $i * 3 ) % 4 ], $id );
		update_field( 'blame_confidence', ( $i * 17 ) % 101, $id );
		update_field(
			'stack_trace',
			sprintf(
				"Traceback (most recent call last):\n  File \"app/handler.php\", line %d\n  RuntimeException: %s",
				40 + $i,
				$headline
			),
			$id
		);
		update_field( 'reporter_display_name', SEED_REPORTERS[ $i % 8 ], $id );
		update_field( 'is_verified', 0 === $i % 3, $id );
	}

	return 40;
}

/**
 * Eight reviews, two per verdict, with both repeaters populated.
 *
 * @param array<string, int> $media From seed_media().
 */
function seed_reviews( array $media ): int {
	$stacks = array_keys( \Blame\Core\TECH_STACK_TERMS );

	for ( $i = 0; $i < 8; $i++ ) {
		$company = SEED_COMPANIES[ $i ];
		$logo    = $media[ sprintf( 'review-logo-%02d', $i + 1 ) ];
		$dates   = seed_date( 60 + ( $i * 2 ), 11 );

		$id = upsert_post(
			array(
				'post_type'     => 'tech_review',
				'post_name'     => sprintf( 'review-%02d', $i + 1 ),
				'post_title'    => $company,
				'post_status'   => 'publish',
				'post_content'  => sprintf(
					'<!-- wp:paragraph --><p>We ran %s in production for six months. Here is the damage.</p><!-- /wp:paragraph -->',
					esc_html( $company )
				),
				'post_date'     => $dates['post_date'],
				'post_date_gmt' => $dates['post_date_gmt'],
			)
		);

		wp_set_object_terms( $id, array( term_id( $stacks[ $i % 10 ], 'tech_stack' ) ), 'tech_stack', false );
		set_post_thumbnail( $id, $logo );

		update_field( 'company_name', $company, $id );
		update_field( 'logo', $logo, $id );
		update_field( 'rating_overall', 1 + ( ( $i * 7 ) % 10 ), $id );
		update_field( 'rating_dx', 1 + ( ( $i * 3 ) % 10 ), $id );
		update_field( 'rating_docs', 1 + ( ( $i * 5 ) % 10 ), $id );
		update_field( 'rating_incident_response', 1 + ( ( $i * 9 ) % 10 ), $id );
		update_field( 'verdict', SEED_VERDICTS[ $i % 4 ], $id );
		// SCF's Date Picker stores Ymd and reformats on read via return_format.
		update_field( 'reviewed_at', str_replace( '-', '', substr( $dates['post_date_gmt'], 0, 10 ) ), $id );

		// A repeater value is a list of rows keyed by SUB-FIELD NAME. This is
		// the PHP shape behind [TechReviewFieldsPros] — Lesson 04.2.
		update_field(
			'pros',
			array(
				array( 'item' => sprintf( '%s ships runnable examples in the docs', $company ) ),
				array( 'item' => 'The status page is honest about outages' ),
			),
			$id
		);

		update_field(
			'cons',
			array(
				array( 'item' => 'Pricing requires a spreadsheet and a lawyer' ),
				array( 'item' => sprintf( 'The %s CLI has four ways to do one thing', $company ) ),
			),
			$id
		);
	}

	return 8;
}

/**
 * Block markup exercising every custom block from Module 13.
 *
 * `btt/scapegoat-picker` stores a TERM ID, so the id is resolved from the slug
 * here. A literal would be a fixture that works on exactly one machine.
 *
 * Every string below is byte-for-byte what the block's `save()` produces in
 * Module 13. That is not a coincidence and it is not optional: the block
 * validator re-runs `save()` on load and compares its output to what is
 * stored, so a fixture that merely looks right makes every seeded post open
 * with "this block contains unexpected content". Three of the six blocks
 * serialise to a self-closing comment because their `save()` returns `null`
 * — they store data and no markup, which is the right shape when a React
 * front end does the rendering.
 *
 * These two posts are also the "already published" content that Lesson 13.5's
 * `deprecated` entry exists for. When 13.5 changes `btt/incident-callout`'s
 * markup, this is the old markup it has to keep loading.
 */
function block_showcase( int $scapegoat_term_id ): string {
	return implode(
		"\n\n",
		array(
			'<!-- wp:heading --><h2 class="wp-block-heading">What happened</h2><!-- /wp:heading -->',
			'<!-- wp:paragraph --><p>A short, entirely fictional description of a very real feeling.</p><!-- /wp:paragraph -->',
			'<!-- wp:btt/incident-callout {"incidentSlug":"incident-01","severity":"s1-catastrophic"} --><div class="wp-block-btt-incident-callout"><h3>Production is a smoking crater</h3><p>The DNS change was fine in staging.</p></div><!-- /wp:btt/incident-callout -->',
			'<!-- wp:btt/blame-quote {"attribution":"The on-call engineer"} --><blockquote class="wp-block-btt-blame-quote"><!-- wp:paragraph --><p>It worked on my machine.</p><!-- /wp:paragraph --></blockquote><!-- /wp:btt/blame-quote -->',
			sprintf( '<!-- wp:btt/scapegoat-picker {"termId":%d} /-->', $scapegoat_term_id ),
			'<!-- wp:btt/incident-ticker {"count":5,"severities":["s1-catastrophic","s2-major"]} /-->',
			'<!-- wp:btt/tech-verdict-card {"reviewSlug":"review-01"} --><div class="wp-block-btt-tech-verdict-card">Trial.</div><!-- /wp:btt/tech-verdict-card -->',
			'<!-- wp:btt/hobt-cta {"label":"Stop blaming the tech","href":"/hobt"} /-->',
		)
	);
}

/**
 * Ten blog posts. The first two carry every custom block.
 *
 * @param array<string, int> $media From seed_media().
 */
function seed_posts( array $media ): int {
	$showcase = block_showcase( term_id( 'the-intern', 'scapegoat' ) );
	$stacks   = array_keys( \Blame\Core\TECH_STACK_TERMS );

	for ( $i = 0; $i < 10; $i++ ) {
		$dates = seed_date( 40 + $i, 9 );

		$id = upsert_post(
			array(
				'post_type'      => 'post',
				'post_name'      => sprintf( 'blog-%02d', $i + 1 ),
				'post_title'     => sprintf( 'Blaming the tech, part %d', $i + 1 ),
				'post_status'    => 'publish',
				'post_excerpt'   => 'A short satirical post about the thing that broke.',
				'post_content'   => $i < 2
					? $showcase
					: sprintf(
						'<!-- wp:paragraph --><p>Instalment %d. Nothing exploded today, which is suspicious.</p><!-- /wp:paragraph -->',
						$i + 1
					),
				'post_date'      => $dates['post_date'],
				'post_date_gmt'  => $dates['post_date_gmt'],
				'comment_status' => 'closed',
			)
		);

		wp_set_object_terms( $id, array( term_id( $stacks[ $i % 10 ], 'tech_stack' ) ), 'tech_stack', false );
		set_post_thumbnail( $id, $media['hero-home'] );
	}

	return 10;
}

/**
 * Home, About and HOBT.
 *
 * @param array<string, int> $media From seed_media().
 */
function seed_pages( array $media ): int {
	$home = upsert_post(
		array_merge(
			seed_date( 0, 7 ),
			array(
				'post_type'    => 'page',
				'post_name'    => 'home',
				'post_title'   => 'Blame The Tech',
				'post_status'  => 'publish',
				'post_content' => '<!-- wp:paragraph --><p>Every outage has a scapegoat. Find yours.</p><!-- /wp:paragraph -->',
			)
		)
	);
	set_post_thumbnail( $home, $media['hero-home'] );

	$about = upsert_post(
		array_merge(
			seed_date( 0, 8 ),
			array(
				'post_type'    => 'page',
				'post_name'    => 'about',
				'post_title'   => 'About',
				'post_status'  => 'publish',
				'post_content' => '<!-- wp:paragraph --><p>We catalogue blame. It is a growth industry.</p><!-- /wp:paragraph -->',
			)
		)
	);
	set_post_thumbnail( $about, $media['hero-about'] );

	$hobt = upsert_post(
		array_merge(
			seed_date( 0, 9 ),
			array(
				'post_type'    => 'page',
				'post_name'    => 'hobt',
				'post_title'   => 'HOBT',
				'post_status'  => 'publish',
				'post_content' => block_showcase( term_id( 'kubernetes', 'scapegoat' ) ),
			)
		)
	);
	set_post_thumbnail( $hobt, $media['hero-hobt'] );

	// The second half of the HOBT Promo location rule from Lesson 04.3. Without
	// this row the field group does not apply and hobtPromo resolves to null.
	update_post_meta( $hobt, '_wp_page_template', 'templates/hobt.php' );

	update_field( 'headline', 'How To Omit Blaming Tech', $hobt );
	update_field( 'subheadline', 'A twenty-four module course in not being the scapegoat.', $hobt );
	update_field( 'hero_image', $media['hero-hobt'], $hobt );
	update_field( 'price_usd', 499, $hobt );
	update_field( 'seats_left', 12, $hobt );
	update_field( 'demo_booking_url', 'https://example.test/hobt/demo', $hobt );
	update_field( 'start_now_url', 'https://example.test/hobt/checkout', $hobt );

	update_field(
		'modules',
		array(
			array(
				'title'            => 'Blame Fundamentals',
				'summary'          => 'Who to blame, and in what order.',
				'duration_minutes' => 90,
			),
			array(
				'title'            => 'Advanced Deflection',
				'summary'          => 'It was DNS. It is always DNS.',
				'duration_minutes' => 120,
			),
			array(
				'title'            => 'Postmortem Theatre',
				'summary'          => 'Blameless, in the sense of blaming a process.',
				'duration_minutes' => 60,
			),
		),
		$hobt
	);

	update_field(
		'testimonials',
		array(
			array(
				'quote'  => 'I have not been blamed once since the workshop.',
				'author' => 'Dana Editor',
				'role'   => 'Head of Nobody Told Me',
				'avatar' => $media['avatar-the-intern'],
			),
			array(
				'quote'  => 'We now blame Mercury retrograde with confidence.',
				'author' => 'Sam Reporter',
				'role'   => 'Incident Reporter',
				'avatar' => $media['avatar-the-intern'],
			),
		),
		$hobt
	);

	// A static front page, so nodeByUri("/") resolves to a real node in Module 09.
	// Only write when something changed.
	if ( 'page' !== get_option( 'show_on_front' ) || $home !== (int) get_option( 'page_on_front' ) ) {
		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', $home );
	}

	return 3;
}

/**
 * Force-delete everything the seeder owns.
 *
 * `true` skips the trash. A trashed post keeps its slug reserved, so the next
 * seed would get `incident-01-2` and every URL in the test suite would be wrong.
 */
function reset_seeded(): int {
	$ids = get_posts(
		array(
			'post_type'      => array( 'incident', 'tech_review', 'post', 'page', 'attachment' ),
			'post_status'    => 'any',
			'posts_per_page' => -1,
			'fields'         => 'ids',
			'orderby'        => 'ID',
			'order'          => 'ASC',
			'meta_key'       => SEED_MARKER,
		)
	);

	foreach ( $ids as $id ) {
		// wp_delete_post() delegates to wp_delete_attachment() for attachments,
		// which also removes the files from the uploads volume.
		wp_delete_post( (int) $id, true );
	}

	return count( $ids );
}

/**
 * The whole seed, in dependency order.
 *
 * @param array<string, mixed> $assoc_args Flags from the CLI command.
 */
function seed_all( array $assoc_args ): void {
	assert_seed_environment();

	if ( \WP_CLI\Utils\get_flag_value( $assoc_args, 'fresh', false ) ) {
		WP_CLI::confirm( '--fresh force-deletes all seeded content first. Continue?', $assoc_args );
		WP_CLI::log( sprintf( 'reset: removed %d items', reset_seeded() ) );
	}

	$users = seed_users();

	// Two jobs at once. It sets post_author for editorial content, and it gives
	// the process `unfiltered_html` — without which wp_insert_post() runs
	// post_content through wp_kses and strips every <!-- wp:… --> comment.
	wp_set_current_user( $users['editor'] );

	if ( ! current_user_can( 'unfiltered_html' ) ) {
		WP_CLI::error(
			'The seeding user lacks unfiltered_html, so every block comment would be stripped '
			. 'from post_content. On multisite this capability is super-admin only.'
		);
	}

	$media = seed_media();

	$counts = array(
		'media'        => count( $media ),
		'users'        => count( $users ),
		'incidents'    => seed_incidents( $users ),
		'tech_reviews' => seed_reviews( $media ),
		'posts'        => seed_posts( $media ),
		'pages'        => seed_pages( $media ),
	);

	// Term counts are maintained incrementally, so recount once at the end and
	// the Module 05 leaderboard is correct on its first read.
	foreach ( array( 'scapegoat', 'severity', 'tech_stack' ) as $taxonomy ) {
		$terms = get_terms(
			array(
				'taxonomy'   => $taxonomy,
				'hide_empty' => false,
				'fields'     => 'ids',
			)
		);

		if ( ! is_wp_error( $terms ) ) {
			wp_update_term_count_now( $terms, $taxonomy );
		}
	}

	update_option( 'btt_seed_version', SEED_VERSION, false );

	foreach ( $counts as $label => $n ) {
		WP_CLI::log( sprintf( '%-13s %d', $label, $n ) );
	}

	WP_CLI::success( sprintf( 'seed %s complete', SEED_VERSION ) );
}
```

### Step 4: Wire it all into the command

Three edits. First the include list:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
	private const CLI_INCLUDES = array(
		'includes/cli/migrations.php',      // Lesson 04.5
		'includes/cli/seed.php',            // Lesson 04.5
		'includes/cli/blame-command.php',   // Lesson 04.4
	);
```

Then replace the two stub bodies in `blame-command.php`:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/blame-command.php
	public function seed( array $args, array $assoc_args ): void {
		// Same namespace, so the function resolves without a `use`.
		seed_all( $assoc_args );
	}

	public function reset( array $args, array $assoc_args ): void {
		WP_CLI::confirm(
			'This force-deletes every seeded incident, review, post, page and media item. Continue?',
			$assoc_args
		);

		WP_CLI::success( sprintf( 'removed %d items', reset_seeded() ) );
	}
```

And add the migration subcommand:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/blame-command.php
	/**
	 * Apply every schema migration that has not run yet.
	 *
	 * Forward only. To undo something, add a new migration.
	 *
	 * ## OPTIONS
	 *
	 * [--dry-run]
	 * : List what would run, and change nothing.
	 *
	 * ## EXAMPLES
	 *
	 *     wp blame migrate --dry-run
	 *     wp blame migrate
	 *
	 * @when after_wp_load
	 *
	 * @param string[]             $args       Positional arguments (none).
	 * @param array<string, mixed> $assoc_args Associative arguments.
	 */
	public function migrate( array $args, array $assoc_args ): void {
		$dry_run = (bool) \WP_CLI\Utils\get_flag_value( $assoc_args, 'dry-run', false );
		$from    = (int) get_option( 'btt_db_version', 0 );

		if ( $from > DB_VERSION ) {
			// The database has seen a newer deploy than this code. Rolling the
			// code back does not roll the data back — say so rather than
			// pretending everything is fine.
			WP_CLI::warning(
				sprintf( 'Database is at version %d but this code expects %d.', $from, DB_VERSION )
			);
		}

		$applied = run_migrations( $dry_run );

		if ( array() === $applied ) {
			WP_CLI::success( sprintf( 'Database is at version %d. Nothing to do.', $from ) );

			return;
		}

		foreach ( $applied as $version => $changed ) {
			WP_CLI::log(
				$dry_run
					? sprintf( 'pending: migration %d', $version )
					: sprintf( 'migration %d: %d row(s) changed', $version, (int) $changed )
			);
		}

		WP_CLI::success(
			$dry_run
				? sprintf( '%d migration(s) pending.', count( $applied ) )
				: sprintf( 'Database is now at version %d.', DB_VERSION )
		);
	}
```

**Verify §4:**

- [ ] `docker compose run --rm wpcli wp help blame` now lists six subcommands, including
      `migrate`.
- [ ] `docker compose run --rm wpcli wp blame migrate --dry-run` lists three pending migrations
      and leaves `btt_db_version` at `0`.

### Step 5: Seed

The three passwords are generated into this shell and passed into the container explicitly.
They are never written to a file.

```bash
cd wordpress-headless

export BTT_EDITOR_PASSWORD="$(openssl rand -base64 24)"
export BTT_REPORTER_PASSWORD="$(openssl rand -base64 24)"
export BTT_E2E_PASSWORD="$(openssl rand -base64 24)"

docker compose run --rm \
  -e BTT_EDITOR_PASSWORD="$BTT_EDITOR_PASSWORD" \
  -e BTT_REPORTER_PASSWORD="$BTT_REPORTER_PASSWORD" \
  -e BTT_E2E_PASSWORD="$BTT_E2E_PASSWORD" \
  wpcli wp blame seed --fresh --yes

echo "Save these three in your password manager now, then close this terminal when you are done."
```

> **`-e VAR="$VAR"` puts the value in that container's environment for the second or two it
> exists.** It is not on disk, not in git, and not in the image. It *is* in your shell history if
> you type a literal, which is exactly why the `export` lines use `openssl` and the `run` lines use
> `$VAR`. Do not add these to `.env`: that file is `env_file`-mounted into four services, none of
> which needs a user credential.

Then the migrations:

```bash
docker compose run --rm wpcli wp blame migrate
docker compose run --rm wpcli wp blame status
```

**Verify §5:**

- [ ] The seed output lists `incidents 40`, `tech_reviews 8`, `posts 10`, `pages 3`, `media 12`,
      `users 3`, then `Success:`.
- [ ] `wp blame migrate` reports it is now at version 3. Migration 2 changed 0 rows, which is
      correct — the seeder never wrote a legacy `environment` value.
- [ ] `wp blame status` shows `db_version 3`.
- [ ] Log in to wp-admin as `editor` with the password you generated. If it fails, the variable
      did not reach the container.

### Step 6: Run it twice and diff the result

This is the definition of done for this lesson.

```bash
docker compose run --rm wpcli wp post list --post_type=incident \
  --fields=post_name,post_date,post_status --format=csv --posts_per_page=-1 \
  --orderby=post_name --order=ASC > /tmp/seed-a.csv

docker compose run --rm \
  -e BTT_EDITOR_PASSWORD="$BTT_EDITOR_PASSWORD" \
  -e BTT_REPORTER_PASSWORD="$BTT_REPORTER_PASSWORD" \
  -e BTT_E2E_PASSWORD="$BTT_E2E_PASSWORD" \
  wpcli wp blame seed --fresh --yes

docker compose run --rm wpcli wp post list --post_type=incident \
  --fields=post_name,post_date,post_status --format=csv --posts_per_page=-1 \
  --orderby=post_name --order=ASC > /tmp/seed-b.csv

diff /tmp/seed-a.csv /tmp/seed-b.csv && echo "IDENTICAL"
```

**Verify §6:**

- [ ] `IDENTICAL`. Every slug, every date, every status the same.
- [ ] The **ids** are different, and that is fine — nothing in the fixture refers to one.
      `wp post list --post_type=incident --fields=ID,post_name --format=csv | head -3` before and
      after makes the point.
- [ ] If the diff is non-empty, the cause is in Key Concept 4's banned list. Grep the seeder for
      `rand`, `time(`, `uniqid` and `shuffle` before you look anywhere else.

### Step 7: Practise the dump round trip

You will do this for real in Module 24. Do it once now, locally, where nothing is at risk.

```bash
docker compose run --rm wpcli wp db export /tmp/btt-seeded.sql --add-drop-table
docker compose run --rm wpcli wp db reset --yes
docker compose run --rm wpcli wp db import /tmp/btt-seeded.sql
docker compose run --rm wpcli wp blame status

# What you would run after importing a dump taken from another URL.
docker compose run --rm wpcli wp search-replace \
  'https://blamethe.tech' 'http://localhost:8080' --all-tables --dry-run
```

**Verify §7:**

- [ ] `wp blame status` after the import matches what it said before the export, `db_version`
      included. The migration version travels with the data, which is the point of keeping it in
      `wp_options`.
- [ ] The `--dry-run` output is a table of per-table replacement counts and reports `0` for
      everything, because nothing here contains that domain. Read the table shape — that is what
      you will be checking against real numbers in Module 24.
- [ ] Delete the dump: `rm /tmp/btt-seeded.sql`. A dump of real content is PII; get into the habit
      on the one that is not.

---
## Verification

```bash
cd wordpress-headless

# 1. The full inventory from appendix 03 section 9
docker compose run --rm wpcli wp blame status
# Expected: incidents 40, tech_reviews 8, posts 10, pages 3, media 12,
#           users 4 or more (three seeded plus btt_admin from Lesson 02.2),
#           scapegoat_terms 10, severity_terms 4, db_version 3

# 2. The spread is exactly even, which is what makes every facet demonstrable
docker compose run --rm wpcli wp term list scapegoat --fields=slug,count --format=csv
# Expected: 10 rows, count 4 on every one  (4 x 10 = 40)
docker compose run --rm wpcli wp term list severity --fields=slug,count --format=csv
# Expected: 4 rows, count 10 on every one  (10 x 4 = 40)

# 3. Slugs are the fixed ones, not derived from titles
docker compose run --rm wpcli wp post list --post_type=incident --field=post_name \
  --posts_per_page=-1 --orderby=post_name --order=ASC | head -3
# Expected: incident-01, incident-02, incident-03 — and NOT incident-01-2,
#           which is what a trashed rather than force-deleted reset produces

# 4. Both date columns written, both identical, neither derived
docker compose run --rm wpcli wp db query \
  "SELECT post_name, post_date, post_date_gmt FROM wp_posts WHERE post_name='incident-01';"
# Expected: 2024-09-02 11:00:00 in BOTH columns

# 5. Nothing was left undated
docker compose run --rm wpcli wp db query \
  "SELECT COUNT(*) AS undated FROM wp_posts
   WHERE post_type IN ('incident','tech_review','post','page')
     AND post_date_gmt = '0000-00-00 00:00:00';"
# Expected: 0

# 6. Two reviews per verdict — 8 / 4, as the contract specifies
docker compose run --rm wpcli wp db query \
  "SELECT meta_value, COUNT(*) AS n FROM wp_postmeta
   WHERE meta_key='verdict' GROUP BY meta_value ORDER BY meta_value;"
# Expected: adopt 2, assess 2, hold 2, trial 2

# 7. The repeater rows are in SCF's array-of-rows shape
docker compose run --rm wpcli wp eval 'print_r( get_field( "pros", get_page_by_path( "review-01", OBJECT, "tech_review" )->ID ) );'
# Expected: Array( [0] => Array( [item] => ... ), [1] => Array( [item] => ... ) )

# 8. Twelve media items, and ZERO intermediate sizes
docker compose run --rm wpcli wp post list --post_type=attachment --post_status=inherit --format=count
# Expected: 12
docker compose run --rm wpcli wp eval '$n = 0; foreach ( get_posts( array( "post_type" => "attachment", "post_status" => "inherit", "posts_per_page" => -1, "fields" => "ids" ) ) as $id ) { $m = wp_get_attachment_metadata( $id ); $n += count( $m["sizes"] ?? array() ); } echo $n;'
# Expected: 0 — the intermediate_image_sizes_advanced filter did its job

# 9. The HOBT page carries its template AND its promo fields
docker compose run --rm wpcli wp eval '$p = get_page_by_path( "hobt" ); echo get_post_meta( $p->ID, "_wp_page_template", true ), " | ", get_field( "headline", $p->ID ), " | ", count( (array) get_field( "modules", $p->ID ) );'
# Expected: templates/hobt.php | How To Omit Blaming Tech | 3

# 10. Block comments survived wp_insert_post()
docker compose run --rm wpcli wp eval 'echo substr_count( get_page_by_path( "blog-01", OBJECT, "post" )->post_content, "<!-- wp:btt/" );'
# Expected: 6 — one per custom block. A 0 means kses stripped them, which means
#           the seeding user did not have unfiltered_html.

# 11. ...and the scapegoat-picker term id resolves to a real term
docker compose run --rm wpcli wp eval '$c = get_page_by_path( "blog-01", OBJECT, "post" )->post_content; preg_match( "/scapegoat-picker \{\"termId\":(\d+)\}/", $c, $m ); $t = get_term( (int) ( $m[1] ?? 0 ), "scapegoat" ); echo $t instanceof WP_Term ? $t->slug : "UNRESOLVED";'
# Expected: the-intern — resolved from the slug at seed time, never hard-coded

# 12. The migration runner is a no-op the second time
docker compose run --rm wpcli wp blame migrate; echo "exit=$?"
# Expected: "Success: Database is at version 3. Nothing to do." and exit=0

# 13. Re-seeding needs no secrets at all once the accounts exist
docker compose run --rm wpcli wp blame seed; echo "exit=$?"
# Expected: the full seed output and exit=0. No password variables were passed and none
#           were needed — nothing had to be created.

# 14. NEGATIVE: creating an account WITHOUT its password variable is refused
docker compose run --rm wpcli wp user delete e2e_agent --yes
docker compose run --rm wpcli wp blame seed; echo "exit=$?"
# Expected: "Error: Missing password variables: BTT_E2E_PASSWORD..." and exit=1.
#           NOT an account with an invented password and a green exit code.

# 14b. ...and it succeeds the moment the variable is passed through
docker compose run --rm -e BTT_E2E_PASSWORD="$BTT_E2E_PASSWORD" wpcli wp blame seed > /dev/null
docker compose run --rm wpcli wp user get e2e_agent --field=roles
# Expected: incident_reporter

# 15. NEGATIVE: no literal credential in the tracked seeder
grep -nE "(pass(word)?|secret|token)[[:space:]]*=[[:space:]]*['\"][^'\"\$]{8,}" \
  wp-content/plugins/blame-the-tech-core/includes/cli/seed.php \
  || echo 'no literal credential — correct'
# Expected: no literal credential — correct

# 16. NEGATIVE: none of Key Concept 4's banned functions appear
grep -nE '\b(wp_rand|mt_rand|shuffle|array_rand|uniqid|wp_generate_uuid4)[[:space:]]*\(|\btime[[:space:]]*\([[:space:]]*\)|\bcurrent_time[[:space:]]*\(' \
  wp-content/plugins/blame-the-tech-core/includes/cli/seed.php \
  || echo 'deterministic — correct'
# Expected: deterministic — correct

# 17. NEGATIVE: sed corrupts a serialized value; a length-aware rewrite does not
docker compose run --rm wpcli wp eval '
$before = serialize( array( "logo" => "https://old.example.com" ) );
$sedded = str_replace( "https://old.example.com", "http://localhost:8080", $before );
// The @ is deliberate: unserialize() emits a notice on the corrupt input, which
// is the whole point of the demonstration.
echo "sed    -> ", var_export( @unserialize( $sedded ), true ), PHP_EOL;
echo "aware  -> ", var_export( unserialize( serialize( array( "logo" => "http://localhost:8080" ) ) ), true ), PHP_EOL;'
# Expected: sed    -> false                    (the s:23: prefix no longer matches 21 bytes)
#           aware  -> array ( 'logo' => ... )  (re-serialized with the right length)
#           This is exactly why `wp search-replace` exists and `sed` on a dump does not.

# 18. Determinism, restated as data
docker compose run --rm wpcli wp post list --post_type=tech_review \
  --fields=post_name,post_date --format=csv --posts_per_page=-1 --orderby=post_name --order=ASC
# Expected: review-01 .. review-08, starting 2024-11-01 19:00:00, two days apart

# 19. Nothing broke and nothing secret is staged
docker compose logs --tail=80 wordpress | grep -iE 'php (warning|notice|fatal)' || echo clean
git status --short
# Expected: clean. Modified: includes/Plugin.php, includes/cli/blame-command.php.
#           New: includes/cli/seed.php, includes/cli/migrations.php.
#           NO .sql file, no .env, no uploads.
```

Checks 14 through 17 are the four that matter most. The first is the secret rule enforced by the
code rather than by a comment; the last is the reason `wp search-replace` is the only tool in this
course allowed near a URL change.

## Control Questions

1. `reset_seeded()` passes `true` as the second argument to `wp_delete_post()`. Describe what
   happens on the next `wp blame seed --fresh` if you remove it, name the core function that
   causes it, and say which Module 12 assertion breaks first.
2. `seed_date()` returns both `post_date` and `post_date_gmt`. Explain what WordPress does with an
   omitted `post_date_gmt`, give the two user-visible symptoms that produces when a colleague's
   machine is on a different timezone, and say why pinning the timezone alone would not be enough.
3. `seed_users()` calls `wp_check_password()` before `wp_update_user()`. Explain what would change
   in the database if it updated unconditionally, and say why that matters for a seeder whose whole
   purpose is producing identical output.
4. `run_migrations()` writes `btt_db_version` after every step rather than once at the end. Walk
   through what happens on a retry after migration 2 crashes, under both designs, and say which
   migration would run twice.
5. A colleague fixes a staging URL by running `sed -i 's|https://staging.blamethe.tech|http://localhost:8080|g'` over a
   `.sql` dump before importing it. The import succeeds and the site loads. Name two things that
   are now silently broken, explain the mechanism in terms of bytes, and give the command that
   would have been correct.

## Learn More

- [`wp_insert_post()` reference](https://developer.wordpress.org/reference/functions/wp_insert_post/) —
  read the note about slashed data, and the list of every date field it will fill in for you
- [`wp_unique_post_slug()` reference](https://developer.wordpress.org/reference/functions/wp_unique_post_slug/) —
  four paragraphs that explain why a trashed post breaks a deterministic fixture
- [WP-CLI — `wp media import`](https://developer.wordpress.org/cli/commands/media/import/) — the
  `--porcelain` behaviour the seeder depends on, plus `--post_id` for attaching to a parent
- [WP-CLI — `wp search-replace`](https://developer.wordpress.org/cli/commands/search-replace/) —
  read the "serialized data" and `--precise` sections; they are the authoritative version of Key
  Concept 9
- [WP-CLI — `WP_CLI::runcommand()`](https://make.wordpress.org/cli/handbook/references/internal-api/wp-cli-runcommand/) —
  the `launch`, `return` and `exit_error` options, and why `launch => false` is required for the
  image-sizes filter to apply
- [`intermediate_image_sizes_advanced` reference](https://developer.wordpress.org/reference/hooks/intermediate_image_sizes_advanced/) —
  the filter, and the related `big_image_size_threshold` you will meet again in Module 21
- [PHP — `serialize()`](https://www.php.net/manual/en/function.serialize.php) — the format
  specification; the `s:<bytes>:` prefix is the entire explanation for the `sed` trap
- [WordPress — upgrade routines and `dbDelta()`](https://codex.wordpress.org/Creating_Tables_with_Plugins) —
  the pattern the migration runner generalises, including why an option-stored version number is
  the conventional gate
