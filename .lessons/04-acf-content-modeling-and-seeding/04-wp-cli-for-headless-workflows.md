---
title: 'WP-CLI for Headless Workflows'
module: 4
lesson: 4
teaches: [wp-cli-basics, wp-cli-add-command, wp-cli-in-compose, idempotent-commands, porcelain-output]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/blame-command.php']
requires: [3.1]
---

# Lesson 04.4 — WP-CLI for Headless Workflows

## Quick Overview

In a headless build WP-CLI stops being a convenience and becomes the primary interface to
WordPress-the-server. There is no front end to click through, deploys run unattended in a
container, and CI needs to bring a database from empty to populated with no human present.
Everything structural you do from here on — seeding, migrations, language setup in Module 20,
the Fly.io `release_command` in Module 24 — is a WP-CLI invocation. This lesson makes you
fluent: the commands worth knowing (`wp post`, `wp term`, `wp user`, `wp option`, `wp db`,
`wp search-replace`, `wp media import`), the flags that matter (`--porcelain`, `--format=json`,
`--quiet`), and the fact that every one of them runs inside the container as `www-data`.

Then you register your own. `WP_CLI::add_command('blame', ...)` creates a namespace, and each
public method on the command class becomes a subcommand with its docblock as its `--help`
output. You build the namespace and one trivial subcommand — `wp blame status`, printing the
current content counts and the migration version — to get the plumbing, argument parsing, exit
codes and `--porcelain` output right before Lesson 04.5 puts real work behind it. Exit codes are
not decoration: `WP_CLI::error()` exits non-zero, which is how a failed release command stops a
deploy instead of shipping a half-migrated site.

By the end of this lesson you will have:

- `includes/cli/blame-command.php` registering the `blame` command namespace, loaded only when
  `WP_CLI` is defined
- `wp blame status` printing content counts, with `--porcelain` producing script-friendly output
- Docblock-driven `--help` for the namespace and the subcommand
- Correct exit codes — `WP_CLI::success` for zero, `WP_CLI::error` for non-zero — proven with
  `echo $?`
- A shell alias or wrapper script so `wp` means `docker compose run --rm wpcli wp`
- A written list of the WP-CLI commands this course will call from CI and from a deploy

## Classic WP Analogy

You have used WP-CLI, almost certainly for the same handful of jobs: `wp search-replace` after a
database migration, `wp plugin install`, `wp db export` before doing something risky, maybe
`wp user create` to fix a lockout over SSH. Every one of those commands works identically here.
The mechanics are unchanged too — WP-CLI boots WordPress the same way `wp-load.php` does, so
your hooks fire, your plugin loads, and `$wpdb` is the same object. A command is just PHP with
`wp-admin` swapped out for a terminal.

What is new is the *centrality*. In Classic WordPress, WP-CLI is the tool you reach for when the
browser is inconvenient; the canonical way to do something is still to click it. In this project
the browser is not available at the moments that matter — a deploy is a container starting with
no TTY, CI is a GitHub Actions runner, and the seeder has to produce 73 pieces of content in
order. So the canonical way to do something becomes a command, and wp-admin becomes the thing
editors use rather than the thing developers automate through.

**Where the analogy breaks down:** a command you run by hand can be non-idempotent and you
simply do not run it twice. A command in a `release_command` runs on **every deploy**, so
"create the terms" must mean "create the terms if they are not there", and "run the migration"
must mean "run the migrations that have not run". WP-CLI in Classic WordPress rarely forces that
discipline on you because a human is holding the keyboard and can see what happened. Here nobody
is watching, the output goes to a log nobody reads until something breaks, and the only signal
anyone acts on is the exit code — which is why this lesson spends time on exit codes that would
look excessive in a Classic WordPress context.

---

## Key Concepts

### 1. The moments that matter have no browser in them

Four things this course has to do, and none of them can involve clicking.

| Moment | Where it runs | Why wp-admin is unavailable |
|---|---|---|
| Populating a database (Lesson 04.5) | your machine, and a CI runner | 73 pieces of content in a fixed order, twice, identically |
| A schema migration (Lesson 04.5) | Fly.io `release_command` (Module 24) | a one-shot container, no TTY, no HTTP listener yet |
| End-to-end test setup (Module 12) | GitHub Actions | no display, no session, no cookies |
| Language setup (Module 20) | both of the above | Polylang's settings screen is not scriptable |

The consequence is a shift in what "the canonical way to do something" means. In Classic
WordPress the canonical way is the admin screen and WP-CLI is the shortcut; here it inverts. If a
piece of setup exists only as a sequence of clicks, it does not exist in CI, and therefore it does
not exist in the deploy — which you discover on the deploy.

