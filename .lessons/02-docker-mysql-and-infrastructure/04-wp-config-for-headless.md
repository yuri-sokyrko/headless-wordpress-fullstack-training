---
title: 'wp-config for Headless'
module: 2
lesson: 4
teaches: [wp-config-from-env, wp-home-vs-siteurl, headless-theme-redirect, wp-environment-type]
produces: ['wordpress-headless/wp-config.php', 'wordpress-headless/wp-content/themes/btt-headless/style.css', 'wordpress-headless/wp-content/themes/btt-headless/functions.php', 'wordpress-headless/wp-content/themes/btt-headless/index.php']
requires: [2.2]
---

# Lesson 02.4 — wp-config for Headless

## Quick Overview

`wp-config.php` is the one WordPress file that is *not* in this repository, and this lesson
explains the trade. Instead of a committed file with literal values, you write a config that
reads every setting with `getenv()` and commit nothing but the template inside this lesson. The
container generates the real file at boot from the environment, which means the same code runs
locally, in CI and on Fly.io with three different sets of values and zero branching. It also
means there is no file on disk that a leaked backup could hand an attacker.

The second half of the lesson is a theme with no templates. `btt-headless` exists because
WordPress refuses to run without an active theme, and because a few things — permalink
generation, `preview_post_link`, the block editor's asset loading — behave badly when the theme
is broken rather than merely minimal. Its `functions.php` does one interesting thing: it
intercepts front-end requests and redirects them to `BTT_FRONTEND_URL`, so a stray
`http://localhost:8080/incidents/dns` lands on Next.js instead of rendering a half-styled
WordPress page. You also set `WP_HOME` and `WP_SITEURL` to the WordPress origin — not the Next
origin — and the lesson is explicit about why swapping them, which several tutorials suggest,
breaks wp-admin and media URLs.

By the end of this lesson you will have:

- `wordpress-headless/wp-config.php` reading every setting through `getenv()`, with no literal
  credentials
