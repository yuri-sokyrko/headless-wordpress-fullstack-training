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

- `wordpress-headless/docker-compose.yml` with five services, one network, three named volumes
  and three bind mounts
- `wordpress-headless/docker-compose.dev.yml` — the development-only overlay
- `wordpress-headless/php.ini` and `uploads.ini`, mounted into both PHP containers
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
| `wordpress` | `wordpress:7.1-php8.4-apache` | `8080 → 80` | The CMS. One container, Apache and `mod_rewrite` behaving exactly like the shared hosting you know. |
| `db` | `mysql:8.4` | `3306 → 3306` | The database. The port is published so you can run `EXPLAIN` from your host in Lesson 02.3. |
| `adminer` | `adminer:5` | `8081 → 8080` | A 4 MB SQL console. Its "SQL command" tab renders `EXPLAIN` plans as a table, which is what makes Lesson 02.3 possible. |
| `mailpit` | `axllent/mailpit` | `8025 → 8025`, `1025 → 1025` | Captures every `wp_mail()` so registration and lead notifications are inspectable and **never leave your machine**. |
| `wpcli` | `wordpress:cli-php8.4` | — | WP-CLI. Run with `docker compose run --rm wpcli …`. |

> **The stock `wordpress` image does not include WP-CLI.** This surprises almost everyone. That
> is why `wpcli` is a separate service on the same network, sharing the same volumes and the
> same database credentials — the standard pattern, and it keeps the `wordpress` image
> unmodified until Module 24 builds a real production image. From this lesson onward, every
> `wp` command in this course is `docker compose run --rm wpcli wp …`.
>
> `wpcli` carries `profiles: ['cli']`, which is what makes "run-on-demand" true rather than
> aspirational: without it, `up` starts the container, its default command exits, and
> `up -d --wait` returns `1`. The cost is that a profile-gated service is invisible to
> `up`, `ps` **and `docker compose config`** unless you ask for it — so any check that inspects
> the `wpcli` service needs `docker compose --profile cli config`. `docker compose run` turns
> the profile on for you, so nothing you type day to day changes.

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
   btt-wp-core           ─────▶  /var/www/html      SHARED: wordpress + wpcli
   survives `down` · destroyed by `down -v` · never in git
```

| | Bind mount | Named volume |
|---|---|---|
| Use for | plugins, themes, mu-plugins, config files | the MySQL data directory, `wp-content/uploads`, **WordPress core** |
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

**The core volume is the one you would never think to add, and everything depends on it.**
`btt-wp-core` is mounted at `/var/www/html` in **both** the `wordpress` and the `wpcli`
service, and it exists for one reason: the official `wordpress` image populates
`/var/www/html` from `/usr/src/wordpress` at container start, and if nothing is mounted there
the copy lands in that container's own writable layer — where `wpcli`, a completely separate
container, cannot see it. The `wordpress:cli` image ships the WP-CLI binary and **no WordPress
at all**, so `wp` would have nothing to bootstrap and every command in this course would fail
with `Error: This does not seem to be a WordPress installation.`

```
WITHOUT btt-wp-core                        WITH btt-wp-core
────────────────────────────────────       ────────────────────────────────────
wordpress container                        wordpress container
  /var/www/html  ← core, private   ✅        /var/www/html  ← core ─┐
                                                                    │ shared
wpcli container                            wpcli container          │
  /var/www/html  ← wp-content only ❌         /var/www/html  ←───────┘   ✅
  `wp` → "not a WordPress installation"     `wp core version` → 7.1.x
