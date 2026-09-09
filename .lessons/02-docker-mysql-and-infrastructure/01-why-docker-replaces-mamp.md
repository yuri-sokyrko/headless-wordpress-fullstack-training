---
title: 'Why Docker Replaces MAMP'
module: 2
lesson: 1
teaches: [docker-images-vs-containers, dev-env-parity, bind-mounts-vs-volumes, image-layers]
produces: []
requires: [1.2]
---

# Lesson 02.1 — Why Docker Replaces MAMP

## Quick Overview

MAMP works. That is worth saying out loud, because the argument for Docker is not that your
current setup is broken — it is that your current setup is *undescribed*. The PHP version, the
extensions, the MySQL version, the `max_execution_time`, the `upload_max_filesize`: all of it
lives in a preferences pane on one laptop, and none of it is in your repository. This lesson
introduces the alternative, where the same facts are written down in a file, versioned, and
reproduced identically on your machine, a colleague's machine, CI, and production.

You will learn the three nouns that carry all of Docker: an **image** is an immutable stack of
filesystem layers, a **container** is one running instance of an image with a thin writable
layer on top, and a **volume** is storage that outlives the container. Getting those three
straight now prevents the two mistakes every newcomer makes — expecting file edits inside a
container to survive `docker compose down`, and expecting a database to vanish when it does not.
You will pull the exact WordPress image this course pins, look inside it, and see that "PHP
8.3 with the right extensions" is a fact you can now cite rather than hope for.

By the end of this lesson you will have:

- The `wordpress:6.8-php8.3-apache` and `mysql:8.0` images pulled and inspected locally
- A written distinction between image, container, layer, bind mount and named volume
- Proof that a file written inside a container's writable layer disappears on recreate, and
  that a file in a named volume does not
- The PHP version, loaded extensions and document root of the WordPress image, read from
  inside the container
- A decision record for why this course containerises WordPress but not Next.js

## Classic WP Analogy

Your MAMP setup and a Docker image solve the same problem — "give me Apache, PHP and MySQL,
configured the way WordPress wants" — and they solve it at the same layer. MAMP is a bundle
someone assembled and shipped you as an application; the `wordpress:6.8-php8.3-apache` image is
a bundle someone assembled and shipped you as a filesystem. `htdocs/` maps almost exactly onto
a bind mount: the directory you actually edit, visible to the server process. MAMP's PHP
version dropdown maps onto the image tag. `php.ini` is still `php.ini` — you will write one in
Lesson 02.2 and mount it in.

The difference is who holds the configuration. In MAMP, the answer to "which PHP extensions are
loaded?" is a GUI checkbox list; in Docker, the answer is a line in a file in your repository,
and the same line produced the container that will run in Fly.io in Module 24. That is the
whole pitch, and it is why the phrase "works on my machine" changes meaning: the machine is
now something you can hand to someone else.

**Where the analogy breaks down:** MAMP's `htdocs/` is your only filesystem, and everything
persists because there is nowhere else for it to go. A container has three kinds of storage
with three lifetimes, and confusing them is the number-one source of lost work in this module.
Files in a **bind mount** (`./wp-content/plugins`) are on your host and are as permanent as any
other file you own. Files in a **named volume** (`btt-db-data`, `btt-uploads`) survive
`docker compose down` but are invisible in your editor and are deleted by
`docker compose down -v`. Files anywhere *else* inside the container — including a plugin you
install through wp-admin into an unmounted path — live in the container's writable layer and are
gone the moment the container is recreated, which happens every time you change the compose
file. MAMP has no equivalent of that third category, and it will bite you at least once.

---

## Key Concepts

### 1. An image is a stack of layers; a container is one run of it

An **image** is immutable: an ordered stack of read-only filesystem layers plus a small JSON
metadata blob saying what command to run, which ports it expects, what its environment defaults
to, and which user it runs as. A **container** is one running instance of an image with a single
thin **writable layer** on top. Nothing you do inside a container ever modifies the image.

```
        container A                container B
   ┌──────────────────────┐   ┌──────────────────────┐
   │ writable layer  (A)  │   │ writable layer  (B)  │  ← per-container, discarded
   ├──────────────────────┴───┴──────────────────────┤     on `docker rm`
   │ layer 25  docker-entrypoint.sh, CMD, ENV        │
   │ layer 24  WordPress core → /usr/src/wordpress   │  ← read-only, shared,
   │ layer ..  PHP 8.3 + mysqli gd exif imagick      │     content-addressed by digest.
   │ layer ..  Apache 2.4 + mod_rewrite              │     ONE copy on disk no matter
   │ layer  1  debian:bookworm-slim                  │     how many containers run it.
   └─────────────────────────────────────────────────┘
              image: wordpress:6.8-php8.3-apache   (25 layers)
```

