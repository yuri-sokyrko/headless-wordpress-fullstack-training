# Module 02 — Docker, MySQL & Local Infrastructure

## Prerequisites

Before starting this module you should have completed:

- **Module 01** — Kickoff & the Headless Contract, all three lessons

You need Docker Desktop running, the contract in
[appendix 04](../appendix/04-env-reference.md) open in a second tab, and roughly 4 GB of free
disk for images and volumes.

> ⚠️ **If you still have MAMP, XAMPP, Local or a system MySQL running, stop them now.** They
> hold ports 3306 and often 8080, and the failure mode is not a clear error — it is a
> `db` container that starts, binds nothing, and leaves WordPress retrying a connection
> forever. `lsof -nP -iTCP:3306 -sTCP:LISTEN` before you start saves twenty minutes.

## Starting State

Module 01 complete: an unmodified clone with both application directories still holding only
their placeholder READMEs, and a verified toolchain.

```bash
# 1. The clone is clean and nothing has been scaffolded
git status --short
# Expected: no output (or only your ADR file, if you committed it separately)

ls wordpress-headless/
# Expected: README.md — and nothing else

# 2. Docker is running and Compose v2 is available
docker compose version
# Expected: Docker Compose version v2.x.x

# 3. Nothing is holding the ports this module publishes
lsof -nP -iTCP:8080 -iTCP:8081 -iTCP:8025 -iTCP:3306 -sTCP:LISTEN
# Expected: no output
```

## What You'll Learn

- **Docker and Compose** — images versus containers, layers, bind mounts versus named volumes,
  and why a declarative `docker-compose.yml` replaces a MAMP preferences pane
- **Service networking** — containers reach each other by service name, `db:3306` is not
  `localhost:3306`, and `host.docker.internal` is how a container reaches your host
- **Healthchecks and `depends_on`** — why "the container started" and "MySQL accepts
  connections" are different events
- **The WordPress schema, for real** — `wp_posts`, `wp_postmeta` as an unindexed EAV table,
  `wp_term_*`, and reading an `EXPLAIN` plan in **Adminer**
- **`wp-config.php` from the environment** — `getenv()`, `WP_HOME` versus `WP_SITEURL`, and a
  theme whose only job is to redirect
- **Env and secrets for two applications** — the ignore-before-secret ordering and the
  `NEXT_PUBLIC_` boundary
- **Captured email** — **Mailpit** on `:8025`, so `wp_mail()` is inspectable and never leaves
  your machine

## What You'll Build

- `wordpress-headless/docker-compose.yml` and `docker-compose.dev.yml` — four services:
  `wordpress`, `db`, `adminer`, `mailpit`
- `wordpress-headless/php.ini` and `uploads.ini` — pinned PHP limits, bind-mounted
- `wordpress-headless/wp-config.php` — generated from environment variables, gitignored
- `wordpress-headless/wp-content/themes/btt-headless/` — the redirect-only theme stub
- `wordpress-headless/.env.example` — every variable name, `__CHANGE_ME__` for every secret,
  and the only env file in git
- `wordpress-headless/README.md` — your own runbook, replacing the placeholder

After this module WordPress installs, persists across `docker compose down`, and answers on
`http://localhost:8080/wp-admin` with configuration that comes entirely from the environment.
No secret is in git, and you can read a query plan against your own database.

## Lessons

| # | Lesson | New Technology | What You Build |
|---|---|---|---|
| 1 | [Why Docker Replaces MAMP](01-why-docker-replaces-mamp.md) | Docker images, layers, volumes | A pulled, inspected `wordpress:7.1-php8.4-apache` image |
| 2 | [The Compose Stack](02-the-compose-stack.md) | Docker Compose, service DNS, healthchecks | `docker-compose.yml`, `docker-compose.dev.yml`, `php.ini`, `uploads.ini` |
| 3 | [MySQL & the WordPress Schema](03-mysql-and-the-wordpress-schema.md) | MySQL 8, Adminer, `EXPLAIN` | Query plans for a `tax_query` and a `meta_query`, side by side |
| 4 | [wp-config for Headless](04-wp-config-for-headless.md) | `getenv()`, `WP_HOME`, theme redirect | `wp-config.php`, the `btt-headless` theme stub |
| 5 | [Env & Secrets for Two Apps](05-env-and-secrets-for-two-apps.md) | `env_file`, `openssl rand`, `git check-ignore` | `.env.example`, nine generated secrets in an ignored `.env` |
| 6 | [Daily Workflow & Troubleshooting](06-daily-workflow-and-troubleshooting.md) | `docker compose logs/exec`, WP-CLI in a container | `wordpress-headless/README.md` — your runbook |

## The Stack

Next.js is **not** in this table. It runs on the host with `npm run dev` from Module 09 onward —
see [PROJECT.md](../PROJECT.md) for why. Only WordPress genuinely benefits from being
containerised.

| Service | Image | Published | What it is for |
|---|---|---|---|
| `wordpress` | `wordpress:7.1-php8.4-apache` | `8080` → `80` | `/wp-admin`, `/graphql`, WP-CLI |
| `db` | `mysql:8.4` | `3306` | The database — published **on purpose**, so Lesson 02.3 can run `EXPLAIN` from a host client too |
| `adminer` | `adminer` | `8081` | Raw SQL and query plans in a browser |
| `mailpit` | `axllent/mailpit` | `8025` UI, `1025` SMTP | Every `wp_mail()` captured, none delivered |

> **This is a development stack only.** There is no `Dockerfile` in this module — the
> production image, its multi-stage build, the non-root user and opcache all land in
> Module 24. Building a production image before you have an application to put in it teaches
> nothing.

## How to Work

1. **Read the module README, then work the lessons in order.** Lesson 02.2 writes the compose
   file that every later lesson assumes; 02.3 is a reading-and-measuring lesson with no file
   output, and skipping it will cost you in Module 06.
2. **Keep `docker compose logs -f wordpress` open in a second terminal.** Almost every failure
   in this module announces itself there before it shows in the browser.
3. **Run each Verification block.** Container state is invisible — `docker compose ps` and a
   `curl` are the only proof that what you think is running is running.
4. **Commit after every lesson.** `git add -A && git commit -m "feat(wp): compose stack"`. If
   `git status` ever shows a `.env` file, stop and go back to Lesson 02.5.