- `WP_HOME`, `WP_SITEURL`, `WP_ENVIRONMENT_TYPE` and `WORDPRESS_DEBUG` driven from the
  environment per [appendix 04 §2](../appendix/04-env-reference.md#2-wordpress--wordpress-headlessenv)
- The `btt-headless` theme — `style.css`, `functions.php`, `index.php` — active and passing
  theme checks
- A front-end redirect that sends any non-admin, non-API request to the front-end URL
- WordPress installed, persisting across `docker compose down` and back up, with wp-admin
  reachable on `:8080`

## Classic WP Analogy

You have edited `wp-config.php` many times: pasted the database block from your host, added
`define('WP_DEBUG', true)`, dropped in salts from the WordPress.org generator, maybe set
`WP_HOME` and `WP_SITEURL` to fix a broken domain migration. Everything you know about the file
still applies — it is loaded before WordPress, it defines constants, and the order matters.
What changes is only the right-hand side of each `define()`: a literal becomes
`getenv('WORDPRESS_DB_PASSWORD')`.

`WP_HOME` and `WP_SITEURL` deserve their own paragraph because your instinct here is actively
wrong. In Classic WordPress those two are almost always the same value and you set them to the
site's public URL. In this architecture the site's public URL belongs to Next.js — but both
constants must still point at **WordPress**, because they are what wp-admin, `admin_url()`,
media `sourceUrl` and REST route generation are built from. The public front-end address is a
separate variable, `BTT_FRONTEND_URL`, and it is used only for redirects and for the Module 18
webhook. Conflating them produces an install where every wp-admin link points at a Next.js
route that does not exist.

**Where the analogy breaks down:** in Classic WordPress the theme is where all your work goes.
Here the theme is a stub whose entire front end is a `wp_redirect()`, and `functions.php` is
explicitly *not* the place code lives — the plugin you build in Module 03 owns all of it.
That inversion is deliberate and it is the habit hardest to break: `functions.php` is where a
Classic WordPress developer reflexively adds "just one hook", and in this course adding a hook
there means it disappears the day someone switches themes and it is invisible to the plugin's
test suite in Module 23.

---

## Key Concepts

### 1. Where `wp-config.php` comes from in a container

There are three ways a containerised WordPress ends up with a `wp-config.php`, and the choice
determines where your credentials live for the rest of the course.

| Option | How it works | Verdict |
|---|---|---|
| (a) Commit a literal `wp-config.php` | You write the file with real values and `git add` it | ❌ **Never.** The database password is now in the object database, in every clone, forever. Deleting it later is not remediation — rotation is. |
| (b) The image entrypoint generates it | `docker-entrypoint.sh` reads `WORDPRESS_DB_*` and writes `wp-config.php` on first boot, appending whatever is in `WORDPRESS_CONFIG_EXTRA` | ✅ The right default for a five-minute demo. Zero files to maintain. **This is what Lesson 02.2 §6 used.** |
| (c) Write your own `wp-config.php`, gitignored, and mount it read-only | The file reads every setting with `getenv()`; Compose bind-mounts it into `wordpress` and `wpcli` | ✅✅ **The recommendation from this lesson onward.** |

Three reasons (c) wins as soon as the config stops being trivial:

- **A YAML block scalar is a bad place for PHP.** The moment the config needs an `if`, a helper
  or a comment explaining *why*, you are writing PHP inside YAML inside an environment
  variable, with no highlighting and no linting.
- **Module 24's production image must not depend on the dev entrypoint.** The Fly.io image
  copies your own `wp-config.php` in and never uses the `WORDPRESS_*` convention. Config that
  lives in a Compose file does not deploy.
- **One file you can read beats a config assembled from two places.** With (b), "what is
  `WP_DEBUG` set to?" needs an `exec` into a container. With (c) it is one `grep`.

The mechanic that makes (c) work is one line in the official image's entrypoint: it generates
`wp-config.php` **only if the file does not already exist**. Mount one and it is left alone.

```
NO wp-config.php PRESENT                  wp-config.php MOUNTED  (this lesson)
────────────────────────────────          ────────────────────────────────────
entrypoint: missing? ─▶ yes               entrypoint: missing? ─▶ no ─▶ do nothing
   ├─ read WORDPRESS_DB_* vars
   ├─ append WORDPRESS_CONFIG_EXTRA       ./wp-config.php  (yours, :ro, getenv() only)
   └─ write wp-config.php                        │
        generated, not in your editor            └─▶ /var/www/html/wp-config.php
```

> **The cost, stated plainly:** you now own a file WordPress used to own. A missing semicolon
> in it is not a helpful error message — it is HTTP 500 with an empty body, because the fatal
> happens before WordPress has loaded enough to render anything. That is why Step 4 has you
> read `docker compose logs` immediately after recreating the container.

### 2. `getenv()` and the shape of a 12-factor `wp-config.php`

PHP exposes the process environment three ways, and only one is reliable here. Use
**`getenv()`**: it reads the live process environment, is unaffected by `variables_order` in
`php.ini`, and behaves identically under Apache and the WP-CLI SAPI. `$_ENV` is populated only
if `variables_order` includes `E`, which the official image does not guarantee; `$_SERVER` holds
only what Apache chooses to pass through and is silently empty under WP-CLI. Both would give you
a config that works in the browser and fails under `wp`.

`getenv()` returns `false` — not `null`, not `''` — when a variable is unset. A naive
`define('WP_DEBUG', getenv('WORDPRESS_DEBUG'))` therefore gives `false` for both "unset" and
"explicitly off", and the *string* `'1'` for on. Wrap it. Three tiny helpers carry the whole
file, and you write all three in Step 2: `btt_env()` for a required value that **exits** if it
is missing, `btt_env_opt()` for an optional value with a default, and `btt_env_bool()` for the
`'1'`/`'true'` case.

Failing loudly at boot is the point. A WordPress that starts with an empty `DB_PASSWORD` does
not fail — it connects as `btt` with no password, gets refused, and shows "Error establishing a
database connection", which sends you looking at the network. One that refuses to start and
names the missing variable has already told you the answer.

> **The invariant for this file: not one literal credential, anywhere.** Every value that
> [appendix 04 §2](../appendix/04-env-reference.md#2-wordpress--wordpress-headlessenv) marks
> **yes** in the "Secret" column arrives through `getenv()`. If you can read a password by
> opening `wp-config.php`, the file is wrong — regardless of whether it is gitignored, because
> a gitignored file still ends up in backups, in `docker cp` output and in screen shares.

### 3. `WP_HOME` versus `WP_SITEURL`, and the mistake tutorials make

Your instinct here is actively wrong, in a way that produces a *working-looking* install that
breaks two weeks later.

| Constant | What it controls | Correct value here | Symptom if you point it at Next |
|---|---|---|---|
| `WP_SITEURL` | Where WordPress **is**. `includes_url()`, `admin_url()`, REST route bases, block editor asset URLs | `http://localhost:8080` | wp-admin loads with no CSS or JS; the block editor is a white screen; every REST call 404s |
| `WP_HOME` | What WordPress thinks the site's **front page** is. `home_url()`, permalink generation, `preview_post_link` | `http://localhost:8080` | Permalinks and preview links point at Next routes that do not exist yet; media `sourceUrl` breaks after Module 24's offload |
| `BTT_FRONTEND_URL` | Where the **public** site lives. Redirects and the Module 18 revalidation webhook | `http://host.docker.internal:3000` | — this is the one that points at Next |

Both WordPress constants point at **WordPress**. The public address of Blame The Tech belongs to
Next.js and is a *third* value with its own variable — not a reassignment of either of the first
two.

```
   ┌─ AUDIENCE ─────────────┬─ ADDRESS ───────────────────────┬─ SET BY ─────────────┐
   │ end users (browser)    │ http://localhost:3000           │ NEXT_PUBLIC_SITE_URL │
   │                        │   ▲ 302 from the theme          │ (Module 09)          │
   │ editors (wp-admin)     │ http://localhost:8080/wp-admin  │ WP_SITEURL           │
   │ Next's data layer      │ http://localhost:8080/graphql   │ WP_SITEURL           │
   │ WordPress → Next hook  │ http://host.docker.internal:3000│ BTT_FRONTEND_URL     │
   └────────────────────────┴─────────────────────────────────┴──────────────────────┘
   Three addresses. Three variables. Zero overlap.
```

> **Why the common tutorial advice is wrong.** "Set `WP_HOME` to your front-end URL so
> permalinks match the headless site" appears to work — the permalink column in wp-admin shows
> nice Next URLs. Then `preview_post_link` points at a Next route with no preview handshake
> (Module 17 depends on this), `admin_url()` generates links to `:3000/wp-admin`, and the block
> editor cannot load its own assets. Permalinks are made to match the front end by the theme
> redirect in Key Concept 7, not by lying to WordPress about where it lives.

### 4. `WP_DEBUG`, `WP_DEBUG_LOG`, and the real reason `DISPLAY` is `false`

In Classic WordPress you set `WP_DEBUG` to `true` and read notices at the top of the page. Do
that here and you lose an hour to a bug that is not where the error points.

| Constant | Local | Production | What it does |
|---|---|---|---|
| `WP_DEBUG` | `true` | **`false`** | Master switch. Turns on notice/deprecation reporting. |
| `WP_DEBUG_LOG` | `true` | `false` | Writes everything to `wp-content/debug.log`. |
| `WP_DEBUG_DISPLAY` | **`false`** | `false` | Prints errors **into the response body**. Off in both. |
| `SCRIPT_DEBUG` | `true` | `false` | Unminified core JS/CSS in wp-admin. Editor debugging only. |

The reason `WP_DEBUG_DISPLAY` is `false` even locally is specific. A PHP notice prints wherever
output happens to be at that moment, and when the request is `POST /graphql` that is the middle
of a JSON body:

```
Notice: Undefined array key "foo" in /var/www/html/…/Resolver.php on line 42
{"data":{"incidents":{"nodes":[…]}}}
```

Next's data layer calls `response.json()` on that and `JSON.parse` throws
`Unexpected token 'N', "Notice: Un"... is not valid JSON`, with a stack trace pointing at
`src/lib/graphql/client.ts`. Nothing in the error mentions PHP, WordPress, or the resolver that
is actually broken — so you debug TypeScript for an hour. With `DISPLAY` off and `LOG` on, the
same notice lands in `debug.log`, the JSON stays valid, and the front end keeps working while
you fix the resolver.

> **`debug.log` is not in your editor, and this catches everyone.** It is written to
> `/var/www/html/wp-content/debug.log`, and your bind mounts are the three *subdirectories*
> `plugins`, `themes` and `mu-plugins` — **not** `wp-content` itself. So the file exists only
> inside the container: `docker compose exec wordpress tail -f
> /var/www/html/wp-content/debug.log`. Lesson 02.6 puts that in your runbook. Do not go looking
> for it on your disk.

### 5. The rest of the constants, and why order matters

| Constant | Value here | Why it matters in a headless build |
|---|---|---|
| `DISALLOW_FILE_EDIT` | `false` local, `true` prod | Kills the wp-admin theme/plugin file editor. That editor is arbitrary code execution for anyone who reaches an admin session. Driven from the environment per [appendix 04 §2](../appendix/04-env-reference.md#2-wordpress--wordpress-headlessenv). |
| `DISALLOW_FILE_MODS` | `false` local, `true` prod | No plugin or theme installs, updates or deletions through wp-admin. In production the image *is* the plugin set; anything installed at runtime vanishes on the next deploy anyway. |
| `FS_METHOD` | `'direct'` | Without it, WordPress probes for a writable filesystem and — if the probe is ambiguous — shows an **FTP credentials form** when you install a plugin. Inside a container that form is both wrong and unanswerable. `direct` says "just use PHP's file functions". |
| `WP_ENVIRONMENT_TYPE` | `local` \| `staging` \| `production` | Feeds `wp_get_environment_type()`. Module 24's hardening `mu-plugin` branches on it, and WordPress itself changes update behaviour and error display defaults. |
| `WP_MEMORY_LIMIT` | `256M` | The block editor and ACF field groups are memory-hungry. Separate from `php.ini`'s `memory_limit` (Lesson 02.2), and applies to PHP running WordPress. |
| `WP_POST_REVISIONS` | `10` | Module 17's preview reads revision rows. Unbounded revisions are `wp_posts` bloat; zero breaks preview for published posts. Ten is a compromise, not a magic number. |
| `WP_CACHE` | leave undefined | Only meaningful with a page-cache drop-in, and there is none here — Next.js owns caching (Module 18). Setting it only confuses the next reader. |

Placement is load-bearing. Every constant must be defined **before**
`require_once ABSPATH . 'wp-settings.php';`, because that line is where WordPress loads and
reads them. A `define('WP_DEBUG_DISPLAY', false)` after it is a no-op that looks correct —
WordPress has already decided. The file you write in Step 2 is banded into eight numbered
sections in exactly the conventional order — database, salts, `$table_prefix`, URLs, debug,
hardening, application constants, then `ABSPATH` and `wp-settings.php`. Keep those bands when
you add a constant later; the ninth section does not exist, because nothing goes after
`require_once`.

### 6. A theme with no templates

WordPress will not run without an active theme — not as a soft requirement: with no theme,
`get_template_directory()` returns nonsense, `wp-admin` shows a fatal, and the block editor's
REST API cannot enumerate templates. So a theme must exist.

There is a subtler reason it must be *minimal rather than broken*: permalink generation,
`preview_post_link` and the block editor's asset loading all call into the active theme, so a
theme that throws on load takes those with it and the failure surfaces somewhere unrelated — a
preview button that does nothing, or an editor that will not save.

Three files, and each has a job:

| File | Required | Job |
|---|---|---|
| `style.css` | **yes** | The header comment **is** the theme metadata. WordPress parses `Theme Name:` out of this file to list the theme at all. No header, no theme in wp-admin. Not one CSS rule is needed. |
| `index.php` | **yes** | The last-resort template. The template hierarchy always falls back to it, so it must exist. Reaching it means the redirect did not fire — so it is also a diagnostic. |
| `functions.php` | no, but we add it | The front-end redirect, and nothing else ever. |

`incident` keeps `publicly_queryable => true` in
[appendix 03 §1](../appendix/03-content-model-reference.md#1-post-types) even though nothing
WordPress renders is user-visible, because permalink generation and `preview_post_link` behave
normally only for publicly queryable types — and Module 17's preview flow needs a sane permalink
that Next can intercept. The theme redirect is what makes "publicly queryable but never publicly
rendered" a coherent position.

### 7. The redirect, and exactly what must not be redirected

A redirect that is too broad breaks the block editor, GraphQL and cron — each in a way that
does not obviously point back here.

| Request | Action | Why |
|---|---|---|
| `/wp-admin/*`, `/wp-login.php` | pass | Editors work here. `is_admin()` is true so `template_redirect` barely fires — but the guard documents intent. |
| `/wp-json/*` | pass | The block editor **is** a REST client. Module 17's `/wp-json/btt/v1/preview/verify` also lives here. |
| `/graphql` | pass | The entire architecture is one `POST` to this path. Redirect it and Next gets a 302 instead of JSON. |
| `/wp-cron.php` | pass | Scheduled events. A redirect makes cron silently stop running. |
| `/wp-content/uploads/*` | pass | Served by Apache as static files until Module 24 offloads media to R2/S3. |
| AJAX / cron context (`wp_doing_ajax()`, `wp_doing_cron()`) | pass | `admin-ajax.php` and the internal cron spawner. |
| REST context (`wp_is_json_request()`) | pass | Catches REST requests arriving by a route you did not predict. |
| WP-CLI (`defined('WP_CLI')`) | pass | A `wp` command that `exit`s mid-redirect produces confusing partial output. |
| Everything else | **302 → `BTT_FRONTEND_URL` + path + query** | Blame The Tech's public front end is Next.js. |

**Why `template_redirect`.** It fires after the main query is parsed and before any template
loads — the last moment you can bail out cheaply and the first moment `is_singular()` and
friends are meaningful. Earlier hooks (`init`, `parse_request`) fire for REST and cron requests
too, which is exactly the mess the table above avoids.

> **Use 302, never 301 — this is the trap in the lesson.** A 301 is *permanent* and browsers
> cache it essentially forever. Chrome and Safari will keep redirecting
> `http://localhost:8080/some-path` long after you have deleted the code, and clearing it means
> clearing the whole host's cache or opening a fresh profile. During development that is a bug
> you cannot fix by editing a file.

### 8. Why nothing else ever goes in `functions.php`

**Rule: `functions.php` here holds the front-end redirect and the admin-bar suppression.
Nothing else, ever.** Post types, taxonomies, roles, GraphQL fields and the revalidation webhook
all live in the `blame-the-tech-core` plugin from Module 03 — a hook in `functions.php`
disappears the day someone switches themes, is coupled to a theme that renders nothing, and is
invisible to Module 23's plugin test suite.

---

## Task

### Step 1: Confirm `wp-config.php` is ignored before you write it

The root `.gitignore` already has the rule. Prove it before the file contains a password.

```bash
cd wordpress-headless
git check-ignore -v ../wordpress-headless/wp-config.php
```

**Verify §1:**

- [ ] The output names a rule from `.gitignore`, mentioning
      `wordpress-headless/wp-config.php`.
- [ ] **No output means the file is not ignored. Stop and fix the root `.gitignore` first** —
      writing the file and "fixing it afterwards" is how a password enters git history.

### Step 2: Write `wp-config.php`

Every value comes from the environment; the inline comments are the lesson.

**The file's first line is the bare opening tag `<?php`**; everything below goes after it.

```php
// wordpress-headless/wp-config.php
//
// GITIGNORED. Reads everything from the environment — see appendix 04 for the inventory.
// Bind-mounted read-only into `wordpress` and `wpcli`. Because this file exists, the
// official image's entrypoint does NOT generate one.

// Required. Fails at boot rather than booting misconfigured. A hard stop is correct:
// "Error establishing a database connection" would send you looking at the network
// instead of at a missing variable. getenv() returns false — not null — when unset.
function btt_env( string $key ): string {
	$value = getenv( $key );
	if ( false === $value || '' === $value ) {
		http_response_code( 500 );
		exit( 'Missing required environment variable: ' . htmlspecialchars( $key, ENT_QUOTES ) );
	}
	return $value;
}

// Optional, with a default.
function btt_env_opt( string $key, string $default = '' ): string {
	$value = getenv( $key );
	return ( false === $value || '' === $value ) ? $default : $value;
}

// Boolean from a string. FILTER_VALIDATE_BOOLEAN accepts 1/true/yes/on.
function btt_env_bool( string $key, bool $default = false ): bool {
	$value = getenv( $key );
	return ( false === $value || '' === $value )
		? $default
		: filter_var( $value, FILTER_VALIDATE_BOOLEAN );
}

// ── 1. Database ──────────────────────────────────────────────────────────
// Note DB_HOST is `db:3306`, the Compose service name. Never `localhost` —
// inside this container `localhost` is this container. See Lesson 02.2 §2.
define( 'DB_NAME',     btt_env( 'WORDPRESS_DB_NAME' ) );
define( 'DB_USER',     btt_env( 'WORDPRESS_DB_USER' ) );
define( 'DB_PASSWORD', btt_env( 'WORDPRESS_DB_PASSWORD' ) );
define( 'DB_HOST',     btt_env_opt( 'WORDPRESS_DB_HOST', 'db:3306' ) );
define( 'DB_CHARSET',  'utf8mb4' );
define( 'DB_COLLATE',  '' );

// ── 2. Salts ─────────────────────────────────────────────────────────────
// Eight independent 64-char values, plus a NINTH for the GraphQL JWT that must differ
// from AUTH_KEY (different blast radius — appendix 04 §5). You generate all nine in
// Lesson 02.5; until then they read as empty strings, which WordPress tolerates with
// degraded cookie security. That is why 02.5 is the very next lesson.
define( 'AUTH_KEY',         btt_env_opt( 'AUTH_KEY' ) );
define( 'SECURE_AUTH_KEY',  btt_env_opt( 'SECURE_AUTH_KEY' ) );
define( 'LOGGED_IN_KEY',    btt_env_opt( 'LOGGED_IN_KEY' ) );
define( 'NONCE_KEY',        btt_env_opt( 'NONCE_KEY' ) );
define( 'AUTH_SALT',        btt_env_opt( 'AUTH_SALT' ) );
define( 'SECURE_AUTH_SALT', btt_env_opt( 'SECURE_AUTH_SALT' ) );
define( 'LOGGED_IN_SALT',   btt_env_opt( 'LOGGED_IN_SALT' ) );
define( 'NONCE_SALT',       btt_env_opt( 'NONCE_SALT' ) );

// Read by WPGraphQL JWT Authentication, installed in Module 05 and configured in
// Module 15. Defined here so the environment is the only place it ever lives.
define( 'GRAPHQL_JWT_AUTH_SECRET_KEY', btt_env_opt( 'GRAPHQL_JWT_AUTH_SECRET_KEY' ) );

// ── 3. Table prefix ──────────────────────────────────────────────────────
// A variable, not a constant. WordPress reads $table_prefix from global scope.
$table_prefix = btt_env_opt( 'WORDPRESS_TABLE_PREFIX', 'wp_' );

// ── 4. URLs ──────────────────────────────────────────────────────────────
// BOTH point at WordPress. The public site belongs to Next.js and has its own variable
// below (section 7). See Key Concept 3 before changing either of these.
define( 'WP_HOME',    btt_env_opt( 'WP_HOME',    'http://localhost:8080' ) );
define( 'WP_SITEURL', btt_env_opt( 'WP_SITEURL', 'http://localhost:8080' ) );

// ── 5. Debug ─────────────────────────────────────────────────────────────
define( 'WP_DEBUG',         btt_env_bool( 'WORDPRESS_DEBUG', false ) );
define( 'WP_DEBUG_LOG',     WP_DEBUG );   // → wp-content/debug.log, inside the container
define( 'WP_DEBUG_DISPLAY', false );      // NEVER true: a notice inside a JSON body
                                          // breaks the Next.js parser. Key Concept 4.
define( 'SCRIPT_DEBUG',     WP_DEBUG );
@ini_set( 'display_errors', '0' );        // belt and braces — the same reasoning

// ── 6. Environment and hardening ─────────────────────────────────────────
define( 'WP_ENVIRONMENT_TYPE', btt_env_opt( 'WP_ENVIRONMENT_TYPE', 'local' ) );
define( 'DISALLOW_FILE_EDIT',  btt_env_bool( 'DISALLOW_FILE_EDIT', false ) );
define( 'DISALLOW_FILE_MODS',  btt_env_bool( 'DISALLOW_FILE_MODS', false ) );
define( 'FS_METHOD',           'direct' ); // no FTP credential prompt in a container
define( 'WP_MEMORY_LIMIT',     '256M' );
define( 'WP_POST_REVISIONS',   10 );       // Module 17 preview reads revision rows
define( 'AUTOSAVE_INTERVAL',   120 );

// ── 7. Application constants ─────────────────────────────────────────────
// Where the public front end lives. Used by the btt-headless theme redirect and, from
// Module 18, by the revalidation webhook. NOT a WordPress URL.
define( 'BTT_FRONTEND_URL', btt_env_opt( 'BTT_FRONTEND_URL', 'http://host.docker.internal:3000' ) );

// ── 8. ABSPATH, then load WordPress. Nothing goes after this line. ───────
if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', __DIR__ . '/' );
}
require_once ABSPATH . 'wp-settings.php';
```

> **Do not add a closing `?>`.** A trailing newline after it is output, and output before
> headers are sent produces "Cannot modify header information" on every request — the classic
> `wp-config.php` bug, and it is invisible in a diff.

### Step 3: Mount it, and delete the `WORDPRESS_CONFIG_EXTRA` block

Add the mount to **both** services that run PHP against this install, immediately after the
existing PHP configuration mounts.

```yaml
# wordpress-headless/docker-compose.yml
# Fragment. Add the LAST line of each block to the existing `volumes:` list.
services:
  wordpress:
    volumes:
      - ./php.ini:/usr/local/etc/php/conf.d/zz-btt.ini:ro
      # Read-only on purpose: nothing in the container should rewrite your config.
      - ./wp-config.php:/var/www/html/wp-config.php:ro

  wpcli:
    volumes:
      - ./php.ini:/usr/local/etc/php/conf.d/zz-btt.ini:ro
      # WP-CLI must read the SAME config as the web container, or `wp config get`
      # will disagree with what the browser sees.
      - ./wp-config.php:/var/www/html/wp-config.php:ro
```

Then remove `WORDPRESS_CONFIG_EXTRA` from the development overlay, which becomes:

```yaml
# wordpress-headless/docker-compose.dev.yml
# Development-only. Never applied to staging or production.
services:
  wordpress:
    environment:
      # Read by wp-config.php via btt_env_bool('WORDPRESS_DEBUG').
      WORDPRESS_DEBUG: 1

  db:
    # Published only in development, for the EXPLAIN drills in Lesson 02.3.
    ports:
      - '3306:3306'
```

You are deleting something you wrote in Lesson 02.2 §6, and that is the point of the comparison
rather than an accident: `WORDPRESS_CONFIG_EXTRA` was the correct choice for six `define()`
calls with no logic, and stopped being correct the moment the config needed helpers, an
environment switch and comments. Keeping both would leave two sources of truth for
`WP_DEBUG_DISPLAY` — the worst available outcome.

**Verify §3:**

- [ ] `docker compose -f docker-compose.yml -f docker-compose.dev.yml config` prints the merged
      configuration with no error, and no longer contains `WORDPRESS_CONFIG_EXTRA` anywhere.
- [ ] It contains `./wp-config.php:/var/www/html/wp-config.php:ro` twice — once for
      `wordpress`, once for `wpcli`.

### Step 4: Recreate the container and read the logs

A mounted file is only picked up by a container created after the mount existed.

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --force-recreate wordpress wpcli
docker compose logs --tail=30 wordpress
```

Then verify through WP-CLI. `wp config get` parses the **file** — mounted into `wpcli` too, so
it reads exactly what Apache reads:

```bash
docker compose run --rm wpcli wp config get WP_HOME
docker compose run --rm wpcli wp config get WP_SITEURL
docker compose run --rm wpcli wp config get table_prefix
docker compose run --rm wpcli wp option get siteurl
```

**Verify §4:**

- [ ] `wp config get WP_HOME` prints `http://localhost:8080`.
- [ ] `wp option get siteurl` prints `http://localhost:8080` — this one hits the **database**,
      so it proves the credentials in your new file actually work.
- [ ] ⚠️ **A blank page or a bare `500` means a PHP syntax error in `wp-config.php`.** The
      browser shows nothing because `WP_DEBUG_DISPLAY` is `false`, which is correct.
      `docker compose logs --tail=30 wordpress` prints the file and line number. Fix it there,
      not by guessing.

### Step 5: Create the `btt-headless` theme

Three files in `wp-content/themes/btt-headless/` — create it with
`mkdir -p wp-content/themes/btt-headless`. The stylesheet exists for its header comment, not
for any CSS:

```css
/* wordpress-headless/wp-content/themes/btt-headless/style.css */
/*
Theme Name:        BTT Headless
Author:            Blame The Tech
Description:       Deliberately empty theme for a headless install. Renders nothing. Its only
                   behaviour is a 302 from any front-end request to BTT_FRONTEND_URL. All
                   application code lives in the blame-the-tech-core plugin, never here.
Version:           1.0.0
Requires at least: 6.7
Requires PHP:      8.3
License:           GPL-2.0-or-later
License URI:       https://www.gnu.org/licenses/gpl-2.0.html
Text Domain:       btt-headless
*/

/* Intentionally no rules. wp-admin styling comes from core; the public site is Next.js. */
```

`index.php` is the template hierarchy's last resort. It must exist — and if a visitor ever sees
it, the redirect failed, so it says so:

Again, the file opens with a bare `<?php` line, then:

```php
// wordpress-headless/wp-content/themes/btt-headless/index.php
//
// The mandatory last-resort template. WordPress falls back here when nothing more
// specific matches, so the file must exist for the theme to be valid.
//
// Reaching this page means the template_redirect hook in functions.php did NOT fire.
// Treat it as a diagnostic, not a page: check the guards in btt_headless_redirect().

$btt_frontend = defined( 'BTT_FRONTEND_URL' ) ? BTT_FRONTEND_URL : '/';
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="robots" content="noindex, nofollow">
	<title><?php echo esc_html( get_bloginfo( 'name' ) ); ?></title>
</head>
<body>
	<p>This WordPress install is headless. It serves an API, not pages.</p>
	<p><a href="<?php echo esc_url( $btt_frontend ); ?>"><?php echo esc_html( $btt_frontend ); ?></a></p>
</body>
</html>
```

`functions.php` holds the redirect and nothing else:

```php
// wordpress-headless/wp-content/themes/btt-headless/functions.php
// (again, below a bare `<?php` first line)
//
// The ONLY behaviour in this theme. Everything else — post types, taxonomies, roles,
// GraphQL fields, the revalidation webhook — belongs to the blame-the-tech-core plugin
// built in Module 03. See Key Concept 8.

// Send any public front-end request to the Next.js application. Hooked to
// `template_redirect`: after the main query is parsed, before any template loads.
function btt_headless_redirect(): void {
	// 1. Context-based passes. Each of these breaks something specific if redirected —
	//    see the table in Key Concept 7.
	if (
		is_admin()                                              // wp-admin
		|| ( defined( 'WP_CLI' ) && WP_CLI )                    // any `wp` command
		|| wp_doing_ajax() || wp_doing_cron()                   // admin-ajax, wp-cron
		|| ( defined( 'REST_REQUEST' ) && REST_REQUEST )        // REST dispatch
		|| ( function_exists( 'wp_is_json_request' ) && wp_is_json_request() )
		|| is_robots() || is_feed() || is_trackback()
	) {
		return;
	}

	// 2. Path-based passes. `/graphql` is the whole architecture; `/wp-json` is the block
	//    editor and Module 17's preview verify endpoint; uploads are static files.
	$path = (string) parse_url( $_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH );
	foreach ( array( '/graphql', '/wp-json', '/wp-content/uploads', '/wp-login.php', '/wp-cron.php' ) as $prefix ) {
		if ( 0 === strpos( $path, $prefix ) ) {
			return;
		}
	}

	// Misconfigured: render index.php rather than redirect to nowhere.
	if ( ! defined( 'BTT_FRONTEND_URL' ) || '' === BTT_FRONTEND_URL ) {
		return;
	}

	// 3. Preserve path and query string so /incidents/dns/?x=1 lands on the same route.
	$target = rtrim( BTT_FRONTEND_URL, '/' ) . ( $_SERVER['REQUEST_URI'] ?? '/' );

	// 302, NOT 301 — a cached 301 to the wrong place is unclearable in development.
	//
	// wp_redirect(), not wp_safe_redirect(): the safe variant restricts targets to hosts in
	// `allowed_redirect_hosts`, and this target host is external to WordPress by design.
	// A filter would work, but it is a second place to keep in sync with BTT_FRONTEND_URL,
	// and this target is a constant we set ourselves — never user input.
	wp_redirect( esc_url_raw( $target ), 302 );
	exit;
}
add_action( 'template_redirect', 'btt_headless_redirect' );

// No admin bar on the front end — it would render into index.php's diagnostic page.
add_filter( 'show_admin_bar', '__return_false' );

// Minimal support so the block editor knows what it is dealing with. Module 13 replaces
// this with a real `theme.json`.
add_action(
	'after_setup_theme',
	static function (): void {
		add_theme_support( 'title-tag' );
		add_theme_support( 'editor-styles' );

		// The second — and last — thing this theme does. Menu LOCATIONS are theme-scoped
		// in WordPress core: switch themes and they disappear, which is why this cannot
		// live in the plugin even though everything else does. WPGraphQL builds
		// `MenuLocationEnum` from exactly this call, so without it
		// `menuItems(where: { location: PRIMARY })` fails GraphQL VALIDATION rather than
		// returning empty — Lessons 05.4 and 11.3 both depend on it.
		register_nav_menus( array( 'primary' => 'Primary Navigation' ) );
	}
);
```

> **Only `primary`, and only because something queries it.** A Classic theme would register
> three or four locations on the assumption that a designer will want them. Here every location
> is a value in a public GraphQL enum, so an unused one is API surface you have to keep
> answering for. Register the second location in the lesson that renders it, not now.

**Verify §5:**

- [ ] `docker compose exec wordpress ls /var/www/html/wp-content/themes/btt-headless` lists all
      three files. Nothing listed means the `themes` bind mount is missing — Lesson 02.2 Step 5.
- [ ] `docker compose exec wordpress php -l /var/www/html/wp-content/themes/btt-headless/functions.php`
      prints `No syntax errors detected`.
- [ ] `docker compose run --rm wpcli wp menu location list --format=csv` lists `primary`. An
      empty list means `register_nav_menus()` did not run — usually because the theme is not
      the active one. Lesson 05.4 queries this location and Lesson 11.3 renders it.

### Step 6: Activate the theme

```bash
docker compose run --rm wpcli wp theme activate btt-headless
docker compose run --rm wpcli wp theme list
```

**Verify §6:**

- [ ] `btt-headless` shows `active` in the second `wp theme list`.
- [ ] The bundled default themes show `inactive`. Leave them installed for now — Module 24
      removes them from the production image, which is a deployment concern, not a local one.
- [ ] `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:8080/`
      returns `302` to `http://host.docker.internal:3000/`. Nothing is listening there yet —
      you are testing WordPress's response, not Next's.
- [ ] The same command against `/graphql` returns **`404`, not `302`**. WPGraphQL arrives in
      Module 05, so 404 is correct today, and a 302 would mean Module 05's first query gets
      HTML from Next instead of JSON. Checks 7–10 below prove the rest of the table.

---

## Verification

```bash
cd wordpress-headless

# 1. The stack is healthy after the recreate
docker compose ps
# Expected: wordpress, db, adminer, mailpit — all "running"; db "(healthy)"; wpcli absent

# 2. WordPress reads your config file, and both URLs point at WordPress.
#    The third command hits the DATABASE, proving the credentials in the file work.
docker compose run --rm wpcli wp config get WP_HOME     # Expected: http://localhost:8080
docker compose run --rm wpcli wp config get WP_SITEURL  # Expected: http://localhost:8080
docker compose run --rm wpcli wp option get siteurl     # Expected: http://localhost:8080

# 3. NOT ONE literal credential in the file — everything comes from the environment
grep -cE "^define\( *'DB_PASSWORD', *'" wp-config.php   # Expected: 0
grep -c getenv wp-config.php                            # Expected: 15 or more

# 4. The file is ignored, and is not staged
git check-ignore -v wp-config.php
# Expected: a rule from .gitignore
git status --short
# Expected: wp-config.php does NOT appear. Neither does .env.

# 5. The redirect-only theme is the active theme
docker compose run --rm wpcli wp theme list --status=active --field=name
# Expected: btt-headless

# 6. A public front-end request is redirected to Next
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:8080/
# Expected: 302 http://host.docker.internal:3000/

# 7. NEGATIVE — wp-admin is NOT redirected to the front end. Both /wp-admin/ and /
#    answer 302, so the status code proves nothing: read the redirect_url.
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:8080/wp-admin/
# Expected: 302 to .../wp-login.php?redirect_to=...
#           If you see :3000 here, your guards are wrong and editors cannot log in.

# 8. NEGATIVE — REST and GraphQL are not redirected. The block editor needs the first;
#    the entire architecture needs the second. Both must show an EMPTY redirect_url.
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:8080/wp-json/
# Expected: 200 and nothing after it
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:8080/graphql
# Expected: 404 and nothing after it. 404 is correct until Module 05 installs WPGraphQL;
#           a 302 here would break the whole architecture.

# 9. NEGATIVE — the old config mechanism is gone, so there is one source of truth
docker compose -f docker-compose.yml -f docker-compose.dev.yml config | grep -c WORDPRESS_CONFIG_EXTRA
# Expected: 0

# 10. The whole thing survives a restart
docker compose down && docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait
docker compose run --rm wpcli wp option get blogname
# Expected: Blame The Tech
```

Check 7 is the one people get wrong. They see `302` for `/wp-admin/`, assume the redirect is
correct everywhere, and only discover in Module 03 that editors cannot reach the dashboard. The
status code is identical for both outcomes — the `redirect_url` is the only thing that
distinguishes a working guard from a broken one.

## Control Questions

1. The official `wordpress` image generates `wp-config.php` at first boot. Explain why your
   mounted file is not overwritten, and what would happen on a fresh volume if you mounted the
   file but left `WORDPRESS_DB_PASSWORD` out of `.env`.
2. `WP_HOME` and `WP_SITEURL` both point at `http://localhost:8080`, not at
   `http://localhost:3000`. Name three specific things that break if you set `WP_HOME` to the
   Next.js origin, and say which variable is the correct home for the front-end address.
3. `WP_DEBUG` is `true` locally but `WP_DEBUG_DISPLAY` is `false`. Describe the exact failure a
   `true` `WP_DEBUG_DISPLAY` would produce in Module 10's data layer, and say why the error
   message would point at the wrong file.
4. The theme's redirect passes `/graphql`, `/wp-json`, `/wp-admin` and any WP-CLI context
   through untouched. Pick two of those, and for each describe the concrete symptom you would
   see in a *later* module if the guard were missing.
5. The redirect uses a 302. State what specifically goes wrong with a 301 during development,
   and explain why `wp_redirect()` was chosen over `wp_safe_redirect()` here — including what
   you would have to add to use the safe variant.

## Learn More

- [Editing `wp-config.php`](https://developer.wordpress.org/advanced-administration/wordpress/wp-config/) —
  the authoritative constant reference; skim `WP_DEBUG_LOG`, `DISALLOW_FILE_MODS` and `FS_METHOD`
  specifically, because all three behave differently in a container than on shared hosting
- [The `wordpress` image on Docker Hub](https://hub.docker.com/_/wordpress) — read the
  "Configuration" section for the full list of `WORDPRESS_*` variables and the exact wording of
  the "only if `wp-config.php` does not exist" behaviour Key Concept 1 depends on
- [`getenv()` in the PHP manual](https://www.php.net/manual/en/function.getenv.php) — worth two
  minutes for the return-value note alone: `false` on failure, which is why the helpers in Step 2
  check for it explicitly
- [Theme basics](https://developer.wordpress.org/themes/basics/) — the `style.css` header and
  template hierarchy pages, which together explain why a theme with two files and no CSS is
  still valid
- [`wp_redirect()` and `wp_safe_redirect()`](https://developer.wordpress.org/reference/functions/wp_safe_redirect/) —
  read the "allowed hosts" note, then re-read the comment in `functions.php` explaining why this
  course chose the unsafe-sounding one deliberately
