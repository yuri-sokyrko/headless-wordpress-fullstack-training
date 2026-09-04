---
title: 'Daily Workflow & Troubleshooting'
module: 2
lesson: 6
teaches: [compose-daily-workflow, container-logs, wp-cli-in-container, volume-reset, runbook]
produces: ['wordpress-headless/README.md']
requires: [2.5]
---

# Lesson 02.6 — Daily Workflow & Troubleshooting

## Quick Overview

The stack works. Now you need the six commands you will type every day for the next 22 modules,
and the diagnostic sequence for when one of them does not do what you expect. `docker compose
up -d`, `ps`, `logs -f wordpress`, `exec wordpress bash`, `down`, and — the one to be careful
with — `down -v`. That last flag deletes named volumes, which means your database and your
uploads, and it is the difference between "restart the stack" and "start the module over".

You will also run WP-CLI for the first time. WP-CLI lives inside the `wordpress` container, so
every invocation is `docker compose run --rm wpcli wp <command>`, and you will alias
it because you are about to type it several hundred times. Then you write
`wordpress-headless/README.md` — replacing the placeholder that shipped with the repo — as a
real runbook: the start command, the ports, the reset procedure, and the three failure modes
that account for most of the pain in this module. Writing the runbook is not busywork; the
resume-after-a-gap problem is real, and Module 24 will turn parts of this file into a deploy
checklist.

By the end of this lesson you will have:

- `wordpress-headless/README.md` — your own runbook, replacing the shipped placeholder
- A shell alias or script for `wp` inside the container, verified with `wp core version`
- A deliberate break-and-fix cycle: stop `db`, watch `logs -f wordpress` report the failure,
  bring it back
- The full reset procedure written down, with `down -v` clearly labelled as destructive
- A troubleshooting table covering port conflicts, the `db:3306` versus `localhost:3306`
  mistake, and file-permission errors on bind-mounted plugin directories

## Classic WP Analogy

Your MAMP workflow had a runbook too — it was just in your head. Open MAMP, click Start, check
the ports page, open phpMyAdmin if something looked wrong, tail
`/Applications/MAMP/logs/php_error.log` when a plugin white-screened, and restore from a `.sql`
dump when you broke the database. Every one of those has an exact counterpart here:
`docker compose up -d` replaces Start, `docker compose ps` replaces the ports page, Adminer on
`:8081` replaces phpMyAdmin, `docker compose logs -f wordpress` replaces tailing the PHP error
log, and a volume reset replaces the `.sql` restore.

WP-CLI is the one piece that carries over unchanged in *behaviour* and changes in *invocation*.
`wp plugin list`, `wp post create`, `wp search-replace`, `wp db export` all work exactly as you
remember. The only difference is that the command must run inside the container, as
`www-data`, so that any files it creates are owned by the user Apache runs as. Getting the `-u
www-data` right the first time avoids a whole category of "permission denied" confusion later,
particularly in Module 04 when the seeder sideloads media.

**Where the analogy breaks down:** when MAMP misbehaved, everything was inspectable with tools
you already had — the filesystem was right there, the process was in Activity Monitor, the log
was a file you could open. A container is opaque by default. The process list you care about is
inside a namespace, the log is a stream you have to ask for, and the filesystem you are looking
at in your editor is only the three directories you bind-mounted; everything else is somewhere
you have to `exec` into to see. This is why the module leans so heavily on `docker compose ps`
and `logs` in every Verification block: in a container world, "I can see that it is running" is
a claim that requires a command, not a glance.

---

## Key Concepts

### 1. The eight commands, and what each one does not do

Almost everything you do for the next 22 modules is one of these. The third column is the one
worth reading — most confusion in this module comes from expecting a command to do something it
never claimed to.

