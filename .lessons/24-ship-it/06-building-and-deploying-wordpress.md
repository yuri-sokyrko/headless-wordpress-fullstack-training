---
title: 'Building & Deploying WordPress'
module: 24
lesson: 6
teaches: [multi-stage-dockerfile, non-root-container, opcache, ghcr, fly-io, release-command, blue-green, health-check, media-offload, forward-only-migrations]
produces: ['wordpress-headless/Dockerfile', 'wordpress-headless/.dockerignore', 'wordpress-headless/fly.toml', 'wordpress-headless/railway.json', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/health.php', '.github/workflows/deploy-wp.yml']
requires: [24.4, 24.1, 20.1]
---

# Lesson 24.6 — Building & Deploying WordPress

## Quick Overview

Module 02 built a development stack on the `wordpress:6.8-php8.3-apache` image with bind mounts,
`WP_DEBUG` on, no opcache and every dev tool available. That was correct for developing and is
wrong for production, and every deferred decision comes due now. The production `Dockerfile` is
**multi-stage**: a Composer stage installing with `--no-dev`, a Node stage building the block
assets, and a slim runtime stage that copies only the built artifacts. It runs as a **non-root**
user, enables **opcache** with `validate_timestamps=0` (the code cannot change inside an
immutable image, so revalidation is wasted syscalls), pins WordPress core explicitly, and
contains **no dev tooling** — no Composer, no npm, no Xdebug, and per Lesson 24.1 no ability to
install anything at runtime.

Then deployment. The image is built in CI, scanned, tagged with the commit SHA and pushed to
GHCR. Fly.io pulls it. The interesting part is `release_command`, which runs **once, before any
new machine takes traffic, and aborts the deploy on a non-zero exit**:

```bash
wp core update-db && wp plugin activate --all && wp rewrite flush --hard && wp blame ensure-languages
```

Four commands, each idempotent, each necessary. And **the reason this step is boring is that ACF
field groups are PHP-registered from `includes/acf-json/`** — the decision made back in Module 04.
Field groups in the database would mean an export/import step in every single release, plus a
whole class of "works on staging" failures. Say it plainly, because it is the highest-leverage
architectural choice in the pipeline and it pays off exactly here.

Blue-green gives you a real rollback: a new machine boots, the health check passes, traffic
shifts. The health check is `/wp-json/btt/v1/health`, and it checks the **database connection,
the expected plugin versions and WPGraphQL introspection** — not `/`, which returns 200 from
Apache while WordPress cannot reach MySQL.

By the end of this lesson you will have:

- `wordpress-headless/Dockerfile` — multi-stage, non-root, opcache tuned, core pinned, no dev
  tooling — plus a `.dockerignore` excluding `.env`, `node_modules`, `vendor` and test
  directories, with `docker history` showing no secret in any layer
- `includes/health.php` — `/wp-json/btt/v1/health` asserting DB, plugin versions and introspection
- `fly.toml` with a `release_command`, a health check, and `[env]` holding **only** non-secret
  configuration
- `.github/workflows/deploy-wp.yml` — build, scan, push to GHCR, deploy by immutable SHA tag
- `railway.json` as the documented alternative target using the same image, and media offloaded
  to R2/S3 **from day one** with `next/image` `remotePatterns` updated
- A written rollback procedure, and a core-upgrade procedure that snapshots the volume first

## Classic WP Analogy

| Classic WordPress deploy | This deploy |
|---|---|
| FTP the changed files | Build an immutable image, push by SHA, deploy the tag |
| Plugins installed via wp-admin | `wp plugin install` at **build** time, pinned in the `Dockerfile` |
| Core updated by clicking Update | Core pinned; upgrades are a separate manual workflow |
| `wp-config.php` edited on the server | Environment variables and `fly secrets set` |
| "Did someone flush the permalinks?" | `wp rewrite flush --hard` in `release_command` |
| A `.sql` dump before touching anything | A volume snapshot, taken before a core upgrade |
| Roll back by re-uploading old files | Redeploy the previous image SHA |

The shift is **immutability**. A Classic WordPress server accumulated state: a plugin someone
installed in 2019, a file edited live during an incident, an uploads folder nobody could account
for. Nobody could reconstruct it, which is why "staging matches production" was always a polite
fiction. An image built from a `Dockerfile` in git is reconstructible by definition, and
`wp-content/plugins` contains exactly what the build put there.

> **Three things this course is honest about, from [PROJECT.md](../PROJECT.md).** Skipping them
> would teach you the wrong lessons.
>
> **Fly.io has no managed MySQL.** Running it as a Fly app with a volume is fine for a course and
> for low-stakes production, and it is a single point of failure with no point-in-time recovery
> and a snapshot RPO of roughly 24 hours. The lesson names the managed alternatives — PlanetScale,
> Amazon RDS, DigitalOcean Managed MySQL — and what each costs.
>
> **A Fly volume pins the app to one machine.** Scale to two and `uploads/` diverges immediately,
> because each machine has its own volume. That is why media offload to R2/S3 is taught as **the
> correct answer from day one**, not an optional extra for later.
>
> **You cannot roll back `wp core update-db`.** Application code rolls back by redeploying a
> previous immutable image; schema changes are forward-only. That is precisely why core is pinned
> in the `Dockerfile` and core upgrades get their own manual workflow that snapshots the volume
> before running anything.

Where the analogy breaks hardest is that last one, and it is the asymmetry worth carrying out of
this module: **your code is now trivially reversible and your data is not.** In the FTP era both
were equally awkward, so nobody distinguished them. Immutable images make code rollback a
one-liner, which makes it very easy to assume everything rolls back — right up to the deploy that
ran `wp core update-db`, after which the previous image is talking to a schema it does not
recognise. Rollback is a code property. Database migrations need snapshots, a maintenance window
and a separate decision.

---

## Key Concepts

### 1. This lesson is a bill arriving, not new material

[Lesson 02.2](../02-docker-mysql-and-infrastructure/02-the-compose-stack.md) built a development
stack and said, in several places, "Module 24 will do this properly." Every one of those
deferrals is now due, and reading the lesson that way is more useful than reading it as six new
technologies.

| Deferred in Module 02 | Due here | What the deferral cost you |
|---|---|---|
| Bind mounts, so you can edit plugin PHP live | `COPY` into the image; the code cannot change at run time | nothing — it was the right call for developing |
| `WP_DEBUG` and `SCRIPT_DEBUG` on, in `docker-compose.dev.yml` | off; `WP_ENVIRONMENT_TYPE: production`, which 24.1's hardening branches on | nothing, **because 02.2 §5 put them in the overlay.** In the base file this step would be a bug hunt |
| No opcache — every request recompiles | opcache on with `validate_timestamps=0` | roughly 40% of your request time, which you never noticed locally |
| Everything runs as root | a **non-root** user, and Apache moved off port 80 to prove it | a container escape is a host root escape |
| Composer and WP-CLI both available | Composer out of the runtime; WP-CLI kept **on purpose** — see Key Concept 8 | a 40 MB dependency resolver with network access, in production |
| `wordpress:6.8-php8.3-apache`, a moving tag, pulled at run time | the **exact patch tag plus its digest**, resolved at build time | two builds of the same commit could be different WordPresses |
| Media in a named volume | offloaded to R2/S3 **from day one** — Key Concept 10 | one machine, forever |

The row that pays off best is the second one. `WORDPRESS_DEBUG` living in
`docker-compose.dev.yml` rather than `docker-compose.yml` was, at the time, a tidiness decision
with a one-sentence justification. It means the production configuration in this lesson has
nothing to remember: the settings that must not be true in production were never in the shared
file.

### 2. Three build stages, and what each one keeps out of the runtime

A multi-stage build exists so that the tools that produce an artifact are not shipped with it.
Each `FROM` starts a new filesystem; only what you explicitly `COPY --from` survives.

```
  ┌── vendor ────────────┐  composer:2 · installs with --no-dev
  │  composer.lock       │  → /app/vendor          (autoloader, no Pest, no wp-phpunit)
  └───────┬──────────────┘
  ┌── assets ────────────┐  node:22 · @wordpress/scripts
  │  blocks/src/         │  → /blocks/build        (six blocks; build/ is GITIGNORED)
  └───────┬──────────────┘
  ┌── plugins ───────────┐  curl · pinned third-party zips
  │  version pins        │  → /plugins/*           (WPGraphQL, ACF, Polylang, Yoast …)
  └───────┬──────────────┘
          ▼
  ┌── runtime ───────────────────────────────────────────────────┐
  │  wordpress:6.8.2-php8.3-apache  (core is the base image)     │
  │  COPY --from=vendor   vendor/                                │
  │  COPY --from=assets   build/                                 │
  │  COPY --from=plugins  third-party plugins                    │
  │  COPY  our plugins, theme, mu-plugins, wp-config.php, php.ini│
  │  no composer · no node · no npm · no Xdebug · non-root       │
  └──────────────────────────────────────────────────────────────┘
```

The `assets` stage is not optional and this is the trap.
[Lesson 13.1](../13-gutenberg-block-development/01-the-block-editor-mental-model.md) gitignored
`build/` and made the plugin register from `build/`, never `src/` — so **a fresh clone has no
built blocks at all**, and an image built without this stage activates a plugin that registers
zero block types. It does not error; `register_block_type()` is guarded by `is_dir()`, so the
editor simply has no Blame The Tech blocks and every existing post's block markup renders as
nothing. That is the correct failure mode locally and a silent catastrophe in production, which
is why Step 2 asserts one built `block.json` inside the build stage rather than trusting it.

### 3. `.dockerignore` is a security control, and it is the one you must test

`.dockerignore` is usually explained as a build-speed optimisation: a smaller context uploads
faster. That is true and it is the less important half. The build context is **everything the
`COPY` instructions can reach**, and a broad `COPY . .` with a missing `.dockerignore` entry puts
`.env` inside a layer.

```
   COPY . /var/www/html/          .dockerignore has no `.env` line
   ────────────────────────       ──────────────────────────────────
   layer 7: 41 MB                 wordpress-headless/.env, with the
                                  database password and the JWT secret,
                                  in an image you pushed to GHCR
```

Deleting the file in a later `RUN` does not help: layers are additive and the earlier layer is
still in the image, still pullable, still visible in `docker history`. The remediation is the same
as for git — **rotate**, per Key Concept 7 of [Lesson 24.5](05-quality-gates-and-branch-protection.md).

So the verification that matters is not "does `.dockerignore` exist". It is `docker history` and a
filesystem grep over the built image, and it belongs in the Verification of this lesson because
**a `.dockerignore` you did not test is a `.env` in a public image.**

### 4. Non-root, and the one thing it visibly breaks

The official `wordpress` image runs Apache as root, which then drops to `www-data` per worker.
Root in the container is not root on the host, but it is one kernel bug away from being exactly
that, and it is unnecessary: nothing this application does needs to write outside `uploads/`.

Switching to `USER www-data` breaks exactly one thing, immediately and obviously: **a non-root
process cannot bind a port below 1024.** So Apache moves to 8080 inside the container and
`fly.toml`'s `internal_port` follows. Two lines of `sed` in the build, and you have a container
that cannot become root even if PHP is compromised.

| Option | Cost |
|---|---|
| Keep root, drop per worker | the parent process and the entrypoint run as root for the container's whole life |
| `setcap CAP_NET_BIND_SERVICE` on Apache | keeps port 80, adds a capability, and needs `--cap-add` at run time on some platforms |
| **Move to 8080 and run as `www-data`** | one config line changes in `fly.toml`. **Chosen.** |

Two consequences to know before you debug them. The official entrypoint only performs its
`chown` work when it is running as uid 0, so as `www-data` it skips those steps — which is fine
because the build already put every file in place with the right owner, and it is why Step 2
does the `wp-content` ownership work at build time rather than at boot. And `wp-config.php` must
already exist in the image: the entrypoint generates one *only if the file is absent*, and it
cannot write into a directory it does not own. Reasoned from the image's entrypoint script, not
executed.

### 5. opcache, and why `validate_timestamps=0` is safe here and wrong locally

opcache caches the compiled bytecode of every PHP file. By default it `stat()`s each file on each
request to see whether the source changed — which is correct on a server where files change, and
pure waste inside an immutable image where they cannot.

```
   validate_timestamps=1 (default)      validate_timestamps=0 (this image)
   ──────────────────────────────       ──────────────────────────────────
   request → stat() ~400 files          request → serve bytecode
           → compare mtimes            (a code change requires a NEW IMAGE,
           → serve bytecode             which is the only way code changes)
```

`0` in development would be actively hostile: you would edit a file, reload, and see the old code
with no indication why. That is precisely why Module 02 left opcache off entirely rather than
tuning it — and it is why this setting lives in a file that only the production image copies.

JIT stays **off**, deliberately. PHP 8.3's tracing JIT helps CPU-bound numerical code; WordPress
is I/O-bound on MySQL and its measured gain is close to zero, while the JIT buffer costs memory
and has historically produced the hardest-to-diagnose class of PHP bug. Turn it on if you measure
a reason; do not turn it on because it is available.

### 6. Your code is now trivially reversible. Your data is not.

This is the asymmetry to carry out of the module, and it is genuinely new.

| | Classic WordPress (FTP) | Here |
|---|---|---|
| Roll back application code | re-upload yesterday's folder, hope | `fly deploy --image …:<previous-sha>` — seconds, exact |
| Roll back a database schema change | restore a `.sql` dump, lose everything since | **not possible.** Forward-only |

In the FTP era both operations were equally awkward, so nobody distinguished them. Immutable
images make code rollback a one-liner, which makes it very easy to assume everything rolls back —
right up to the deploy that ran `wp core update-db`, after which the previous image is talking to
a schema it does not recognise. `wp core update-db` has no inverse. There is no
`--downgrade-db`, and WordPress does not keep the old schema.

Three consequences, all of them design decisions in this lesson:

1. **Core is pinned in the build**, by exact tag and recorded digest, so no deploy ever runs
   `update-db` by accident.
2. **Core upgrades are their own manual workflow**, which takes a volume snapshot first and is
   triggered by a human who has read the release notes.
3. `release_command` still runs `wp core update-db` on every deploy, because it must be there when
   the core version *does* change — and it is a no-op on every other deploy.

### 7. A health check that checks something real

`GET /` on this container returns 200 from Apache while WordPress cannot reach MySQL, because
Apache is happy and the theme's `template_redirect` (Lesson 02.4) issues a 302 before anything
queries the database. A load balancer reading that response keeps sending traffic to a broken
machine.

So the check asserts three things that can actually fail independently:

| Check | Assertion | Failure it catches |
|---|---|---|
| Database | one prepared `SELECT` against `wp_options` | wrong credentials, a full volume, a MySQL app that did not start |
| Plugin versions | every plugin in an expected map is active **at the expected version** | a deploy from an image built before a pin changed |
| GraphQL | `\WPGraphQL::get_schema()` builds without throwing | a registration that broke the type registry — which returns 200 with an `errors` array, so nothing else would notice |

`/wp-json/btt/v1/health` **extends a namespace that already exists**:
[Lesson 17.2](../17-faustjs-preview-and-draft-mode/02-preview-and-draft-mode.md) registered
`/wp-json/btt/v1/preview/verify`. And it is reachable because Lesson 02.4's routing table passes
`/wp-json/*` through the theme redirect untouched — a fact worth checking rather than assuming,
because a `/wp-json` route behind a 302 is a health check that reports the *front end's*
availability.

**Two design decisions worth arguing about.**

`register_rest_route()` without a `permission_callback` triggers `_doing_it_wrong()`. A health
endpoint is legitimately public — a monitor holds no credential and must not be throttled — so the
callback is written as `static fn(): bool => true` **with a comment saying it is deliberate.**
WordPress emits that notice specifically so that "public" has to be typed on purpose rather than
achieved by forgetting a line.

And public means **fingerprinting data leaks.** "WPGraphQL 2.1.0, ACF 6.3.6, Polylang 3.6.6" tells
an attacker exactly which CVE lists to read. So the response is split:

| Caller | Body |
|---|---|
| Anyone | `status`, `checkedAt`, and one **boolean per check** |
| Holding `X-BTT-App-Token` | the same, plus `detail`: expected versus actual versions, the DB error code, the schema exception message |

`status` and `checkedAt` are the same two keys `/api/health` returns
([Lesson 09.5](../09-nextjs-app-router/05-route-handlers-and-middleware.md)), on purpose: one
uptime monitor configuration, two tiers.

### 8. `release_command`: once, before traffic, and it can stop the deploy

Fly runs `release_command` in a **temporary machine from the new image**, before any machine
serving traffic is replaced, and **a non-zero exit aborts the deploy.** That is what makes it a
gate rather than a startup script.

```bash
wp core update-db && wp plugin activate --all && wp rewrite flush --hard && wp blame ensure-languages
```

Four commands. Each is necessary and each is idempotent, which matters because this runs on the
hundredth deploy as well as the first.

| Command | Why | Idempotent because |
|---|---|---|
| `wp core update-db` | the schema must match the core version in the image | a no-op when `db_version` already matches |
| `wp plugin activate --all` | activation state lives in the **database**, not the image. Lesson 03.1 §1 named this: a deactivated plugin means the `incident` post type does not exist and 55 rows become invisible | activating an active plugin exits 0 |
| `wp rewrite flush --hard` | rewrite rules are a serialised option, and `/wp-json` and `/graphql` depend on them | rebuilds from what is registered now |
| `wp blame ensure-languages` | Polylang's three languages are database rows, and 20 modules of routing assume they exist | **because [Lesson 20.1](../20-internationalization/01-multilingual-content-modeling.md) made it so, for this line.** Its second run prints "All 3 languages already exist. Nothing to do." and exits 0 |

That last row is not a coincidence. Lesson 20.1's WP-CLI command carries a docblock saying
"IDEMPOTENT BY CONTRACT. Module 24's Fly.io `release_command` runs this on every deploy" — a
promise written eleven lessons before the line that needs it.

**Which is why WP-CLI stays in the runtime image**, and this is the one place the "no dev tooling"
rule is narrower than it sounds. `wp` is a single PHAR, owned by root, mode 0755, not writable by
the process that serves requests, not reachable over HTTP, and its install and update subcommands
are inert because 24.1 sets `DISALLOW_FILE_MODS`. Composer, npm and Xdebug are genuinely absent.
Removing WP-CLI too would mean no `release_command`, which would mean activation state and
rewrite rules drift silently — a much worse trade, stated rather than glossed.

### 9. The deploy has no migration step, and that is Module 04's doing

The most valuable thing in this lesson is a step that does not exist.

ACF field groups can live in two places. In the database, as `acf-field-group` posts — which means
every release needs an export from staging and an import into production, in the right order,
by a person, with a whole class of "it works on staging" failures when it is skipped. Or in
**Local JSON**, as `.json` files inside the plugin, loaded from disk.

[Lesson 04.1](../04-acf-content-modeling-and-seeding/01-acf-field-groups-as-code.md) chose Local
JSON and recorded it as ADR 0004. The consequence lands exactly here: `includes/acf-json/*.json`
is copied into the image by the same `COPY` as the rest of the plugin, ACF reads it on the next
request, and there is nothing to migrate. **It is the highest-leverage architectural choice in
the pipeline, and it pays off in this lesson and nowhere else.** A decision made in Module 04, on
grounds of reviewability, removes an entire release step in Module 24.

The general form is worth naming because it will apply again: **configuration that lives in files
deploys with your code; configuration that lives in the database needs a migration.** Every time
you choose one over the other you are choosing whether the deploy has an extra step forever.

### 10. Storage: a volume pins you to one machine, so media offload is not optional

A Fly volume is attached to **one machine**. Scale to two and each gets its own volume, so an
upload that lands on machine A is a 404 on machine B, and `wp_get_attachment_url()` returns a URL
that works for half your visitors. There is no shared-filesystem option; that is the platform's
model, not a misconfiguration.

Which makes media offload to R2 or S3 **the correct answer from day one**, not an optional extra:

```
   VOLUME (one machine)                  OFFLOAD (any number of machines)
   ────────────────────                  ───────────────────────────────
   upload → /wp-content/uploads          upload → S3 API → R2 bucket
   served by Apache                      served from cdn.<domain>
   scale to 2 → uploads/ diverges        scale to 2 → identical, both stateless
   deploy → volume survives              media URLs stop naming the origin,
   snapshot RPO ~24h                     which also helps appendix 04 §6
```

Offload has a front-end consequence: media URLs move to a new host, so `next/image` needs that
host in `images.remotePatterns`. **That key is [Lesson 14.5](../14-blocks-as-data/05-media-images-and-next-image.md)'s
and this pass it is edited by [Lesson 24.2](02-security-hardening-next.md), which owns
`next.config.ts`.** This lesson describes the change and does not make it: one more entry in the
existing `images.remotePatterns` array for `cdn.<your-domain>`, `protocol: 'https'`, with the
localhost entry kept for development. Step 8 says exactly what to hand over.

**And the database.** Fly.io has **no managed MySQL.** Running MySQL as a Fly app with a volume is
fine for a course and for low-stakes production, and you should know precisely what you are
accepting: a single point of failure, no point-in-time recovery, and a snapshot RPO of roughly 24
hours — meaning a bad afternoon can cost a day of content.

| Option | Roughly | What you get |
|---|---|---|
| MySQL as a Fly app + 10 GB volume | ~$5–10/mo | what this course does. Snapshots, ~24h RPO, one machine |
| DigitalOcean Managed MySQL | from ~$15/mo | daily backups, point-in-time recovery, failover on the larger plans |
| PlanetScale | paid tiers from ~$39/mo | branching, online schema changes, no `ALTER TABLE` locks |
| Amazon RDS for MySQL | from ~$15/mo, plus storage and I/O | PITR to the second, multi-AZ, and an invoice that needs reading |

Prices move; the shape does not. Anything managed costs more per month than the volume and buys
you the one thing the volume cannot: a recovery point that is not yesterday. **Railway's managed
MySQL add-on is the cheapest way to get that here**, which is the honest reason `railway.json`
is in this lesson at all rather than as a curiosity.

---

## Task

### Step 1: Write `.dockerignore` before you write the `Dockerfile`

Same discipline as Lesson 02.2 Step 1, for the same reason: you confirm the exclusion before the
thing being excluded can reach a layer.

```dockerfile
# wordpress-headless/.dockerignore
# A SECURITY control first and a build-speed optimisation second. Everything
# not listed here is reachable by every COPY in the Dockerfile, and a layer is
# permanent — deleting a file in a later RUN does not remove it from the image.

# --- secrets. The only entries whose absence is a disclosure ---------
.env
.env.*
!.env.example
*.pem
*.key
*.p12
*.pfx
wp-salts.php
fly.secrets*

# --- artifacts the BUILD produces. A stale local copy must never win -
**/node_modules
**/vendor
wp-content/plugins/blame-the-tech-blocks/build

# --- tests and dev tooling. Modules 23 and 24.5 own these ------------
wp-content/plugins/blame-the-tech-core/tests
wp-content/plugins/blame-the-tech-core/phpunit.xml.dist
wp-content/plugins/blame-the-tech-core/phpcs.xml.dist
wp-content/plugins/blame-the-tech-core/phpstan.neon
wp-content/plugins/blame-the-tech-core/phpstan-baseline.neon

# --- state WordPress owns at run time, never in an image -------------
wp-content/uploads
wp-content/cache
wp-content/upgrade
wp-content/languages
wp-content/db-data
wp-content/debug.log

# --- local development only ------------------------------------------
docker-compose.yml
docker-compose.dev.yml
Dockerfile
.dockerignore
fixtures
*.sql
```

Two entries are deliberately **absent** and both would break the build if you added them out of
tidiness:

| Not excluded | Why |
|---|---|
| `wp-content/plugins/blame-the-tech-blocks/src` | the `assets` stage compiles it. Exclude it and `npm run build` has no input |
| `wp-config.php` | the runtime stage copies it. Step 3 has a callout about this file, and it is the sharpest thing in the lesson |

**Verify §1:**

- [ ] `.dockerignore` excludes `.env` **and** `.env.*`. One without the other leaves
      `.env.production` in the context.
- [ ] It does **not** exclude `wp-content/plugins/blame-the-tech-blocks/src` or `wp-config.php`.
- [ ] `git check-ignore -v .dockerignore` returns nothing — this file is tracked, unlike `.env`.

### Step 2: Write the `Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1
# wordpress-headless/Dockerfile
#
# Build from wordpress-headless/, which is the context:
#   docker build -t btt-wp:dev .
#
# Four stages; only `runtime` ships. Key Concept 2.

# Pin core by EXACT PATCH TAG. `6.8-php8.3-apache` is a MOVING tag — Module 02
# used it deliberately for development and it is wrong here. Resolve the digest
# once and pass it in CI as
#   --build-arg WP_IMAGE=wordpress:6.8.2-php8.3-apache@sha256:<digest>
# Get it with: docker buildx imagetools inspect wordpress:6.8.2-php8.3-apache
ARG WP_IMAGE=wordpress:6.8.2-php8.3-apache

# ----------------------------------------------------------- 1. vendor
FROM composer:2.8 AS vendor
WORKDIR /app
# The manifest and lock FIRST, so this layer caches until dependencies change.
# composer.lock is committed (Lesson 03.1 §4) precisely so this is reproducible:
# without it, two builds of the same commit resolve versions afresh.
COPY wp-content/plugins/blame-the-tech-core/composer.json \
     wp-content/plugins/blame-the-tech-core/composer.lock ./
RUN composer install --no-dev --optimize-autoloader --classmap-authoritative \
      --no-interaction --no-progress --no-scripts
# `.dockerignore` excludes **/vendor, so this COPY cannot overwrite what
# `composer install` just produced.
COPY wp-content/plugins/blame-the-tech-core/ ./
RUN composer dump-autoload --no-dev --optimize --classmap-authoritative \
 && test -f vendor/autoload.php \
 # --no-dev is WHY these are absent. Assert it rather than assume it: Pest,
 # Brain Monkey, wp-phpunit (23.4/23.5) and PHPStan (24.5) must not ship.
 && test ! -d vendor/pestphp \
 && test ! -d vendor/phpstan

# ----------------------------------------------------------- 2. assets
FROM node:22-bookworm-slim AS assets
WORKDIR /blocks
COPY wp-content/plugins/blame-the-tech-blocks/package.json \
     wp-content/plugins/blame-the-tech-blocks/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY wp-content/plugins/blame-the-tech-blocks/ ./
# build/ is GITIGNORED (Lesson 13.1), so a fresh clone has NO built blocks and
# this stage is the only thing that creates them. The assertion is the point:
# register_block_type() is guarded by is_dir(), so an unbuilt plugin registers
# ZERO blocks and does not error. Silent in the log, empty on the page.
RUN npm run build \
 && test -f build/incident-callout/block.json \
 && test "$(ls -1 build | wc -l)" -ge 6

# ---------------------------------------------------------- 3. plugins
FROM debian:bookworm-slim AS plugins
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /plugins

# Pinned, one line each: the version you verified locally, never "latest".
# downloads.wordpress.org/plugin/<slug>.<version>.zip is the same artifact
# `wp plugin install --version=` fetches, which is why the analogy table says
# plugins are installed at BUILD time.
ARG WPGRAPHQL_VERSION=2.1.0
ARG ACF_VERSION=6.3.6
ARG POLYLANG_VERSION=3.6.6
ARG YOAST_VERSION=24.0
RUN set -eu; \
    for spec in "wp-graphql:${WPGRAPHQL_VERSION}" \
                "advanced-custom-fields:${ACF_VERSION}" \
                "polylang:${POLYLANG_VERSION}" \
                "wordpress-seo:${YOAST_VERSION}"; do \
      slug="${spec%%:*}"; ver="${spec##*:}"; \
      curl -fsSL -o /tmp/p.zip \
        "https://downloads.wordpress.org/plugin/${slug}.${ver}.zip"; \
      unzip -q /tmp/p.zip -d /plugins; rm /tmp/p.zip; \
    done

# The four WPGraphQL companions are NOT on wordpress.org — Modules 14, 15, 19
# and 20 each recorded a GitHub release-asset URL. Those URLs are PUBLIC, so
# they are build args. A build arg is never a secret (appendix 04 §7); a public
# URL is not a secret, and that distinction is the whole rule.
ARG CONTENT_BLOCKS_ZIP
ARG WPGRAPHQL_ACF_ZIP
ARG JWT_ZIP
ARG WPGRAPHQL_POLYLANG_ZIP
ARG WPGRAPHQL_YOAST_ZIP
RUN set -eu; \
    for url in "$CONTENT_BLOCKS_ZIP" "$WPGRAPHQL_ACF_ZIP" "$JWT_ZIP" \
               "$WPGRAPHQL_POLYLANG_ZIP" "$WPGRAPHQL_YOAST_ZIP"; do \
      test -n "$url" || { echo "A plugin URL build arg is empty. Fail loudly."; exit 1; }; \
      curl -fsSL -o /tmp/p.zip "$url"; unzip -q /tmp/p.zip -d /plugins; rm /tmp/p.zip; \
    done \
 && test -d /plugins/wp-graphql && test -d /plugins/advanced-custom-fields

# WP-CLI, fetched here because this stage has curl. It ships in the runtime
# image on purpose — Key Concept 8. Root-owned and 0755: executable by the web
# process, NOT writable by it.
ARG WP_CLI_VERSION=2.11.0
RUN set -eu; \
    curl -fsSL -o /wp \
      "https://github.com/wp-cli/wp-cli/releases/download/v${WP_CLI_VERSION}/wp-cli-${WP_CLI_VERSION}.phar"; \
    chmod 0755 /wp

# ---------------------------------------------------------- 4. runtime
FROM ${WP_IMAGE} AS runtime

# Core comes from the base image. Copy it into place at BUILD time rather than
# letting the entrypoint do it on every boot: an immutable image should not be
# assembling itself at start-up, and doing it here is what makes wp-content
# contain exactly what the build put there.
RUN set -eux; \
    cp -a /usr/src/wordpress/. /var/www/html/; \
    rm -rf /var/www/html/wp-content/plugins/* /var/www/html/wp-content/themes/*; \
    mkdir -p /var/www/html/wp-content/plugins \
             /var/www/html/wp-content/themes \
             /var/www/html/wp-content/mu-plugins \
             /var/www/html/wp-content/uploads

# Production PHP configuration. Written here rather than as a repository file
# because Compose never mounts it — a separate file would have exactly one
# consumer, and that consumer is this image.
RUN set -eux; \
    { \
      echo 'opcache.enable=1'; \
      echo 'opcache.enable_cli=0'; \
      # 0, because the code CANNOT change inside an immutable image. This value
      # in development would show you stale code with no explanation, which is
      # why Module 02 left opcache off entirely. Key Concept 5.
      echo 'opcache.validate_timestamps=0'; \
      echo 'opcache.memory_consumption=192'; \
      echo 'opcache.interned_strings_buffer=16'; \
      echo 'opcache.max_accelerated_files=20000'; \
      # JIT OFF, deliberately. WordPress is I/O-bound on MySQL; the measured
      # gain is close to zero and the failure modes are the worst in PHP.
      echo 'opcache.jit=off'; \
      echo 'expose_php=Off'; \
      echo 'display_errors=Off'; \
      echo 'log_errors=On'; \
      # stderr, so the platform collects it. Lesson 24.3 owns where it lands,
      # and note that WP_DEBUG_LOG would send PHP output to
      # wp-content/debug.log instead — inside a container nobody can tail.
      echo 'error_log=/dev/stderr'; \
    } > /usr/local/etc/php/conf.d/zz-btt-production.ini
COPY uploads.ini /usr/local/etc/php/conf.d/uploads.ini

# A non-root process cannot bind a port below 1024. Two lines, and the
# container can no longer become root even if PHP is compromised. fly.toml's
# internal_port follows. Key Concept 4.
RUN set -eux; \
    sed -ri 's/^Listen 80$/Listen 8080/' /etc/apache2/ports.conf; \
    sed -ri 's!\*:80>!*:8080>!' /etc/apache2/sites-available/000-default.conf; \
    a2enmod rewrite headers expires; \
    grep -q '^Listen 8080$' /etc/apache2/ports.conf

# Our code. --chown at COPY time, so no boot-time chown is needed — which
# matters because the entrypoint's chown steps only run as uid 0 and this
# container does not.
COPY --chown=www-data:www-data wp-content/themes/btt-headless/ \
     /var/www/html/wp-content/themes/btt-headless/
COPY --chown=www-data:www-data wp-content/mu-plugins/ \
     /var/www/html/wp-content/mu-plugins/
COPY --chown=www-data:www-data wp-content/plugins/blame-the-tech-core/ \
     /var/www/html/wp-content/plugins/blame-the-tech-core/
COPY --from=vendor --chown=www-data:www-data /app/vendor/ \
     /var/www/html/wp-content/plugins/blame-the-tech-core/vendor/
COPY --chown=www-data:www-data \
     wp-content/plugins/blame-the-tech-blocks/blame-the-tech-blocks.php \
     /var/www/html/wp-content/plugins/blame-the-tech-blocks/
COPY --from=assets --chown=www-data:www-data /blocks/build/ \
     /var/www/html/wp-content/plugins/blame-the-tech-blocks/build/
COPY --from=plugins --chown=www-data:www-data /plugins/ \
     /var/www/html/wp-content/plugins/
COPY --from=plugins --chown=root:root /wp /usr/local/bin/wp
COPY --chown=www-data:www-data wp-config.php /var/www/html/wp-config.php

RUN set -eux; \
    chmod 0775 /var/www/html/wp-content/uploads; \
    # Fail the BUILD, not the deploy, if wp-config.php did not arrive. See the
    # callout below — this is the check that catches a fresh CI clone.
    test -f /var/www/html/wp-config.php; \
    test -f /var/www/html/wp-content/plugins/blame-the-tech-core/vendor/autoload.php; \
    test -d /var/www/html/wp-content/plugins/blame-the-tech-blocks/build; \
    test -x /usr/local/bin/wp; \
    # The three things the NEGATIVE checks assert. Assert them at build time
    # too, because a runtime discovery is an incident.
    ! command -v composer; \
    ! command -v npm; \
    ! php -m | grep -qi xdebug

USER www-data
EXPOSE 8080
# ENTRYPOINT and CMD are the base image's (docker-entrypoint.sh /
# apache2-foreground) and are correct as they are. No Docker HEALTHCHECK: Fly
# gates the deploy on [[http_service.checks]] in fly.toml, which is what
# Step 5 configures, and a second definition would drift.
```

> **The `wp-config.php` problem, and it is real.** The runtime stage copies
> `wordpress-headless/wp-config.php` — the 12-factor file
> [Lesson 02.4](../02-docker-mysql-and-infrastructure/04-wp-config-for-headless.md) wrote, whose
> own Verification proves it holds **no literal value** and reads everything through `getenv()`.
> But Lesson 02.4 Step 1 also confirmed the file is **gitignored**, which means it exists on your
> machine and **not in a fresh CI clone**. So this build succeeds locally and fails in CI with
> `"wp-config.php": not found` — the exact "works on my machine" failure this module exists to
> remove, arriving from the course's own configuration. A file containing only `getenv()` calls
> has no reason to be gitignored, so the correction is to **track it** and remove the
> `wordpress-headless/wp-config.php` line from the root `.gitignore`. That is a change to a file
> this lesson does not own; make it deliberately, and keep the `test -f` above either way, because
> a build that fails loudly beats an image that boots into WordPress's installer.

**Verify §2:**

- [ ] `docker build -t btt-wp:dev .` succeeds, with `--build-arg` values for the five plugin URLs.
- [ ] The build fails, with your own message, if you pass an empty `CONTENT_BLOCKS_ZIP`. Try it
      once. A silently missing plugin is a schema without `blocksJSON`.
- [ ] `docker image inspect btt-wp:dev --format '{{.Config.User}}'` prints `www-data`.
- [ ] `docker image ls btt-wp:dev` is under roughly 700 MB. Much larger means a stage leaked —
      check for a `COPY . .` you added.

### Step 3: Write `includes/health.php`

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/health.php
<?php
/**
 * GET /wp-json/btt/v1/health — the check Fly.io's blue-green deploy gates on.
 *
 * EXTENDS an existing namespace. Lesson 17.2 registered
 * /wp-json/btt/v1/preview/verify, so `btt/v1` is not new here. The route is
 * reachable because Lesson 02.4's theme redirect passes /wp-json/* through
 * untouched — behind that 302 this would report the FRONT END's health.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

use Throwable;
use WPGraphQL;
use WP_REST_Request;
use WP_REST_Response;

defined( 'ABSPATH' ) || exit;

/**
 * Plugin directory slug => the version this image was built to run.
 *
 * Keyed by DIRECTORY, not by main-file path, because the main file name is a
 * third party's choice and changes between releases. Paste your own versions
 * from `wp plugin list --fields=name,version`; the ones below are indicative.
 *
 * @var array<string, string>
 */
const HEALTH_EXPECTED_PLUGINS = array(
	'wp-graphql'                    => '2.1.0',
	'advanced-custom-fields'        => '6.3.6',
	'polylang'                      => '3.6.6',
	'wp-graphql-content-blocks'     => '4.5.0',
	'wp-graphql-jwt-authentication' => '0.7.0',
);

/**
 * Is the database answering, with the right credentials and table prefix?
 *
 * A real read, not `check_connection()`: wrong credentials, a full volume and
 * a MySQL app that never started all fail here, and none of them fail a TCP
 * connect. The table name comes from $wpdb and the value is bound with
 * prepare() — there is no string concatenation in this file.
 *
 * @return array{ok: bool, detail: string}
 */
function health_database(): array {
	global $wpdb;

	$suppress = $wpdb->suppress_errors( true );
	$value    = $wpdb->get_var(
		$wpdb->prepare(
			"SELECT option_value FROM {$wpdb->options} WHERE option_name = %s LIMIT 1",
			'siteurl'
		)
	);
	$wpdb->suppress_errors( $suppress );

	if ( is_string( $value ) && '' !== $value ) {
		return array(
			'ok'     => true,
			'detail' => 'siteurl read from ' . $wpdb->options,
		);
	}

	return array(
		'ok'     => false,
		// $wpdb->last_error is a MySQL message, so it is DETAIL and never
		// public. See the split in rest_health().
		'detail' => 'read failed: ' . ( $wpdb->last_error ?: 'no rows' ),
	);
}

/**
 * Is every expected plugin active, at the expected version?
 *
 * Catches the deploy that ran an image built before a pin changed — the one
 * failure mode a database check and a GraphQL check both miss.
 *
 * @return array{ok: bool, detail: string}
 */
function health_plugins(): array {
	// get_plugins() lives in wp-admin and is NOT loaded on a REST request.
	require_once ABSPATH . 'wp-admin/includes/plugin.php';

	$installed = get_plugins();
	$problems  = array();

	foreach ( HEALTH_EXPECTED_PLUGINS as $slug => $expected ) {
		$file = '';
		foreach ( array_keys( $installed ) as $candidate ) {
			if ( 0 === strpos( (string) $candidate, $slug . '/' ) ) {
				$file = (string) $candidate;
				break;
			}
		}

		if ( '' === $file ) {
			$problems[] = "{$slug}: not installed";
			continue;
		}
		if ( ! is_plugin_active( $file ) ) {
			// `wp plugin activate --all` in release_command exists for exactly
			// this: activation state is a DATABASE row, not an image fact.
			$problems[] = "{$slug}: installed but inactive";
			continue;
		}
		$actual = (string) ( $installed[ $file ]['Version'] ?? '' );
		if ( $actual !== $expected ) {
			$problems[] = "{$slug}: expected {$expected}, found {$actual}";
		}
	}

	return array(
		'ok'     => array() === $problems,
		'detail' => array() === $problems
			? count( HEALTH_EXPECTED_PLUGINS ) . ' plugins at pinned versions'
			: implode( '; ', $problems ),
	);
}

/**
 * Does the GraphQL type registry still build?
 *
 * This is what "introspection healthy" means here: the schema assembles and
 * has a query type. It deliberately does NOT run an `__schema` query, because
 * Lesson 24.1 turns public introspection off in production and a health check
 * must not depend on a setting it is not testing.
 *
 * A broken registration surfaces as HTTP 200 with an `errors` array, so
 * nothing else in the stack would notice it.
 *
 * Reasoned from WPGraphQL's own class, not executed in this repository.
 *
 * @return array{ok: bool, detail: string}
 */
function health_graphql(): array {
	if ( ! class_exists( WPGraphQL::class ) ) {
		return array(
			'ok'     => false,
			'detail' => 'WPGraphQL class not loaded',
		);
	}

	try {
		$schema = WPGraphQL::get_schema();
	} catch ( Throwable $e ) {
		return array(
			'ok'     => false,
			'detail' => 'schema build threw: ' . $e->getMessage(),
		);
	}

	return null === $schema->getQueryType()
		? array(
			'ok'     => false,
			'detail' => 'schema built with no query type',
		)
		: array(
			'ok'     => true,
			'detail' => 'type registry built',
		);
}

/**
 * The route callback. Two response shapes, one status contract.
 */
function rest_health( WP_REST_Request $request ): WP_REST_Response {
	$checks = array(
		'database' => health_database(),
		'plugins'  => health_plugins(),
		'graphql'  => health_graphql(),
	);

	$healthy = ! in_array( false, array_column( $checks, 'ok' ), true );

	// The same two keys /api/health returns (Lesson 09.5), on purpose: one
	// uptime-monitor configuration, two tiers. Never rename either.
	$body = array(
		'status'    => $healthy ? 'ok' : 'degraded',
		'checkedAt' => gmdate( 'c' ),
		'checks'    => array_map(
			static fn( array $check ): bool => $check['ok'],
			$checks
		),
	);

	/*
	 * DETAIL IS FINGERPRINTING DATA. "WPGraphQL 2.1.0, ACF 6.3.6" tells an
	 * attacker which CVE list to read, and a MySQL error message names paths
	 * and table prefixes. So the public body carries one boolean per check and
	 * nothing else; the detail requires the app token, compared with
	 * hash_equals() by Lesson 06.2's helper. Check that helper's signature in
	 * includes/graphql/app-token.php — it takes the presented token.
	 */
	if ( app_token_matches( (string) $request->get_header( 'x_btt_app_token' ) ) ) {
		$body['detail'] = array_map(
			static fn( array $check ): string => $check['detail'],
			$checks
		);
	}

	// 503 is what a load balancer reads as "do not send me traffic", and it is
	// what makes Fly's blue-green deploy refuse to shift traffic.
	$response = new WP_REST_Response( $body, $healthy ? 200 : 503 );
	$response->header( 'Cache-Control', 'no-store' );

	return $response;
}

add_action(
	'rest_api_init',
	static function (): void {
		register_rest_route(
			'btt/v1',
			'/health',
			array(
				'methods'             => 'GET',
				'callback'            => __NAMESPACE__ . '\\rest_health',
				/*
				 * DELIBERATELY PUBLIC, and typed on purpose. A monitor holds no
				 * credential and must not be rate limited — the same reasoning
				 * Lesson 15.5's entry-point matrix records for GET /api/health.
				 * register_rest_route() without this key triggers
				 * _doing_it_wrong(), which is WordPress making you say "public"
				 * out loud instead of achieving it by forgetting a line.
				 */
				'permission_callback' => '__return_true',
			)
		);
	}
);
```

**Verify §3:**

- [ ] `grep -c 'permission_callback' includes/health.php` is `1`. A zero is a `_doing_it_wrong()`
      notice in your log and an endpoint whose publicness was an accident.
- [ ] `grep -c 'prepare(' includes/health.php` is `1` and `grep -c '\$_GET\|\$_POST'` is `0`.
- [ ] The public branch cannot leak a version. `grep -n "'detail'" includes/health.php` shows the
      only assignment into `$body` sitting **inside** the `app_token_matches()` block.

### Step 4: Add it to `Plugin::INCLUDES`, without dropping an entry

`INCLUDES` has grown across eleven lessons and every entry is required and in order. **Lesson
24.3 is adding `includes/observability.php` in the same module**, so this reprint carries both new
lines and the whole existing list. Reproduce it in full and count it — a reprint that silently
drops an entry is a defect this course has already shipped once, and the symptom is a post type
that no longer exists and 55 rows that become invisible to every query.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
	private const INCLUDES = array(
		'includes/post-types.php',                          // Lesson 03.2
		'includes/taxonomies.php',                          // Lesson 03.3
		'includes/statuses.php',                            // Lesson 03.4
		'includes/admin/incident-columns.php',              // Lesson 03.4
		'includes/admin/moderation-queue.php',              // Lesson 16.4
		'includes/roles.php',                               // Lesson 03.5
		'includes/acf.php',                                 // Lesson 04.1
		'includes/Leads.php',                               // Lesson 16.3
		'includes/graphql/enums.php',                       // Lesson 06.1
		'includes/graphql/fields.php',                      // Lesson 06.1
		'includes/graphql/app-token.php',                   // Lesson 06.2
		'includes/graphql/mutation-create-incident.php',    // Lesson 06.2
		'includes/graphql/mutation-register-developer.php', // Lesson 06.2
		'includes/graphql/mutation-submit-hobt-lead.php',   // Lesson 06.2
		'includes/graphql/performance.php',                 // Lesson 06.4
		'includes/graphql/mutation-verify-developer.php',   // Lesson 15.3
		'includes/Preview.php',                             // Lesson 17.2
		'includes/Revalidate.php',                          // Lesson 18.3
		'includes/polylang.php',                            // Lesson 20.1
		'includes/observability.php',                        // Lesson 24.3
		'includes/health.php',                              // Lesson 24.6
	);
```

**Twenty-one entries**, and here is the derivation so you can check it against your own file
rather than trusting a reprint: Lesson 16.3's was the last complete printing at **15**; Lesson
16.4 inserted `moderation-queue.php` after `incident-columns.php` → **16**; Lessons 17.2, 18.3
and 20.1 each appended one → **19**; Lesson 24.3 appends `observability.php` → **20**; this
lesson appends `health.php` → **21**. If your count differs, your file is the authority — find the
entry the reprint above is missing and tell nobody it was fine.

`health.php` must come **after** `includes/graphql/app-token.php`, because it calls
`app_token_matches()`. It does: it is last.

**Verify §4:**

```bash
cd wordpress-headless
grep -c "^		'includes/" wp-content/plugins/blame-the-tech-core/includes/Plugin.php
docker compose run --rm wpcli wp plugin deactivate blame-the-tech-core
docker compose run --rm wpcli wp plugin activate blame-the-tech-core
docker compose logs --tail=40 wordpress | grep -c 'Failed opening required'
curl -s http://localhost:8080/wp-json/btt/v1/health | jq
```

- [ ] The `grep -c` prints `21`.
- [ ] The plugin activates and `Failed opening required` count is `0`. A fatal here is almost
      always a typo in a path you just added.
- [ ] `jq` shows `status`, `checkedAt` and three booleans under `checks` — and **no** `detail`.
- [ ] Locally, `plugins` will be `false` until the pinned versions in `HEALTH_EXPECTED_PLUGINS`
      match what your dev stack actually has. Fix the constant, not the check.

### Step 5: Write `fly.toml`

```toml
# wordpress-headless/fly.toml
# No `image` key: the image is chosen AT DEPLOY TIME, by SHA, so this file
# never needs editing to ship or to roll back.
app = 'btt-wp'
primary_region = 'ams'

[build]
  # Deliberately empty. `fly deploy` must not build — CI builds, scans and
  # pushes, and the deploy pulls an artifact that already passed every gate.

[deploy]
  # Runs ONCE, in a temporary machine from the NEW image, BEFORE any machine
  # serving traffic is replaced. A non-zero exit ABORTS the deploy. Four
  # commands, each idempotent, each necessary — Key Concept 8.
  release_command = 'wp core update-db && wp plugin activate --all && wp rewrite flush --hard && wp blame ensure-languages'
  strategy = 'bluegreen'

[env]
  # NON-SECRET CONFIGURATION ONLY. Every credential arrives through
  # `fly secrets set`, which is encrypted at rest and injected at boot.
  # appendix 04 §7 is the rule; this file is the place people break it.
  WP_ENVIRONMENT_TYPE = 'production'
  WORDPRESS_DB_HOST = 'btt-db.internal:3306'
  WORDPRESS_DB_NAME = 'btt'
  WORDPRESS_DB_USER = 'btt'
  WORDPRESS_TABLE_PREFIX = 'wp_'
  WP_HOME = 'https://wp.blamethe.tech'
  WP_SITEURL = 'https://wp.blamethe.tech'
  BTT_FRONTEND_URL = 'https://blamethe.tech'
  # Off in production. Module 02 put these in docker-compose.dev.yml, so there
  # is nothing here to remember to remove.
  WORDPRESS_DEBUG = '0'

[http_service]
  # 8080, because the container runs as www-data and cannot bind 80.
  internal_port = 8080
  force_https = true
  # A CMS that sleeps returns a cold first byte to a revalidation request, and
  # ISR regeneration is exactly the traffic that arrives after a quiet hour.
  auto_stop_machines = false
  min_machines_running = 1

  [[http_service.checks]]
    # THIS is what gates blue-green. GET / would return 200 from Apache while
    # WordPress cannot reach MySQL — Key Concept 7.
    path = '/wp-json/btt/v1/health'
    method = 'GET'
    interval = '15s'
    timeout = '5s'
    grace_period = '30s'

[[mounts]]
  # Pins this app to ONE machine. Key Concept 10: with media offloaded this
  # holds nothing that matters, and it stays for a local-fallback upload path
  # and for nothing else.
  source = 'btt_wp_data'
  destination = '/var/www/html/wp-content/uploads'

[[vm]]
  size = 'shared-cpu-1x'
  memory = '1gb'
```

The secrets, set once, from your shell and never from a file:

```bash
fly secrets set \
  WORDPRESS_DB_PASSWORD="$WORDPRESS_DB_PASSWORD" \
  GRAPHQL_JWT_AUTH_SECRET_KEY="$GRAPHQL_JWT_AUTH_SECRET_KEY" \
  BTT_APP_TOKEN="$BTT_APP_TOKEN" \
  BTT_REVALIDATE_SECRET="$BTT_REVALIDATE_SECRET" \
  BTT_PREVIEW_SHARED_SECRET="$BTT_PREVIEW_SHARED_SECRET" \
  BTT_LEAD_IP_HMAC_KEY="$BTT_LEAD_IP_HMAC_KEY"

fly secrets list
```

**Verify §5:**

- [ ] `fly secrets list` prints **names and digests, never values.** If you can read a value, you
      are not looking at `fly secrets list`.
- [ ] `grep -icE 'password|secret|token' fly.toml` returns `1` — the word `secrets` in the comment
      about `fly secrets set`, and no assignment.
- [ ] `grep -c 'image' fly.toml` returns `0` outside the `[build]` comment. An image pinned in
      this file means a rollback is a commit.

### Step 6: Write `.github/workflows/deploy-wp.yml`

```yaml
# .github/workflows/deploy-wp.yml
# A SEPARATE workflow, not an addition to ci.yml. It runs only after CI
# succeeded on `main`, and it never builds: `_docker-wp.yml` (Lesson 24.4)
# already built, scanned and pushed the image this job deploys.
name: Deploy WordPress

on:
  workflow_run:
    workflows: ['CI']
    types: [completed]
    branches: [main]
  # The rollback path. One input, one command, no rebuild.
  workflow_dispatch:
    inputs:
      image_sha:
        description: 'Full 40-character commit SHA of the image to deploy'
        required: true

permissions:
  contents: read

concurrency:
  # Two deploys racing on one machine is how you get a half-applied
  # release_command. One at a time, and do not cancel a running deploy —
  # cancelling mid-release_command is the worst possible moment.
  group: deploy-wp
  cancel-in-progress: false

jobs:
  deploy:
    # Environment protection rules live here: required reviewers, a wait
    # timer, and the FLY_API_TOKEN scoped to this environment only.
    environment: production
    runs-on: ubuntu-latest
    if: >
      github.event_name == 'workflow_dispatch' ||
      github.event.workflow_run.conclusion == 'success'
    steps:
      - name: Resolve the tag, and refuse anything that is not a SHA
        id: tag
        env:
          SHA: ${{ inputs.image_sha || github.event.workflow_run.head_sha }}
          OWNER: ${{ github.repository_owner }}
        run: |
          # `latest` is a name that means a different thing every day. A deploy
          # you cannot reproduce is a deploy you cannot roll back to.
          case "$SHA" in
            [0-9a-f]*) ;;
            *) echo "::error::Not a commit SHA: $SHA"; exit 1 ;;
          esac
          test "${#SHA}" -eq 40 || { echo "::error::Need the full 40-char SHA"; exit 1; }
          echo "image=ghcr.io/${OWNER}/btt-wp:${SHA}" >> "$GITHUB_OUTPUT"

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Copy the manifest to Fly's registry — no rebuild
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
          IMAGE: ${{ steps.tag.outputs.image }}
        run: |
          # `flyctl deploy --image` needs credentials for a private registry,
          # and GHCR is private because a public image publishes your exact
          # plugin set (appendix 04 §6). `imagetools create` copies the MANIFEST
          # by digest: same bytes, no rebuild. Lesson 24.7 makes the same
          # argument for the front end — you promote an artifact, you do not
          # produce a new one.
          # Reasoned, not executed: confirm the flag set against
          # `docker buildx imagetools create --help` for your Buildx version.
          flyctl auth docker
          docker buildx imagetools create \
            --tag "registry.fly.io/btt-wp:${GITHUB_SHA}" "$IMAGE"

      - name: Deploy
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
        working-directory: wordpress-headless
        run: |
          # release_command runs first and aborts this command on a non-zero
          # exit, so a failed `wp core update-db` never takes traffic.
          flyctl deploy \
            --image "registry.fly.io/btt-wp:${GITHUB_SHA}" \
            --strategy bluegreen

      - name: Prove the deployed machine is honest
        run: |
          curl -fsS https://wp.blamethe.tech/wp-json/btt/v1/health | tee /tmp/health.json
          jq -e '.status == "ok"' /tmp/health.json
          # NOT `.checks.database` alone: a 200 with one false boolean is a
          # degraded site that answered politely.
          jq -e '[.checks[]] | all' /tmp/health.json
```

**Verify §6:**

- [ ] `grep -c 'latest' .github/workflows/deploy-wp.yml` is `0`.
- [ ] `grep -c 'docker build\|flyctl deploy --dockerfile' .github/workflows/deploy-wp.yml` is `0`.
      This workflow deploys; it does not build.
- [ ] `environment: production` is present, and that environment holds `FLY_API_TOKEN` with at
      least one required reviewer.

### Step 7: Media offload, and the `next.config.ts` change this lesson does not make

Offload is configured on the WordPress side by a plugin reading `BTT_S3_*` from the environment
(appendix 04 §9 reserves those names for this module), pinned in the `plugins` stage like every
other third-party plugin, with the bucket credentials arriving through `fly secrets set` and
never through a build arg.

```bash
fly secrets set \
  BTT_S3_BUCKET="$BTT_S3_BUCKET" \
  BTT_S3_REGION="$BTT_S3_REGION" \
  BTT_S3_ENDPOINT="$BTT_S3_ENDPOINT" \
  BTT_S3_KEY="$BTT_S3_KEY" \
  BTT_S3_SECRET="$BTT_S3_SECRET" \
  BTT_S3_CDN_HOST="cdn.blamethe.tech"
```

The front end then needs the CDN host in `next/image`'s `remotePatterns`, and **this lesson does
not make that edit.** `images` is [Lesson 14.5](../14-blocks-as-data/05-media-images-and-next-image.md)'s
key in `next.config.ts`, and in this pass `next.config.ts` is owned by
[Lesson 24.2](02-security-hardening-next.md). The hand-over, precisely:

| | |
|---|---|
| File | `next-app/next.config.ts` |
| Key | the existing `images.remotePatterns` array — **one entry appended**, nothing replaced |
| Entry | `{ protocol: 'https', hostname: 'cdn.blamethe.tech' }` |
| Keep | the existing `localhost` entry. Development still serves media from `:8080` |
| Applied by | **Lesson 24.2.** Not here |
| Symptom if forgotten | every image 400s with `url parameter is not allowed`, in production only |

`railway.json` is the alternative target, **using the same image**. It exists because Railway has
a managed MySQL add-on and Fly does not, which is the one thing Key Concept 10 says the volume
cannot give you.

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "deploy": {
    "healthcheckPath": "/wp-json/btt/v1/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "numReplicas": 1,
    "preDeployCommand": [
      "wp core update-db && wp plugin activate --all && wp rewrite flush --hard && wp blame ensure-languages"
    ]
  }
}
```

That is `wordpress-headless/railway.json`. `preDeployCommand` is Railway's `release_command`: it
runs once before the new deployment receives traffic and a non-zero exit fails the deploy.
Reasoned from Railway's configuration reference, not executed — verify the key name for your
account before you rely on it, because getting this wrong turns a gate into a startup script.

### Step 8: The core-upgrade procedure, in `docs/architecture.md`

Rollback is a command you already have — `workflow_dispatch` with a previous SHA, Step 6. A core
upgrade is not, because it is the one operation on the other side of the forward-only boundary.
[Lesson 24.7](07-deploying-next-to-vercel-and-environments.md) writes the 3am runbook for both
tiers; this section is the architectural boundary, so it goes where the other decisions live.

```markdown
<!-- docs/architecture.md — append. Lesson 01.3 created this file. -->

