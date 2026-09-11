# wordpress-headless

The WordPress half of Blame The Tech: a Docker Compose stack serving `/wp-admin` and, from
Module 05, `/graphql`. Next.js lives in `../next-app` and runs on the host.

## Quick start

```bash
cd wordpress-headless
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait
# or: make up-wait
```

| URL                              | What                                                   |
| -------------------------------- | ------------------------------------------------------ |
| <http://localhost:8080>          | WordPress — redirects to the front end (Lesson 02.4)   |
| <http://localhost:8080/wp-admin> | The editor dashboard                                   |
| <http://localhost:8081>          | Adminer — raw SQL and `EXPLAIN` plans                  |
| <http://localhost:8025>          | Mailpit — every `wp_mail()`, captured, never delivered |

## Services

| Service     | Image                         | Published              | Purpose                                                                             |
| ----------- | ----------------------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| `wordpress` | `wordpress:7.1-php8.4-apache` | `8080` → `80`          | The CMS, Apache, PHP 8.4                                                            |
| `db`        | `mysql:8.4`                   | `3306` (dev only)      | MySQL. Data in the `btt-db-data` volume.                                            |
| `adminer`   | `adminer:5`                   | `8081` → `8080`        | SQL console and query plans                                                         |
| `mailpit`   | `axllent/mailpit`             | `8025` UI, `1025` SMTP | Captured mail                                                                       |
| `wpcli`     | `wordpress:cli-php8.4`        | —                      | WP-CLI, run on demand. `profiles: ['cli']` keeps it out of `up` and `ps` by design. |

Project name `btt`, network `btt-net`. Database name and user are both `btt` — never `root`
for the application.

## Everyday commands

| Task                   | Command                                           |
| ---------------------- | ------------------------------------------------- |
| Start                  | `make up` (or `up-wait` to block on healthchecks) |
| Status                 | `make ps`                                         |
| WordPress log          | `make logs`                                       |
| `debug.log`            | `make debug-log`                                  |
| Shell in the container | `make sh`                                         |
| WP-CLI                 | `make wp ARGS="plugin list"`                      |
| MySQL log              | `make logs-db`                                    |
| Open Mailpit           | `make mail`                                       |
| Open Adminer           | `make adminer`                                    |
| Every target           | `make help`                                       |
| Stop                   | `make down`                                       |

WP-CLI is **always** `docker compose run --rm wpcli wp <command>`. The stock `wordpress` image
ships no `wp` binary and no `composer`. `--allow-root` is accepted by WP-CLI but pointless here:
the `wpcli` service is pinned to uid 33, never root. Full list:
[appendix 07](../.lessons/appendix/07-command-reference.md).

`.env` also sets `COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml`, so a bare
`docker compose …` loads both files. Without it, a bare `run` recreates `db` and unpublishes 3306.

## Resetting

| You want to                                           | Command                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Restart the stack                                     | `make down && make up`                                                                                 |
| Reset the database, keep your code                    | `make reset-db`, then re-run `wp core install`                                                         |
| Start over completely                                 | `make nuke`, then `make up-wait && make uploads-own` — ⚠️ **destroys `btt-db-data` and `btt-uploads`** |
| Fix "Unable to create directory wp-content/uploads/…" | `make uploads-own` — a fresh `btt-uploads` volume is `root:root`                                       |

⚠️ `docker compose down -v` (what `make nuke` runs) deletes the database **and** all uploaded
media. Your plugin and theme code is a bind mount on your own disk and survives everything.

## Where the logs are

| Log              | Command                                                                    | Contains                                       |
| ---------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| Container stdout | `docker compose logs -f wordpress`                                         | Apache, the entrypoint, PHP fatals             |
| WordPress debug  | `docker compose exec wordpress tail -f /var/www/html/wp-content/debug.log` | Notices, warnings, `error_log()`               |
| MySQL            | `docker compose logs -f db`                                                | `ready for connections`, InnoDB, auth failures |

`debug.log` is inside the container. `wp-content` itself is not bind-mounted — only `plugins`,
`themes` and `mu-plugins` are — so the file is not visible in your editor.

## Troubleshooting

