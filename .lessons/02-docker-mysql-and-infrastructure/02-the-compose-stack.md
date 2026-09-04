---
title: 'The Compose Stack'
module: 2
lesson: 2
teaches: [docker-compose-services, compose-networking, healthchecks, host-docker-internal, compose-overrides]
produces: ['wordpress-headless/docker-compose.yml', 'wordpress-headless/docker-compose.dev.yml', 'wordpress-headless/php.ini', 'wordpress-headless/uploads.ini']
requires: [2.1]
---

# Lesson 02.2 — The Compose Stack

## Quick Overview

One file now describes your entire local backend. `docker-compose.yml` declares five services —
`wordpress` on `:8080`, `db` on `:3306`, `adminer` on `:8081`, `mailpit` on `:8025` and a
run-on-demand `wpcli` — plus the network they share, the volumes they persist to, and the bind
mounts that let you edit plugin code in your editor and have it take effect immediately. A
second file, `docker-compose.dev.yml`, holds the settings that are development-only, so the base
file stays honest about what is shared with other environments.

Two things in this file will confuse you exactly once each, so they get named up front. First,
`WORDPRESS_DB_HOST` is `db:3306`, not `localhost:3306` — inside the Compose network each
service is reachable by its service name, and `localhost` inside the `wordpress` container means
the `wordpress` container. Second, when WordPress later needs to call Next.js (Module 18's
revalidation webhook), the address is `host.docker.internal:3000`, because Next runs on your
**host** and is not a Compose service at all. On Linux that hostname needs
`extra_hosts: ["host.docker.internal:host-gateway"]`; on Docker Desktop it is free. You will add
it now and be glad in Module 18. You also add a `healthcheck` to `db`, because "the container
started" and "MySQL will accept a connection" are separated by several seconds and WordPress
does not retry politely.

By the end of this lesson you will have:

- `wordpress-headless/docker-compose.yml` with five services, one network, two named volumes
  and three bind mounts
- `wordpress-headless/docker-compose.dev.yml` — the development-only overlay
- `wordpress-headless/php.ini` and `uploads.ini`, mounted into the WordPress container
- A `db` healthcheck that `wordpress` genuinely waits on, via the long form of `depends_on`
- All four long-running services reporting `running` in `docker compose ps`, with `db` marked
  `(healthy)`
- A first `.env` that you confirmed was gitignored **before** you wrote a value into it

## Classic WP Analogy

`docker-compose.yml` is the file MAMP never had. Everything you used to configure by clicking —
which PHP version, which ports, where `htdocs` points, whether MySQL is running — is one
declarative document, and starting the stack is one command instead of a sequence of
application launches. If you have ever written an Apache `VirtualHost` block or an `httpd.conf`
`Include`, the shape is familiar: a nested, indented description of services and how they are
wired, read top to bottom at startup.

The closest thing in your existing WordPress experience is actually `wp-config.php` combined
with a server provisioning script. `wp-config.php` says "here is how the application finds its
database"; a provisioning script says "here is what must exist for that to be true". Compose
merges those two concerns into one file that also *creates* the things it describes. The bind
mounts are the part that will feel most immediately familiar — `./wp-content/plugins` mounted at
`/var/www/html/wp-content/plugins` is your `htdocs` habit preserved exactly, which is why you
can keep editing PHP in your editor with no build step and no restart.

**Where the analogy breaks down:** a `VirtualHost` describes one process on one host with one
network namespace, so `localhost` means the same thing everywhere in it. Compose describes
several isolated network namespaces, and `localhost` means something *different in each
container*. This is the single most expensive misunderstanding in the module: `db:3306` works
from `wordpress`, `localhost:3306` works from your host shell, `localhost:3306` from inside
`wordpress` connects to nothing, and `localhost:3000` from inside `wordpress` will never reach
the Next.js dev server no matter how correct the rest of your configuration is. There is no
Classic WordPress experience that prepares you for one hostname resolving four ways depending
on who is asking.

---

## Key Concepts

### 1. A service is a recipe, a container is the thing running

A **service** is a named block in `docker-compose.yml`. It says which image to use, which ports
to publish, which volumes to attach, which environment to inject. A **container** is one running
instance created from that recipe. Most services here run exactly one container, so the two
words blur together — until you meet `wpcli`, which runs zero containers most of the time and
one short-lived container whenever you ask it to do something.