## The forward-only boundary (Lesson 24.6)

Two kinds of change ship through the same pipeline and only one of them reverses.

| Change | Rollback | Mechanism |
|---|---|---|
| PHP, blocks, theme, plugin pins | seconds, exact | redeploy the previous image SHA |
| `wp core update-db` | **none** | forward-only. No `--downgrade-db` exists |
| An ACF field group | seconds | it is a JSON file in the image (ADR 0004) |
| A `dbDelta()` change to `wp_btt_leads` | forward-only | write migrations additively |

**Core upgrades are a manual workflow, and this is the order.** Never as part of a feature deploy.

1. Read the release notes. Decide whether this is a patch or a schema change.
2. `fly volumes snapshots create <volume-id>`, and wait for it to complete. This is the only
   recovery point that exists.
3. Bump the `WP_IMAGE` tag in `Dockerfile`, in a pull request whose **only** content is that
   line. Record the new digest.
4. Merge, let CI build and scan, deploy. `release_command` runs `wp core update-db`.
5. Verify `/wp-json/btt/v1/health` and one GraphQL query before you close the window.
6. If it is wrong: **the image rolls back and the database does not.** Restore the snapshot, then
   deploy the previous SHA — in that order, because the old image cannot read the new schema.

Step 6 is the whole reason step 2 is not optional.
```

**Verify §8:**

- [ ] `grep -c 'forward-only boundary' docs/architecture.md` is `1`, and Lesson 01.3's original
      sections are still above yours.
- [ ] You know your volume ID: `fly volumes list`. A snapshot procedure that starts with "find the
      volume" is a procedure nobody runs at 3am.

```bash
git add -A
git commit -m "feat(docker): production image, Fly.io deploy and the health endpoint"
```

---

## Verification

```bash
cd wordpress-headless

