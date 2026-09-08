# wordpress-headless/

**This directory is empty on purpose. You build it.**

Every file listed below is inlined in a lesson. There is nothing to copy from here and nothing
to `npm install` yet — go to [`../.lessons/README.md`](../.lessons/README.md) and start at
Module 01.

## Which module creates what

| Module | What lands here |
|---|---|
| 02 | `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example`, `php.ini`, `uploads.ini`, the `btt-headless` theme stub, this directory's own runbook |
| 03 | `wp-content/plugins/blame-the-tech-core/` — plugin header, Composer PSR-4 autoload, post types, taxonomies, custom statuses, roles and capabilities |
| 04 | `includes/acf-json/` field groups, `includes/cli/` with the `wp blame seed` command, the option-based migration runner |
| 06 | `includes/graphql/` — registered enums, the `blameScore` field, `createIncident`, `registerDeveloper`, `submitHobtLead`, and the committed `schema.graphql` contract |
| 07 | `blame-the-tech-core/phpcs.xml.dist` — WordPress Coding Standards, beside the code it describes |
| 12 | `wp-content/mu-plugins/blame-seeder/` — determinism fixes to the Module 04 seeder, plus `wp blame fixture export|load|status` (dev/CI only, never in the production image) |
| 13 | `wp-content/plugins/blame-the-tech-blocks/` — six blocks, `block.json` each, `@wordpress/scripts` build, `theme.json` |
| 15 | JWT configuration and `incident_reporter` hardening |
| 23 | `tests/` — Pest + Brain Monkey unit tests run in the `composer` service, `wp-phpunit` integration tests in the `wordpress` container, `phpunit.xml.dist`, and a `wp_test` database created by one idempotent `exec` rather than a Compose edit |
| 24 | `Dockerfile` (multi-stage, non-root, opcache; **WP-CLI stays**, because `release_command` is four `wp` invocations), `.dockerignore`, `fly.toml`, `railway.json`, `phpstan.neon`, `includes/health.php`, `includes/observability.php`, `mu-plugins/000-btt-hardening.php` |
| 17 | `includes/Preview.php` — preview token issue and the `/wp-json/btt/v1/preview/verify` endpoint |
| 18 | `includes/Revalidate.php` — the HMAC-signed revalidation webhook |
| 20 | Polylang bootstrap and the idempotent `wp blame ensure-languages` command |
| 23 | `tests/Unit/` (Pest + Brain Monkey), `tests/Integration/` (`wp-phpunit`), `phpstan.neon` |
| 24 | `Dockerfile` (multi-stage, non-root, opcache), `.dockerignore`, `fly.toml`, `railway.json`, `wp-content/mu-plugins/000-btt-hardening.php` |

## Expected final tree

Use this to check your work. If a path here doesn't exist by the end of Module 24, you skipped
something.

```
wordpress-headless/
├── docker-compose.yml            (M02)
├── docker-compose.dev.yml        (M02)
├── Dockerfile                    (M24 — prod image, same base as local)
├── .dockerignore                 (M24)
├── .env.example                  (M02)   ← the ONLY env file in git
├── fly.toml                      (M24)
├── railway.json                  (M24)
├── php.ini  uploads.ini          (M02)
├── schema.graphql                (M06)   ← the committed GraphQL contract
├── README.md                     ← this file, replaced by your own runbook in M02
└── wp-content/
    ├── plugins/
    │   ├── blame-the-tech-core/           (M03, M04, M06, M15, M18, M20, M24)
    │   │   ├── blame-the-tech-core.php
    │   │   ├── composer.json                  (M03, M07, M23)
    │   │   ├── phpcs.xml.dist                 (M07)   ← beside the code it describes
    │   │   ├── phpstan.neon  phpstan-baseline.neon  (M24)
    │   │   ├── phpunit.xml.dist                (M23)   ← two suites: unit, integration
    │   │   ├── includes/
    │   │   │   ├── post-types.php  taxonomies.php  roles.php  statuses.php
    │   │   │   ├── acf-json/*.json
    │   │   │   ├── graphql/  cli/
    │   │   │   ├── Revalidate.php  Preview.php  Leads.php
    │   │   │   ├── health.php  observability.php   (M24)
    │   │   │   └── admin/
    │   │   └── tests/                          (M23)
    │   │       ├── Pest.php  bootstrap.php  wp-tests-config.php
    │   │       ├── Unit/         Pest + Brain Monkey — the `composer` service
    │   │       └── Integration/  wp-phpunit — the `wordpress` container
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
> its contents, lessons add files inside it — that is expected, and each lesson's front matter
> records exactly what it produces, in its `produces:` front matter. If a *directory* you have
> built is not listed here at all, you have drifted; check the module README's Starting State.

## What is deliberately NOT in git

`.gitignore` at the repo root handles all of this. Read the comments in it — two of its
patterns are themselves lessons.

| Not committed | Why |
|---|---|
| WordPress core | Comes from the `wordpress:6.8-php8.3-apache` image |
| `wp-content/plugins/*` except our two | Third-party plugins are installed by the bootstrap script with `wp plugin install`, pinned by version |
| `wp-content/uploads/` | Media lives in a named Docker volume locally and in R2/S3 in production |
| WordPress core | The `btt-wp-core` named volume, shared by the `wordpress` and `wpcli` services. Nothing here is core, and nothing here should be |
| `wp-config.php` | Generated from environment variables at container boot. The template lives in Lesson 02.4. |
| `.env` | Real secrets. `.env.example` — names and `__CHANGE_ME__` placeholders only — is the tracked one. |
| `blame-the-tech-blocks/build/` | Regenerated by `npm run build` |
| `vendor/` | `composer install` |

> **Never put a secret in this directory in plaintext, and never bake one into the
> `Dockerfile`.** `docker history` prints build args, and every image layer you push sits in
> the registry. Secrets are runtime-only — see
> [the env reference](../.lessons/appendix/04-env-reference.md).

---

**Start → [`../.lessons/02-docker-mysql-and-infrastructure/README.md`](../.lessons/02-docker-mysql-and-infrastructure/README.md)**