> **The test to apply to every piece of setup from now on:** could a container with no terminal
> attached do this, given only the repository and the environment? If not, it is not finished.

### 2. WP-CLI is a separate container, and this trips everyone once

```
    ┌────────────────────────┐          ┌──────────────────────────────┐
    │ wordpress              │          │ wpcli                        │
    │ wordpress:7.1-php8.4   │          │ wordpress:cli-php8.4         │
    │ apache + php-fpm       │          │ php + the `wp` binary        │
    │ ❌ NO `wp` binary       │          │ ✅ `wp`                       │
    │ runs: always           │          │ runs: only when you ask      │
    └───────────┬────────────┘          └──────────────┬───────────────┘
                │        same btt-net, same .env,      │
                │        same wp-content bind mounts   │
                └──────────────┬───────────────────────┘
                               ▼
                        ┌─────────────┐
                        │ db  :3306   │
                        └─────────────┘
```

| Invocation | Result |
|---|---|
| `docker compose run --rm wpcli wp <cmd>` | ✅ **the only correct form in this course** |
| `docker compose exec wordpress wp <cmd>` | ❌ `wp: not found` — the stock image ships no `wp` |
| `docker compose run --rm wpcli wp <cmd> --allow-root` | ❌ pointless, not invalid: WP-CLI accepts the flag and it does nothing, because the cli image runs as `www-data` (uid 33) and never as root |
| `wp <cmd>` on your host | ❌ no WordPress, no database, wrong PHP |
| `docker compose exec wordpress php -a` | ✅ fine — it is only `wp` and `composer` that are absent |

`run --rm` creates a container, runs one command, and deletes it. So each `wp` invocation is a
cold start of about a second — annoying interactively, irrelevant in CI, and the reason Step 1
gives you a two-character alias.

Two properties of that container matter for the code you are about to write. It runs as
**`www-data`**, so anything it creates on the bind mount is owned by uid 33. And it boots
WordPress **fully**: `wp-load.php` runs, `mu-plugins` load, plugins load, `init` fires, your hooks
are registered. A WP-CLI command is not a script that talks to the database; it is WordPress with
a terminal instead of a request.

### 3. The commands this course will actually call