| Command | What it does | What it does **not** do | Reach for it when |
|---|---|---|---|
| `up -d` | Creates and starts containers, detached | Wait for anything to be *ready*. Recreate containers whose compose definition changed, in every case | Starting your day |
| `up -d --wait` | Same, then blocks until every healthcheck passes | Tell you *why* a healthcheck failed | Scripts and CI, where the next command must not run early |
| `ps` | Lists containers in this project, with health | Show run-on-demand services like `wpcli` | Anything is behaving oddly |
| `logs -f wordpress` | Streams a service's stdout/stderr | Show PHP warnings — those go to `debug.log` | Almost every failure in this module |
| `exec wordpress <cmd>` | Runs a command **inside the already-running** container | Work if the container is not running | `php`, `bash`, `cat`, `getent`, `tail` |
| `run --rm wpcli <cmd>` | Creates a **new** container, runs one command, deletes it | Reuse the running container's memory or state | Every WP-CLI invocation |
| `down` | Stops and removes containers and the network | Touch named volumes or your bind mounts | Ending your day, or after editing compose |
| `restart wordpress` | Stops and starts one container | Pick up compose-file changes | Apache is wedged but config is unchanged |

The `exec` versus `run --rm` distinction is the one that repays understanding, because it
explains why `wpcli` never shows up in `docker compose ps`:

```
docker compose exec wordpress bash          docker compose run --rm wpcli wp core version
─────────────────────────────────           ────────────────────────────────────────────────
   ┌──────────────────────┐                    ┌──────────────────────┐
   │ btt-wordpress-1      │  ◀── attach        │ btt-wpcli-run-a1b2   │  ◀── created now
   │ already running      │                    │ runs one command     │
   │ shares its state     │                    │ then --rm deletes it │
   └──────────────────────┘                    └──────────────────────┘
   requires a running container                needs no running container
```

`wpcli` is declared as a service so it inherits the network, the environment and the volumes —
but it runs zero containers until you ask it to, and the container it creates is gone a second
later. That is correct, and `docker compose ps` omitting it is not a bug.

### 2. The two-`-f` invocation, and one correction to your WP-CLI mental model

Every start in this course is two files:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Forget the second `-f` and the stack still comes up — which is exactly the problem. You get no
`WORDPRESS_DEBUG`, so nothing lands in `debug.log`, and no published `3306`, so a host MySQL
client cannot connect. Neither failure appears now; both appear later, in the Lesson 02.3
drills or the first time you need a warning logged. Step 3 wraps this in a `Makefile` so the
two flags stop being something you can forget.

> **One correction to make to your mental model.** WP-CLI does **not** live in the `wordpress`
> container. The stock `wordpress:6.8-php8.3-apache` image ships no `wp` binary at all — and no
> `composer` either. That is precisely why `docker-compose.yml` declares a separate `wpcli`
> service on `wordpress:cli-php8.3`, sharing the same network, environment and volumes. The
> `cli` image already runs as `www-data`, so there is nothing to pass: `-u www-data` is
> unnecessary and `--allow-root` is invalid and will be rejected.

```bash
# ✅ The only correct WP-CLI invocation in this course
docker compose run --rm wpcli wp <command>

# ❌ Wrong — the stock wordpress image ships no `wp` binary at all
docker compose exec wordpress wp <command>

# ❌ Also wrong — `--allow-root` is invalid for the cli image, which runs as www-data
docker compose run --rm wpcli wp <command> --allow-root
```