```
docker-compose.yml (recipes)          running containers
┌──────────────────────────┐          ┌──────────────────────┐
│ services:                │          │ btt-wordpress-1      │  :8080 → 80
│   wordpress:  ───────────┼─────────▶│ btt-db-1  (healthy)  │  :3306 → 3306
│   db:         ───────────┤          │ btt-adminer-1        │  :8081 → 8080
│   adminer:    ───────────┤          │ btt-mailpit-1        │  :8025 → 8025
│   mailpit:    ───────────┤          └──────────────────────┘
│   wpcli:      ───────────┼─────────▶ (nothing — runs on demand)
└──────────────────────────┘
```

The five services and why each exists:

| Service | Image | Published | Why it is here |
|---|---|---|---|
| `wordpress` | `wordpress:6.8-php8.3-apache` | `8080 → 80` | The CMS. One container, Apache and `mod_rewrite` behaving exactly like the shared hosting you know. |
| `db` | `mysql:8.0` | `3306 → 3306` | The database. The port is published so you can run `EXPLAIN` from your host in Lesson 02.3. |
| `adminer` | `adminer:5` | `8081 → 8080` | A 4 MB SQL console. Its "SQL command" tab renders `EXPLAIN` plans as a table, which is what makes Lesson 02.3 possible. |
| `mailpit` | `axllent/mailpit` | `8025 → 8025`, `1025 → 1025` | Captures every `wp_mail()` so registration and lead notifications are inspectable and **never leave your machine**. |
| `wpcli` | `wordpress:cli-php8.3` | — | WP-CLI. Run with `docker compose run --rm wpcli …`. |

> **The stock `wordpress` image does not include WP-CLI.** This surprises almost everyone. That
> is why `wpcli` is a separate service on the same network, sharing the same volumes and the
> same database credentials — the standard pattern, and it keeps the `wordpress` image
> unmodified until Module 24 builds a real production image. From this lesson onward, every
> `wp` command in this course is `docker compose run --rm wpcli wp …`.

### 2. Service names are hostnames — this is the whole networking model

Compose creates one network and puts every service on it. Inside that network, Docker runs a DNS
server that resolves **service names** to container IPs. So `db` is a hostname. `mailpit` is a
hostname. They are stable across restarts even though IPs are not.

Four resolutions of the same-looking address, and who each one is correct for:

| From | Address | Reaches |
|---|---|---|
| `wordpress` container | `db:3306` | ✅ MySQL. **This is what `WORDPRESS_DB_HOST` must be.** |
| your host shell | `localhost:3306` | ✅ MySQL, via the published port |
| `wordpress` container | `localhost:3306` | ❌ nothing — `localhost` is the `wordpress` container itself |
| `wordpress` container | `host.docker.internal:3000` | ✅ your host's Next.js dev server (Module 18) |

`ports:` and service-name DNS are independent. `ports:` punches a hole from your **host** into a
container. Service-name DNS is how containers reach **each other** and needs no `ports:` at all.
`adminer` talks to `db:3306` over the internal network; the fact that `3306` is also published to
your host is a convenience for you, not a requirement for Adminer.

> **This is why `WORDPRESS_DB_HOST=localhost` produces the worst error message in the module.**
> WordPress prints "Error establishing a database connection" and nothing else. There is no hint
> that the hostname is the problem. If you see that error, check this line first, every time.

### 3. Bind mounts are for code you edit; named volumes are for data the container owns

Two kinds of persistence, and choosing wrong causes a different bug in each direction.

```
BIND MOUNT — a path on your disk, projected into the container
   ./wp-content/plugins  ─────▶  /var/www/html/wp-content/plugins
   you edit in your editor · container sees it instantly · lives in git

NAMED VOLUME — storage Docker manages, opaque to you
   btt-db-data           ─────▶  /var/lib/mysql
   btt-uploads           ─────▶  /var/www/html/wp-content/uploads
   survives `down` · destroyed by `down -v` · never in git
```

| | Bind mount | Named volume |
|---|---|---|
| Use for | plugins, themes, mu-plugins, config files | the MySQL data directory, `wp-content/uploads` |
| You edit it | yes, in your editor | no |
| In git | yes | never |
| Survives `docker compose down` | it is your disk | yes |
| Survives `docker compose down -v` | yes | **no — destroyed** |
| macOS performance | slower (filesystem translation) | native |

