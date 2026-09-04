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

<!-- TODO: Phase B -->

---

## Task

<!-- TODO: Phase B -->

---

## Verification

<!-- TODO: Phase B -->

## Control Questions

<!-- TODO: Phase B -->

## Learn More

<!-- TODO: Phase B -->