# 1. Build it. Five URL build args, because five plugins are not on wordpress.org.
docker build -t btt-wp:dev \
  --build-arg CONTENT_BLOCKS_ZIP="$BTT_CONTENT_BLOCKS_ZIP" \
  --build-arg WPGRAPHQL_ACF_ZIP="$BTT_WPGQL_ACF_ZIP" \
  --build-arg JWT_ZIP="$BTT_JWT_ZIP" \
  --build-arg WPGRAPHQL_POLYLANG_ZIP="$BTT_WPGQL_POLYLANG" \
  --build-arg WPGRAPHQL_YOAST_ZIP="$BTT_WPGQL_YOAST_ZIP" .
# Expected: a successful build. The in-build `test` assertions are the point:
#           the image cannot exist without wp-config.php, vendor/autoload.php,
#           a built blocks directory and no Composer.

# 2. NEGATIVE — no secret in any layer's build history
docker history --no-trunc btt-wp:dev | grep -ciE 'password|secret|token|AKIA'
# Expected: 0. A hit means a value went in as a build ARG, which is permanent:
#           layers are additive and `docker history` is readable by anyone who
#           can pull the image. appendix 04 §7 forbids it for this reason.

# 3. NEGATIVE — no env file anywhere in the filesystem, not just the last layer
docker create --name btt-probe btt-wp:dev >/dev/null
docker export btt-probe | tar -t | grep -cE '(^|/)\.env'
docker rm btt-probe >/dev/null
# Expected: 0. This is the check that proves .dockerignore, and it is not
#           `test -f`: a file deleted in a later RUN is still in the image.
#           A .dockerignore you did not test is a .env in a public image.