The uploads decision is the interesting one. Uploads *could* be a bind mount, and plenty of
tutorials do that. This course uses a named volume for three reasons: binary media has no
business in git; thousands of small files bind-mounted on macOS is measurably slow; and in
production uploads go to S3/R2 anyway (Module 24), so treating them as container-owned data
locally matches where they end up.

### 4. `depends_on` alone does not wait for MySQL

This is the bug that makes people think Docker is flaky.

```
WITHOUT a healthcheck                     WITH a healthcheck
─────────────────────────────────         ─────────────────────────────────
db container starts        t=0s           db container starts        t=0s
wordpress starts           t=0s           (wordpress waits)
wordpress connects → FAIL  t=1s           db passes healthcheck      t=8s
mysqld ready               t=8s           wordpress starts           t=8s
                                          wordpress connects → OK    t=9s
```

Plain `depends_on: [db]` waits for the container to be **created**, not for the process inside it
to be **ready**. MySQL 8 spends several seconds initialising on first boot. WordPress tries once,
fails, and Apache serves the database-connection error. Restart it a minute later and it works —
which is exactly the kind of intermittent behaviour that wastes an afternoon.

The fix is a `healthcheck` on `db` plus the long form of `depends_on`:

```yaml
# wordpress-headless/docker-compose.yml (fragment — full file in the Task)
depends_on:
  db:
    condition: service_healthy
```

The healthcheck command itself has a quoting subtlety worth understanding, because you will hit
it again:

```yaml
# wordpress-headless/docker-compose.yml (fragment)
healthcheck:
  test: ['CMD-SHELL', 'mysqladmin ping -h 127.0.0.1 -u root -p"$$MYSQL_ROOT_PASSWORD" --silent']
```

`$$` is how you write a literal `$` in a Compose file. A single `$` would be expanded by
**Compose on your host**, using your `.env` — and the resulting password would appear in
`docker compose config` output and in the container's process list. `$$` passes the `$` through
untouched, so the expansion happens inside the container's shell against the container's own
environment. Same visible result, one of them leaks a credential into logs.

Note `-h 127.0.0.1` rather than `localhost`. Inside the `db` container `localhost` makes
`mysqladmin` use a Unix socket, which can succeed before TCP is actually accepting connections —
so the healthcheck would pass while WordPress still cannot connect. Forcing TCP tests the thing
that matters.

### 5. Override files: what is shared versus what is only true here

`docker compose up` reads `docker-compose.yml` and, if present, `docker-compose.override.yml`.
Any other overlay you name explicitly with `-f`. Later files win, and mappings merge key by key.

This course keeps the split deliberate:

| File | Holds | Why separate |
|---|---|---|
| `docker-compose.yml` | services, images, networks, volumes, the shape of the system | This is the description you would recognise in any environment |
| `docker-compose.dev.yml` | `WORDPRESS_DEBUG`, the published `db` port, dev PHP settings, `WORDPRESS_CONFIG_EXTRA` | Things that must **not** be true in production |

Keeping `WORDPRESS_DEBUG=1` out of the base file is not tidiness. Module 24 deploys the same
image to Fly.io, and `WP_DEBUG` on in production prints PHP notices into your HTML and, with
`WP_DEBUG_DISPLAY`, leaks file paths and plugin versions to anyone who triggers a warning.
Structuring the files this way now means the production deploy has nothing to remember.

```bash
# The two-file invocation. Lesson 02.6 wraps this in a script so you stop typing it.
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

### 6. `env_file` versus `environment`

Both inject environment variables. Only one keeps secrets out of git.

```yaml
# ❌ Never. This value is now committed, forever, in every clone.
environment:
  WORDPRESS_DB_PASSWORD: hunter2

# ✅ Names in the committed file, values in the gitignored one.
env_file:
  - .env
environment:
  WORDPRESS_DB_PASSWORD: ${WORDPRESS_DB_PASSWORD:?WORDPRESS_DB_PASSWORD is required}