| Symptom                                                       | Cause                                                                    | Fix                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| "Error establishing a database connection"                    | `WORDPRESS_DB_HOST` is `localhost`                                       | Use `db:3306` — the service name                        |
| `port is already allocated` or `bind: address already in use` | Another container or process owns the port                               | `lsof -nP -iTCP:8080 -sTCP:LISTEN`, then `docker ps -a` |
| "Error establishing a database connection" right after `up`   | Started before MySQL was ready; it serves 500s, it does not restart-loop | `depends_on` needs `condition: service_healthy`         |
| Plugin edits do nothing                                       | Bind mount wrong, or container predates it                               | `docker compose up -d --force-recreate`                 |
| `wp: command not found`                                       | Ran `wp` on the host or via `exec wordpress`                             | `docker compose run --rm wpcli wp …`                    |
| White screen, empty 500                                       | PHP syntax error; `WP_DEBUG_DISPLAY` is `false`                          | `docker compose logs --tail=30 wordpress`               |
| Content vanished                                              | `down -v` was run                                                        | Reinstall; then the Module 04 seeder                    |

Fuller list: [appendix 06](../.lessons/appendix/06-troubleshooting.md).

## Configuration

Every setting comes from the environment. `wp-config.php` reads it with `getenv()` and holds no
literal credentials. The variable inventory — which are secret, which side holds them — is
[appendix 04](../.lessons/appendix/04-env-reference.md). Do not duplicate it here.

`.env` is gitignored and never committed. `.env.example` is the only env file in git, and it
contains names and `__CHANGE_ME__` placeholders only.

## What is not in git

| Not committed                  | Why                                                                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WordPress core                 | Comes from the `wordpress:7.1-php8.4-apache` image                                                                                                                               |
| Third-party plugins            | Installed with `wp plugin install`, pinned by version                                                                                                                            |
| The three bundled core themes  | The entrypoint copies them onto the `themes` bind mount at first boot — ~14 MB of WordPress core. `.gitignore` ignores `wp-content/themes/*` and re-includes `btt-headless` only |
| `wp-config.php`                | Written from the environment; gitignored                                                                                                                                         |
| `.env`                         | Real secrets. Only `.env.example` is tracked.                                                                                                                                    |
| `wp-content/uploads/`          | The `btt-uploads` volume locally, R2/S3 in production                                                                                                                            |
| `vendor/`                      | `composer install`                                                                                                                                                               |
| `blame-the-tech-blocks/build/` | Regenerated by `npm run build`                                                                                                                                                   |

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

That is the directory **today**, at the end of Module 02. The two sections below are where it
is going — keep them, because later modules refer back to them. Lesson 16.3 in particular
expects `Leads.php` to be findable in the tree below before it writes it.

## Which module creates what

| Module | What lands here                                                                                                                                                                                                                                                                                                      |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 02     | `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example`, `php.ini`, `uploads.ini`, the `btt-headless` theme stub, this runbook                                                                                                                                                                                 |
| 03     | `wp-content/plugins/blame-the-tech-core/` — plugin header, Composer PSR-4 autoload, post types, taxonomies, custom statuses, roles and capabilities                                                                                                                                                                   |
| 04     | `includes/acf-json/` field groups, `includes/cli/` with the `wp blame seed` command, the option-based migration runner                                                                                                                                                                                                |
| 06     | `includes/graphql/` — registered enums, the `blameScore` field, `createIncident`, `registerDeveloper`, `submitHobtLead`, and the committed `schema.graphql` contract                                                                                                                                                  |
| 07     | `blame-the-tech-core/phpcs.xml.dist` — WordPress Coding Standards, beside the code it describes                                                                                                                                                                                                                       |
| 12     | `wp-content/mu-plugins/blame-seeder/` — determinism fixes to the Module 04 seeder, plus `wp blame fixture export\|load\|status` (dev/CI only, never in the production image)                                                                                                                                          |
| 13     | `wp-content/plugins/blame-the-tech-blocks/` — six blocks, `block.json` each, `@wordpress/scripts` build, `theme.json`                                                                                                                                                                                                 |
| 15     | JWT configuration and `incident_reporter` hardening                                                                                                                                                                                                                                                                  |
| 16     | `includes/Leads.php` — the HOBT lead capture the funnel writes to                                                                                                                                                                                                                                                    |
| 17     | `includes/Preview.php` — preview token issue and the `/wp-json/btt/v1/preview/verify` endpoint                                                                                                                                                                                                                        |
| 18     | `includes/Revalidate.php` — the HMAC-signed revalidation webhook                                                                                                                                                                                                                                                     |
| 20     | Polylang bootstrap and the idempotent `wp blame ensure-languages` command                                                                                                                                                                                                                                            |
| 23     | `tests/` — Pest + Brain Monkey unit tests and `wp-phpunit` integration tests, both executed in the `phptest` service (PHP 8.3, while the site runs 8.4 — Lesson 23.4 §1.1), `phpunit.xml.dist`, and a `wp_test` database created by one idempotent `exec` rather than a Compose edit                                   |
| 24     | `Dockerfile` (multi-stage, non-root, opcache; **WP-CLI stays**, because `release_command` is four `wp` invocations), `.dockerignore`, `fly.toml`, `railway.json`, `phpstan.neon`, `includes/health.php`, `includes/observability.php`, `mu-plugins/000-btt-hardening.php`                                              |