# 4. NEGATIVE — the container does not run as root
docker run --rm --entrypoint id btt-wp:dev -u
# Expected: 33  (www-data in the Debian wordpress image).
#           A 0 means `USER www-data` is missing, and every PHP RCE is a
#           container root.

# 5. NEGATIVE ×3 — no Composer, no npm/node, no Xdebug in the runtime
docker run --rm --entrypoint sh btt-wp:dev -c \
  'command -v composer || echo "no composer"; command -v npm || echo "no npm"; command -v node || echo "no node"'
# Expected: three "no ..." lines. Each of those tools is a code fetcher with
#           network access, and Lesson 24.1 already disabled the WordPress
#           route to installing code.
docker run --rm --entrypoint php btt-wp:dev -m | grep -ci xdebug
# Expected: 0. Xdebug in production is a remote-debugging port and a 3x
#           slowdown.

# 6. WP-CLI IS present, and that is deliberate — Key Concept 8
docker run --rm --entrypoint sh btt-wp:dev -c \
  'ls -l /usr/local/bin/wp; test -w /usr/local/bin/wp && echo WRITABLE || echo "not writable by www-data"'
# Expected: root-owned, mode -rwxr-xr-x, and "not writable by www-data".
#           WRITABLE means a compromised PHP process can replace the binary
#           that release_command runs as part of the next deploy.