Worth skimming now so the names are familiar when a later module uses one without ceremony.
[Appendix 07 §2](../appendix/07-command-reference.md#2-wp-cli) is the full list.

| Job | Commands |
|---|---|
| Content | `wp post create`, `wp post list`, `wp post meta`, `wp term list`, `wp post term add` |
| Users | `wp user create`, `wp user update`, `wp cap list` |
| Options | `wp option get/update`, `wp option list --search=` |
| Media | `wp media import`, `wp media regenerate` |
| Database | `wp db export`, `wp db import`, `wp db query`, `wp search-replace` |
| Plugins and core | `wp plugin install/activate`, `wp core update-db`, `wp rewrite flush` |
| Escape hatch | `wp eval`, `wp eval-file` |
| Ours, from Lesson 04.5 | `wp blame status/seed/reset/migrate/ensure-languages` |

`wp eval` is the one to be slightly suspicious of. It is invaluable for exploring — you used it in
Lessons 04.1 and 04.3 — and it is a bad place for anything you will run twice, because it lives
in your shell history rather than in the repository. **The rule: `wp eval` to find out, a
registered command to keep.**

### 4. `WP_CLI::add_command()`: a class becomes a namespace

Registering a command is one call. Everything else is convention.

```
  WP_CLI::add_command( 'blame', Blame_Command::class )
                          │              │
                          │              └── public methods become subcommands
                          └── the namespace: `wp blame …`

   class Blame_Command                        the CLI surface
   ────────────────────────────────           ─────────────────────────────
   public function status()          ──▶      wp blame status
   public function seed()            ──▶      wp blame seed
   public function reset()           ──▶      wp blame reset
   public function ensure_languages()──▶      wp blame ensure-languages
        │                                            ▲
        └── underscores become hyphens ──────────────┘
   private function counts()         ──▶      (not a subcommand)
```

| Convention | Detail |
|---|---|
| Method name | `snake_case` becomes a hyphenated subcommand — `update_db` is `wp core update-db` in core itself |
| `@subcommand <name>` | overrides that mapping. Use it when the method name is a PHP reserved word (`list`) or when you want the CLI name to survive a refactor |
| The class docblock | becomes the namespace description in `wp help blame` |
| A method docblock | becomes that subcommand's `--help` page, and it is **parsed**, not just displayed |
| `## OPTIONS` | each `[--flag]` / `<positional>` entry with a `:` description line becomes real argument documentation and real validation |
| `## EXAMPLES` | indented lines under this heading are printed verbatim by `--help` |
| `@when before_wp_load` / `after_wp_load` | when WordPress boots relative to your callback. Default is `after_wp_load`, which is what you want |

Two signatures land in every method: `$args`, the positional arguments in order, and
`$assoc_args`, the `--flags` as a map. Read flags with
`\WP_CLI\Utils\get_flag_value( $assoc_args, 'porcelain', false )` rather than
`isset( $assoc_args['porcelain'] )`, because the helper understands `--no-porcelain` and the
default value in one call.

> **`## OPTIONS` is documentation that does work.** Declare `[--format=<format>]` with an
> `options:` list and WP-CLI rejects `--format=xml` for you, before your method runs, with a
> readable message. A flag you did not declare is accepted silently and ignored, which is how a
> typo in a CI script becomes a seed that quietly did not do what the script asked.

### 5. `WP_CLI` does not exist during a web request

This is the one mistake in this lesson that takes the whole site down.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/blame-command.php (fragment)
// ❌ At the top of a file that is required on every request:
WP_CLI::add_command( 'blame', Blame_Command::class );
//    ↑ Fatal error: Class "WP_CLI" not found — on every page load, including wp-admin.
```

The `WP_CLI` class is defined by the WP-CLI runtime. During an HTTP request it does not exist, and
neither does the `WP_CLI` **constant**. So there are two locks, and this project uses both:

| Lock | Where | What it protects |
|---|---|---|
| `defined( 'WP_CLI' ) && WP_CLI` around `CLI_INCLUDES` | `Plugin::boot()`, from Lesson 03.1 | the file is not even read on a web request |
| `if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) { return; }` | the top of `blame-command.php` | the file is safe if anything ever requires it directly |

Belt and braces is warranted here because the failure mode is a white screen on every URL,
including the one you would use to fix it. The second lock costs three lines and turns a site
outage into a no-op. Note that the constant is checked for **truthiness** as well as existence —
some tooling defines `WP_CLI` as `false` to signal "not under WP-CLI", and `defined()` alone would
be satisfied by that.

### 6. Output streams and exit codes are the API

Nobody reads the log of a successful deploy. The only thing anything downstream acts on is the
exit code, so getting these right is not politeness.

| Call | Stream | Prefix | Exit code |
|---|---|---|---|
| `WP_CLI::line( $msg )` | STDOUT | none | continues |
| `WP_CLI::log( $msg )` | STDOUT | none, and **suppressed by `--quiet`** | continues |
| `WP_CLI::success( $msg )` | STDOUT | `Success:` | continues; the script exits 0 |
| `WP_CLI::warning( $msg )` | STDERR | `Warning:` | continues — **still exits 0** |
| `WP_CLI::error( $msg )` | STDERR | `Error:` | **exits 1 immediately** |
| `WP_CLI::error( $msg, false )` | STDERR | `Error:` | continues — for reporting several failures |
| `WP_CLI::halt( $code )` | — | — | exits with `$code` |

```
   wp blame status && echo "deploy continues"
   ─────────────────────────────────────────────────────────
   success  →  exit 0  →  "deploy continues"          ✅
   warning  →  exit 0  →  "deploy continues"          ⚠️  intended, but be sure
   error    →  exit 1  →  nothing printed             ✅  the deploy stops here
```

Choosing between `warning` and `error` is a design decision each time. "The language already
exists" is a warning — the desired state is the actual state. "Polylang is not installed, so I
cannot create languages" is an error, because the caller asked for something that did not happen
and a release that continues has shipped a broken site.

**`--porcelain` is the third output mode and the one scripts use.** The convention across WP-CLI
is: no headings, no decoration, one value or one record per line, stable column order, and nothing
on STDOUT except the data.

```
   wp blame status                       wp blame status --porcelain
   ┌──────────────────┬───────┐
   │ item             │ count │          40  8  10  3  12  4  10  4  3
   ├──────────────────┼───────┤          └── tab-separated, fixed order, no header
   │ incidents        │ 40    │
   │ tech_reviews     │ 8     │          $(wp blame status --porcelain | cut -f1)
   └──────────────────┴───────┘             → 40