```

Two consequences worth knowing now rather than discovering later. `docker compose down -v`
destroys core along with the database — harmless, because the next `up` re-copies it from the
image, and it is why this course never treats `down -v` as dangerous to *code*. And
`wp-config.php`, which Lesson 02.4 bind-mounts read-only at
`/var/www/html/wp-config.php`, still wins over the volume: the longer target path always
mounts on top.

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

**The half of this that bites, and the one-line cure.** Typing both flags every time is tedious;
*forgetting* them on some commands and not others is a bug. Compose compares the service
definition it is given against the container that is running, so a bare
`docker compose run --rm wpcli wp …` — which sees only the base file — decides `db` has changed,
**recreates it**, and quietly takes the published `3306` away with it. Your next `EXPLAIN` from a
host client fails for a reason nothing on screen mentions.

`COMPOSE_FILE` in `.env` (Step 3) removes the choice. Compose reads `COMPOSE_*` variables from
`.env` before it resolves which files to load, so every bare invocation loads both:

| Invocation | Files loaded | `db` published? |
|---|---|---|
| `docker compose up -d`, with `COMPOSE_FILE` set | both | yes |
| `docker compose run --rm wpcli wp …`, with it set | both | yes — and no recreate |
| `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d` | both | yes — an explicit `-f` still wins |
| `docker compose -f docker-compose.yml up -d` | base only | no — one flag still overrides, which is §5's whole point |

An explicit `-f` always beats the variable, so nothing you have already typed changes meaning.

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

- [ ] The output names a rule from `.gitignore` — currently `../.gitignore:80:.env   .env`.
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

# ── Compose itself ───────────────────────────────────────────────────
# Not a WordPress setting. Compose reads COMPOSE_* variables out of this file
# BEFORE it resolves anything else, so this one line makes every bare
# `docker compose …` in this course behave as if you had typed both -f flags.
# Without it, `docker compose run --rm wpcli …` sees a different `db` than
# `up -f … -f … ` created, decides the service changed, and RECREATES it —
# silently dropping the published 3306 that Lesson 02.3 needs. See §5.
COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml

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
    image: wordpress:7.1-php8.4-apache
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
      # WordPress CORE, in a named volume SHARED with wpcli. The `wordpress:cli`
      # image ships the WP-CLI binary and no WordPress, so without this `wp` has
      # nothing to bootstrap and every command in Modules 03-24 fails with
      # "This does not seem to be a WordPress installation." Key Concept 3.
      - btt-wp-core:/var/www/html
      # Bind mounts — code you edit, in git. A LONGER target path mounts on top
      # of the volume above, so these still win for wp-content.
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
    image: mysql:8.4
    command:
      # No authentication flag here, deliberately. MySQL 8.0 tutorials all pass
      # `--default-authentication-plugin=mysql_native_password`; that option was
      # REMOVED in 8.4 and the server now refuses to start with "unknown variable".
      # Nothing is lost: mysqlnd in the PHP 8.4 wordpress image speaks
      # caching_sha2_password perfectly well, and so does Adminer 5. If a legacy
      # GUI client of yours cannot, the 8.4 spelling is `--mysql-native-password=ON`
      # plus `--authentication-policy=mysql_native_password` — an opt-in to a
      # deprecated plugin, not a default. Do not add it just because a blog post did.
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
    image: wordpress:cli-php8.4
    # Run-on-demand, and the profile is what makes that true. Without it `up`
    # starts this container too, its default command (`wp shell`) exits, and
    # `up -d --wait` then reports "container wpcli-1 exited" and returns 1.
    # `docker compose run` activates a service's own profile, so every
    # `run --rm wpcli` in this course keeps working unchanged.
    profiles: ['cli']
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
      # A pinned numeric uid has no home directory in this image, and WP-CLI
      # warns on every run when it cannot create its cache.
      WP_CLI_CACHE_DIR: /tmp/wp-cli-cache
    # uid 33 is www-data in the Debian `wordpress` image and uid 82 in the
    # Alpine-based `wordpress:cli` image. Two containers sharing a volume while
    # disagreeing about who www-data is means wpcli cannot write what the web
    # container owns — `wp media import` in Lesson 04.5 is the first command
    # that would fail. Pin the numeric uid instead of hoping.
    user: '33:33'
    volumes:
      # The SAME core volume as the web container. This is what gives `wp`
      # something to bootstrap.
      - btt-wp-core:/var/www/html
      # Must see exactly what the web container sees
      - ./wp-content/plugins:/var/www/html/wp-content/plugins
      - ./wp-content/themes:/var/www/html/wp-content/themes
      - ./wp-content/mu-plugins:/var/www/html/wp-content/mu-plugins
      - btt-uploads:/var/www/html/wp-content/uploads
      # BOTH PHP config files, same as the web container. uploads.ini carries
      # memory_limit=512M, and `wp media import` in Lesson 04.5 sideloads
      # through WP-CLI — leave it out and WP-CLI runs at the image default
      # 128M while Apache gets 512M, which is a confusing way to fail.
      - ./uploads.ini:/usr/local/etc/php/conf.d/uploads.ini:ro
      - ./php.ini:/usr/local/etc/php/conf.d/zz-btt.ini:ro
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    networks: [btt-net]

volumes:
  btt-db-data:
  btt-uploads:
  btt-wp-core:

networks:
  btt-net:
    driver: bridge
```

**Verify §5:**

- [ ] `docker compose config` prints the merged configuration with no error.
- [ ] In that output, `WORDPRESS_DB_HOST` is `db:3306`.
- [ ] In that output, the `db` healthcheck test reads `-p"$$MYSQL_ROOT_PASSWORD"` — Compose
      re-escapes the literal `$`, so you see **two** of them and **not** your actual password.
      If you see the password, you wrote `$` where you needed `$$`.
- [ ] `docker compose config --volumes` lists **three** volumes: `btt-db-data`, `btt-uploads`
      and `btt-wp-core`, in any order.
- [ ] `docker compose --profile cli config | grep -c 'source: btt-wp-core'` prints **2** — once
      under `wordpress`, once under `wpcli`. Two details make the obvious version of this check
      lie to you. Compose rewrites short volume syntax into long form in `config` output, so
      grepping for the `btt-wp-core:/var/www/html` you typed finds nothing even when the file is
      right; and `config` **omits services whose profile is not active**, so without
      `--profile cli` you see only the `wordpress` half and get `1`. Once is worse than never:
      the two containers would then disagree about what WordPress is.

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