# 7. NEGATIVE — opcache does not stat the filesystem
docker run --rm --entrypoint php btt-wp:dev -r \
  'printf("validate_timestamps=%s enable=%s jit=%s\n", ini_get("opcache.validate_timestamps"), ini_get("opcache.enable"), ini_get("opcache.jit"));'
# Expected: validate_timestamps=0 enable=1 jit=off
#           A 1 on the first value means every request stats ~400 files for a
#           change that cannot happen. Key Concept 5.
docker run --rm --entrypoint php btt-wp:dev -r 'printf("expose_php=%s display_errors=%s\n", ini_get("expose_php"), ini_get("display_errors"));'
# Expected: expose_php= display_errors=   (both Off, printed as empty)

# 8. The build stages did their jobs, and the dev dependencies did not ship
docker run --rm --entrypoint sh btt-wp:dev -c \
  'ls /var/www/html/wp-content/plugins/blame-the-tech-blocks/build | wc -l'
# Expected: 6 or more. A 0 means the assets stage was skipped and the plugin
#           registers ZERO blocks — silently, because register_block_type() is
#           guarded by is_dir(). Every existing post renders nothing.
docker run --rm --entrypoint sh btt-wp:dev -c \
  'test -d /var/www/html/wp-content/plugins/blame-the-tech-core/vendor/pestphp && echo LEAKED || echo "dev deps absent"'