```

`${VAR:?message}` fails the command with your message if `VAR` is unset, instead of silently
starting a container with an empty password. Fail loudly at startup; do not debug it later.

> **Order of operations matters more than the syntax.** You confirm `.env` is gitignored
> **before** you write a value into it. A secret committed once is compromised even after you
> delete it, because it stays in the object database and in every clone anyone has pulled — and
> the remedy is rotation, not `git rm`. Step 1 of the Task does the check first for exactly this
> reason. See [appendix 04 §1](../appendix/04-env-reference.md#1-the-five-rules).

### 7. `host.docker.internal`, added now, needed in Module 18

Next.js runs on your host, not in Compose. So when WordPress publishes a post and wants to tell
Next to revalidate, it cannot use `localhost:3000` — inside the container that is the container.

```
   ┌─ your host ────────────────────────────────────────────────┐
   │                                                            │
   │   next-app  `npm run dev`  :3000                           │
   │        ▲                                                   │
   │        │  POST /api/revalidate                             │
   │        │  http://host.docker.internal:3000                 │
   │   ┌────┴───────────────────────────────────────────┐        │
   │   │ compose network: btt-net                       │        │
   │   │   wordpress ──▶ db ──▶ (mailpit, adminer)      │        │
   │   └────────────────────────────────────────────────┘        │
   └────────────────────────────────────────────────────────────┘
```

On Docker Desktop (macOS, Windows) the hostname exists automatically. On Linux it does not, and
you must map it:

```yaml
# wordpress-headless/docker-compose.yml (fragment)
extra_hosts:
  - 'host.docker.internal:host-gateway'
```

Adding it on every platform is harmless and portable. Leaving it out on Linux produces the
number-one Module 18 symptom: publishing works, the webhook fires, WordPress logs nothing
useful, and the front end silently serves stale content forever.

---

## Task

### Step 1: Confirm the ignore rule before any secret exists

```bash
cd wordpress-headless
git check-ignore -v .env
```

**Verify §1:**

- [ ] The output names a rule from `.gitignore`, something like `../.gitignore:78:.env*   .env`.
- [ ] If there is **no output**, stop. `.env` is not ignored. Fix the root `.gitignore` before
      you continue — do not "fix it afterwards".

### Step 2: Create the directory skeleton

Bind mounts do not create missing host directories in a useful way — Docker will make them as
root-owned empties, which then confuses the WordPress image. Make them yourself first.

```bash
mkdir -p wp-content/plugins wp-content/themes wp-content/mu-plugins
touch wp-content/mu-plugins/.gitkeep
ls -la wp-content/
```

### Step 3: Write the first `.env`

This is the minimal set the stack needs to boot. Lesson 02.5 turns this file into a documented
contract and adds the salts and application tokens; for now, just enough to start.

Generate the two passwords rather than inventing them:

```bash
printf 'WORDPRESS_DB_PASSWORD=%s\n' "$(openssl rand -base64 24 | tr -d '\n=+/')"
printf 'MYSQL_ROOT_PASSWORD=%s\n'   "$(openssl rand -base64 24 | tr -d '\n=+/')"
```

Paste those two lines into `.env` alongside the rest:

```dotenv
# wordpress-headless/.env
# GITIGNORED. Never commit this file. Lesson 02.5 explains every variable in full.

# ── Database ─────────────────────────────────────────────────────────
MYSQL_DATABASE=btt
MYSQL_USER=btt
WORDPRESS_DB_NAME=btt
WORDPRESS_DB_USER=btt
WORDPRESS_TABLE_PREFIX=wp_

# Generated above — yours will differ. Never `root` for the app user.
WORDPRESS_DB_PASSWORD=__CHANGE_ME__
MYSQL_ROOT_PASSWORD=__CHANGE_ME__

# ── URLs ─────────────────────────────────────────────────────────────
WP_HOME=http://localhost:8080
WP_SITEURL=http://localhost:8080

# Where WordPress will find Next.js. Not localhost — see Key Concept 7.
BTT_FRONTEND_URL=http://host.docker.internal:3000

# ── Mail (captured by Mailpit, never sent) ──────────────────────────
BTT_SMTP_HOST=mailpit
BTT_SMTP_PORT=1025
```

> **`MYSQL_USER` is `btt`, not `root`.** The MySQL image creates that user with rights on the
> `btt` database only. WordPress connects as `btt`; `root` exists for administration and the
> healthcheck. This is least privilege applied to the cheapest possible target, and it means a
> WordPress-level SQL injection cannot reach another schema.

### Step 4: Write the PHP configuration

Two small files, mounted into the container's PHP config directory.

```ini
; wordpress-headless/uploads.ini
file_uploads = On
memory_limit = 512M
upload_max_filesize = 64M
post_max_size = 64M
max_execution_time = 300
```

```ini
; wordpress-headless/php.ini
; Applies to both the web SAPI and WP-CLI.
max_input_vars = 3000
```

`max_input_vars` matters sooner than you would think: the block editor and ACF field groups both
post large nested arrays, and PHP's default of 1000 silently truncates them. Silently. You lose
field values with no error.

### Step 5: Write `docker-compose.yml`

```yaml
# wordpress-headless/docker-compose.yml
name: btt