### Step 7: Bring the stack up, and give the uploads volume an owner

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait
docker compose ps
```

First run pulls roughly 700 MB of images.

Then one command you will run exactly once per fresh `btt-uploads` volume. Docker creates a new
named volume owned by `root:root` with mode `755`, and the WordPress image's entrypoint does not
chown into it — so **nothing** can write media there: not WP-CLI at uid 33, and not Apache,
whose workers are also uid 33. The `exec` below runs as root inside the container, which is
exactly the privilege needed and the only place it exists:

```bash
docker compose exec wordpress chown 33:33 /var/www/html/wp-content/uploads
docker compose exec wordpress ls -ldn /var/www/html/wp-content/uploads
```

Skip it and Step 8 answers with
`Warning: Unable to create directory wp-content/uploads/2026/09. Is its parent directory writable
by the server?`, the media library refuses every upload, and `wp media import` in Lesson 04.5
fails with a permission error rather than a clear one. Re-run it after any `down -v`.

**Verify §7:**

- [ ] `wordpress`, `db`, `adminer` and `mailpit` all show `running`.
- [ ] `db` shows `(healthy)` — not `(health: starting)`. Give it 30 seconds if needed. `mailpit`
      and `wordpress` ship healthchecks of their own, so you will see **three** `(healthy)`
      services, not one; only `db`'s is the one this lesson added.
- [ ] `wpcli` does **not** appear, in `ps` or in `ps -a`. It is a run-on-demand service and the
      `profiles: ['cli']` line is what keeps it out — and keeps `up -d --wait` at exit `0`.
- [ ] `ls -ldn` on the uploads directory prints `33 33`, not `0 0`.

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
# Expected: wordpress, db, adminer, mailpit — all "running"; db shows "(healthy)".
#           mailpit and wordpress carry healthchecks of their own, so THREE
#           services read "(healthy)" — only db's was added by this lesson.
#           wpcli absent from ps AND from `ps -a` — profiles: ['cli'].

# 2. WordPress answers on 8080
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/
# Expected: 200

# 3. WP-CLI can see WordPress at all. This is the check that fails if btt-wp-core
#    is missing from either service, and it fails before anything else does.
docker compose run --rm wpcli wp core version
# Expected: 7.1.x
#           "This does not seem to be a WordPress installation" means the core
#           volume is absent from one of the two services. Key Concept 3.

# 3b. WordPress can actually reach the database (a healthcheck cannot prove this)
docker compose run --rm wpcli wp option get siteurl
# Expected: http://localhost:8080

# 3c. NEGATIVE — wpcli is not quietly running as a different user than Apache
docker compose run --rm wpcli id -u
# Expected: 33. An 82 means the `user:` pin is missing and `wp media import`
#           will fail in Lesson 04.5 with a permission error, not a clear one.

# 4. Service-name DNS works from inside the wordpress container
docker compose exec wordpress getent hosts db
# Expected: an address followed by "db" — e.g. 172.19.0.2   db

# 5. NEGATIVE — `localhost` inside that container is NOT the database (Key Concept 2)
docker compose exec wordpress bash -c 'timeout 3 bash -c "</dev/tcp/127.0.0.1/3306" 2>&1; echo "exit=$?"'
# Expected: a non-zero exit. Nothing is listening on 3306 inside the wordpress container.

# 6. The host IS reachable from the container under the name Module 18 will use
docker compose exec wordpress getent hosts host.docker.internal
# Expected: an address followed by "host.docker.internal". Docker Desktop often
#           answers with IPv6 (fdc4:…::254), which is correct — the only wrong
#           answer is EMPTY, which means extra_hosts is missing. Fix it now,
#           not in Module 18.

# 7. Adminer is up and pointed at the right server
curl -s http://localhost:8081/ | grep -o 'Adminer' | head -1
# Expected: Adminer

# 8. Mailpit is up and its inbox is reachable
curl -s http://localhost:8025/api/v1/messages | head -c 60
# Expected: JSON beginning {"total":0,"unread":0,"count":0,  — an empty inbox
#           is correct. The `messages` array comes later in the same object.

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
# Expected: -p"$$MYSQL_ROOT_PASSWORD" — TWO dollars, because Compose re-escapes
#           the literal one on the way out. If you see your real password, you
#           wrote $ where you needed $$.

# 12. NEGATIVE — no secret is staged for commit
git status --short wordpress-headless/
git check-ignore -v .env
# Expected: .env does NOT appear in git status, and check-ignore names a rule

# 13. Data survives a restart (named volumes), and the stack comes back healthy
docker compose down && docker compose up -d --wait
docker compose run --rm wpcli wp option get blogname
# Expected: exit 0 from `up --wait` (the cli profile keeps run-on-demand
#           containers out of the wait set), then: Blame The Tech
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