```

You have already relied on this: `wp post create --porcelain` prints the new id and nothing else,
which is why `ID=$(… --porcelain)` works in every verification block since Lesson 03.4.

### 7. `WP_CLI::confirm()`, and why CI must type `--yes`

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/blame-command.php (fragment)
WP_CLI::confirm( 'This deletes every seeded item. Continue?', $assoc_args );
```

`confirm()` prompts on STDIN and aborts with exit code 0 if the answer is not `y`. Passing
`$assoc_args` is what makes `--yes` work: the helper looks for that flag itself, so you never
write the `if` around it.

Two things follow for a containerised workflow. `docker compose run` attaches a TTY by default, so
the prompt works interactively. **In CI there is no TTY**, so a destructive command needs both
flags:

```bash
# Interactive — prompts
docker compose run --rm wpcli wp blame reset

# CI — no TTY, no prompt possible
docker compose run --rm -T wpcli wp blame reset --yes
```

Leaving `--yes` out in CI produces a job that hangs or aborts with a confusing message. Having to
add it deliberately is the safety property, not a nuisance: no destructive command in this project
runs unattended unless someone wrote `--yes` in a file that went through review.

### 8. Idempotency stops being a nicety

Module 24's Fly.io `release_command` is roughly this, and it runs on **every deploy**:

```bash
wp core update-db && wp plugin activate --all && wp blame migrate && wp rewrite flush --hard
```

So every command in it runs for the fifth, twentieth and hundredth time. Three patterns cover
nearly everything, and you have used all three already:

| Pattern | Use for | Seen in |
|---|---|---|
| Existence guard | terms, roles, pages, users | `term_exists()` in Lesson 03.3's `seed_default_terms()` |
| Declarative diff | database tables | `dbDelta()` — compares declared schema against reality |
| Version gate | anything genuinely one-way | `btt_roles_version` in Lesson 03.5; `btt_db_version` in Lesson 04.5 |

There is a fourth pattern that is really an anti-pattern: **doing the work and then checking**.
Deleting forty incidents and recreating them is idempotent in the sense that the end state is
stable, and it is still wrong in production, because for two seconds the site has no incidents and
anything reading it during that window sees an empty site. `wp blame seed --fresh` is explicitly a
development and CI command for exactly that reason, and Lesson 04.5 makes the distinction part of
its design rather than a warning in a comment.

> **Idempotency is a property of the command, not of the caller.** "We only run that once" is not
> a design; it is a fact about today that nobody will remember. Write the guard.

---
## Task

### Step 1: Stop typing thirty characters per command

[Appendix 07 §2](../appendix/07-command-reference.md#2-wp-cli) documents the alias. Add it to your
shell profile:

```bash
# ~/.zshrc  (or ~/.bashrc)
alias wpx='docker compose run --rm wpcli wp'
```

Then `source ~/.zshrc` and, **from `wordpress-headless/`**:

```bash
cd wordpress-headless
wpx core version
wpx plugin list --status=active --field=name
```

The alias inherits Compose's working-directory requirement, so it only works from the directory
holding `docker-compose.yml`. If you find yourself flipping between `wordpress-headless/` and
`next-app/` all day, a function is worth the four extra lines:

```bash
# ~/.zshrc — optional. Works from anywhere under the repository.
wpx() {
  ( cd "$(git rev-parse --show-toplevel)/wordpress-headless" \
    && docker compose run --rm wpcli wp "$@" )
}
```

The subshell is deliberate: the `cd` happens inside `( … )`, so your own shell does not move.

> **Every command in this course is written out in full**, as
> `docker compose run --rm wpcli wp …`, so that a copy-paste works for a reader who has not set up
> the alias. Use `wpx` while you work and read the long form as documentation.

**Verify §1:**

- [ ] `wpx core version` prints a version, from `wordpress-headless/`.
- [ ] `docker compose exec wordpress bash -lc 'command -v wp'` prints **nothing**. That is the
      house rule from Lesson 02.2, confirmed rather than assumed.

### Step 2: Write the command class

```bash
mkdir -p wp-content/plugins/blame-the-tech-core/includes/cli
```

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/cli/blame-command.php
<?php
/**
 * The `wp blame` command namespace.
 *
 * Loaded ONLY under WP-CLI. See Plugin::CLI_INCLUDES and the guard below.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core\CLI;

use WP_CLI;

defined( 'ABSPATH' ) || exit;

/*
 * Second lock. Plugin::boot() already gates CLI_INCLUDES on this condition, but
 * a file under includes/ is one careless `require` away from a web request, and
 * `WP_CLI::add_command()` on a web request is a fatal error on every URL — wp-admin
 * included, so you cannot get in to fix it. Three lines, outage becomes no-op.
 *
 * Truthiness as well as existence: some tooling defines WP_CLI as false.
 */
if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
	return;
}

