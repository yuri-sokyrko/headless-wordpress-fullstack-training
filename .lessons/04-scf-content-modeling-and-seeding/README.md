# Module 04 — SCF, Content Modeling & WP-CLI Seeding

## Prerequisites

Before starting this module you should have completed:

- **Module 02** — Docker, MySQL & Local Infrastructure
- **Module 03** — Plugin, CPTs, Taxonomies & Roles, all five lessons

[Appendix 03 §4 and §9](../appendix/03-content-model-reference.md#4-acf-field-groups) are what
this module implements. Every field name, GraphQL name and count comes from there.

> ⚠️ **Do not build field groups by clicking in the SCF UI and leaving them there.** SCF's
> default storage is database rows, which are invisible to git, undiffable in review, and would
> force an export/import step into every deploy. You will use the UI — it is the fastest field
> builder there is — but Lesson 04.1 turns on **Local JSON** first, so every click lands as a
> tracked file. Doing it in the other order means re-creating the groups.

## Starting State

Module 03 verified clean. The plugin is active and owns the content model's structure; SCF is
not installed yet.

```bash
# 1. The stack is up and the plugin is active
docker compose run --rm wpcli wp plugin list --status=active --field=name
# Expected: includes blame-the-tech-core

# 2. Post types and taxonomies are registered
docker compose run --rm wpcli wp post-type list --field=name | grep -E 'incident|tech_review'
# Expected: incident and tech_review
docker compose run --rm wpcli wp taxonomy list --field=name | grep -E 'scapegoat|severity|tech_stack'
# Expected: scapegoat, severity, tech_stack

# 3. Terms were seeded on activation
docker compose run --rm wpcli wp term list severity --field=slug
# Expected: s1-catastrophic, s2-major, s3-minor, s4-cosmetic

# 4. The reporter role exists and cannot publish
docker compose run --rm wpcli wp cap list incident_reporter | grep -c publish_incidents
# Expected: 0
```

## What You'll Learn

- **SCF Local JSON** — field groups as version-controlled files, `acf/settings/save_json` and
  `load_json`, and why this is the highest-leverage decision in the pipeline
- **The SCF field types this app needs** — date-time, number, select, range, textarea, image,
  true/false, and **repeaters**
- **SCF through WPGraphQL** — `show_in_graphql`, `graphql_field_name`, and how a repeater
  becomes a generated object list type rather than `string[]`
- **Term field groups and options pages** — `acf_add_options_page()` exposed on the root query,
  so global settings are one fetch in the root layout
- **Taxonomy versus relationship field**, decided on evidence rather than taste
- **WP-CLI as a first-class interface** — `WP_CLI::add_command`, arguments, `--porcelain`,
  exit codes, and why a headless project lives or dies by its CLI
- **Deterministic seeding and forward-only migrations** — fixed slugs, fixed `post_date`, and an
  option-versioned migration runner

## What You'll Build

- SCF installed, with Local JSON writing to
  `blame-the-tech-core/includes/acf-json/` and the loader registered in the plugin bootstrap
- Five field groups as tracked JSON — `Incident Details`, `Tech Review Fields`,
  `Scapegoat Profile`, `HOBT Promo`, `Site Settings`
- `wordpress-headless/wp-content/themes/btt-headless/templates/hobt.php` — the page template the
  HOBT group's location rule keys off
- `includes/cli/blame-command.php` — the `wp blame` command namespace
- `includes/cli/seed.php` and `includes/cli/migrations.php` — `wp blame seed --fresh` and the
  option-based migration runner

After this module **one command produces a fully populated site**: 40 incidents, 8 tech
reviews, 10 blog posts, 3 pages, 3 users and 12 media items, with fixed slugs and fixed dates,
reproducible from an empty database in under a minute.

## Lessons

| # | Lesson | New Technology | What You Build |
|---|---|---|---|
| 1 | [SCF Field Groups as Code](01-scf-field-groups-as-code.md) | SCF, Local JSON, `acf/settings/save_json` | The loader plus `Incident Details` as tracked JSON |
| 2 | [SCF & WPGraphQL](02-scf-and-wpgraphql.md) | WPGraphQL for SCF, repeater types | `Tech Review Fields`, including both repeaters |
| 3 | [Relationships & Options Pages](03-relationships-and-options-pages.md) | Term field groups, `acf_add_options_page()` | `Scapegoat Profile`, `HOBT Promo`, `Site Settings`, `templates/hobt.php` |
| 4 | [WP-CLI for Headless Workflows](04-wp-cli-for-headless-workflows.md) | `WP_CLI::add_command`, `--porcelain` | `includes/cli/blame-command.php` |
| 5 | [Seed Data & Migrations](05-seed-data-and-migrations.md) | `wp_insert_post`, `wp media import`, option-versioned migrations | `wp blame seed --fresh`, `includes/cli/migrations.php` |

## The Five Field Groups

Field lists live in the contract. This table is the index into it — never a second copy.

| Group | Location rule | `graphql_field_name` | Contract |
|---|---|---|---|
| Incident Details | `post_type == incident` | `incidentDetails` | [§4.1](../appendix/03-content-model-reference.md#41-incident-details) |
| Scapegoat Profile | `taxonomy == scapegoat` | `scapegoatProfile` | [§4.2](../appendix/03-content-model-reference.md#42-scapegoat-profile) |
| Tech Review Fields | `post_type == tech_review` | `techReviewFields` | [§4.3](../appendix/03-content-model-reference.md#43-tech-review-fields) |
| HOBT Promo | `page` + `page_template == templates/hobt.php` | `hobtPromo` | [§4.4](../appendix/03-content-model-reference.md#44-hobt-promo) |
| Site Settings | options page | `siteSettings` | [§4.5](../appendix/03-content-model-reference.md#45-site-settings-options-page) |

> **Seed passwords come from the environment, never from a literal in the seeder.** The three
> seeded users in [§9](../appendix/03-content-model-reference.md#9-seed-data) — `editor`,
> `reporter`, `e2e_agent` — get their passwords from variables read at run time. A password
> typed into a committed PHP file is a committed secret, and Module 12's CI will run this exact
> seeder.

## How to Work

1. **Turn on Local JSON before you create a single field.** Lesson 04.1 §1. Everything after it
   assumes every group is a file.
2. **After every group, check the JSON diff, not just the UI.** `git diff includes/acf-json/` is
   the review artifact — if a change does not appear there, it only exists in your database.
3. **Run `wp blame seed --fresh` twice** at the end of Lesson 04.5. Identical output both times
   is the definition of done; anything else is non-determinism you will pay for in Module 12.
4. **Commit after every lesson.** `git add -A && git commit -m "feat(wp): incident details field
   group"`.
