---
title: 'Deterministic Test Data'
module: 12
lesson: 4
teaches: [deterministic-seeding, fixed-slugs, sql-fixture-dump, wp-cli-seeding, global-setup, secrets-from-environment]
produces: ['wordpress-headless/wp-content/mu-plugins/blame-seeder-loader.php', 'wordpress-headless/wp-content/mu-plugins/blame-seeder/blame-seeder.php', 'next-app/e2e/global-setup.ts']
requires: [12.3, 4.4]
---

# Lesson 12.4 — Deterministic Test Data

## Quick Overview

The smoke spec from Lesson 12.3 passes on your machine and will fail on a colleague's, because
it asserts things about content and your two databases are not the same. This lesson makes the
data a controlled input rather than an accident. `wp blame seed` becomes genuinely
deterministic — the same command, run twice, on two machines, in either order, produces
byte-identical content — and a dev/CI-only mu-plugin puts `wp blame fixture export` and
`wp blame fixture load` beside the `wp blame reset` Lesson 04.5 already gave you, so restoring
that state takes two seconds instead of ninety.

The determinism rules are unglamorous and each one exists because it broke somebody's suite.
**Reference content by slug, never by ID**, because auto-increment values differ between two
runs of the same seeder. **Set `post_date` and `post_date_gmt` explicitly**, because the default
is "now", which makes "the six most recent incidents" a different six on Tuesday. **No
randomness at all** — no `wp_rand()`, no `time()`, no unseeded Faker — because a flaky test that
fails one run in forty is worse than no test. And **passwords come from the environment**: the
seeder reads all three fixture-account passwords from named env vars, and a literal password
never appears in a seeder file, because seeder files get committed. The full rule set is
recorded in
[the content model contract](../appendix/03-content-model-reference.md#9-seed-data), and this
lesson implements it.

By the end of this lesson you will have:

- `wordpress-headless/wp-content/mu-plugins/blame-seeder/blame-seeder.php` — dev/CI-only, never in the production image
- `wp blame fixture load` restoring the exact seeded state in seconds, and a `wp blame seed --fresh` that is idempotent
- A gitignored SQL fixture dump, exported from the seeder and cached in CI, with a documented staleness check
- `next-app/e2e/global-setup.ts` resetting WordPress before the Playwright run, gated on `E2E_MODE`
- The Lesson 12.3 spec passing twice in a row, with content assertions on fixed slugs and no literal password anywhere in git

## Classic WP Analogy

You already have a way of getting a known database, and you have already been bitten by its
weaknesses:

| Classic WordPress | Here |
|---|---|
| `wp db export backup.sql` before a risky change | the fixture dump, but derived rather than captured |
| Pulling a copy of production down to local | rejected: production content is not a fixture |
| `wp import` on a WXR export file | `wp blame seed`, which is code |
| `wp post create` in a shell script | the same, made deterministic |
| A migration plugin syncing staging to local | `wp blame reset` |
| "works on my machine" | the exact problem this lesson removes |

If you have ever copied a production database to debug something and found that the bug
vanished, you already know the failure mode: a captured database is a snapshot of accumulated
drift, and nobody can tell you which parts of it matter. The seeder is the opposite. It is code,
it is reviewed, and every piece of content in it exists because a test needs it — two of the ten
blog posts use every custom block specifically so Module 14's block-rendering spec has something
to assert against.

The analogy breaks on the relationship between the dump and the truth. `wp db export` treats the
database as the source and the file as a copy. Here it is inverted: **the seeder is the source of
truth and the SQL dump is a cache.** That ordering is what keeps it honest. The dump is
gitignored, keyed on a hash of the seeder, and rebuilt whenever the seeder changes, so it can
never become an artifact nobody knows how to regenerate — which is exactly what the
`backup-final-v2.sql` sitting in every agency's shared drive is.

The second break is the one that produces the most confusing failures: **WordPress is only
deterministic if you make it so, and most of the nondeterminism is invisible.** Auto-increment
IDs restart differently after a `TRUNCATE`. `post_date` defaults to the current time, so an
`orderby: date` query returns a stable order only within one seed run. `wp_rand()` seeds itself
from the system. Term IDs shift if terms are created in a different order. Uploads land in a
`uploads/2026/09/` folder that depends on the month you ran the seeder. None of this matters for
a real site and all of it matters for a test asserting the third card on a page. Classic
WordPress development never surfaces any of it, because nothing was ever asserting anything.

One security note, because seeders are a common leak. A seeder that creates users needs
passwords, and a password written into a PHP file in git is a committed secret — permanently,
in every clone, even after you delete the line. The seeder reads them from the environment and
fails loudly if the variable is absent. `E2E_MODE` and `E2E_SECRET` are introduced here, and
[appendix 04 §1](../appendix/04-env-reference.md#1-the-five-rules) is the rule set they follow.

---

## Key Concepts

### 1. Seven rules, and the WordPress mechanism each one is fighting

The module README lists the rules. This is the same table with the third column filled in, because
a rule you cannot attribute to a mechanism is one you drop the first time it is inconvenient.

| Rule | The mechanism that breaks it | Where it bites |
|---|---|---|
| Reference content by **slug**, never by id | `AUTO_INCREMENT` is a property of a table's *history*. Delete forty rows, insert forty more, and the ids start where the old ones stopped | a block attribute storing `"termId": 4`; a spec asserting `/?p=52` |
| Set `post_date` **and** `post_date_gmt` | WordPress derives whichever you omit from `timezone_string`, so two installs in two zones write two different rows | `orderby: DATE` flips between two posts a minute apart |
| No `wp_rand()`, `time()`, `uniqid()`, unseeded Faker | each seeds itself from the system | every assertion downstream of the value |
| One fixed `WP_HOME` for seeding **and** running | serialized option values embed the URL **with a byte-length prefix**, so a plain string replace corrupts them | `unserialize()` returns `false`, `get_option()` returns nothing, and no error is raised anywhere |
| Create terms in a fixed order | `term_id` follows insertion order | anything that stored a term id, including the leaderboard's cache |
| Passwords from the environment, never literals | git is permanent, and Module 24 copies the plugin into an image | a committed credential, in every clone, for ever |
| The dump is derived from the seeder, never the reverse | nothing enforces it but a habit — see Key Concept 5 | `backup-final-v2.sql`, which nobody can regenerate |

Two more mechanisms Lesson 04.5 did not reach, and this lesson does:

| Mechanism | Effect |
|---|---|
| `wp_upload_dir()` computes `uploads/YYYY/MM` from **today** | twelve attachment URLs and twelve `_wp_attached_file` rows differ between a September run and an October one — Key Concept 4 |
| `wp_options.autoload` | a large autoloaded option is read on **every** request, including every GraphQL request. The seeder writes its own options with `autoload = false` |

### 2. What Lesson 04.5 already got right

Say this generously, because the shape of this lesson is *finishing a job*, not redoing one.

| Already correct in `includes/cli/seed.php` | Why it matters here |
|---|---|
| `SEED_EPOCH = '2024-09-02 08:00:00'`, UTC, and `seed_date($days, $hours)` | one clock. Every `post_date` and `post_date_gmt` in the fixture is a pure function of the loop index |
| `assert_seed_environment()` pins `timezone_string` to `UTC` before a single row is written | removes the option the date derivation would otherwise depend on |
| `upsert_post()` resolves by `get_page_by_path( $slug, … )` | slugs in, ids out, everywhere |
| `reset_seeded()` force-deletes with `true` | a trashed post keeps its slug reserved, so the next seed would produce `incident-01-2` and every URL in the suite would be wrong |
| Variety from arithmetic — `( $i * 37 ) % 480`, `$i % 4`, `$i % 10` | forty distinct-looking incidents, ten per severity, four per scapegoat, and nothing random |
| `intermediate_image_sizes_advanced` returning `array()` during media import | twelve files instead of seventy-two, and no thumbnail bytes that differ between GD builds |
| Passwords read with `getenv()`, required **only** to create an account | the seeder re-runs in CI with no secrets in the environment at all |
| `btt_seed_home` recording the `WP_HOME` it ran under | a warning naming the exact `wp search-replace` you need, instead of a blank options page |

The seeder is already deterministic **for the content it creates**. This lesson is about the
content it does not create, and about turning ninety seconds of seeding into two of restore.

### 3. The two gaps that are invisible on your machine

This is the highest-value fix in the module and the definition of "works on my machine". Two
things the app shell reads on **every page** were created by hand, once, months ago:

| Thing | Created by | The seeder creates it | A fresh database has |
|---|---|---|---|
| The `Primary` menu, 5 items, assigned to the `primary` location | **you**, in Lesson 05.4, with `wp menu item add-custom` | ❌ until this lesson | an empty header nav |
| The `Site Settings` ACF options page | **you**, in Lesson 04.3, with a `wp eval` one-liner | ❌ until this lesson | `siteSettings` resolving to `null` and an empty footer |

```
   YOUR LAPTOP                                CI, or a colleague's clone
   ─────────────────────────────────          ─────────────────────────────────
   wp blame seed --fresh                      wp blame seed --fresh
   + menu items, typed in 05.4                (nothing — nobody typed them)
   + site settings, typed in 04.3             (nothing)
        │                                          │
   smoke suite: 13 passed  ✅                  smoke suite: 9 failed  ❌
                                              "expected 4 links, received 0"
```

Nothing about that failure points at the cause. Route, query and component are all fine; the
database is missing content whose absence you have never once observed. It is also the exact
failure that teaches people to distrust CI — "it passes locally, CI is broken" — and it is a
two-function fix.

A third item is in the same category and stays unfixed on purpose: the **scapegoat term
profiles** (`tagline`, `official_excuse`, `defensiveness`), also typed into a Lesson 04.3
`wp eval`. No route asserts them and a null ACF field renders as absent rather than crashing, so
they wait for the spec that needs them — using the same shape as `seed_site_settings()`.

### 4. `upload_dir` and the month you happened to run the seeder

`wp media import` calls `media_handle_sideload()`, which calls `wp_upload_dir()`, which computes
`uploads/YYYY/MM` from the **current** time. So:

```
   Seeded in September 2026        Seeded in October 2026
   ─────────────────────────       ─────────────────────────
   uploads/2026/09/hero-home.jpg   uploads/2026/10/hero-home.jpg
   _wp_attached_file:              _wp_attached_file:
     2026/09/hero-home.jpg           2026/10/hero-home.jpg
   guid:                           guid:
     …/uploads/2026/09/hero…         …/uploads/2026/10/hero…
```

Twelve attachments, three rows each, all different — and no page breaks, which is exactly why it
survives unnoticed: the URLs stay internally consistent, so everything renders. What it breaks is
*comparison*, and any future assertion on an image URL is a time bomb with a one-month fuse.

The fix is a filter on `upload_dir` derived from `SEED_EPOCH`, registered for the duration of the
media import exactly as the intermediate-sizes filter already is. `wp_upload_dir()` applies the
filter **before** it creates the directory, so the pinned path is the one that gets made — and it
works only because Lesson 04.5 runs `wp media import` with `'launch' => false`, in-process, where
your filters exist. With `launch => true` it would be another WP-CLI process and none of them
would.

### 5. The seeder is the source; the dump is a cache

`wp db export` treats the database as the truth and the file as a copy. Everything here inverts
that, and the inversion needs a mechanism, not a convention.

```
   THE ARROW MUST POINT THIS WAY
   ─────────────────────────────────────────────────────────────────────

   includes/cli/seed.php  ──────▶  MySQL  ──────▶  fixtures/seeded.sql
   (reviewed, diffable,            (90 s)          (a cache. 2 s to restore.)
    the source of truth)                                  │
        │                                                 │
        └── sha256 of SEED_VERSION + the three cli/*.php ──┘
                     the DIGEST, written as the dump's FIRST LINE
```

The digest is what keeps the arrow pointing that way. `wp blame fixture export` computes a
`sha256` over the seeder's **inputs** — `SEED_VERSION` plus the hash of each of
`includes/cli/{seed,migrations,blame-command}.php` — and writes it as the first line of the dump:

```
-- btt-seed-digest: 9f2c…
```

That is an SQL comment, so `wp db import` ignores it, and the dump now carries its own
provenance. `wp blame fixture status` recomputes the digest from the code on disk and prints the
same one line. Staleness is therefore a string comparison a human can perform:

```bash
head -1 ../fixtures/seeded.sql            # what the dump was built from
docker compose run --rm -T wpcli wp blame fixture status   # what the code says now
```

Different lines mean the seeder changed after the dump was taken, and the dump is a lie. The
consumers — `npm run e2e:reset` and `e2e/global-setup.ts` — **refuse** on a mismatch rather than
warning, because a warning in the middle of a 90-line CI log is a warning nobody reads.

Two deliberate choices. **A first-line comment rather than a `seeded.sql.sha256` sidecar**: one
file cannot be separated from its own digest by a copy, a CI cache restore, or a `.gitignore` that
names only one of the two. And **the digest hashes the code, not the data** — hashing the dump
would tell you the file is intact, which is not the question. The question is "did the seeder I
have right now produce this file", and only the inputs can answer it.

### 6. mu-plugins load first, so the `blame` namespace does not exist yet

Two load-order facts, and each one costs an hour if you meet it by accident.

**mu-plugins load before regular plugins.** `wp-settings.php` loads `wp-content/mu-plugins/*.php`
and only then the active plugins. So when `blame-seeder.php` runs, `blame-the-tech-core` has not
been loaded, `WP_CLI::add_command( 'blame', … )` has not been called, and there is no `blame`
namespace to hang a subcommand on. Registering at the top level produces
`Error: 'fixture' is not a registered subcommand of 'blame'` — or, worse, a second top-level
`fixture` command that works but is not where the documentation says it is.

The fix is a hook. WP-CLI fires `after_add_command:<name>` immediately after a command is
registered:

```php
// (illustration) mu-plugins/blame-seeder/blame-seeder.php — the ordering fix
WP_CLI::add_hook( 'after_add_command:blame', __NAMESPACE__ . '\\register' );
```

```
   wp-settings.php
     ├─▶ mu-plugins/*.php          add_hook('after_add_command:blame', …)   ← queued
     ├─▶ plugins/…-core/…          add_command('blame', Blame_Command::class)
     │        └─────────────────▶  the hook fires here
     │                             add_command('blame fixture', Fixture_Command::class)
     └─▶ WP-CLI dispatches         wp blame fixture export  ✅
```

`wp help blame fixture` is the one-command proof, and it is a `**Verify §N:**` in the Task for
that reason: it resolves only if the subcommand was registered on the right parent at the right
moment.

**mu-plugins does not recurse.** `wp_get_mu_plugins()` globs `WPMU_PLUGIN_DIR . '/*.php'`, top
level only, so `mu-plugins/blame-seeder/blame-seeder.php` is **never loaded** — a silent no-op
rather than an error: no command, no warning, nothing in a log. The directory therefore gets a
one-line loader beside it, which is the standard pattern for a must-use plugin of several files.

### 7. A command that can replace the database must not ship

`wp blame fixture load` runs `wp db import`, which is `DROP TABLE` followed by `CREATE` and
`INSERT` across every table. There is no undo and no confirmation prompt.

| Where it could live | Consequence |
|---|---|
| `plugins/blame-the-tech-core/` | Module 24 copies that directory into the production image. A database-replacing command would then exist on the production host, one `fly ssh console` away from a very bad afternoon |
| `mu-plugins/blame-seeder/` | not in the image's build context at all — **this** |

That is the whole architectural argument, and it is why this file is not three more methods on
`Blame_Command`. The plugin is the *artifact you deploy*; the mu-plugin is *tooling for the
machines that develop and test*. The safest way to guarantee a command cannot run in production is
for the code not to be there.

Belt and braces on top, because "not in the image" is a fact about a `Dockerfile` somebody may
edit: the file's first statement after the guard comment is
`if ( 'production' === wp_get_environment_type() ) { return; }`. Note what that does — it does
not make the command fail, it makes it **not exist**, so the error a confused operator gets is
"not a registered subcommand" rather than a permission message that invites a workaround.

This is also why Lesson 04.5's `wp blame reset` is **not** re-registered here. Five commands, two
homes, and the split is capability rather than tidiness:

| Command | Lives in | Does | Costs |
|---|---|---|---|
| `wp blame seed --fresh` | the plugin | builds the fixture from code | ~90 s |
| `wp blame reset --yes` | the plugin | force-deletes everything the seeder owns | ~10 s |
| `wp blame fixture export` | the **mu-plugin** | writes the dump plus its digest to STDOUT | ~3 s |
| `wp blame fixture load` | the **mu-plugin** | replaces the whole database from STDIN | ~2 s |
| `wp blame fixture status` | the **mu-plugin** | prints the digest of the code on disk | instant |

Reach for `seed --fresh` when the seeder changed, `fixture load` when you want the state you
already had, `reset` when you want an empty site. The 90-versus-2-second gap is the whole
economic argument for the dump: a reset that costs two seconds happens before every run.

### 8. Crossing the container boundary with a stream, not a path

`wp` runs in the `wpcli` container; the dump belongs on your host, at repo-root
`fixtures/seeded.sql`. Those two facts do not meet, and Lesson 02.2 is why: the `wpcli` service
bind-mounts `wp-content/{plugins,themes,mu-plugins}` and `wp-config.php`, and nothing else.

| Approach | Result |
|---|---|
| `wp db export /tmp/seeded.sql` | writes inside the container. `--rm` deletes it seconds later. The learner finds nothing and cannot see why |
| Add a bind mount for `fixtures/` | edits Module 02's Compose file, and every command needs `-v` forever |
| **`wp db export -` and redirect on the host** | ✅ the container writes to STDOUT, your shell owns the file |

```bash
# from wordpress-headless/
docker compose run --rm -T wpcli wp blame fixture export > ../fixtures/seeded.sql
docker compose run --rm -T wpcli wp blame fixture load  < ../fixtures/seeded.sql
```

This is the same pattern appendix 07 §3 already uses for `mysqldump`, and it makes the ownership
argument physically true: the container never touches the host filesystem, and the host shell
creates, owns and gitignores the file.

Two consequences to build in, both of which are the whole reason this is a Key Concept:

**`-T` is not optional.** Without it `docker compose run` allocates a TTY, and a TTY mangles the
stream: line endings get translated and the dump arrives subtly corrupt, or the redirect produces
nothing. It is the most common way this breaks.

**In `export`, STDOUT is data.** Every human-readable byte has to go to STDERR instead. That
includes `WP_CLI::log()` and `WP_CLI::success()`, both of which write to **STDOUT** — one stray
`log()` call puts `Success: exported` inside your SQL, and the import fails hundreds of lines
later with a syntax error that names a table. The command therefore uses a small `note()` helper
that writes to `STDERR`, and it flushes STDOUT before handing the descriptor to `mysqldump`, so
the digest line cannot end up after the dump it describes.

### 9. `E2E_MODE` is a safety interlock, and it comes from the shell you typed in

`e2e/global-setup.ts` can drop and reimport a database, so its default must be to do nothing.

| `E2E_MODE` | `global-setup` does |
|---|---|
| unset or anything but `1` | **nothing**, and logs one line saying so and how to arm it |
| `1` | checks WordPress, verifies the digest, imports the dump, asserts 40 incidents |

A global setup that reset the database the first time somebody ran `npx playwright test` would be
a hostile default: an afternoon's editorial work gone, with no prompt and no mention in the
output. Silence plus destruction is the worst pairing in tooling.

Now the part that surprises people, and it must be said plainly.
[Appendix 04 §3.1](../appendix/04-env-reference.md#31-server-only-no-prefix) lists `E2E_MODE`
and `E2E_SECRET` under `next-app/.env.local`. **Playwright does not read that file.** `.env.local`
is loaded by **Next**, inside the Next runtime, for the application. `playwright.config.ts` and
`global-setup.ts` run in a plain Node process that Playwright started, and to that process
`process.env.E2E_MODE` is `undefined` no matter what `.env.local` says.

```
   .env.local  ──▶  next dev / next build  ──▶  the app's process.env
                                                (Module 18's revalidate hook
                                                 reads E2E_SECRET here — and
                                                 appendix 04 §3.1 is right about it)

   your shell  ──▶  npx playwright test    ──▶  playwright.config.ts
                                                e2e/global-setup.ts
                                                (this is the only source)
```

So the interlock is armed in the command:

```bash
E2E_MODE=1 npx playwright test
```

The course resolves it this way rather than adding `dotenv`, and the reason is not dependency
count. **A destructive setup that arms itself from a dotfile is one `git pull` away from dropping
a colleague's database** — the file is on disk, invisible at the moment of invocation, and nobody
typed anything. One armed only from the invoking shell cannot fire by accident: `.env.local` is
the *application's* configuration, and the harness's kill switch belongs in the command you
typed.

### 10. Secrets, in the two places this lesson touches them

Nothing here is new policy — [appendix 04 §1](../appendix/04-env-reference.md#1-the-five-rules)
is the rule set — but both halves apply at once.

| Secret | Read by | Rule |
|---|---|---|
| `BTT_EDITOR_PASSWORD`, `BTT_REPORTER_PASSWORD`, `BTT_E2E_PASSWORD` | the seeder, only when *creating* an account | `getenv()`, fail loudly if absent, never in `.env`, never in a file. Passed in per-invocation with `-e VAR="$VAR"` |
| `E2E_SECRET` | Module 18's test-only revalidation hook, inside Next | exported into the session that runs the suite. `global-setup` only checks it is present, and fails with one sentence if it is not |

`E2E_SECRET` is checked here and used later on purpose: finding a half-configured environment now
costs a second, where finding it in Module 18 costs an afternoon. And the dump inherits the whole
rule set — it holds `wp_users` rows, so password **hashes** and email addresses. That is why
`fixtures/seeded.sql` is gitignored and why this lesson *verifies* the rule rather than trusting
it.

---

## Task

### Step 1: Seed the menu and the options page

Two new functions, appended after `seed_pages()`. Both are upserts keyed on something stable — a
title, a field name — so a second run writes nothing new.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/seed.php — append

/** The menu Lesson 05.4 created by hand, and the theme location it is assigned to. */
const SEED_MENU_NAME     = 'Primary';
const SEED_MENU_LOCATION = 'primary';

/**
 * The five items, in a FIXED order. `parent` is a TITLE, resolved to an id below —
 * a hard-coded parent id would be a fixture that works on exactly one machine.
 */
const SEED_MENU_ITEMS = array(
	array( 'title' => 'Incidents',         'url' => '/incidents/',  'parent' => '' ),
	array( 'title' => 'Scapegoats',        'url' => '/scapegoats/', 'parent' => '' ),
	array( 'title' => 'Reviews',           'url' => '/reviews/',    'parent' => '' ),
	array( 'title' => 'Blog',              'url' => '/blog/',       'parent' => '' ),
	array(
		'title'  => 'Catastrophic only',
		'url'    => '/incidents/?severity=s1-catastrophic',
		'parent' => 'Incidents',
	),
);

/**
 * Recreate the primary menu. Idempotent: items are matched by title, so a second
 * run updates the five that exist rather than adding five more.
 */
function seed_menu(): int {
	// Menu LOCATIONS are theme-scoped — btt-headless registers `primary` in its
	// after_setup_theme callback (Lesson 02.4). Without it there is nothing to
	// assign to, and MenuLocationEnum has no PRIMARY value for WPGraphQL either.
	if ( ! array_key_exists( SEED_MENU_LOCATION, get_registered_nav_menus() ) ) {
		WP_CLI::error(
			'No "primary" menu location is registered. btt-headless is not the active theme, '
			. 'or its register_nav_menus() call is missing — fix that first (Lesson 02.4).'
		);
	}

	$menu = wp_get_nav_menu_object( SEED_MENU_NAME );

	if ( ! $menu instanceof \WP_Term ) {
		$created = wp_create_nav_menu( SEED_MENU_NAME );

		if ( is_wp_error( $created ) ) {
			WP_CLI::error( 'Could not create the Primary menu: ' . $created->get_error_message() );
		}

		$menu = wp_get_nav_menu_object( (int) $created );
	}

	if ( ! $menu instanceof \WP_Term ) {
		WP_CLI::error( 'The Primary menu could not be resolved after creating it.' );
	}

	$menu_id = (int) $menu->term_id;

	// Existing items, indexed by title. `wp_get_nav_menu_items` returns them in
	// menu_order, and an empty menu returns an empty array rather than false.
	$by_title = array();

	foreach ( (array) wp_get_nav_menu_items( $menu_id, array( 'post_status' => 'any' ) ) as $item ) {
		if ( $item instanceof \WP_Post ) {
			$by_title[ $item->title ] = (int) $item->ID;
		}
	}

	$ids      = array();
	$position = 0;

	foreach ( SEED_MENU_ITEMS as $spec ) {
		++$position;

		// The parent is resolved from the title of an item created EARLIER in this
		// same fixed list, which is why the order in SEED_MENU_ITEMS is part of
		// the fixture rather than a formatting choice.
		$parent = '' === $spec['parent'] ? 0 : ( $ids[ $spec['parent'] ] ?? 0 );

		$id = wp_update_nav_menu_item(
			$menu_id,
			$by_title[ $spec['title'] ] ?? 0,
			array(
				'menu-item-title'     => $spec['title'],
				'menu-item-url'       => $spec['url'],
				'menu-item-type'      => 'custom',
				'menu-item-status'    => 'publish',
				'menu-item-position'  => $position,
				'menu-item-parent-id' => $parent,
			)
		);

		if ( is_wp_error( $id ) ) {
			WP_CLI::error( sprintf( 'Menu item "%s" failed: %s', $spec['title'], $id->get_error_message() ) );
		}

		$ids[ $spec['title'] ] = (int) $id;
		update_post_meta( (int) $id, SEED_MARKER, 1 );
	}

	// Assigning a menu to a location is a THEME MOD, not a property of the menu.
	// This is the line whose absence produces an empty header nav with a fully
	// populated menu sitting in wp-admin — the confusing half of the bug.
	$locations = (array) get_theme_mod( 'nav_menu_locations', array() );

	if ( ( $locations[ SEED_MENU_LOCATION ] ?? 0 ) !== $menu_id ) {
		$locations[ SEED_MENU_LOCATION ] = $menu_id;
		set_theme_mod( 'nav_menu_locations', $locations );
	}

	return count( $ids );
}

/**
 * The `Site Settings` ACF options page from appendix 03 section 4.5, which
 * SiteChrome reads in the root layout on every request.
 *
 * The values are exactly the ones Lesson 04.3 asked you to type into a `wp eval`,
 * so a seeded database now matches a hand-built one instead of approximating it.
 */
function seed_site_settings(): int {
	if ( ! function_exists( 'update_field' ) ) {
		WP_CLI::error( 'ACF is not active, so the Site Settings options page cannot be seeded.' );
	}

	// `option` is ACF's identifier for an options page — not a post id, not a
	// term_<id>. Lesson 04.3 Key Concept 3.
	$fields = array(
		'site_tagline'             => 'Every outage has a scapegoat.',
		'primary_cta_label'        => 'Report an incident',
		// `/incidents/submit`, the route Module 16 builds. Not `/incidents/new`:
		// that string appears nowhere else in the course.
		'primary_cta_url'          => '/incidents/submit',
		'footer_blurb'             => 'Blame The Tech is satire. The outages are real.',
		'incident_submission_open' => 1,
		'social_links'             => array(
			array( 'network' => 'mastodon', 'url' => 'https://example.test/@blamethetech' ),
			array( 'network' => 'github', 'url' => 'https://example.test/blamethetech' ),
		),
	);

	// Written unconditionally, and still idempotent: update_option() compares the
	// serialized value and returns without touching the row when it is unchanged.
	foreach ( $fields as $name => $value ) {
		update_field( $name, $value, 'option' );
	}

	return count( $fields );
}
```

Wire both into `seed_all()`, in the `$counts` array, after `pages`:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/seed.php — edit seed_all()
	$counts = array(
		'media'         => count( $media ),
		'users'         => count( $users ),
		'incidents'     => seed_incidents( $users ),
		'tech_reviews'  => seed_reviews( $media ),
		'posts'         => seed_posts( $media ),
		'pages'         => seed_pages( $media ),
		// NEW in Lesson 12.4. Both are read by the app shell on every page, and
		// neither existed in a database nobody had hand-built.
		'menu_items'    => seed_menu(),
		'site_settings' => seed_site_settings(),
	);
```

> **`reset_seeded()` deliberately does not delete the menu.** Its `post_type` list is
> `incident`, `tech_review`, `post`, `page`, `attachment` — `nav_menu_item` is not in it, and
> adding it would orphan the theme-mod location assignment on every `--fresh` run. The upsert is
> keyed on title, so leaving the items in place is both idempotent and cheaper. The `_btt_seeded`
> meta still goes on each one, so you can always find them.

### Step 2: Pin the media upload directory to `SEED_EPOCH`

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/seed.php — append
/**
 * Pin uploads to SEED_EPOCH's month.
 *
 * wp_upload_dir() derives `uploads/YYYY/MM` from the CURRENT time, so twelve
 * attachment URLs — and therefore the whole dump — differ between a September run
 * and an October one. wp_upload_dir() applies this filter BEFORE it creates the
 * directory, so the pinned path is the one that gets made.
 *
 * @param array<string, string> $dirs From wp_upload_dir().
 * @return array<string, string>
 */
function seed_upload_dir( array $dirs ): array {
	$epoch  = new \DateTimeImmutable( SEED_EPOCH, new \DateTimeZone( 'UTC' ) );
	$subdir = '/' . $epoch->format( 'Y/m' );

	$dirs['subdir'] = $subdir;
	$dirs['path']   = $dirs['basedir'] . $subdir;
	$dirs['url']    = $dirs['baseurl'] . $subdir;

	return $dirs;
}
```

Register it beside the existing filter in `seed_media()`, and remove it in the same place:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/seed.php — edit seed_media()
	add_filter( 'intermediate_image_sizes_advanced', __NAMESPACE__ . '\\no_intermediate_sizes' );
	// NEW: both filters only apply because `wp media import` runs with
	// 'launch' => false, i.e. in THIS process. With launch => true it would be a
	// separate WP-CLI process and neither filter would exist there.
	add_filter( 'upload_dir', __NAMESPACE__ . '\\seed_upload_dir' );
```

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/seed.php — edit seed_media()
	remove_filter( 'intermediate_image_sizes_advanced', __NAMESPACE__ . '\\no_intermediate_sizes' );
	remove_filter( 'upload_dir', __NAMESPACE__ . '\\seed_upload_dir' );
```

### Step 3: Re-seed, and see the two gaps close

```bash
cd wordpress-headless

docker compose run --rm wpcli wp blame seed --fresh --yes
```

No password variables are needed: the three accounts already exist, and Lesson 04.5's
`assert_seed_environment()` asks for a credential only when it must create one.

**Verify §3:**

- [ ] The output now ends with `menu_items 5` and `site_settings 6` alongside the six counts from
      Lesson 04.5.
- [ ] `docker compose run --rm wpcli wp menu item list primary --fields=title,position,link --format=table`
      lists five items with `Incidents` first and `Catastrophic only` last.
- [ ] `docker compose run --rm wpcli wp post list --post_type=attachment --field=guid | head -1`
      contains `/2024/09/`, not this month. If it shows the current month, the `upload_dir`
      filter is registered after the import rather than before it.
- [ ] Reload `http://localhost:3000/en` — four nav items, and the footer blurb. If they were
      already there, that is the point: they were there because *you* typed them.

### Step 4: Write the mu-plugin

Two files, because `wp_get_mu_plugins()` globs `*.php` at the top level only and never recurses
(Key Concept 6). First the loader:

```php
// wordpress-headless/wp-content/mu-plugins/blame-seeder-loader.php
<?php
/**
 * Plugin Name: Blame Seeder Loader
 * Description: Loads the dev/CI fixture commands. mu-plugins does not recurse into directories.
 *
 * @package Blame\Seeder
 */

declare( strict_types=1 );

defined( 'ABSPATH' ) || exit;

$btt_seeder = __DIR__ . '/blame-seeder/blame-seeder.php';

// A guard, not an optimisation: this directory is excluded from the production
// image, so on a host where the exclusion worked the require would be fatal.
if ( is_readable( $btt_seeder ) ) {
	require_once $btt_seeder;
}
```

Then the commands:

```php
// wordpress-headless/wp-content/mu-plugins/blame-seeder/blame-seeder.php
<?php
/**
 * `wp blame fixture` — export, load and inspect the seeded-database cache.
 *
 * DEV AND CI ONLY. `fixture load` replaces the entire database, and a command
 * that can do that has no business existing in a deployable artifact. Two
 * independent protections:
 *
 *   1. Location. Module 24's image copies wp-content/plugins/blame-the-tech-core
 *      and nothing else, so this directory is not in the build context.
 *   2. The environment bail below, in case somebody edits that Dockerfile.
 *
 * @package Blame\Seeder
 */

declare( strict_types=1 );

namespace Blame\Seeder;

use WP_CLI;

defined( 'ABSPATH' ) || exit;

// The first statement after the guard. wp_get_environment_type() reads the
// WP_ENVIRONMENT_TYPE constant from wp-config.php first, then the environment
// variable. Returning here means the command does not EXIST rather than failing,
// so a confused operator gets "not a registered subcommand" and no workaround.
if ( 'production' === wp_get_environment_type() ) {
	return;
}

// No web surface at all. WP_CLI::add_command() on a web request is a fatal error
// on every URL, including wp-admin — Lesson 04.4.
if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
	return;
}

/** The dump's first line. An SQL comment, so `wp db import` ignores it. */
const DIGEST_PREFIX = '-- btt-seed-digest: ';

/**
 * Human-readable output, on STDERR, always.
 *
 * In `export` STDOUT is the dump. WP_CLI::log() and WP_CLI::success() both write
 * to STDOUT, so one stray call puts "Success:" inside your SQL and the import
 * fails hundreds of lines later with a syntax error naming a table.
 */
function note( string $message ): void {
	fwrite( STDERR, '[blame fixture] ' . $message . "\n" );
}

/**
 * The files whose contents define the fixture. Sorted, so the digest does not
 * depend on the order they are listed in here.
 *
 * @return string[]
 */
function seeder_inputs(): array {
	$dir = WP_PLUGIN_DIR . '/blame-the-tech-core/includes/cli';

	$files = array(
		$dir . '/seed.php',
		$dir . '/migrations.php',
		$dir . '/blame-command.php',
	);

	sort( $files );

	return $files;
}

/**
 * sha256 over SEED_VERSION plus the hash of each seeder input.
 *
 * Hashing the CODE, not the data: "is this file intact" is not the question.
 * "Was this dump produced by the seeder I have right now" is, and only the
 * inputs can answer it. SEED_VERSION is read from the plugin's constant rather
 * than from wp_options, so the digest is a pure function of the repository.
 */
function digest(): string {
	$version = defined( 'Blame\Core\CLI\SEED_VERSION' )
		? (string) constant( 'Blame\Core\CLI\SEED_VERSION' )
		: 'unversioned';

	$parts = array( $version );

	foreach ( seeder_inputs() as $file ) {
		if ( ! is_readable( $file ) ) {
			WP_CLI::error( sprintf( 'Cannot read %s, so any digest would be a lie.', $file ) );
		}

		$parts[] = (string) hash_file( 'sha256', $file );
	}

	return hash( 'sha256', implode( "\n", $parts ) );
}

/** Published incidents. The one number worth asserting after an import. */
function incident_count(): int {
	// The import replaced every table under this process's feet.
	wp_cache_flush();

	$counts = wp_count_posts( 'incident' );

	return isset( $counts->publish ) ? (int) $counts->publish : 0;
}

/**
 * Export, load and inspect the seeded-database cache.
 *
 * The seeder is the source of truth; this dump is a cache of its output.
 */
final class Fixture_Command {

	/**
	 * Write the seeded database, prefixed with its digest, to STDOUT.
	 *
	 * ## EXAMPLES
	 *
	 *     # From wordpress-headless/. -T is REQUIRED: a TTY corrupts the stream.
	 *     docker compose run --rm -T wpcli wp blame fixture export > ../fixtures/seeded.sql
	 *
	 * @when after_wp_load
	 *
	 * @param string[]             $args       Positional arguments (none).
	 * @param array<string, mixed> $assoc_args Associative arguments (none).
	 */
	public function export( array $args, array $assoc_args ): void {
		note( sprintf( 'exporting %d incidents…', incident_count() ) );

		// fwrite + fflush rather than WP_CLI::line(): mysqldump inherits this same
		// descriptor, so the parent must flush before handing it over — otherwise
		// PHP's buffer is emptied AFTER the dump and the digest lands at the end.
		fwrite( STDOUT, DIGEST_PREFIX . digest() . "\n" );
		fflush( STDOUT );

		WP_CLI::runcommand(
			'db export - --add-drop-table',
			array(
				'launch'     => false,
				'return'     => false,
				'exit_error' => true,
			)
		);

		note( 'done. The first line of the dump is its digest.' );
	}

	/**
	 * Replace the entire database with SQL read from STDIN.
	 *
	 * The digest CANNOT be verified here: the dump is a stream, and by the time
	 * this process could read the file it would already have imported it. The
	 * check belongs on the host — see `npm run e2e:reset` and e2e/global-setup.ts.
	 *
	 * ## EXAMPLES
	 *
	 *     docker compose run --rm -T wpcli wp blame fixture load < ../fixtures/seeded.sql
	 *
	 * @when after_wp_load
	 *
	 * @param string[]             $args       Positional arguments (none).
	 * @param array<string, mixed> $assoc_args Associative arguments (none).
	 */
	public function load( array $args, array $assoc_args ): void {
		// Without this, forgetting `-T` or the `<` redirect leaves the command
		// waiting on a terminal for ever, looking like a hang.
		if ( stream_isatty( STDIN ) ) {
			WP_CLI::error(
				'Nothing is piped to STDIN. Run this as: '
				. 'docker compose run --rm -T wpcli wp blame fixture load < ../fixtures/seeded.sql'
			);
		}

		note( 'importing SQL from STDIN — this replaces every table…' );

		WP_CLI::runcommand(
			'db import -',
			array(
				'launch'     => false,
				'return'     => false,
				'exit_error' => true,
			)
		);

		$count = incident_count();

		if ( 40 !== $count ) {
			WP_CLI::error(
				sprintf(
					'Imported, but there are %d published incidents rather than 40. '
					. 'The dump is not a seeded fixture — re-export it.',
					$count
				)
			);
		}

		WP_CLI::success( sprintf( 'restored: %d incidents.', $count ) );
	}

	/**
	 * Print the digest of the seeder as it exists on disk, one line, on STDOUT.
	 *
	 * Compare it with the dump's first line to decide whether the cache is stale:
	 *
	 *     head -1 ../fixtures/seeded.sql
	 *
	 * ## EXAMPLES
	 *
	 *     docker compose run --rm -T wpcli wp blame fixture status
	 *
	 * @when after_wp_load
	 *
	 * @param string[]             $args       Positional arguments (none).
	 * @param array<string, mixed> $assoc_args Associative arguments (none).
	 */
	public function status( array $args, array $assoc_args ): void {
		// EXACTLY one line on STDOUT, so `head -1 dump` = `fixture status` is a
		// string comparison a script and a human can both make.
		WP_CLI::line( DIGEST_PREFIX . digest() );

		note( sprintf( 'inputs: %s', implode( ', ', array_map( 'basename', seeder_inputs() ) ) ) );
		note( sprintf( 'this database holds %d published incidents', incident_count() ) );
	}
}

/** Registered from the hook below, never at load time. */
function register(): void {
	WP_CLI::add_command( 'blame fixture', Fixture_Command::class );
}

// mu-plugins load BEFORE regular plugins, so `blame` does not exist yet and
// registering now would create a stray top-level command. WP-CLI fires this hook
// immediately after blame-the-tech-core calls add_command('blame', …).
// Key Concept 6. `wp help blame fixture` is the proof.
WP_CLI::add_hook( 'after_add_command:blame', __NAMESPACE__ . '\\register' );
```

**Verify §4:**

- [ ] `docker compose run --rm wpcli wp help blame` lists `fixture` alongside `seed`, `reset`,
      `migrate` and `status`.
- [ ] `docker compose run --rm wpcli wp help blame fixture` resolves and lists three
      subcommands. If it says `'fixture' is not a registered subcommand of 'blame'`, the hook
      name is wrong or the loader is missing — check that
      `wp-content/mu-plugins/blame-seeder-loader.php` exists at the **top level** of
      `mu-plugins/`.
- [ ] `docker compose run --rm wpcli wp blame reset --help` still works. You did not re-register
      it, and re-registering it would have collided.

### Step 5: Export the dump, verify it, and prove the fixture is deterministic

```bash
cd wordpress-headless
mkdir -p ../fixtures

docker compose run --rm -T wpcli wp blame fixture export > ../fixtures/seeded.sql
```

**Verify §5:**

- [ ] `git check-ignore -v ../fixtures/seeded.sql` names a rule from the root `.gitignore`. **No
      output means stop** — the dump contains `wp_users` rows, so it carries password hashes and
      email addresses, and it must never be staged.
- [ ] `head -1 ../fixtures/seeded.sql` is a single `-- btt-seed-digest: …` line. If it is
      `-- MySQL dump …`, a `WP_CLI::log()` or a missing `fflush()` reordered the stream.
- [ ] `head -3 ../fixtures/seeded.sql` shows the digest, then mysqldump's own comment header.
- [ ] `grep -c 'btt-seed-digest' ../fixtures/seeded.sql` prints `1`.
- [ ] `wc -c < ../fixtures/seeded.sql` is a few megabytes, not a few hundred bytes. A tiny file
      means `-T` was missing or the redirect captured an error.
- [ ] `docker compose run --rm -T wpcli wp blame fixture status` prints exactly the same line as
      `head -1`. That equality **is** the staleness check.

Now prove the fixture is deterministic. Two `wp blame seed --fresh` runs must produce the same **content**. They will not produce
byte-identical dumps, and it is worth knowing exactly why rather than chasing it:

| Differs between two seeds | Because |
|---|---|
| every `INSERT` id | `AUTO_INCREMENT` continues from the deleted rows' high-water mark — Lesson 04.5 Key Concept 3 |
| `AUTO_INCREMENT=NN` in each `CREATE TABLE` | same reason, recorded in the DDL |
| `-- Dump completed on …` | mysqldump stamps the clock |

So compare a **stable projection** — what the application and the suite actually read: 

```bash
cd wordpress-headless

snapshot() {
  docker compose run --rm -T wpcli wp post list \
    --post_type=incident,tech_review,post,page,attachment --post_status=any \
    --posts_per_page=-1 --orderby=post_name --order=ASC \
    --fields=post_type,post_name,post_date,post_date_gmt,post_status --format=csv
  docker compose run --rm -T wpcli wp term list scapegoat severity tech_stack \
    --fields=taxonomy,slug,count --format=csv
  docker compose run --rm -T wpcli wp menu item list primary \
    --fields=title,position,link --format=csv
  docker compose run --rm -T wpcli wp post list --post_type=attachment \
    --posts_per_page=-1 --orderby=post_name --order=ASC --field=guid
}

snapshot | tr -d '\r' > /tmp/btt-snap-a.txt
docker compose run --rm wpcli wp blame seed --fresh --yes
snapshot | tr -d '\r' > /tmp/btt-snap-b.txt

diff /tmp/btt-snap-a.txt /tmp/btt-snap-b.txt && echo IDENTICAL
```

**Verify §5b:**

- [ ] `IDENTICAL`. Every slug, both date columns, every term count, the five menu items in order
      and all twelve attachment URLs are the same across two independent seeds.
- [ ] The attachment `guid` lines all contain `/2024/09/`. Comment out the `upload_dir` filter,
      re-seed, and watch these lines — and only these lines — change. Put it back.
- [ ] If anything else differs, grep the seeder for `rand`, `time(`, `uniqid` and `shuffle`
      before looking anywhere else. Lesson 04.5 Key Concept 4 has the full banned list.
- [ ] Re-export the dump afterwards — you just replaced the database:
      `docker compose run --rm -T wpcli wp blame fixture export > ../fixtures/seeded.sql`

### Step 6: Write `global-setup.ts`, and the one script the learner types

```ts
// next-app/e2e/global-setup.ts
// Runs ONCE, before any spec, in Playwright's own Node process.
//
// That process does NOT read next-app/.env.local — that file is loaded by Next,
// for the app. `process.env.E2E_MODE` here comes from the shell you typed in, and
// that is the safety property, not a limitation. Key Concept 9.
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { resolve } from 'node:path';

import type { FullConfig } from '@playwright/test';

const DIGEST_PREFIX = '-- btt-seed-digest: ';
const GRAPHQL = process.env.WP_GRAPHQL_ENDPOINT ?? 'http://localhost:8080/graphql';

/** One readable failure instead of nine specs failing one at a time. */
function fail(lines: readonly string[]): never {
  throw new Error(['', '[e2e] global setup failed:', ...lines.map((l) => `  ${l}`), ''].join('\n'));
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  // THE INTERLOCK. Anything other than exactly '1' does nothing at all — a global
  // setup that silently drops a colleague's database the first time they run
  // `npx playwright test` is a hostile default.
  if (process.env.E2E_MODE !== '1') {
    console.log(
      '[e2e] E2E_MODE is not "1", so the database was NOT reset. Specs will run ' +
        'against whatever WordPress holds right now. To arm the reset:\n' +
        '      E2E_MODE=1 E2E_SECRET="$E2E_SECRET" npx playwright test'
    );
    return;
  }

  // Declared here, used by the test-only revalidation hook Module 18 builds. It is
  // checked now because an armed destructive run with a half-configured
  // environment is a run whose result you cannot trust.
  if ((process.env.E2E_SECRET ?? '') === '') {
    fail([
      'E2E_MODE=1 but E2E_SECRET is empty or unset.',
      'Export one into this shell: export E2E_SECRET="$(openssl rand -base64 32)"',
      'Never write it to a file — appendix 04 §1.',
    ]);
  }

  // rootDir is the directory holding playwright.config.ts, so these paths do not
  // depend on where you invoked the command from.
  const repoRoot = resolve(config.rootDir, '..');
  const wpDir = resolve(repoRoot, 'wordpress-headless');
  const dump = resolve(repoRoot, 'fixtures/seeded.sql');

  const wp = (args: readonly string[]): string =>
    execFileSync('docker', ['compose', 'run', '--rm', '-T', 'wpcli', 'wp', ...args], {
      cwd: wpDir,
      encoding: 'utf8',
    })
      .replace(/\r/g, '')
      .trim();

  // 1. Is WordPress there at all? This is the check that turns Lesson 12.3's
  //    120-second webServer timeout into one sentence in under a second.
  let status = 0;

  try {
    const response = await fetch(GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
      signal: AbortSignal.timeout(5000),
    });

    status = response.status;
  } catch {
    // Only a TRANSPORT failure lands here. Calling fail() inside the try would
    // be caught by this block and reported as "did not answer", which is a
    // different diagnosis and would send you to the wrong place.
    fail([
      `${GRAPHQL} did not answer.`,
      'Start the stack: cd wordpress-headless && docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d',
    ]);
  }

  if (status !== 200) {
    fail([
      `${GRAPHQL} answered HTTP ${status}.`,
      'WordPress is up but WPGraphQL is not — check the plugin is active.',
    ]);
  }

  if (!existsSync(dump)) {
    fail([
      `${dump} does not exist.`,
      'Export it: cd wordpress-headless && docker compose run --rm -T wpcli wp blame fixture export > ../fixtures/seeded.sql',
    ]);
  }

  // 2. Staleness. Read only the first 200 bytes — never load a multi-megabyte
  //    dump into memory to look at one line.
  const fd = openSync(dump, 'r');
  const head = Buffer.alloc(200);
  readSync(fd, head, 0, 200, 0);
  closeSync(fd);

  const dumpDigest = (head.toString('utf8').split('\n')[0] ?? '').trim();
  const codeDigest = wp(['blame', 'fixture', 'status']);

  if (!dumpDigest.startsWith(DIGEST_PREFIX)) {
    fail(['The dump has no digest on its first line. Re-export it.']);
  }

  // REFUSE, not warn. A warning in the middle of a CI log is a warning nobody
  // reads, and importing a stale fixture produces failures that blame the code.
  if (dumpDigest !== codeDigest) {
    fail([
      'fixtures/seeded.sql is stale: the seeder has changed since it was exported.',
      `  dump: ${dumpDigest}`,
      `  code: ${codeDigest}`,
      'Rebuild it: wp blame seed --fresh, then wp blame fixture export.',
    ]);
  }

  // 3. Import, streaming the file straight into the container's STDIN.
  const input = openSync(dump, 'r');
  try {
    execFileSync(
      'docker',
      ['compose', 'run', '--rm', '-T', 'wpcli', 'wp', 'blame', 'fixture', 'load'],
      { cwd: wpDir, stdio: [input, 'inherit', 'inherit'] }
    );
  } finally {
    closeSync(input);
  }

  // 4. Assert the state the specs are about to rely on.
  const count = wp(['post', 'list', '--post_type=incident', '--format=count']);

  if (count !== '40') {
    fail([`Expected 40 incidents after the import, found ${count}.`]);
  }

  console.log('[e2e] database reset from fixtures/seeded.sql — 40 incidents.');
}
```

Wire it into the config — one line, next to `testDir`:

```ts
// next-app/playwright.config.ts — add inside defineConfig({ … })
  // Runs once, before webServer and before any spec. Gated on E2E_MODE.
  globalSetup: './e2e/global-setup.ts',
```

Then the script. It does the same digest check on the host, because the container cannot:

```bash
cd next-app

npm pkg set "scripts.e2e:reset=cd ../wordpress-headless && test \"\$(head -1 ../fixtures/seeded.sql)\" = \"\$(docker compose run --rm -T wpcli wp blame fixture status | tr -d '\r')\" || { echo 'fixtures/seeded.sql is stale — re-export it (Lesson 12.4 Step 5)'; exit 1; } && docker compose run --rm -T wpcli wp blame fixture load < ../fixtures/seeded.sql && { curl -sf -o /dev/null http://127.0.0.1:3000/en || echo 'cache warm skipped: nothing on :3000'; }"

npm pkg get scripts.e2e:reset
```

Appendix 07 §5 describes `e2e:reset` as "reset the DB and warm caches before an E2E run" — which
is exactly the three parts: refuse a stale dump, import, then one `curl` of `/en` so the first
spec does not pay for a cold ISR render.

**Verify §6:**

- [ ] `npm run e2e:reset` prints `restored: 40 incidents.` and exits `0`.
- [ ] `npm run type-check` is silent — `e2e/global-setup.ts` is in `tsconfig.json`'s `include`.
- [ ] `npx playwright test` still runs and logs the `E2E_MODE is not "1"` line. Nothing was
      reset, and that is the correct default.

### Step 7: Sharpen the smoke spec, now that the data is an input

Four content assertions that were unsafe in Lesson 12.3 and are safe now. Append to the
app-shell `describe`:

```ts
// next-app/e2e/smoke.spec.ts — append inside the `the app shell` describe
  test('the seeded primary menu renders four top-level items', async ({ page }) => {
    await page.goto('/en');

    // Four roots; `Catastrophic only` is a child and the desktop nav renders one
    // level. Nobody typed these five items into this database — seed_menu() did.
    const nav = page.getByRole('navigation', { name: 'Primary' });

    await expect(nav.getByRole('link')).toHaveCount(4);
    await expect(nav.getByRole('link', { name: 'Incidents' })).toBeVisible();
  });

  test('the footer renders the seeded site settings', async ({ page }) => {
    await page.goto('/en');

    // `footer_blurb` from the ACF options page — the second gap seed_site_settings()
    // closed. On a database nobody hand-built, this was an empty footer.
    await expect(page.getByRole('contentinfo')).toContainText(
      'Blame The Tech is satire. The outages are real.'
    );
  });

  test('the incident archive shows the newest twelve, newest first', async ({ page }) => {
    await page.goto('/en/incidents');

    // The list query is `orderby: { field: DATE, order: DESC }` (Lesson 10.5) and
    // the route asks for `first: 12` (Lesson 10.3), and the seeder dates
    // incident-NN as seed_date($i, 3) — so incident-40 is newest and incident-01
    // is off the end of page one. Two assertions: one about ordering, one about
    // the page size. If your route fetches 40 or more, the second one fails
    // legitimately: change the number here or there, and say which is right.
    const main = page.getByRole('main');

    await expect(main).toContainText('A leap second in the log parser (#40)');
    await expect(main).not.toContainText('Deployed on a Friday (#1)');
  });

  test('/en/hobt renders the seeded ACF promo values', async ({ page }) => {
    await page.goto('/en/hobt');

    // seats_left = 12 and price_usd = 499, from seed_pages(). Formatted by
    // Intl.NumberFormat with maximumFractionDigits: 0 (Lesson 11.5).
    const main = page.getByRole('main');

    await expect(main).toContainText('12 seats left');
    await expect(main).toContainText('$499');
  });
```

Then run the suite twice in a row, armed:

```bash
export E2E_SECRET="$(openssl rand -base64 32)"

E2E_MODE=1 npx playwright test
E2E_MODE=1 npx playwright test
```

**Verify §7:**

- [ ] 17 passed, twice, with identical output. The second run started from the same database as
      the first, because `global-setup` put it back.
- [ ] The first line of each run is `[e2e] database reset from fixtures/seeded.sql — 40
      incidents.`
- [ ] Publish a draft incident in wp-admin, then run the suite again. Still 17 passed — your edit
      was discarded by the reset, which is exactly what a test fixture is for and exactly why
      `E2E_MODE` is opt-in.

### Step 8: Break the digest on purpose

The staleness check holds "the seeder is the source" in place. See it fire:

```bash
cd next-app

# Change the seeder in the most trivial way possible: one comment line. No
# leading newline — the restore below deletes exactly this line, and the file has
# to end up byte-identical or the digest will not come back.
printf '// Touched to move the digest — reverted below.\n' >> \
  ../wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/seed.php

npm run e2e:reset; echo "exit=$?"
```

**Verify §8:**

- [ ] `exit=1`, and the message names the file and tells you to re-export. The import did **not**
      run — a check that fires after the import is decoration.
- [ ] `E2E_MODE=1 npx playwright test` fails in the setup with the same reason, printing both
      digests, before a single browser starts.

Restore the seeder — never with git, as the file predates this lesson only in part:

```bash
sed -i.bak '/Touched to move the digest/d' \
  ../wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/seed.php
rm ../wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/seed.php.bak
npm run e2e:reset
```

**Verify §8b:**

- [ ] `npm run e2e:reset` prints `restored: 40 incidents.` again. Digest equality returns only
      because the file is byte-identical to what it was — which is exactly the property a hash
      gives you, and exactly why the `printf` had no leading newline.

---

## Verification

```bash
cd wordpress-headless

# 1. The mu-plugin loaded, and its subcommands hung off the RIGHT parent (D14's proof)
docker compose run --rm wpcli wp help blame fixture | head -12
# Expected: a usage block listing export, load and status. NOT
#           "'fixture' is not a registered subcommand of 'blame'", which means the
#           after_add_command:blame hook or the top-level loader is missing.

# 2. wp blame reset still belongs to the plugin — nothing was re-registered
docker compose run --rm wpcli wp help blame | grep -cE 'seed|reset|migrate|status|fixture'
# Expected: 5 or more

# 3. The two gaps are closed, by the seeder rather than by hand
docker compose run --rm wpcli wp menu item list primary --format=count
# Expected: 5
docker compose run --rm wpcli wp eval 'echo get_field("footer_blurb","option"), PHP_EOL;'
# Expected: Blame The Tech is satire. The outages are real.
docker compose run --rm wpcli wp post list --post_type=incident --format=count
# Expected: 40

# 4. Media URLs are pinned to SEED_EPOCH's month, not to today
docker compose run --rm wpcli wp post list --post_type=attachment --field=guid | grep -c '/2024/09/'
# Expected: 12

# 5. The dump exists, is ignored by git, and carries its own digest
git check-ignore -v ../fixtures/seeded.sql
# Expected: a rule from the root .gitignore, e.g. .gitignore:30:fixtures/seeded.sql
head -1 ../fixtures/seeded.sql
# Expected: -- btt-seed-digest: <64 hex chars>
docker compose run --rm -T wpcli wp blame fixture status | tr -d '\r'
# Expected: the SAME line. That equality is the staleness check.

# 6. Determinism, on a stable projection rather than on the dump's bytes
snapshot() {
  docker compose run --rm -T wpcli wp post list \
    --post_type=incident,tech_review,post,page,attachment --post_status=any \
    --posts_per_page=-1 --orderby=post_name --order=ASC \
    --fields=post_type,post_name,post_date,post_date_gmt,post_status --format=csv
  docker compose run --rm -T wpcli wp menu item list primary \
    --fields=title,position,link --format=csv
  docker compose run --rm -T wpcli wp post list --post_type=attachment \
    --posts_per_page=-1 --orderby=post_name --order=ASC --field=guid
}
snapshot | tr -d '\r' | openssl dgst -sha256
docker compose run --rm wpcli wp blame seed --fresh --yes > /dev/null
snapshot | tr -d '\r' | openssl dgst -sha256
# Expected: the two hashes are IDENTICAL. The dump's bytes are not — ids and
#           mysqldump's own timestamp differ — which is why this compares the
#           content the app and the suite read.
docker compose run --rm -T wpcli wp blame fixture export > ../fixtures/seeded.sql

# 7. NEGATIVE — not one literal credential anywhere on the WordPress side
git grep -nE "(password|passwd|secret)\s*=>\s*'[^']" -- wordpress-headless/ ; echo "exit=$?"
# Expected: no output, exit=1. Every password is getenv() plus a loud failure.
git grep -c 'getenv' -- wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/seed.php
# Expected: 3 or more

# 8. NEGATIVE — a fixture subcommand does not EXIST under a production environment
docker compose run --rm -T -e WP_ENVIRONMENT_TYPE=production wpcli wp blame fixture status
echo "exit=$?"
# Expected: an error saying 'fixture' is not a registered subcommand of 'blame',
#           and exit=1. Not a permission message — the code returned before it
#           registered anything, so there is nothing to work around.

# 9. NEGATIVE — `load` refuses a terminal instead of hanging on it for ever
docker compose run --rm wpcli wp blame fixture load
echo "exit=$?"
# Expected: "Nothing is piped to STDIN" and exit=1. Note the missing -T and the
#           missing redirect: that is the mistake being caught. In a terminal
#           `docker compose run` allocates a TTY, which is what stream_isatty()
#           sees; from a CI runner with no TTY the guard cannot fire, and the
#           import simply reads an empty stream.

cd ../next-app
export E2E_SECRET="$(openssl rand -base64 32)"

# 10. The suite is green twice consecutively, from the same starting database
E2E_MODE=1 npx playwright test
# Expected: 17 passed, and a first line reading
#           "[e2e] database reset from fixtures/seeded.sql — 40 incidents."
E2E_MODE=1 npx playwright test
# Expected: 17 passed. Identical, because the fixture is an input rather than
#           whatever the previous run left behind.

# 11. NEGATIVE — with E2E_MODE unset, global-setup changes NOTHING. Proved by
#     damaging the database first and checking the damage survives.
VICTIM=$(docker compose -f ../wordpress-headless/docker-compose.yml run --rm -T wpcli \
  wp post list --post_type=incident --posts_per_page=1 --format=ids | tr -d '\r')
docker compose -f ../wordpress-headless/docker-compose.yml run --rm -T wpcli \
  wp post delete "$VICTIM" --force
docker compose -f ../wordpress-headless/docker-compose.yml run --rm -T wpcli \
  wp post list --post_type=incident --format=count
# Expected: 39
npx playwright test -g 'redirects to /en'
# Expected: 1 passed, and the "E2E_MODE is not \"1\"" line
docker compose -f ../wordpress-headless/docker-compose.yml run --rm -T wpcli \
  wp post list --post_type=incident --format=count
# Expected: still 39 — the setup did not touch the database. That is the interlock.
E2E_MODE=1 npx playwright test -g 'redirects to /en'
docker compose -f ../wordpress-headless/docker-compose.yml run --rm -T wpcli \
  wp post list --post_type=incident --format=count
# Expected: 40 — armed, it restored the fixture.

# 12. NEGATIVE — a stale dump is REFUSED, not imported with a warning.
#     No leading newline in the printf: the sed below has to restore the file
#     byte-for-byte, or the digest stays different and the reset stays refused.
printf '// digest probe\n' >> \
  ../wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/seed.php
npm run e2e:reset; echo "exit=$?"
# Expected: "stale" and exit=1. Nothing was imported.
sed -i.bak '/digest probe/d' \
  ../wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/seed.php
rm ../wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/seed.php.bak
npm run e2e:reset
# Expected: restored: 40 incidents.

# 13. The unit suite is untouched by any of this
npm run test:run && npm run type-check && npm run lint
# Expected: 53 tests passing, then no output from either check

# 14. NEGATIVE — nothing new is staged for commit that should not be
git status --short
# Expected: the two mu-plugin files, the seeder edit, playwright.config.ts,
#           e2e/global-setup.ts, e2e/smoke.spec.ts and package.json.
#           NOT fixtures/seeded.sql, and NOT /tmp anything.
```

If check 6's two hashes differ, do not re-export and move on: the fixture is not deterministic,
and every content assertion in Lesson 12.3 is resting on it.

## Control Questions

1. `seed_menu()` resolves the child item's parent from a **title** rather than storing a parent
   id. Explain what breaks if you hard-code the id, and name the other place in this seeder that
   makes the same trade for the same reason.
2. `wp blame fixture export` writes the digest with `fwrite(STDOUT, …)` followed by
   `fflush(STDOUT)`, and every progress message goes to `STDERR`. Explain what a single
   `WP_CLI::log()` call inside that method would do to the dump, and where the failure would
   surface.
3. `wp blame fixture load` cannot verify the digest itself. Say why, name the two places that
   verify it instead, and explain why both refuse rather than warn.
4. `E2E_MODE` is listed in appendix 04 §3.1 under `next-app/.env.local`, and `global-setup.ts`
   still reads it from the shell. Explain why both statements are correct, and give the safety
   argument for not adding `dotenv` to the harness.
5. Two consecutive `wp blame seed --fresh` runs produce identical content and non-identical SQL
   dumps. Name the three things that differ in the file, say why none of them matters, and
   describe the projection you would compare instead.

## Learn More

- [WP-CLI — `wp db export`](https://developer.wordpress.org/cli/commands/db/export/) — the `-`
  argument that writes to STDOUT, which is what makes Key Concept 8's host redirect possible
- [WP-CLI — `wp db import`](https://developer.wordpress.org/cli/commands/db/import/) — the same
  in reverse, and the warning that it replaces every table
- [WP-CLI — internal API: `add_command`](https://make.wordpress.org/cli/handbook/references/internal-api/wp-cli-add-command/)
  — how a class becomes a command namespace, and the `when` argument
- [WP-CLI — internal API: `add_hook`](https://make.wordpress.org/cli/handbook/references/internal-api/wp-cli-add-hook/)
  — the hook list including `after_add_command:<command>`, which is Key Concept 6's fix
- [WordPress — Must Use Plugins](https://wordpress.org/documentation/article/must-use-plugins/) —
  the load order, and the sentence about subdirectories not being loaded
- [WordPress — `wp_update_nav_menu_item()`](https://developer.wordpress.org/reference/functions/wp_update_nav_menu_item/)
  — every `menu-item-*` key used in `seed_menu()`, including the parent and position arguments
- [WordPress — `upload_dir` filter](https://developer.wordpress.org/reference/hooks/upload_dir/) —
  the array you are rewriting in Key Concept 4, and the note that it runs before the directory is
  created
- [WordPress — `wp_get_environment_type()`](https://developer.wordpress.org/reference/functions/wp_get_environment_type/)
  — the constant-then-environment-variable precedence the production bail relies on
- [Playwright — `globalSetup`](https://playwright.dev/docs/test-global-setup-teardown) — where it
  runs relative to `webServer` and the projects, which is why the WordPress check belongs there