/**
 * Manage Blame The Tech fixture content, settings and schema migrations.
 *
 * Every subcommand here is designed to be safe to run twice. The Fly.io
 * release_command in Module 24 runs some of them on every single deploy.
 */
final class Blame_Command {

	/**
	 * Report content counts and the current schema version.
	 *
	 * Read-only, and the first thing to run when something looks wrong: it
	 * answers "is the database populated" and "which migrations have run" in
	 * one call.
	 *
	 * ## OPTIONS
	 *
	 * [--porcelain]
	 * : Print one tab-separated line, in a fixed column order, with no header.
	 * For scripts. Column order is: incidents, tech_reviews, posts, pages,
	 * media, users, scapegoat_terms, severity_terms, db_version.
	 *
	 * [--format=<format>]
	 * : Render the table in a particular format. Ignored with --porcelain.
	 * ---
	 * default: table
	 * options:
	 *   - table
	 *   - json
	 *   - csv
	 *   - yaml
	 * ---
	 *
	 * ## EXAMPLES
	 *
	 *     # Human output
	 *     wp blame status
	 *
	 *     # How many incidents, for a script
	 *     wp blame status --porcelain | cut -f1
	 *
	 *     # Feed a CI assertion
	 *     wp blame status --format=json
	 *
	 * @when after_wp_load
	 *
	 * @param string[]             $args       Positional arguments (none).
	 * @param array<string, mixed> $assoc_args Associative arguments.
	 */
	public function status( array $args, array $assoc_args ): void {
		$counts = self::counts();

		if ( \WP_CLI\Utils\get_flag_value( $assoc_args, 'porcelain', false ) ) {
			// Values only, in the documented order. array_values() is safe here
			// because self::counts() builds the array in a fixed order.
			WP_CLI::line( implode( "\t", array_values( $counts ) ) );

			return;
		}

		$rows = array();
		foreach ( $counts as $item => $count ) {
			$rows[] = array(
				'item'  => $item,
				'count' => $count,
			);
		}

		\WP_CLI\Utils\format_items(
			(string) \WP_CLI\Utils\get_flag_value( $assoc_args, 'format', 'table' ),
			$rows,
			array( 'item', 'count' )
		);
	}

	/**
	 * Populate the database with deterministic fixture content.
	 *
	 * Not implemented yet — Lesson 04.5 builds this. It exits 0 with a warning
	 * rather than an error, because "did nothing" is not a failure and a
	 * release_command should not be blocked by a stub.
	 *
	 * ## OPTIONS
	 *
	 * [--fresh]
	 * : Delete existing fixture content before seeding. Development and CI only.
	 *
	 * [--yes]
	 * : Skip the confirmation prompt that --fresh triggers.
	 *
	 * ## EXAMPLES
	 *
	 *     wp blame seed
	 *     wp blame seed --fresh --yes
	 *
	 * @when after_wp_load
	 *
	 * @param string[]             $args       Positional arguments (none).
	 * @param array<string, mixed> $assoc_args Associative arguments.
	 */
	public function seed( array $args, array $assoc_args ): void {
		WP_CLI::warning( 'wp blame seed is a stub. Lesson 04.5 implements it.' );
	}

	/**
	 * Delete every fixture item this project created. DESTRUCTIVE.
	 *
	 * ## OPTIONS
	 *
	 * [--yes]
	 * : Skip the confirmation prompt. Mandatory in CI, where there is no TTY.
	 *
	 * ## EXAMPLES
	 *
	 *     wp blame reset
	 *     wp blame reset --yes
	 *
	 * @when after_wp_load
	 *
	 * @param string[]             $args       Positional arguments (none).
	 * @param array<string, mixed> $assoc_args Associative arguments.
	 */
	public function reset( array $args, array $assoc_args ): void {
		// Passing $assoc_args is what makes --yes work. confirm() looks for the
		// flag itself, so there is no `if` to forget.
		WP_CLI::confirm(
			'This deletes every seeded incident, review, post, page and media item. Continue?',
			$assoc_args
		);

		WP_CLI::warning( 'wp blame reset is a stub. Lesson 04.5 implements it.' );
	}