services:
  wordpress:
    image: wordpress:6.8-php8.3-apache
    depends_on:
      db:
        condition: service_healthy
    ports:
      - '8080:80'
    env_file:
      - .env
    environment:
      WORDPRESS_DB_HOST: db:3306
      WORDPRESS_DB_NAME: ${WORDPRESS_DB_NAME:?required}
      WORDPRESS_DB_USER: ${WORDPRESS_DB_USER:?required}
      WORDPRESS_DB_PASSWORD: ${WORDPRESS_DB_PASSWORD:?required}
      WORDPRESS_TABLE_PREFIX: ${WORDPRESS_TABLE_PREFIX:-wp_}
    volumes:
      # Bind mounts — code you edit, in git
      - ./wp-content/plugins:/var/www/html/wp-content/plugins
      - ./wp-content/themes:/var/www/html/wp-content/themes
      - ./wp-content/mu-plugins:/var/www/html/wp-content/mu-plugins
      # Named volume — media, container-owned, never in git
      - btt-uploads:/var/www/html/wp-content/uploads
      # PHP configuration
      - ./uploads.ini:/usr/local/etc/php/conf.d/uploads.ini:ro
      - ./php.ini:/usr/local/etc/php/conf.d/zz-btt.ini:ro
    extra_hosts:
      # Free on Docker Desktop, required on Linux. Needed from Module 18.
      - 'host.docker.internal:host-gateway'
    networks: [btt-net]
    restart: unless-stopped

  db:
    image: mysql:8.0
    command:
      # Pinned to 8.0, where this flag still exists. Some MySQL clients in the
      # WordPress/PHP ecosystem still expect the older auth plugin.
      - --default-authentication-plugin=mysql_native_password
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_unicode_ci
    env_file:
      - .env
    environment:
      MYSQL_DATABASE: ${MYSQL_DATABASE:?required}
      MYSQL_USER: ${MYSQL_USER:?required}
      MYSQL_PASSWORD: ${WORDPRESS_DB_PASSWORD:?required}
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:?required}
    volumes:
      - btt-db-data:/var/lib/mysql
    healthcheck:
      # $$ is a literal $ — expanded inside the container, not by Compose.
      # 127.0.0.1 forces TCP; `localhost` would use a socket and pass too early.
      test: ['CMD-SHELL', 'mysqladmin ping -h 127.0.0.1 -u root -p"$$MYSQL_ROOT_PASSWORD" --silent']
      interval: 5s
      timeout: 5s
      retries: 12
      start_period: 30s
    networks: [btt-net]
    restart: unless-stopped

  adminer:
    image: adminer:5
    depends_on:
      db:
        condition: service_healthy
    ports:
      - '8081:8080'
    environment:
      ADMINER_DEFAULT_SERVER: db
    networks: [btt-net]
    restart: unless-stopped

  mailpit:
    image: axllent/mailpit:latest
    ports:
      - '8025:8025' # web UI
      - '1025:1025' # SMTP
    environment:
      MP_MAX_MESSAGES: 500
      MP_SMTP_AUTH_ACCEPT_ANY: 1
      MP_SMTP_AUTH_ALLOW_INSECURE: 1
    networks: [btt-net]
    restart: unless-stopped

  wpcli:
    # The stock wordpress image has no WP-CLI. This service provides it.
    # Run with:  docker compose run --rm wpcli wp <command>
    image: wordpress:cli-php8.3
    depends_on:
      db:
        condition: service_healthy
    env_file:
      - .env
    environment:
      WORDPRESS_DB_HOST: db:3306
      WORDPRESS_DB_NAME: ${WORDPRESS_DB_NAME:?required}
      WORDPRESS_DB_USER: ${WORDPRESS_DB_USER:?required}
      WORDPRESS_DB_PASSWORD: ${WORDPRESS_DB_PASSWORD:?required}
      WORDPRESS_TABLE_PREFIX: ${WORDPRESS_TABLE_PREFIX:-wp_}
    volumes:
      # Must see exactly what the web container sees
      - ./wp-content/plugins:/var/www/html/wp-content/plugins
      - ./wp-content/themes:/var/www/html/wp-content/themes
      - ./wp-content/mu-plugins:/var/www/html/wp-content/mu-plugins
      - btt-uploads:/var/www/html/wp-content/uploads
      - ./php.ini:/usr/local/etc/php/conf.d/zz-btt.ini:ro
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    networks: [btt-net]