Three nouns, three lifetimes. An image is created by `docker pull` and destroyed by
`docker image rm`; a container by `docker run` and destroyed by `docker rm`, `docker compose
down`, or **any recreate**; a volume by `docker volume create` and destroyed only by
`docker volume rm` or `docker compose down -v`. None belongs in git — only the image *tag* does.
Key Concept 6 turns this into the table you will actually consult.

> **The two mistakes, named up front.** First: expecting a file you wrote inside a container to
> survive a recreate — it will not, and the recreate happens every time you change a line of
> `docker-compose.yml`. Second: expecting the database to vanish when you stop the stack — it
> will not, because it lives in a named volume, which is why `down` is safe and `down -v` is
> not.

### 2. Layers, the build cache, and why order matters

Each build instruction produces one layer. Layers are content-addressed — identified by the
digest of their contents — which is why two images built from the same base share the base's
layers on disk and over the network. It is also why **changing a layer invalidates every layer
after it**: everything above a changed layer was computed against a different parent and must be
rebuilt. That dictates the ordering of every `Dockerfile` you will ever write — copy what changes
rarely first, what changes constantly last.

```
❌ WRONG — source before manifest         ✅ RIGHT — manifest before source
──────────────────────────────────        ──────────────────────────────────
COPY . .                                  COPY composer.json composer.lock ./
RUN composer install                      RUN composer install
                                          COPY . .

Edit one PHP file → the COPY layer's      composer.json is unchanged → its
digest changes → `composer install`       layer is a cache HIT → the install
re-runs from scratch. Two minutes,        is skipped entirely. Two seconds.
every single build.
```

You will not write a `Dockerfile` until Module 24, and when you do it copies `composer.json` and
`composer.lock` before anything else, for exactly this reason.

Layer sharing is observable today: when Lesson 02.2 pulls `wordpress:cli-php8.3` after you have
already pulled `wordpress:6.8-php8.3-apache`, the second pull is dramatically faster — not
because it is smaller, but because both share base layers already on your disk.

### 3. Tags are pointers; digests are identity

`wordpress:6.8-php8.3-apache` is a **tag**: a mutable, human-friendly name pointing at whatever
the publisher most recently pushed under it. `wordpress@sha256:<64 hex chars>` is a **digest**:
the content hash of a specific image, and it can never point at anything else.

| | Tag | Digest |
|---|---|---|
| Example | `wordpress:6.8-php8.3-apache` | `wordpress@sha256:…` |
| Mutable | **yes** — the publisher can re-push it | no, mathematically |
| `docker pull` twice, a month apart | may give you different bytes | always identical bytes |
| Use it for | local development, and as documentation of intent | **production deploys and CI** |

This course pins the minor version in the tag — `6.8`, `php8.3`, `8.0` — rather than `latest`,
which pins nothing and is how a WordPress 6.9 breaking change arrives on a Tuesday morning
without you touching a file. Module 24 goes further and deploys by digest, so a rollback is a
re-deploy of a byte-identical artifact rather than a hope.

The cost, stated plainly: pinning means **you do not get security patches for free.** A floating
tag would silently pick up a patched PHP; a pinned tag requires you to bump it, read the
changelog, and re-run your tests. That is more work, and it is the right trade — the alternative
is not "always patched", it is "sometimes patched and sometimes broken, and you cannot tell
which without checking".

### 4. The registry, and the honest limits of "works on my machine"

`docker pull wordpress:6.8-php8.3-apache` resolves a name against a **registry** — Docker Hub by
default — downloads each layer the local store lacks, and verifies each against its digest. That
is why "works on my machine" changes meaning: the machine is now an artifact with a name and a
hash that you can hand to a colleague, to CI, and to Fly.io. Be precise about what that
guarantees, though, because overstating it is how people get surprised:

| The image pins | The image does **not** pin |
|---|---|
| The Linux distribution and every user-space package | Your **kernel** — the container shares the host's |
| PHP's version, compiled extensions and `php.ini` defaults | Your **CPU architecture** — see below |
| Apache's and WordPress core's versions | The **data** in your database |

The architecture caveat matters on any Apple Silicon Mac. Images are built per platform:
`linux/amd64` and `linux/arm64` are different artifacts under the same tag, selected
automatically by your daemon. Both `wordpress` and `mysql` publish multi-platform images, so
this is invisible here — until you need an `amd64`-only image, at which point
`--platform linux/amd64` runs it under emulation, correctly and several times slower.

The data caveat has a course-wide consequence. A shared image gives everyone the same *software*
and an empty database. That is why Module 04 builds `wp blame seed`: a deterministic seeder is
what makes "the same environment" include "the same content", and without it the E2E suite in
Module 23 could not assert on anything.