	/**
	 * Create and configure the languages this project needs.
	 *
	 * Errors when Polylang is absent, which is the correct behaviour for a step
	 * a release depends on: silently skipping it would ship a site with no
	 * languages and a green deploy.
	 *
	 * ## EXAMPLES
	 *
	 *     wp blame ensure-languages
	 *
	 * @subcommand ensure-languages
	 * @when after_wp_load
	 *
	 * @param string[]             $args       Positional arguments (none).
	 * @param array<string, mixed> $assoc_args Associative arguments.
	 */
	public function ensure_languages( array $args, array $assoc_args ): void {
		if ( ! function_exists( 'pll_languages_list' ) ) {
			// Exits 1. This is the line that stops a deploy.
			WP_CLI::error( 'Polylang is not active. Language setup arrives in Module 20.' );
		}

		WP_CLI::warning( 'wp blame ensure-languages is a stub. Module 20 implements it.' );
	}

	/**
	 * Content counts, in the fixed order --porcelain documents.
	 *
	 * Private, so WP-CLI does not turn it into a subcommand.
	 *
	 * @return array<string, int>
	 */
	private static function counts(): array {
		$published = static function ( string $post_type ): int {
			$counts = wp_count_posts( $post_type );

			return (int) ( $counts->publish ?? 0 );
		};

		$terms = static function ( string $taxonomy ): int {
			$total = wp_count_terms(
				array(
					'taxonomy'   => $taxonomy,
					'hide_empty' => false,
				)
			);

			return is_wp_error( $total ) ? 0 : (int) $total;
		};

		// Attachments live under the `inherit` status, not `publish`.
		$media = wp_count_posts( 'attachment' );

		return array(
			'incidents'       => $published( 'incident' ),
			'tech_reviews'    => $published( 'tech_review' ),
			'posts'           => $published( 'post' ),
			'pages'           => $published( 'page' ),
			'media'           => (int) ( $media->inherit ?? 0 ),
			'users'           => (int) count_users()['total_users'],
			'scapegoat_terms' => $terms( 'scapegoat' ),
			'severity_terms'  => $terms( 'severity' ),
			'db_version'      => (int) get_option( 'btt_db_version', 0 ),
		);
	}
}

WP_CLI::add_command(
	'blame',
	Blame_Command::class,
	array( 'shortdesc' => 'Manage Blame The Tech fixture content and schema migrations.' )
);
```

**Verify §2:**

- [ ] `docker compose exec wordpress php -l /var/www/html/wp-content/plugins/blame-the-tech-core/includes/cli/blame-command.php`
      prints `No syntax errors detected`.
- [ ] The file is `blame-command.php` — kebab-case, because it is a procedural file loaded
      explicitly, not an autoloaded PSR-4 class file (Lesson 03.1 Key Concept 4). The class inside
      it is not autoloadable and does not need to be.

### Step 3: Load it, only under WP-CLI

`CLI_INCLUDES` has been an empty array since Lesson 03.1 waiting for exactly this.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
	/**
	 * Files loaded only under WP-CLI.
	 *
	 * @var string[]
	 */
	private const CLI_INCLUDES = array(
		'includes/cli/blame-command.php',   // Lesson 04.4
	);
```

Nothing else changes. `Plugin::boot()` already wraps this loop in
`if ( defined( 'WP_CLI' ) && WP_CLI )`.

**Verify §3:**

- [ ] `docker compose run --rm wpcli wp blame status` prints a table.
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/wp-admin/` prints `302`, not
      `500`. A fatal in a CLI include would have taken wp-admin down.

### Step 4: Read the help WP-CLI generated from your docblocks

```bash
docker compose run --rm wpcli wp help blame
docker compose run --rm wpcli wp help blame status
docker compose run --rm wpcli wp blame status --help
```

**Verify §4:**

- [ ] `wp help blame` lists four subcommands, and `ensure-languages` appears **hyphenated**.
- [ ] `wp help blame status` shows an OPTIONS section containing `--porcelain` and
      `--format=<format>` with its four allowed values, and the three examples you wrote.
- [ ] `docker compose run --rm wpcli wp blame status --format=xml` fails with a message naming the
      allowed formats. You wrote no validation code — the `options:` block in the docblock is the
      validation.

### Step 5: Prove the exit codes

Exit codes are the only signal a deploy acts on, so confirm them rather than assuming them.

```bash
cd wordpress-headless