# Expected: dev deps absent  — this is what --no-dev bought you

# 9. Core is the version you pinned, and the tag is not a moving one
docker run --rm --entrypoint sh btt-wp:dev -c \
  'grep -m1 "wp_version =" /var/www/html/wp-includes/version.php'
# Expected: 6.8.2 (or whatever you pinned). Not "6.8", which is a tag that
#           means a different WordPress next month.
grep -c "wordpress:6.8-php8.3-apache" Dockerfile
# Expected: 0 — that is Module 02's development tag

# 10. Trivy, with the qualifier from Lesson 24.5 Key Concept 8
trivy image btt-wp:dev --severity HIGH,CRITICAL --ignore-unfixed
# Expected: no findings. Without --ignore-unfixed you will see base-image CVEs
#           with no fixed version, which is why the GATE carries the flag and
#           the nightly scan does not.

# 11. The health route answers, and its public body leaks nothing
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait
curl -s http://localhost:8080/wp-json/btt/v1/health | jq -r 'keys | join(",")'
# Expected: checkedAt,checks,status
curl -s http://localhost:8080/wp-json/btt/v1/health | jq -r '.checks | keys | join(",")'
# Expected: database,graphql,plugins  — three booleans, no versions

# 12. NEGATIVE — the public body carries no version string at all
curl -s http://localhost:8080/wp-json/btt/v1/health | grep -cE '[0-9]+\.[0-9]+\.[0-9]+'
# Expected: 0. A version number here names the CVE list to read. The `detail`
#           key exists and requires the app token:
curl -s -H "X-BTT-App-Token: $BTT_APP_TOKEN" \
  http://localhost:8080/wp-json/btt/v1/health | jq -e '.detail | length'