### 5. `docker run` versus `docker compose`

Both start containers. Only one describes a system.

| | `docker run` | `docker compose` |
|---|---|---|
| Services it starts | one | as many as you declare |
| Where the configuration lives | your shell history | `docker-compose.yml`, in git |
| Networking | the default bridge — **no service-name DNS** | a project network with DNS for every service name |
| Reaching another container | by IP, which changes on every restart | by service name: `db:3306` |
| Reproducible by a colleague | only if you send the exact command | `git clone` and one command |
| **Verdict** | ✅ one throwaway container, and learning what Compose does for you | ✅ **anything that is a system — everything from Lesson 02.2 onward** |

The argument is easiest to see by length. Here is *one* of five services as a `docker run`:

```bash
# Illustrative — do NOT run this. It is what Lesson 02.2 replaces.
docker run -d --name btt-wordpress --network btt-net -p 8080:80 \
  -e WORDPRESS_DB_HOST=db:3306 -e WORDPRESS_DB_NAME=btt \
  -e WORDPRESS_DB_USER=btt -e WORDPRESS_DB_PASSWORD="$WORDPRESS_DB_PASSWORD" \
  -e WORDPRESS_TABLE_PREFIX=wp_ \
  -v "$PWD/wp-content/plugins:/var/www/html/wp-content/plugins" \
  -v "$PWD/wp-content/themes:/var/www/html/wp-content/themes" \
  -v btt-uploads:/var/www/html/wp-content/uploads \
  -v "$PWD/uploads.ini:/usr/local/etc/php/conf.d/uploads.ini:ro" \
  --add-host host.docker.internal:host-gateway --restart unless-stopped \
  wordpress:6.8-php8.3-apache
```

And here is the same thing declared:

```yaml
# wordpress-headless/docker-compose.yml (illustrative — the real one is Lesson 02.2)
services:
  wordpress:
    image: wordpress:6.8-php8.3-apache
    ports: ['8080:80']
    env_file: [.env]
    environment:
      WORDPRESS_DB_HOST: db:3306
    volumes:
      - ./wp-content/plugins:/var/www/html/wp-content/plugins
      - btt-uploads:/var/www/html/wp-content/uploads
    networks: [btt-net]
```

The declarative version is shorter, but length is not the real argument — the real argument is
that it is a *file*. It can be reviewed in a pull request, diffed when it changes, and read by
someone who was not in the room. The `docker run` version carries the same information and none
of those properties, and needs four more invocations like it before you have a working stack.

> **You will still use `docker run` regularly, and this lesson is one of those times.** It is the
> right tool for "start one thing, look at it, throw it away" — precisely the Task below. What it
> is not is a way to run a system.

### 6. Three kinds of storage, three lifetimes

The concept that costs people work, so it gets a diagram and a table.

```
BIND MOUNT — a path on YOUR disk, projected into the container
   ./wp-content/plugins ─▶ /var/www/html/wp-content/plugins
   you edit it · container sees it instantly · lives in git

NAMED VOLUME — storage Docker manages, opaque to your editor
   btt-db-data ─▶ /var/lib/mysql     btt-uploads ─▶ .../wp-content/uploads
   survives `down` · DESTROYED by `down -v` · never in git

WRITABLE LAYER — the container's own thin top layer
   anything written anywhere ELSE, e.g. a plugin installed via wp-admin
   gone on `docker rm` · gone on ANY recreate · invisible to your editor
```

| | Bind mount | Named volume | Writable layer |
|---|---|---|---|
| Use it for | plugins, themes, mu-plugins, config files | the MySQL data directory, `wp-content/uploads` | **nothing you want to keep** |
| You edit it | yes, in your editor | no | no |
| In git | yes | never | never |
| Survives `docker rm` / `down` | it is your disk | yes | **no** |
| Survives `down -v` | it is your disk | **no — destroyed** | **no** |
| macOS performance | slower (filesystem translation) | native | native |

The third column is the one MAMP has no equivalent of, and it is **the number-one source of lost
work in this module**. The classic accident: you install a plugin through wp-admin into a path
that is not bind-mounted, you edit `docker-compose.yml`, Docker recreates the container, and the
plugin is gone with no error message.

Lesson 02.2 fixes this by declaring exactly what persists where — house facts for the rest of
the course: `wp-content/{plugins,themes,mu-plugins}` are bind mounts on your disk and in git;
`/var/lib/mysql` is the named volume `btt-db-data`; `wp-content/uploads` is `btt-uploads`;
**everything else is the writable layer.** Note what is deliberately *not* mounted — WordPress
core, `wp-config.php`, `wp-content/languages`, `wp-content/upgrade`. Those come from the image
or are generated at boot, and treating them as disposable is the point rather than an oversight.