docker compose run --rm wpcli wp blame status > /dev/null; echo "status  -> $?"
docker compose run --rm wpcli wp blame seed;              echo "seed    -> $?"
docker compose run --rm wpcli wp blame ensure-languages;  echo "lang    -> $?"
```

**Verify §5:**

- [ ] `status -> 0`.
- [ ] `seed -> 0`, with a `Warning:` line. A stub that does nothing is not a failure.
- [ ] `lang -> 1`, with an `Error:` line. Polylang is not installed, the caller asked for
      something that did not happen, and a release must stop.
- [ ] Both the warning and the error went to **STDERR**: repeat the middle command with
      `2>/dev/null` and the warning text disappears while the exit code stays `0`.

### Step 6: Confirm `--porcelain` is machine-readable

```bash
docker compose run --rm wpcli wp blame status --porcelain
docker compose run --rm wpcli wp blame status --porcelain | cut -f1
docker compose run --rm wpcli wp blame status --porcelain | awk -F'\t' '{ print NF }'
```

**Verify §6:**

- [ ] One line, tab separated, no header, no `Success:` prefix.
- [ ] `cut -f1` gives the incident count on its own — this is the shape Module 12's CI assertions
      consume.
- [ ] `NF` is `9`, matching the nine columns your docblock documents. If the docblock and the code
      disagree about the order, the docblock is the contract and the code is the bug.

### Step 7: Add the list to your runbook

Open `wordpress-headless/README.md` — the runbook you wrote in Lesson 02.6 — and add a **Commands
CI and deploys run** section. List every command that will execute with nobody watching, and mark
each one idempotent or not:

| Command | Runs where | Idempotent |
|---|---|---|
| `wp core update-db` | deploy | yes |
| `wp plugin activate --all` | deploy | yes |
| `wp blame migrate` | deploy | yes, by version gate (Lesson 04.5) |
| `wp rewrite flush --hard` | deploy | yes |
| `wp blame seed --fresh --yes` | CI only | yes in effect, **destructive** |
| `wp blame reset --yes` | CI only | yes, **destructive** |
| `wp blame ensure-languages` | deploy, from Module 20 | yes |

Writing it down is the point. Module 24 builds the `release_command` from this list, and the
"idempotent" column is the review checklist for it.

---
## Verification

```bash
cd wordpress-headless

# 1. The namespace is registered, with four subcommands and the hyphenated name
docker compose run --rm wpcli wp help blame | sed -n '1,25p'
# Expected: a SUBCOMMANDS block listing: ensure-languages, reset, seed, status

# 2. The docblock became real help, not just text
docker compose run --rm wpcli wp help blame status | grep -A3 -- '--format'
# Expected: the four allowed values (table, json, csv, yaml) and default: table

# 3. Declared options are validated for you
docker compose run --rm wpcli wp blame status --format=xml; echo "exit=$?"
# Expected: an Error naming the allowed values, and exit=1. You wrote no validation.

# 4. Human output
docker compose run --rm wpcli wp blame status
# Expected: a 9-row table — incidents, tech_reviews, posts, pages, media, users,
#           scapegoat_terms, severity_terms, db_version. db_version is 0 until Lesson 04.5.

# 5. Machine output: one line, tab separated, exactly nine fields
docker compose run --rm wpcli wp blame status --porcelain | awk -F'\t' '{ print "fields=" NF }'
# Expected: fields=9

# 6. ...and the first field is usable on its own
docker compose run --rm wpcli wp blame status --porcelain | cut -f1
# Expected: a bare integer. No header, no "Success:", no trailing text.

# 7. --format=json is parseable
docker compose run --rm wpcli wp blame status --format=json | jq -r '.[] | select(.item=="severity_terms") | .count'
# Expected: 4   (the closed severity set seeded in Lesson 03.3)

# 8. Exit code 0 on success
docker compose run --rm wpcli wp blame status > /dev/null; echo "status=$?"
# Expected: status=0

# 9. A warning does NOT change the exit code
docker compose run --rm wpcli wp blame seed; echo "seed=$?"
# Expected: a "Warning: wp blame seed is a stub" line, then seed=0

# 10. ...and that warning went to STDERR, so a script's stdout stays clean
docker compose run --rm wpcli wp blame seed 2>/dev/null; echo "stdout-only, seed=$?"
# Expected: no warning text at all, then stdout-only, seed=0

# 11. NEGATIVE: an error exits non-zero, which is what stops a deploy
docker compose run --rm wpcli wp blame ensure-languages; echo "lang=$?"
# Expected: "Error: Polylang is not active..." and lang=1

# 12. NEGATIVE: and the shell honours it
docker compose run --rm wpcli wp blame ensure-languages && echo "DEPLOY CONTINUED" || echo "deploy halted — correct"
# Expected: deploy halted — correct