# Expected: 3

# 13. NEGATIVE — a route that is public by ACCIDENT logs a notice
docker compose logs --tail=200 wordpress | grep -c '_doing_it_wrong\|doing_it_wrong'
# Expected: 0. If this is non-zero, `permission_callback` is missing from a
#           route you added — WordPress makes "public" something you type.

# 14. NEGATIVE — the check reports degraded, with a 503, when a check fails.
#     A pinned version that does not match is the honest way to prove this:
#     it leaves WordPress alive and one boolean false, which is the case a
#     load balancer must react to.
docker compose run --rm wpcli wp plugin list --fields=name,version | head
# Expected: your real versions. Now edit HEALTH_EXPECTED_PLUGINS so one is
#           wrong by a patch, reload, and:
curl -s -o /tmp/h.json -w '%{http_code}\n' http://localhost:8080/wp-json/btt/v1/health
jq -r '.status, .checks.plugins' /tmp/h.json
# Expected: 503, then "degraded" and false. Put the version back afterwards.

# 15. NEGATIVE — and when the database is gone, it still says "do not send
#     traffic", though not in the way you might expect
docker compose stop db
curl -s -o /tmp/h2.json -w '%{http_code}\n' http://localhost:8080/wp-json/btt/v1/health
head -c 120 /tmp/h2.json
docker compose start db
# Expected: a 5xx. Be honest about which: WordPress calls wp_die() from
#           require_wp_db() long before REST routing exists, so you will most
#           likely get a 500 with an HTML body, not the 503 JSON. Both mean
#           "do not send traffic" — which is exactly why fly.toml's check
#           asserts on the STATUS CODE and not on the body. The JSON branch
#           earns its place on the case MySQL answers and the read still
#           fails: wrong table prefix, revoked grants, a full volume.