## Expected final tree

Use this to check your work. If a path here doesn't exist by the end of Module 24, you skipped
something.

```text
wordpress-headless/
├── docker-compose.yml            (M02)
├── docker-compose.dev.yml        (M02)
├── Dockerfile                    (M24 — prod image, same base as local)
├── .dockerignore                 (M24)
├── .env.example                  (M02)   ← the ONLY env file in git
├── fly.toml                      (M24)
├── railway.json                  (M24)
├── Makefile                      (M02)
├── php.ini  uploads.ini          (M02)
├── schema.graphql                (M06)   ← the committed GraphQL contract
├── README.md                     ← this file
└── wp-content/
    ├── plugins/
    │   ├── blame-the-tech-core/           (M03, M04, M06, M15, M16, M17, M18, M20, M24)
    │   │   ├── blame-the-tech-core.php
    │   │   ├── composer.json                  (M03, M07, M23)
    │   │   ├── phpcs.xml.dist                 (M07)   ← beside the code it describes
    │   │   ├── phpstan.neon  phpstan-baseline.neon  (M24)
    │   │   ├── phpunit.xml.dist               (M23)   ← two suites: unit, integration
    │   │   ├── includes/
    │   │   │   ├── post-types.php  taxonomies.php  roles.php  statuses.php
    │   │   │   ├── acf-json/*.json
    │   │   │   ├── graphql/  cli/
    │   │   │   ├── Revalidate.php  Preview.php  Leads.php
    │   │   │   ├── health.php  observability.php   (M24)
    │   │   │   └── admin/
    │   │   └── tests/                          (M23)
    │   │       ├── Pest.php  bootstrap.php  wp-tests-config.php
    │   │       ├── Unit/         Pest + Brain Monkey — the `phptest` service
    │   │       └── Integration/  wp-phpunit — the `phptest` service + db
    │   └── blame-the-tech-blocks/         (M13, M14)
    │       ├── blame-the-tech-blocks.php
    │       ├── package.json
    │       └── src/
    │           ├── incident-callout/{block.json,edit.js,save.js,style.scss}
    │           ├── blame-quote/
    │           ├── scapegoat-picker/
    │           ├── incident-ticker/{block.json,edit.js,render.php}
    │           ├── hobt-cta/
    │           └── tech-verdict-card/
    ├── mu-plugins/
    │   ├── blame-seeder/                  (M12 — dev/CI only, never in the prod image)
    │   ├── blame-seeder-loader.php        (M12 — mu-plugins does not recurse)
    │   └── 000-btt-hardening.php          (M24 — branches on WP_ENVIRONMENT_TYPE)
    └── themes/
        └── btt-headless/                  (M02, M13, M17)
            ├── style.css  functions.php  index.php
            ├── theme.json                 (M13)
            └── templates/hobt.php         (M04)
```

> **This tree lists every directory, but not every file.** Where a directory is named without
> its contents, lessons add files inside it — that is expected, and each lesson records exactly
> what it produces in its `produces:` front matter. If a _directory_ you have built is not
> listed here at all, you have drifted; check the module README's Starting State.

> **Never put a secret in this directory in plaintext, and never bake one into the
> `Dockerfile`.** `docker history` prints build args, and every image layer you push sits in the
> registry. Secrets are runtime-only — see
> [the env reference](../.lessons/appendix/04-env-reference.md).