# 13. NEGATIVE: private methods are not subcommands
docker compose run --rm wpcli wp blame counts 2>&1 | head -2
# Expected: an error saying 'blame counts' is not a registered subcommand

# 14. The command class IS loaded under WP-CLI
docker compose run --rm wpcli wp eval 'var_export( class_exists( "\\Blame\\Core\\CLI\\Blame_Command" ) );'
# Expected: true

# 15. NEGATIVE: and is NOT loaded during a normal WordPress boot.
#     This boots WordPress in the web container, where WP_CLI is undefined.
docker compose exec wordpress php -r 'define("WP_USE_THEMES", false); require "/var/www/html/wp-load.php"; var_export( class_exists("\\Blame\\Core\\CLI\\Blame_Command") ); echo PHP_EOL;'
# Expected: false — the guard worked. If this prints `true`, the CLI_INCLUDES gate
#           in Plugin::boot() is not doing its job and one bad edit fatals every URL.

# 16. NEGATIVE: the house rule, confirmed rather than trusted
docker compose exec wordpress bash -lc 'command -v wp || echo "no wp binary in the wordpress image — correct"'
# Expected: no wp binary in the wordpress image — correct

# 17. The site is fine after all of that
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/wp-admin/
# Expected: 302 (a redirect to the login screen). NOT 500.
docker compose logs --tail=60 wordpress | grep -iE 'php (warning|notice|fatal)' || echo clean
# Expected: clean

# 18. Only the two intended files changed
git status --short wp-content/plugins/blame-the-tech-core/
# Expected: includes/cli/blame-command.php and includes/Plugin.php
```

Checks 14 and 15 are the pair to keep. They are the same class name, asked in two runtimes, with
two different correct answers — and the second one is the difference between a working site and a
white screen on every URL.

## Control Questions

1. `WP_CLI::add_command()` sits at the bottom of `blame-command.php`, and there are two separate
   guards preventing it from running during a web request. Name both, say which one you would keep
   if you could only have one, and describe the exact user-visible failure the other one prevents.
2. `wp blame seed` prints a warning and exits `0`; `wp blame ensure-languages` prints an error and
   exits `1`. Justify each choice in terms of what a `release_command` should do next, and give one
   change to the project that would make `seed` deserve an error instead.
3. `wp blame status --format=xml` is rejected with a helpful message, and there is no validation
   code anywhere in the class. Explain the mechanism, and then say what happens instead if a CI
   script passes `--porcelian` — a typo — and why that is worse.
4. Write the shell line a CI job would use to assert that the database has exactly 40 incidents,
   using `wp blame status`. Then say what you would have to change if a later lesson inserted a new
   column at the front of the porcelain output.
5. `docker compose run --rm wpcli wp blame reset` prompts, and the same command in GitHub Actions
   does not. Explain what differs about the two environments, name the two flags CI needs, and say
   why needing them is a feature rather than an inconvenience.

## Learn More

- [WP-CLI — Commands Cookbook](https://make.wordpress.org/cli/handbook/guides/commands-cookbook/) —
  `add_command()`, the method-to-subcommand mapping, `@subcommand`, `@when`, and the docblock
  format Step 2 relies on
- [WP-CLI — `WP_CLI` class reference](https://make.wordpress.org/cli/handbook/references/internal-api/) —
  the full internal API, including `runcommand()`, which Lesson 04.5 uses to call `wp media import`
  from inside PHP
- [WP-CLI — `WP_CLI::error()`](https://make.wordpress.org/cli/handbook/references/internal-api/wp-cli-error/)
  and [`::confirm()`](https://make.wordpress.org/cli/handbook/references/internal-api/wp-cli-confirm/) —
  the exit-code and prompt behaviour in Key Concepts 6 and 7
- [WP-CLI — `WP_CLI\Utils\get_flag_value()`](https://make.wordpress.org/cli/handbook/references/internal-api/wp-cli-utils-get-flag-value/) —
  why this rather than `isset()`, including `--no-<flag>` handling
- [WP-CLI — Common parameters](https://make.wordpress.org/cli/handbook/references/config/) —
  `--quiet`, `--format`, `--porcelain`, `--user`, `--skip-plugins`, all of which your command gets
  for free
- [The `wordpress:cli` image](https://hub.docker.com/_/wordpress) — the "WP-CLI" section, which
  documents the `www-data` user and why `--allow-root`, though accepted, does nothing here
- [WP-CLI — `wp eval` and `wp eval-file`](https://developer.wordpress.org/cli/commands/eval/) —
  the escape hatch from Key Concept 3, and the reasons its own documentation gives for preferring a
  registered command