# 16. NEGATIVE — release_command aborts rather than deploying half a release
docker run --rm -e WORDPRESS_DB_HOST=nope:3306 --entrypoint wp btt-wp:dev \
  core update-db --path=/var/www/html; echo "exit=$?"
# Expected: "Error establishing a database connection" and a NON-ZERO exit.
#           Because release_command chains with &&, the three commands after
#           it never run, and Fly aborts the deploy before any machine takes
#           traffic. That is the difference between release_command and a
#           startup script.

# 17. Plugin::INCLUDES did not lose an entry
grep -c "^		'includes/" wp-content/plugins/blame-the-tech-core/includes/Plugin.php
# Expected: 21
docker compose run --rm wpcli wp plugin activate blame-the-tech-core
docker compose logs --tail=40 wordpress | grep -c 'Failed opening required'
# Expected: 0
docker compose run --rm wpcli wp eval \
  'echo function_exists("Blame\\Core\\rest_health") ? "loaded" : "NOT LOADED", PHP_EOL;'
# Expected: loaded

# 18. NEGATIVE — the deploy workflow deploys a SHA and never `latest`
grep -c 'latest' ../.github/workflows/deploy-wp.yml
# Expected: 0. `latest` is a name that resolves differently every day, so a
#           rollback to "the previous latest" is not a thing that exists.
grep -c 'docker build' ../.github/workflows/deploy-wp.yml
# Expected: 0 — CI builds; this workflow only deploys.

# 19. NEGATIVE — fly.toml holds configuration, never a credential
grep -icE '(password|secret|token|key)[[:space:]]*=' fly.toml
# Expected: 0. Every assignment in [env] is non-secret. The credentials arrive
#           through `fly secrets set`, encrypted at rest, injected at boot.
grep -c "internal_port = 8080" fly.toml
# Expected: 1 — it must match the non-root Apache port, or every health check
#           times out and blue-green never promotes.
```

Check 15 is the one to sit with. The first instinct is to treat "the JSON says degraded" as the
contract, and the honest finding is that the most catastrophic failure mode does not reach your
code at all. A health check earns its place on the failures that leave the application **running
and wrong** — a version mismatch, a broken type registry, a revoked grant — and the platform's
status-code check covers the ones that kill it outright.

## Control Questions

1. `opcache.validate_timestamps=0` is correct in this image and would be actively harmful in the
   Module 02 development stack. Explain the mechanism in one sentence, then name the property of
   the production image that makes the setting safe — and say what would have to change about the
   deployment model for it to become wrong again.
2. `release_command` runs `wp plugin activate --all` on every deploy, including the hundredth.
   Say where activation state actually lives, describe what a user would see if that command were
   removed and a machine were replaced, and explain why the `Dockerfile` cannot fix it.
3. Media offload is presented as the correct answer from day one rather than an optional
   optimisation. Give the concrete two-machine failure it prevents, then name the front-end file
   and key that must change for it to work — and say which lesson makes that edit and why not
   this one.
4. The health endpoint returns a boolean per check to anyone and version detail only to a caller
   holding `X-BTT-App-Token`. Argue the opposite position: what does an operator lose, and what
   would you add to the response to recover most of it without naming a version?
5. A deploy runs `wp core update-db`, the release succeeds, and an hour later you discover the new
   core version broke a plugin. You have the previous image SHA and a volume snapshot from before
   the deploy. State the order of operations, say what data you lose, and explain why deploying
   the previous SHA first would make things worse.

## Learn More

- [The `wordpress` image on Docker Hub](https://hub.docker.com/_/wordpress) — read
  `docker-entrypoint.sh` in the linked repository, not just the README: the "generates
  `wp-config.php` only if absent" behaviour and the "chown only when uid 0" branch are both
  facts Step 2 depends on
- [Dockerfile reference — multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
  — `COPY --from`, and why naming stages beats `--from=0`; then
  [best practices](https://docs.docker.com/build/building/best-practices/) for the ordering rules
  that decide which of your layers cache
- [`.dockerignore` reference](https://docs.docker.com/build/concepts/context/#dockerignore-files)
  — the exclusion syntax, including the `!` re-include Step 1 uses for `.env.example`
- [PHP — opcache configuration](https://www.php.net/manual/en/opcache.configuration.php) —
  `validate_timestamps`, `revalidate_freq` and `max_accelerated_files`, with the note that a
  cache smaller than your file count silently thrashes
- [Fly.io — the `fly.toml` reference](https://fly.io/docs/reference/configuration/) — the
  authoritative list of keys, including `[deploy]`, `[[http_service.checks]]` and `[[mounts]]`
- [Fly.io — deployment strategies](https://fly.io/docs/launch/deploy/) — what `bluegreen`
  actually does with health checks, and when it silently falls back to `rolling`
- [Fly.io — volumes and snapshots](https://fly.io/docs/volumes/overview/) — read the "volumes are
  attached to one machine" section before you decide anything about scaling, and the snapshot
  retention numbers that make the ~24h RPO in Key Concept 10 concrete
- [WP-CLI — `core update-db`](https://developer.wordpress.org/cli/commands/core/update-db/) — and
  note the absence of any inverse command, which is Key Concept 6 in the primary source
- [`register_rest_route()` and `permission_callback`](https://developer.wordpress.org/rest-api/extending-the-rest-api/adding-custom-endpoints/)
  — why the omission is an error rather than a default, and why `WP_Error` is the right failure
  shape in a REST callback