### 7. What is actually inside `wordpress:6.8-php8.3-apache`

You are about to pin your local backend to this image, so know what you are pinning.

| Layer of the stack | What the image provides |
|---|---|
| Base OS | Debian (`bookworm`) |
| Web server | Apache 2.4 with `mod_rewrite` enabled — permalinks work out of the box |
| Language | PHP 8.3 (currently 8.3.28), with `mysqli`, `gd`, `exif`, `imagick`, `opcache`, `intl`, `bcmath`, `sodium` and `zip` installed as extensions |
| Application | WordPress core, staged at **`/usr/src/wordpress`** — not at `/var/www/html` |
| Configuration | `docker-entrypoint.sh` (`CMD` is `apache2-foreground`); PHP drop-ins go in `/usr/local/etc/php/conf.d/`, where Lesson 02.2 mounts `php.ini` and `uploads.ini` |

That `/usr/src/wordpress` detail is not trivia, and Step 3 will surprise you with it. The image
does **not** ship a populated document root — on first boot the entrypoint copies core from
`/usr/src/wordpress` into `/var/www/html`, then writes `wp-config.php` from any `WORDPRESS_*`
variables it finds:

```
WordPress not found in /var/www/html - copying now...
Complete! WordPress has been successfully copied to /var/www/html
No 'wp-config.php' found in /var/www/html, but 'WORDPRESS_...' variables supplied;
   copying 'wp-config-docker.php' (WORDPRESS_DB_HOST WORDPRESS_DB_NAME ...)
```