volumes:
  btt-db-data:
  btt-uploads:

networks:
  btt-net:
    driver: bridge
```

**Verify §5:**

- [ ] `docker compose config` prints the merged configuration with no error.
- [ ] In that output, `WORDPRESS_DB_HOST` is `db:3306`.
- [ ] In that output, the `db` healthcheck test still contains the literal string
      `$MYSQL_ROOT_PASSWORD` — **not** your actual password. If you see the password, you wrote
      `$` where you needed `$$`.

### Step 6: Write the development overlay

```yaml
# wordpress-headless/docker-compose.dev.yml
# Development-only. Never applied to staging or production.
services:
  wordpress:
    environment:
      WORDPRESS_DEBUG: 1
      WORDPRESS_CONFIG_EXTRA: |
        define( 'WP_HOME',    getenv('WP_HOME') );
        define( 'WP_SITEURL', getenv('WP_SITEURL') );
        define( 'WP_DEBUG_LOG',     true );
        define( 'WP_DEBUG_DISPLAY', false );
        define( 'SCRIPT_DEBUG',     true );
        define( 'WP_ENVIRONMENT_TYPE', 'local' );

  db:
    # Published only in development, for the EXPLAIN drills in Lesson 02.3.
    ports:
      - '3306:3306'
```

`WP_DEBUG_DISPLAY` is `false` even in development, deliberately. You want warnings in
`wp-content/debug.log`, not injected into GraphQL JSON responses — a PHP notice in the middle of
a JSON body produces a parse error in Next.js and sends you hunting in entirely the wrong place.

### Step 7: Bring the stack up

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

First run pulls roughly 700 MB of images. Then:

```bash
docker compose ps
```

**Verify §7:**

- [ ] `wordpress`, `db`, `adminer` and `mailpit` all show `running`.
- [ ] `db` shows `(healthy)` — not `(health: starting)`. Give it 30 seconds if needed.
- [ ] `wpcli` does **not** appear. It is a run-on-demand service and that is correct.

### Step 8: Complete the WordPress installation

Install from the command line rather than the browser wizard, so the site is reproducible.

The admin password is generated and read from your environment — it is never typed into a file:

```bash
export BTT_ADMIN_PASSWORD="$(openssl rand -base64 24)"

docker compose run --rm wpcli wp core install \
  --url="http://localhost:8080" \
  --title="Blame The Tech" \
  --admin_user=btt_admin \
  --admin_email=admin@blamethe.tech \
  --admin_password="$BTT_ADMIN_PASSWORD" \
  --skip-email

echo "Save this in your password manager now: $BTT_ADMIN_PASSWORD"
```

> **That `export` lives only in this shell session.** Do not add it to `.zshrc`, `.bashrc` or any
> dotfile, and do not put it in `.env` — a developer credential belongs in your password manager
> and in the environment of the session that needs it, nothing else. Close the terminal and the
> variable is gone, which is the point.

**Verify §8:**

- [ ] `http://localhost:8080/wp-admin` accepts `btt_admin` and that password.
- [ ] The admin bar says **Blame The Tech**.

---

## Verification