Everything *else* through `exec` is correct and common — `docker compose exec wordpress php`,
`bash`, `cat`, `getent`, `tail`. It is only `wp` and `composer` that are absent. The full
command list is [appendix 07 §2](../appendix/07-command-reference.md#2-wp-cli), and the
runbook you write in Step 4 must agree with it.

### 3. `down` versus `down -v`, drawn

One flag is the difference between "restart the stack" and "start the module over".

```
                      ./wp-content/plugins    btt-db-data      btt-uploads     container
                      (bind mount, your disk) (named volume)   (named volume)  writable layer
─────────────────────────────────────────────────────────────────────────────────────────────
docker compose down          SURVIVES            SURVIVES         SURVIVES        destroyed
docker compose down -v       SURVIVES          ⚠️ DESTROYED     ⚠️ DESTROYED      destroyed
docker compose up -d
  --force-recreate           SURVIVES            SURVIVES         SURVIVES        destroyed
```

Your plugin and theme code is on your own disk, projected into the container. No Docker command
in this course can delete it. Your database and your media are Docker-managed volumes, and
`-v` deletes them without a confirmation prompt.

Three scenarios, and the right command for each:

| You want to | Command | Cost |
|---|---|---|
| Restart the stack | `docker compose down` then `up -d` with both `-f` flags | Nothing. Content, users and uploads are intact. |
| **Reset the database, keep your code** | `docker compose run --rm wpcli wp db reset --yes`, then `wp core install …` again (Lesson 02.2 Step 8) | Content and users gone; plugins, themes, uploads and code intact. **This is the one you want almost every time.** |
| Start the module over | `docker compose down -v` | ⚠️ Database *and* uploads destroyed. Reinstall from scratch. |

`wp db reset --yes` drops and recreates the schema through WP-CLI, so it never touches the
volume and never touches your files. Reaching for `down -v` when you meant `db reset` is the
most common self-inflicted wound in this module — from Module 04 onward the recovery is
`wpx blame seed --fresh`, but right now it is a full `wp core install`.

### 4. Three logs, three places

"Check the logs" is ambiguous here, because there are three and they contain different things.

| Log | Where | How to read it | Contains |
|---|---|---|---|
| Container stdout | Docker's log driver | `docker compose logs -f wordpress` | Apache access and error lines, the entrypoint's output, PHP fatals |
| WordPress debug | `/var/www/html/wp-content/debug.log`, **inside** the container | `docker compose exec wordpress tail -f /var/www/html/wp-content/debug.log` | PHP notices, warnings, deprecations, `error_log()` from plugins |
| MySQL | Docker's log driver | `docker compose logs db` | `ready for connections`, InnoDB messages, auth failures |

The middle row catches everyone. `debug.log` is **not visible in your editor**, because
`wp-content` itself is not bind-mounted — only its three subdirectories `plugins`, `themes` and
`mu-plugins` are. You will look for the file on your disk and not find it.

Two flags worth memorising: `--tail=100` to get the last hundred lines instead of everything,
and `--since=5m` to get only what happened while you were reproducing the bug.

### 5. Port collisions

The symptom is unmistakable and arrives at `up` time:

```
Error response from daemon: driver failed programming external connectivity:
bind: address already in use
```

One command diagnoses it — substitute the port from the message:

```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN
```

| Culprit | How you know | Fix |
|---|---|---|
| MAMP, XAMPP or Local still running | `lsof` names `httpd`, `mysqld` or `com.docker` is absent from the output | Quit it. The Module 02 README warns about this for exactly this reason. |
| A stale container from another project | `docker ps -a` shows a container holding the port | `docker rm -f <name>`, or `docker compose down` in that project's directory |
| A second copy of this stack under another project name | `docker compose ls` shows two projects | `docker compose -p <other> down` |

[Appendix 06 §1](../appendix/06-troubleshooting.md#1-docker--the-stack) has the fuller list, and
the diagnosis order there is the one to follow when `lsof` comes back empty.

### 6. The bind-mount-not-updating check

This two-command diagnostic answers "is my file even reaching the container?", which is the
first question in a surprising number of failures.

```
   write a file on the host  ──▶  docker compose exec wordpress cat <same path in container>
                                          │
              ┌───────────────────────────┴────────────────────────────┐
              ▼                                                        ▼
   "No such file or directory"                             the content prints
              │                                                        │
   The MOUNT is wrong:                                    The mount is FINE.
   · path typo in docker-compose.yml                      If WordPress still shows old
   · container predates the mount                         behaviour it is a CACHE:
     → up -d --force-recreate                             · opcache  → restart wordpress
   · you are in the wrong directory                       · object cache → wpx cache flush
                                                          · rewrite rules → wpx rewrite flush
```

The "container predates the mount" branch deserves emphasis: **`docker compose up -d` does not
always recreate a container after you edit the compose file.** It compares its own idea of the
config hash and sometimes decides nothing changed. When a mount, an environment variable or a
port you just added has no effect, `docker compose up -d --force-recreate` is the answer, and
it costs a few seconds.

### 7. Mailpit, and why captured mail is a workflow tool

Mailpit is an SMTP server that accepts everything and delivers nothing. That is the entire
value: mail is inspectable and **nothing leaves your machine**.

| What | Where |
|---|---|
| Web UI | `http://localhost:8025` |
| SMTP, from inside the Compose network | `mailpit:1025` |
| JSON API (used by the Verification block, and by Module 23's tests) | `http://localhost:8025/api/v1/messages` |

This matters more than it sounds. Module 15 sends account-verification mail and Module 16 sends
lead notifications, and seeded or hand-typed addresses have a habit of being real. A local SMTP
sink means a test run cannot email a stranger.

> **Be clear about what is not wired up yet.** WordPress's `wp_mail()` uses PHP's `mail()` by
> default, which is not Mailpit. Pointing WordPress at `mailpit:1025` needs a `phpmailer_init`
> hook, and that belongs to the plugin — it lands with the mail work in Module 15, using the
> `BTT_SMTP_HOST` and `BTT_SMTP_PORT` variables you already have in `.env`. So if you trigger a
> `wp_mail()` today, the Mailpit inbox may well stay empty. The service is running and reachable
> now; the delivery path is finished later.

### 8. The troubleshooting table

Eight failures that account for most of the pain in this module. One command each — run that
before changing anything.

| Symptom | Likeliest cause | Confirm with | Fix |
|---|---|---|---|
| "Error establishing a database connection" | `WORDPRESS_DB_HOST` is `localhost`; inside Compose it must be the service name | `docker compose exec wordpress getent hosts db` | Set `db:3306`. Lesson 02.2 §2. |
| `wordpress` restarts in a loop | `depends_on` without `condition: service_healthy`, so it started before MySQL was ready | `docker compose logs db \| tail -30` | Add the healthcheck condition. Lesson 02.2 §4. |
| `bind: address already in use` | Another process or container owns the port | `lsof -nP -iTCP:8080 -sTCP:LISTEN` | Key Concept 5. |
| Plugin edits do nothing | Bind mount missing, or the container predates it | `docker compose exec wordpress ls /var/www/html/wp-content/plugins` | Key Concept 6, then `up -d --force-recreate`. |
| `wp: command not found`, or "This does not seem to be a WordPress installation" | You ran `wp` on the host, or via `exec wordpress`, which has no `wp` | `docker compose exec wordpress sh -c 'command -v wp'` | `docker compose run --rm wpcli wp …`. Key Concept 2. |
| White screen, empty 500, after editing config | PHP syntax error. `WP_DEBUG_DISPLAY` is `false`, so the browser shows nothing | `docker compose logs --tail=30 wordpress` | Fix the file and line the log names. |
| All content gone | `docker compose down -v` destroyed `btt-db-data` | `docker volume ls \| grep btt` | Reinstall, then Module 04's seeder. Key Concept 3. |
| "Permission denied" writing into a bind-mounted directory | The container runs as `www-data`; your host user owns the files | `docker compose exec wordpress ls -la /var/www/html/wp-content/plugins` | `sudo chown -R $(id -u):$(id -g) wp-content/` on Linux. |

That last row is platform-dependent and worth knowing before it happens. On **Docker Desktop**
(macOS, Windows) the file-sharing layer maps ownership for you, so files WP-CLI creates inside a
bind mount appear as yours and this never bites. On **Linux**, the container's `www-data` UID is
a real UID on your machine, so a file `wpcli` writes into `wp-content/plugins` is owned by that
UID and your editor cannot save over it. It shows up first in Module 04, when the seeder
sideloads media.

[Appendix 06](../appendix/06-troubleshooting.md) is the full list, organised by layer, and it
covers the GraphQL, Next.js and auth failures that are still ahead of you.

---

## Task

### Step 1: Add the `wpx` alias and use it

You are about to type `docker compose run --rm wpcli wp` several hundred times.

```bash
cd wordpress-headless
alias wpx='docker compose run --rm wpcli wp'

wpx core version
wpx plugin list
wpx theme list --status=active --field=name
```

> **This alias is per-shell and per-directory.** It vanishes when you close the terminal, and it
> only works while your working directory is `wordpress-headless/`, because `docker compose`
> resolves the compose files relative to the cwd. Adding it to `.zshrc` fixes the first problem
> and not the second. Step 3 writes a `Makefile` for exactly that reason. The alias is the form
> used throughout [appendix 07 §2](../appendix/07-command-reference.md#2-wp-cli), so it is worth
> having in the session.

**Verify §1:**

- [ ] `wpx core version` prints a version starting `6.8`.
- [ ] `wpx plugin list` prints a table. An empty table is fine — no plugins yet.
- [ ] `wpx theme list --status=active --field=name` prints `btt-headless` from Lesson 02.4.

### Step 2: Break it on purpose, then fix it

You have read what a missing database looks like. Now see it, so you recognise it in three
weeks. Open a second terminal for the logs.

```bash
# Terminal 1 — watch the logs
docker compose logs -f wordpress

# Terminal 2 — take the database away
docker compose stop db
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/
docker compose ps
```

Now put it back:

```bash
docker compose start db
docker compose ps                     # repeat until db shows (healthy)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/
```

**Verify §2:**

- [ ] With `db` stopped, the `curl` returned `500` (or `502`), **not** `200`.
- [ ] `docker compose ps` showed `db` as `exited`, or omitted it entirely.
- [ ] Terminal 1 showed a database-connection error from WordPress or PHP.
- [ ] After `start db` and a `(healthy)` status, the `curl` returned `302` again — the
      Lesson 02.4 redirect, which means WordPress is fully back.
- [ ] You did **not** need to restart `wordpress`. It recovers on its own once `db` answers,
      which is worth knowing before you reflexively restart everything.

### Step 3: Write the `Makefile`

One place for the two-`-f` invocation, so it is impossible to forget.

```make
# wordpress-headless/Makefile
#
# Thin wrapper around docker compose. Every command here is the same command that appears
# in ../.lessons/appendix/07-command-reference.md — this file adds no new behaviour, it
# just stops you from typing two -f flags four hundred times.
#
# Usage:  make up          make wp ARGS="plugin list"        make help

COMPOSE := docker compose -f docker-compose.yml -f docker-compose.dev.yml
WP      := $(COMPOSE) run --rm wpcli wp

.DEFAULT_GOAL := help
.PHONY: help up up-wait down nuke ps logs logs-db sh wp reset-db debug-log mail adminer

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

up: ## Start the stack, detached
	$(COMPOSE) up -d

up-wait: ## Start and block until every healthcheck passes (what CI uses)
	$(COMPOSE) up -d --wait

down: ## Stop and remove containers. Volumes and your code are untouched.
	$(COMPOSE) down

nuke: ## DESTRUCTIVE: down -v — deletes btt-db-data and btt-uploads
	@printf 'This deletes the database AND uploads. Type YES to continue: ' \
		&& read ans && [ "$$ans" = "YES" ] || (echo "Aborted."; exit 1)
	$(COMPOSE) down -v

ps: ## What is running, and is it healthy?
	$(COMPOSE) ps

logs: ## Follow the WordPress container log
	$(COMPOSE) logs -f wordpress

logs-db: ## Follow the MySQL container log
	$(COMPOSE) logs -f db

sh: ## A shell inside the wordpress container
	$(COMPOSE) exec wordpress bash

wp: ## Run WP-CLI:  make wp ARGS="plugin list"
	$(WP) $(ARGS)

reset-db: ## Drop and recreate the schema. Keeps plugins, themes and uploads.
	$(WP) db reset --yes
	@echo 'Schema dropped. Re-run wp core install — see Lesson 02.2 Step 8.'

debug-log: ## Follow wp-content/debug.log (inside the container)
	$(COMPOSE) exec wordpress tail -f /var/www/html/wp-content/debug.log

mail: ## Open Mailpit
	@echo "http://localhost:8025"

adminer: ## Open Adminer
	@echo "http://localhost:8081"
```

`make` ships with macOS (via the Command Line Tools) and every Linux distribution. On Windows
without WSL there is no `make`, so use the `wpx` alias from Step 1 plus the raw
`docker compose -f … -f …` commands; nothing in the rest of the course depends on the
`Makefile` existing.

> **Recipes are indented with a literal tab, not spaces.** `make` rejects spaces with
> `Makefile:12: *** missing separator. Stop.` — which is the least helpful error message in this
> module. If your editor converts tabs, the repo's `.editorconfig` already exempts `Makefile`.

**Verify §3:**

- [ ] `make help` lists every target with its description.
- [ ] `make ps` prints the same table as `docker compose ps`.
- [ ] `make wp ARGS="core version"` prints the WordPress version.
- [ ] `make nuke` **prompts** before doing anything. Type anything other than `YES` and confirm
      it aborts — do not type `YES`.

### Step 4: Write your runbook, replacing the placeholder

`wordpress-headless/README.md` currently holds the "this directory is empty on purpose"
placeholder that shipped with the repo. **You are replacing it, not appending to it** — that
placeholder describes a state that no longer exists. This is the file's `produces:` entry, and
Module 24 turns parts of it into a deploy checklist.

````markdown
<!-- wordpress-headless/README.md -->
# wordpress-headless

The WordPress half of Blame The Tech: a Docker Compose stack serving `/wp-admin` and, from
Module 05, `/graphql`. Next.js lives in `../next-app` and runs on the host.

## Quick start

```bash
cd wordpress-headless
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait
# or: make up-wait
```

| URL | What |
|---|---|
| <http://localhost:8080> | WordPress — redirects to the front end (Lesson 02.4) |
| <http://localhost:8080/wp-admin> | The editor dashboard |
| <http://localhost:8081> | Adminer — raw SQL and `EXPLAIN` plans |
| <http://localhost:8025> | Mailpit — every `wp_mail()`, captured, never delivered |

## Services

| Service | Image | Published | Purpose |
|---|---|---|---|
| `wordpress` | `wordpress:6.8-php8.3-apache` | `8080` → `80` | The CMS, Apache, PHP 8.3 |
| `db` | `mysql:8.0` | `3306` (dev only) | MySQL. Data in the `btt-db-data` volume. |
| `adminer` | `adminer:5` | `8081` → `8080` | SQL console and query plans |
| `mailpit` | `axllent/mailpit` | `8025` UI, `1025` SMTP | Captured mail |
| `wpcli` | `wordpress:cli-php8.3` | — | WP-CLI, run on demand. Absent from `ps` by design. |

Project name `btt`, network `btt-net`. Database name and user are both `btt` — never `root`
for the application.

## Everyday commands

| Task | Command |
|---|---|
| Start | `make up` (or `up-wait` to block on healthchecks) |
| Status | `make ps` |
| WordPress log | `make logs` |
| `debug.log` | `make debug-log` |
| Shell in the container | `make sh` |
| WP-CLI | `make wp ARGS="plugin list"` |
| Stop | `make down` |

WP-CLI is **always** `docker compose run --rm wpcli wp <command>`. The stock `wordpress` image
ships no `wp` binary and no `composer`; `--allow-root` is invalid for the `cli` image, which
already runs as `www-data`. Full list:
[appendix 07](../.lessons/appendix/07-command-reference.md).

## Resetting

| You want to | Command |
|---|---|
| Restart the stack | `make down && make up` |
| Reset the database, keep your code | `make reset-db`, then re-run `wp core install` |
| Start over completely | `make nuke` — ⚠️ **destroys `btt-db-data` and `btt-uploads`** |

⚠️ `docker compose down -v` (what `make nuke` runs) deletes the database **and** all uploaded
media. Your plugin and theme code is a bind mount on your own disk and survives everything.

## Where the logs are

| Log | Command | Contains |
|---|---|---|
| Container stdout | `docker compose logs -f wordpress` | Apache, the entrypoint, PHP fatals |
| WordPress debug | `docker compose exec wordpress tail -f /var/www/html/wp-content/debug.log` | Notices, warnings, `error_log()` |
| MySQL | `docker compose logs -f db` | `ready for connections`, InnoDB, auth failures |

`debug.log` is inside the container. `wp-content` itself is not bind-mounted — only `plugins`,
`themes` and `mu-plugins` are — so the file is not visible in your editor.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Error establishing a database connection" | `WORDPRESS_DB_HOST` is `localhost` | Use `db:3306` — the service name |
| `bind: address already in use` | Another process owns the port | `lsof -nP -iTCP:8080 -sTCP:LISTEN` |
| `wordpress` restarts in a loop | Started before MySQL was ready | `depends_on` needs `condition: service_healthy` |
| Plugin edits do nothing | Bind mount wrong, or container predates it | `docker compose up -d --force-recreate` |
| `wp: command not found` | Ran `wp` on the host or via `exec wordpress` | `docker compose run --rm wpcli wp …` |
| White screen, empty 500 | PHP syntax error; `WP_DEBUG_DISPLAY` is `false` | `docker compose logs --tail=30 wordpress` |
| Content vanished | `down -v` was run | Reinstall; then the Module 04 seeder |

Fuller list: [appendix 06](../.lessons/appendix/06-troubleshooting.md).

## Configuration

Every setting comes from the environment. `wp-config.php` reads it with `getenv()` and holds no
literal credentials. The variable inventory — which are secret, which side holds them — is
[appendix 04](../.lessons/appendix/04-env-reference.md). Do not duplicate it here.

`.env` is gitignored and never committed. `.env.example` is the only env file in git, and it
contains names and `__CHANGE_ME__` placeholders only.

## What is not in git

| Not committed | Why |
|---|---|
| WordPress core | Comes from the `wordpress:6.8-php8.3-apache` image |
| Third-party plugins | Installed with `wp plugin install`, pinned by version |
| `wp-config.php` | Written from the environment; gitignored |
| `.env` | Real secrets. Only `.env.example` is tracked. |
| `wp-content/uploads/` | The `btt-uploads` volume locally, R2/S3 in production |
| `vendor/` | `composer install` |
| `blame-the-tech-blocks/build/` | Regenerated by `npm run build` |

## Files in this directory

```text
docker-compose.yml        the stack
docker-compose.dev.yml    development-only overrides
Makefile                  command wrapper — see `make help`
php.ini  uploads.ini      PHP limits, mounted into the container
wp-config.php             gitignored, generated from the environment
.env                      gitignored
.env.example              tracked; names and placeholders only
wp-content/               plugins, themes, mu-plugins — bind-mounted, yours
```
````

**Verify §4:**

- [ ] `grep -c 'empty on purpose' README.md` prints `0`. If it prints `1`, you appended instead
      of replacing.
- [ ] `grep -cE '8080|8081|8025|3306' README.md` is at least `4` — every port is documented.
- [ ] `grep -n '__CHANGE_ME__' README.md` shows it only as a placeholder description, never
      followed by a real value. No secret is in this file.
- [ ] `git status --short` lists `wordpress-headless/README.md` as modified (`M`), and
      `Makefile` as untracked (`??`).

### Step 5: Commit, and know what Module 03 expects

```bash
cd ..
git add -A
git status --short
git commit -m "feat(docker): add compose runbook, Makefile wrapper and daily workflow"
```

Check the `git status --short` output before committing: it must not list `.env`,
`wp-config.php` or anything under `wp-content/uploads/`. If it does, stop and return to
Lesson 02.5 — a secret committed once is compromised even after you delete it.

This is the last lesson of Module 02, so the Module 03 Starting State assumes exactly the state
you are in now: four services running, `db` healthy, `btt-headless` active, WordPress installed
and persisting across a `down`/`up`, no secret in git, and your own runbook in place of the
placeholder.

---

## Verification

```bash
cd wordpress-headless

# 1. Four long-running services up, db healthy. wpcli ABSENT is correct.
docker compose ps
# Expected: wordpress, db, adminer, mailpit — all "running"; db "(healthy)"
#           wpcli does not appear — it is run-on-demand (Key Concept 1)

# 2. The wrapper works and hides the two -f flags
make help | head -3
# Expected: the help header plus the first targets
make wp ARGS="core version"
# Expected: 6.8.x

# 3. The correct WP-CLI invocation reaches the database
docker compose run --rm wpcli wp option get siteurl
# Expected: http://localhost:8080

# 4. NEGATIVE — there is no `wp` binary in the wordpress image
docker compose exec wordpress sh -c 'command -v wp || echo "no wp in this image — use the wpcli service"'
# Expected: the message. NOT a path like /usr/local/bin/wp.

# 5. NEGATIVE — --allow-root is invalid for the cli image
docker compose run --rm wpcli wp core version --allow-root 2>&1 | head -2
# Expected: an error about an unknown/unrecognised flag. --allow-root does not exist here.

# 6. NEGATIVE — `exec` needs a RUNNING container, `run --rm` does not
docker compose ps --services --filter status=running | grep -c '^wpcli$'
# Expected: 0   (and yet check 3 worked — that is the whole distinction)

# 7. The bind mount is live in both directions
echo "<?php // runbook mount check" > wp-content/plugins/_mount-check.php
docker compose exec wordpress cat /var/www/html/wp-content/plugins/_mount-check.php
# Expected: <?php // runbook mount check
rm wp-content/plugins/_mount-check.php

# 8. Mailpit is reachable and its inbox is readable
curl -s http://localhost:8025/api/v1/messages | head -c 60
# Expected: JSON beginning with {"messages":  (an empty inbox is correct — see KC7)

# 9. Adminer is up
curl -s http://localhost:8081/ | grep -o 'Adminer' | head -1
# Expected: Adminer

# 10. The runbook replaced the placeholder rather than growing around it
grep -c 'empty on purpose' README.md
# Expected: 0
grep -c 8081 README.md
# Expected: 1 or more — Adminer is documented

# 11. NEGATIVE — no secret is staged
git status --short
# Expected: Makefile and README.md appear. .env and wp-config.php DO NOT.

# 12. Everything survives a full stop and start
docker compose down && docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait
docker compose run --rm wpcli wp option get blogname
# Expected: Blame The Tech
```

Check 6 is the one people get wrong. Seeing `wpcli` missing from `docker compose ps` reads like
a broken service, and the instinct is to add it to `depends_on` or start it manually. It is
absent because `run --rm` creates a container on demand and deletes it — check 3 proving that
WP-CLI works while check 6 proves nothing is running is the point, not a contradiction.

## Control Questions

1. `docker compose exec wordpress bash` and `docker compose run --rm wpcli wp plugin list` look
   like the same shape of command. Explain what each does differently, and why only one of them
   requires a container to already be running.
2. You want to throw away all your content and start the module's data from scratch, but you
   have written a plugin file you cannot afford to lose. Name the command you would run, the
   command you must **not** run, and say which of the three storage kinds each one destroys.
3. A plugin file you just edited has no effect in the browser. Give the two-command diagnostic
   from Key Concept 6, and describe what each of the two possible outcomes tells you to do next.
4. You start the stack with `docker compose up -d` — one `-f` flag, not two. Nothing appears to
   be wrong. Name two things that are silently missing and the lesson in which each one first
   causes a visible failure.
5. `wp_mail()` fires but the Mailpit inbox stays empty. Explain why this is expected right now,
   what has to be added for it to work, and which two environment variables that addition will
   read.

## Learn More

- [`docker compose` CLI reference](https://docs.docker.com/reference/cli/docker/compose/) — the
  authoritative flag list; read `up`, `down`, `exec` and `run` and note which of them accept
  `--force-recreate`
- [Compose file reference](https://docs.docker.com/reference/compose-file/) — worth a second
  visit now that you have a working stack, particularly `healthcheck` and `depends_on`
- [Mailpit documentation](https://mailpit.axllent.org/docs/) — the API you curl in check 8, and
  the search syntax that becomes useful when Module 16 asserts on a captured lead email
- [WP-CLI commands](https://developer.wordpress.org/cli/commands/) — the full command index;
  `wp db`, `wp option`, `wp plugin` and `wp theme` are the four you will live in
- [The `wordpress` image on Docker Hub](https://hub.docker.com/_/wordpress) — read the tags
  section to see what the `cli` variants contain, which is why `wpcli` is a separate service
- [GNU Make manual, "Writing Rules"](https://www.gnu.org/software/make/manual/html_node/Rule-Introduction.html) —
  ten minutes here explains `.PHONY`, the tab rule and variable expansion, which is all the
  `make` you need for this course