Read that through Key Concept 6 and something clicks: with nothing mounted at `/var/www/html`,
**the entire WordPress installation lands in the container's writable layer** and is thrown away
on recreate. That is fine — it is regenerated every boot — and it is exactly why `wp-config.php`
is gitignored and why Lesson 02.4 generates it from the environment. See
[appendix 04 §2](../appendix/04-env-reference.md#2-wordpress--wordpress-headlessenv) for the
variable inventory that drives it. Now the fact that catches everyone, which Step 3 makes you
prove with your own hands:

> **The stock `wordpress` image ships no `wp` binary and no `composer`.** Not a broken one — no
> binary at all. This is not a defect; the image is a web server, and WP-CLI is a separate
> official image. It means `docker compose exec wordpress wp …` can never work, and it is why
> Lesson 02.2 declares a fifth service, `wpcli`, on `wordpress:cli-php8.3`, sharing the same
> network, volumes and credentials. **Every WP-CLI command in this course is
> `docker compose run --rm wpcli wp <command>`** — and `--allow-root` is never needed, because that
> image already runs as `www-data`. WP-CLI does **accept** the flag; it is simply a no-op when the
> process is not root, so reaching for it is a sign the `user:` pin has gone missing. Composer arrives the same way, as its own
> service, in Module 03. Note that `docker compose exec wordpress <anything else>` — `php`,
> `bash`, `cat`, `getent` — is correct and you will use it constantly. Only `wp` and `composer`
> are absent.

### 8. Why this course containerises WordPress but not Next.js

Symmetry would suggest containerising both. [PROJECT.md](../PROJECT.md) does not, and the
reasoning is worth having explicitly — you will be tempted to "fix" it in Module 09.

| Criterion | `wordpress-headless/` | `next-app/` |
|---|---|---|
| Does a pinned runtime prevent real bugs? | **yes** — PHP version and extension drift breaks plugins in hard-to-diagnose ways | marginal — `.nvmrc` plus `nvm` already pins Node 22 |
| Files changing per edit session | a handful of PHP files | hundreds, continuously, with a watcher |
| Bind-mount cost on macOS | acceptable — three directories of source | severe — `node_modules` and `.next` are tens of thousands of small files, and every change event crosses the VM boundary |
| Local runtime == production runtime? | **yes, literally the same image** (Module 24) | no — Vercel's runtime is not reproducible locally anyway |
| **Verdict** | ✅ **containerise** | ✅ **run on the host with `npm run dev`** |

The cost, stated plainly: because Next runs on the host, WordPress inside the container cannot
reach it at `localhost:3000` — inside a container, `localhost` is that container. The address is
`host.docker.internal:3000`, Lesson 02.2 adds the `extra_hosts` entry that makes that name
resolve on Linux, and Module 18's revalidation webhook is where forgetting it costs an afternoon.
Module 24 adds an optional overlay running `next-app` in a container purely as a smoke test that
the production image builds; you never develop against it.

---

## Task

Every command below is a bare `docker` command. There is no `docker-compose.yml` yet, no `.env`,
and nothing inside `wordpress-headless/` — Lesson 02.2 creates all of it. The point is to feel,
by hand, the problem Compose exists to solve.

### Step 1: Confirm Docker is running, and know your architecture

```bash
docker --version && docker compose version
# Expected: Docker version 27.x.x (or newer), then Docker Compose version v2.x.x

docker ps
# Expected: a header row (CONTAINER ID  IMAGE  ...). "Cannot connect to the
#           Docker daemon" means Docker Desktop is not started.

docker info --format '{{.Architecture}} {{.OperatingSystem}}'
# Expected: aarch64 or x86_64, then your OS. Note which — it matters the first
#           time you meet an amd64-only image.
```

### Step 2: Pull both images, then look inside them

```bash
# Roughly 700 MB together on a first run
docker pull wordpress:6.8-php8.3-apache
docker pull mysql:8.0
```

Now inspect them rather than trusting the tags:

```bash
# The environment the image DEFAULTS to. Note PHP_VERSION — that is the pin.
docker image inspect --format '{{.Config.Env}}' wordpress:6.8-php8.3-apache
# Expected: a long line including PHP_VERSION=8.3.x and PHP_INI_DIR=/usr/local/etc/php

# How many layers this image is made of
docker image inspect --format '{{range .RootFS.Layers}}{{println .}}{{end}}' \
  wordpress:6.8-php8.3-apache | wc -l
# Expected: about 25 — each one a build instruction

# The DIGEST behind the tag, and what runs if you give the image no command
docker image inspect --format '{{index .RepoDigests 0}}' wordpress:6.8-php8.3-apache
# Expected: wordpress@sha256:<64 hex chars>
docker image inspect --format 'entrypoint={{.Config.Entrypoint}} cmd={{.Config.Cmd}}' \
  wordpress:6.8-php8.3-apache
# Expected: entrypoint=[docker-entrypoint.sh] cmd=[apache2-foreground]
```

**Verify §2:**

- [ ] Both `wordpress:6.8-php8.3-apache` and `mysql:8.0` appear in `docker image ls`.
- [ ] The digest starts `wordpress@sha256:` followed by 64 hex characters. That string, not the
      tag, is what Module 24 deploys.
- [ ] The layer count is around 25, not 1 — a stack, not a disk image.
- [ ] The entrypoint is `docker-entrypoint.sh` (the script that generates `wp-config.php` in
      Lesson 02.4) and the default command is `apache2-foreground`.

### Step 3: Read the image from inside a throwaway container

`docker run --rm <image> <command>` overrides the image's default command, so nothing starts
Apache, the entrypoint skips its WordPress setup, and the container is deleted when the command
exits. It is the cheapest way to interrogate an image.

```bash
# PHP's version and the extensions WordPress, ACF and WPGraphQL rely on
docker run --rm wordpress:6.8-php8.3-apache php -v | head -1
# Expected: a line beginning "PHP 8.3."
docker run --rm wordpress:6.8-php8.3-apache php -m | grep -E '^(mysqli|gd|exif|imagick)$'
# Expected: exactly four lines — exif, gd, imagick, mysqli
#           (opcache reports itself as "Zend OPcache", in two of php -m's sections)

# THE SURPRISE: the document root is nearly EMPTY, and core is staged elsewhere
docker run --rm wordpress:6.8-php8.3-apache ls /var/www/html
# Expected: wp-content — and nothing else
docker run --rm wordpress:6.8-php8.3-apache ls /usr/src/wordpress | head -5
# Expected: index.php, license.txt, readme.html, wp-activate.php, wp-admin

# THE HOUSE RULE. Prove it yourself.
docker run --rm wordpress:6.8-php8.3-apache sh -c 'command -v wp || echo "no wp binary in this image"'
docker run --rm wordpress:6.8-php8.3-apache sh -c 'command -v composer || echo "no composer in this image"'
# Expected: "no wp binary in this image", then "no composer in this image"
```

**Verify §3:**

- [ ] **There is no `wp` binary in the `wordpress` image.** This is the headline: it means
      `docker compose exec wordpress wp …` will never work, however the stack is configured, and
      the only correct invocation in this course is `docker compose run --rm wpcli wp <command>`
      (Lesson 02.2 creates that service). There is no `composer` either — Module 03 adds a
      `composer` service for the same reason.
- [ ] `php -v` reported `PHP 8.3.` — the version is now a fact you can cite, not hope for.
- [ ] All four extensions were present. `imagick` is what makes image resizing work, and it is
      missing from a surprising number of hand-rolled PHP setups.
- [ ] `/var/www/html` contained only `wp-content`, while `/usr/src/wordpress` was a full
      WordPress tree. If that seems backwards, re-read Key Concept 7.

### Step 4: Start a throwaway MySQL, by hand

```bash
docker run -d --name btt-throwaway-db \
  -e MYSQL_ROOT_PASSWORD="$(openssl rand -base64 24)" \
  -e MYSQL_DATABASE=btt \
  mysql:8.0

# MySQL 8 needs ~15 seconds to initialise an empty data directory. Then:
docker logs btt-throwaway-db 2>&1 | grep 'ready for connections' | tail -1
# Expected: a line ending "port: 3306  MySQL Community Server - GPL."
```

> **Even a throwaway container gets a generated password.** `openssl rand -base64 24` produces
> the value, the shell passes it straight into the container's environment, and it is never
> written to a file and never recoverable — fine, because you delete this container in Step 7.
> The habit is the point: the first time you type a literal password because "it is only local"
> is the last time you notice you are doing it.

### Step 5: Start a throwaway WordPress, unlinked, and watch it break

Now start WordPress with correct-looking settings and **no connection to that database**:

```bash
docker run -d --name btt-throwaway-wp -p 8080:80 \
  -e WORDPRESS_DB_HOST=db:3306 \
  -e WORDPRESS_DB_NAME=btt \
  -e WORDPRESS_DB_USER=btt \
  -e WORDPRESS_DB_PASSWORD="$(openssl rand -base64 24)" \
  wordpress:6.8-php8.3-apache

# Wait about twenty seconds, then read the logs and check whether it is alive
docker logs btt-throwaway-wp 2>&1 | head -8
docker ps -a --filter name=btt-throwaway-wp --format '{{.Names}}\t{{.Status}}'
# Expected: btt-throwaway-wp   Up 25 seconds
```

Here is where it gets interesting, and it is not what you would guess. The logs look **fine** —
core is copied in, `wp-config.php` is generated, Apache starts, the container reports `Up`:

```
WordPress not found in /var/www/html - copying now...
Complete! WordPress has been successfully copied to /var/www/html
No 'wp-config.php' found in /var/www/html, but 'WORDPRESS_...' variables supplied; ...
[core:notice] AH00094: Command line: 'apache2 -D FOREGROUND'
```

Now actually ask it for a page, then diagnose from inside the container:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/
# Expected: 500
curl -s http://localhost:8080/ | grep -o 'Error establishing a database connection'
# Expected: Error establishing a database connection

# Can this container resolve the hostname it was told to use?
docker exec btt-throwaway-wp getent hosts db; echo "getent exit=$?"
# Expected: NO output, and getent exit=2 — the name `db` resolves to nothing

# Ask PHP directly, to see the underlying error text
docker exec btt-throwaway-wp php -r 'mysqli_connect("db","btt","x","btt");' 2>&1 | head -2
# Expected: php_network_getaddresses: getaddrinfo for db failed: Name or service not known
```

Read that last error precisely. It does not say "access denied" and it does not say "connection
refused". It says **`getaddrinfo for db failed`** — the hostname could not be resolved at all,
so the credentials were never even tried. `docker run` attaches each container to the **default
bridge network**, which deliberately provides no service-name DNS, so `db` resolves to nothing
from inside `btt-throwaway-wp` even though a container called `btt-throwaway-db` is running two
inches away. No amount of correct credentials fixes a name that does not resolve.

What fixes it is not a longer command. It is **one declarative file that creates a network and
gives every service a name that resolves on it** — which is Lesson 02.2, and which is why that
lesson opens by telling you `WORDPRESS_DB_HOST` is `db:3306` and never `localhost:3306`.

> **Notice how badly this failure announces itself.** The container is `Up`, the logs contain
> nothing alarming, and the message WordPress prints — "Error establishing a database
> connection" — names neither the hostname nor DNS. When you meet this for real,
> `getent hosts <name>` from inside the container is the first thing to run, and it is the first
> check in [appendix 06 §1](../appendix/06-troubleshooting.md#1-docker--the-stack).

**Verify §5:**

- [ ] `docker ps` reported `btt-throwaway-wp` as **`Up`** — a running container is not a working
      one.
- [ ] `curl` returned **500** and the body contained `Error establishing a database connection`.
- [ ] `getent hosts db` produced **no output** and exited non-zero, the PHP probe printed
      `getaddrinfo for db failed`, and you can state the failure in one sentence without using
      the word "credentials".

### Step 6: Prove the three lifetimes

Write into a container's **writable layer**, overriding the command with `sleep` so it stays
alive without a database:

```bash
# 1. A long-running container (no database required), then write into its writable layer
docker run -d --name btt-layer-demo wordpress:6.8-php8.3-apache sleep 600
docker exec btt-layer-demo sh -c 'echo hi > /var/www/html/ephemeral.txt'

# 2. Restart the SAME container — the writable layer belongs to it and survives
docker restart btt-layer-demo && sleep 2
docker exec btt-layer-demo cat /var/www/html/ephemeral.txt
# Expected: hi

# 3. Now DELETE the container and make a fresh one from the same image
docker rm -f btt-layer-demo
docker run --rm wordpress:6.8-php8.3-apache \
  sh -c 'cat /var/www/html/ephemeral.txt 2>/dev/null || echo "GONE — it was in the writable layer"'
# Expected: GONE — it was in the writable layer
```

Now the same experiment with a **named volume**:

```bash
# 1. Create the volume, then write into a path backed by it, in a throwaway container
docker volume create btt-volume-demo
docker run --rm -v btt-volume-demo:/data wordpress:6.8-php8.3-apache \
  sh -c 'echo persisted > /data/proof.txt'

# 2. Brand-new container, same volume — the file is still there, and the volume
#    exists independently of any container
docker run --rm -v btt-volume-demo:/data wordpress:6.8-php8.3-apache cat /data/proof.txt
# Expected: persisted
docker volume ls --filter name=btt-volume-demo
# Expected: one row — DRIVER local, VOLUME NAME btt-volume-demo
```

**Verify §6:**

- [ ] The writable-layer file survived `docker restart` on the **same** container and was
      **gone** in a new one — the category MAMP has no equivalent of.
- [ ] The named-volume file survived the container that wrote it being removed entirely, twice.
- [ ] You can now answer the question Lesson 02.2 will ask: which of `btt-db-data` and
      `./wp-content/plugins` does `docker compose down -v` destroy?

### Step 7: Clean up completely

```bash
docker rm -f btt-throwaway-db btt-throwaway-wp btt-layer-demo 2>/dev/null
docker volume rm btt-volume-demo

docker ps -a --filter name=btt- --format '{{.Names}}'; docker volume ls --filter name=btt- -q
# Expected: no output from either
```

> **Do not run `docker image rm` on the two images you just pulled.** Lesson 02.2 needs both,
> and re-pulling is roughly 700 MB. Removing *containers* and *volumes* is what you want; the
> images stay in your local store and cost nothing but disk.

### Step 8: Write ADR 0002

Continue the ADR habit from Lesson 01.3. Same rules: sequential permanent numbers, and
Consequences is the section that matters.

```markdown
<!-- docs/adr/0002-containerise-wordpress-not-next.md -->
# ADR 0002 — Containerise WordPress, run Next.js on the host

- **Status:** Accepted
- **Date:** 2026-01-15   <!-- TODO: today's date, ISO 8601 -->
- **Supersedes:** —

## Context

Local development needs a pinned PHP 8.3 with `mysqli`, `gd`, `exif`, `imagick` and `opcache`,
a real MySQL 8, an SMTP sink and a SQL console. None of that is reliably available from a host
package manager; all of it is available as an image. Next.js needs Node 22 — which `.nvmrc` plus
`nvm` already pins — plus a watcher firing thousands of times an hour across `node_modules`.

## Decision

TODO: two or three sentences in your own words. Say which application runs where, and name the
hostname WordPress must use to reach Next as a direct consequence.

## Alternatives Considered

| Alternative | How it would work | Why not |
|---|---|---|
| Both applications in Compose | a `next` service with a bind mount for `src/` | TODO: macOS file-event latency, `node_modules` inside a mount, and what you actually gain |
| Neither in Docker (MAMP or host PHP) | Homebrew PHP + MySQL, `npm run dev` alongside | TODO: what stops being reproducible, and what Module 24 could no longer promise |
| WordPress in Compose, Next on the host | TODO | TODO: this is the one you chose |

## Consequences

### Positive — TODO: at least two

### Negative

Rewrite both of these in your own words, completing the `TODO`s, and add any others you see.

- Bind-mounting `wp-content` on macOS is measurably slower than native filesystem access,
  because every read crosses a filesystem translation layer. TODO: which directories, and which
  module notices first.
- The local Next.js runtime is **not** pinned the way PHP is. `.nvmrc` records the intended
  version but nothing enforces it — a colleague with Node 20 active gets a different dependency
  resolution and no error at install time. TODO: what would actually enforce it, and why the
  course accepts the risk instead.

## Related

- ADR 0001 — the headless split (Lesson 01.3)
- Lesson 02.2 — the Compose file this decision produces
```

**Verify §8:**

- [ ] The file exists, with a `**Status:**` line, a real ISO 8601 date, and at least **two**
      negative consequences in your own words, with no `TODO` left anywhere.
- [ ] The Decision section names `host.docker.internal:3000`. If it does not, you recorded the
      decision without its most consequential side effect.

---

## Verification

```bash
# 1. Docker is present and the daemon is up
docker --version
docker ps >/dev/null 2>&1 && echo "daemon: up" || echo "daemon: DOWN"
# Expected: a version line (27.x.x or newer), then "daemon: up"

# 2. Both pinned images are in the local store — Lesson 02.2 needs them
docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E 'wordpress:6.8-php8.3-apache|mysql:8.0'
# Expected: two lines — mysql:8.0 and wordpress:6.8-php8.3-apache

# 3. PHP's version, its extensions, and the staged-not-installed document root
docker run --rm wordpress:6.8-php8.3-apache php -v | head -1
# Expected: a line beginning "PHP 8.3."
docker run --rm wordpress:6.8-php8.3-apache php -m | grep -cE '^(mysqli|gd|exif|imagick)$'
# Expected: 4
docker run --rm wordpress:6.8-php8.3-apache ls /var/www/html
# Expected: wp-content, nothing else — the entrypoint copies core in at boot (KC 7)

# 5. THE NEGATIVE that carries this lesson: there is no WP-CLI in this image
docker run --rm wordpress:6.8-php8.3-apache sh -c 'command -v wp; echo "wp exit=$?"'
docker run --rm wordpress:6.8-php8.3-apache sh -c 'command -v composer; echo "composer exit=$?"'
# Expected: no paths printed, and exit=127 twice ("command not found").
#           This is why the ONLY correct WP-CLI invocation in this course is
#           `docker compose run --rm wpcli wp <command>`, and why
#           `docker compose exec wordpress wp ...` can never work.

# 6. A SECOND NEGATIVE: the throwaway containers and volume from Steps 4-7 are gone
docker ps -a --filter name=btt- --format '{{.Names}}'; docker volume ls --filter name=btt- -q
# Expected: no output from either

# 7. Nothing holds port 8080, and nothing was created in wordpress-headless/
lsof -nP -iTCP:8080 -sTCP:LISTEN; ls wordpress-headless/
# Expected: no output from lsof (a hit is a leftover container or MAMP), then
#           README.md alone — that directory fills up in Lesson 02.2.

# 8. ADR 0002 exists and is finished
test -f docs/adr/0002-containerise-wordpress-not-next.md && echo "adr: present"
grep -c 'TODO' docs/adr/0002-containerise-wordpress-not-next.md
grep -q 'host.docker.internal' docs/adr/0002-containerise-wordpress-not-next.md && echo "consequence: recorded"
# Expected: "adr: present", then 0, then "consequence: recorded"
```

The observation to carry into the next lesson is Step 5's: two containers, both running, both
correctly configured, unable to find each other — with `docker ps` reporting `Up` the whole time.
`getaddrinfo for db failed` is what `docker-compose.yml` exists to make impossible, and Lesson
02.2 writes it.

## Control Questions

1. You edit one line in a plugin PHP file and rebuild an image whose `Dockerfile` runs
   `COPY . .` before `RUN composer install`. Explain, in terms of layer digests, why
   `composer install` runs again — and what reordering two lines would change.
2. `wordpress:6.8-php8.3-apache` and `wordpress@sha256:…` refer to the same bytes today. Describe
   a sequence of events after which they do not, and say which belongs in a production deploy.
3. In Step 5 `docker ps` said `Up` and the logs looked clean, yet the site returned 500. Explain
   what that gap tells you about what container status measures, and name the one command that
   localised the fault in a single line.
4. You install a plugin through wp-admin, edit `docker-compose.yml` an hour later, run
   `docker compose up -d`, and the plugin is gone. Name the storage category it was in, why no
   error was reported, and which mount from Lesson 02.2 would have saved it.
5. The `wordpress` image contains no `wp` binary. Explain why
   `docker compose exec wordpress php -r '...'` is a perfectly normal command in this course
   while `docker compose exec wordpress wp option get siteurl` is not, and what the `wpcli`
   service must share with `wordpress` for the correct form to work at all.

## Learn More

- [The `wordpress` image on Docker Hub](https://hub.docker.com/_/wordpress) — the full list of
  `WORDPRESS_*` variables and the tag matrix; note what it says about `/usr/src/wordpress`
- [The `mysql` image on Docker Hub](https://hub.docker.com/_/mysql) — specifically the "Where to
  Store Data" section, the canonical argument behind Key Concept 6
- [Docker storage overview](https://docs.docker.com/engine/storage/) — Docker's own decision
  guide for bind mounts versus volumes, including the macOS performance note
- [Docker build cache](https://docs.docker.com/build/cache/) — the layer-invalidation rules from
  Key Concept 2, with the ordering advice Module 24's `Dockerfile` follows
- [Docker networking overview](https://docs.docker.com/engine/network/) — why the default bridge
  provides no service-name DNS: exactly the failure you produced in Step 5
- [`docker run` reference](https://docs.docker.com/reference/cli/docker/container/run/) — every
  flag used in Steps 4 to 6, and the ones Compose sets for you from Lesson 02.2 onward