```bash
cd wordpress-headless

# 1. All four long-running services are up, and db is HEALTHY (not "health: starting")
docker compose ps
# Expected: wordpress, db, adminer, mailpit — all "running"; db shows "(healthy)"
#           wpcli absent — it is run-on-demand

# 2. WordPress answers on 8080
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/
# Expected: 200

# 3. WordPress can actually reach the database (this is what a healthcheck cannot prove)
docker compose run --rm wpcli wp option get siteurl
# Expected: http://localhost:8080

# 4. Service-name DNS works from inside the wordpress container
docker compose exec wordpress getent hosts db
# Expected: an IP followed by "db" — e.g. 172.20.0.2   db

# 5. NEGATIVE — `localhost` inside that container is NOT the database (Key Concept 2)
docker compose exec wordpress bash -c 'timeout 3 bash -c "</dev/tcp/127.0.0.1/3306" 2>&1; echo "exit=$?"'
# Expected: a non-zero exit. Nothing is listening on 3306 inside the wordpress container.

# 6. The host IS reachable from the container under the name Module 18 will use
docker compose exec wordpress getent hosts host.docker.internal
# Expected: an IP followed by "host.docker.internal". If EMPTY, your extra_hosts
#           entry is missing — fix it now, not in Module 18.

# 7. Adminer is up and pointed at the right server
curl -s http://localhost:8081/ | grep -o 'Adminer' | head -1
# Expected: Adminer

# 8. Mailpit is up and its inbox is reachable
curl -s http://localhost:8025/api/v1/messages | head -c 60
# Expected: JSON beginning with {"messages":  (an empty inbox is correct)

# 9. PHP limits from uploads.ini actually applied
docker compose exec wordpress php -r 'echo ini_get("upload_max_filesize"), " ", ini_get("max_input_vars"), PHP_EOL;'
# Expected: 64M 3000

# 10. The bind mount is live in both directions
echo "<?php // bind mount smoke test" > wp-content/plugins/_mount-test.php
docker compose exec wordpress cat /var/www/html/wp-content/plugins/_mount-test.php
# Expected: <?php // bind mount smoke test
rm wp-content/plugins/_mount-test.php

# 11. NEGATIVE — the healthcheck did not leak your password into the merged config
docker compose config | grep -A1 'CMD-SHELL'
# Expected: the literal string $MYSQL_ROOT_PASSWORD.
#           If you see your real password, you wrote $ where you needed $$.

# 12. NEGATIVE — no secret is staged for commit
git status --short wordpress-headless/
git check-ignore -v .env
# Expected: .env does NOT appear in git status, and check-ignore names a rule

# 13. Data survives a restart (named volumes), and the stack comes back healthy
docker compose down && docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
docker compose run --rm wpcli wp option get blogname
# Expected: Blame The Tech
```

If check 6 is empty, or check 11 shows a real password, fix it before moving on. Both fail
silently later and cost far more to diagnose than to correct now.

## Control Questions

1. `WORDPRESS_DB_HOST` is `db:3306`. Name the three other things `localhost:3306` and
   `db:3306` could mean, depending on which shell or container asks, and say which is correct
   from Adminer.
2. `docker compose down -v` destroys `btt-db-data` and `btt-uploads` but not
   `./wp-content/plugins`. Explain the difference in one sentence, and say which command you
   would run to reset the database without losing the plugin code you wrote.
3. The `db` healthcheck uses `-h 127.0.0.1` rather than `localhost`. What failure would using
   `localhost` reintroduce, given that the container would still report healthy?
4. `WORDPRESS_DEBUG` lives in `docker-compose.dev.yml`, not `docker-compose.yml`. Describe the
   concrete production consequence of moving it into the base file.
5. `extra_hosts` adds nothing you can observe in this lesson. Which later lesson breaks without
   it, what is the symptom, and why would the logs not tell you?

## Learn More

- [Compose file reference](https://docs.docker.com/reference/compose-file/) — the authoritative
  list of keys; worth skimming `depends_on`, `healthcheck` and `extra_hosts` specifically
- [Compose: control startup order](https://docs.docker.com/compose/how-tos/startup-order/) —
  Docker's own explanation of why `depends_on` is not enough, in their words
- [The `wordpress` image on Docker Hub](https://hub.docker.com/_/wordpress) — the full list of
  `WORDPRESS_*` environment variables, including `WORDPRESS_CONFIG_EXTRA`
- [The `mysql` image on Docker Hub](https://hub.docker.com/_/mysql) — read the "Where to Store
  Data" section before you decide anything about volumes in your own projects
- [WP-CLI `core install`](https://developer.wordpress.org/cli/commands/core/install/) — every
  flag used in Step 8
- [Mailpit](https://mailpit.axllent.org/docs/) — the API you just curled in check 8, useful again
  when Module 16 asserts on a captured email
- [Bind mounts versus volumes](https://docs.docker.com/engine/storage/) — Docker's decision guide,
  which agrees with Key Concept 3 and explains the macOS performance difference
