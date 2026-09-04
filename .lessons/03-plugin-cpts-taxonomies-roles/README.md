# Module 03 — Plugin, CPTs, Taxonomies & Roles

## Prerequisites

Before starting this module you should have completed:

- **Module 01** — Kickoff & the Headless Contract
- **Module 02** — Docker, MySQL & Local Infrastructure, all six lessons

Keep [appendix 03 — the content model contract](../appendix/03-content-model-reference.md) open
for the whole module. Sections §1, §2 and §6 are what you are implementing, field name for
field name.

> ⚠️ **Nothing in this module goes in `functions.php`.** Not one hook. The `btt-headless`
> theme's `functions.php` does exactly one thing — redirect front-end hits — and it stays that
> way. If a registration lives in a theme it dies when the theme is switched, it is invisible to
> the plugin's PHPUnit suite in Module 23, and it does not ship in the production image the way
> a plugin does. Lesson 03.1 makes the argument in full.

## Starting State

Module 02 verified clean. WordPress is installed, persists across a restart, and reads all its
configuration from the environment.

```bash
# 1. Four services up, db healthy
docker compose ps
# Expected: wordpress, db, adminer, mailpit — all "running", db "(healthy)"

# 2. WordPress answers and is installed
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/wp-admin/
# Expected: 302  (redirect to the login form — WordPress is installed)

# 3. WP-CLI works inside the container
docker compose run --rm wpcli wp core version
# Expected: 6.8.x

# 4. The theme stub is active and the plugins directory is yours to write to
docker compose run --rm wpcli wp theme list --status=active --field=name
# Expected: btt-headless
ls wordpress-headless/wp-content/plugins/
# Expected: empty — you create blame-the-tech-core in Lesson 03.1

# 5. No secret is tracked
git check-ignore -v wordpress-headless/.env
# Expected: a .gitignore match. No output = go back to Lesson 02.5.
```

## What You'll Learn

- **Plugin architecture** — a single-responsibility plugin, a bootstrap file, `includes/`, and
  **Composer PSR-4** autoloading in a WordPress context
- **Activation and deactivation hooks** — what belongs there (term seeding, `dbDelta`, rewrite
  flushes) and what must never
- **`register_post_type` for a headless consumer** — `show_in_graphql`,
  `graphql_single_name`/`graphql_plural_name`, and why `show_in_rest` stays **on** even though
  nothing reads REST
- **Taxonomy modelling as a performance decision** — `wp_term_taxonomy.count` versus a grouped
  `COUNT(*)` over `wp_postmeta`, and a closed term set locked with `meta_box_cb`
- **`register_post_meta`** with `show_in_rest`, types and `auth_callback`
- **Custom post statuses and a moderation queue** that editors can actually work
- **Roles and capabilities** — `capability_type`, **`map_meta_cap`**, and why withholding
  `publish_incidents` is structurally different from an `if` statement

## What You'll Build

- `wordpress-headless/wp-content/plugins/blame-the-tech-core/` — the plugin that owns every
  registration in the course
- `includes/post-types.php` — `incident` and `tech_review`, both GraphQL-visible
- `includes/taxonomies.php` — `scapegoat`, `severity`, `tech_stack`, with §2's terms seeded on
  activation
- `includes/statuses.php` and `includes/admin/incident-columns.php` — the moderation queue,
  with severity and scapegoat as sortable admin columns
- `includes/roles.php` — the `incident_reporter` role, deliberately without `publish_incidents`

After this module editors can hand-author incidents, reviews and scapegoats in wp-admin and
move an incident from `pending` to published — and a user in the `incident_reporter` role
provably cannot, because WordPress's own authorisation layer says no.

## Lessons

| # | Lesson | New Technology | What You Build |
|---|---|---|---|
| 1 | [The Project Plugin](01-the-project-plugin.md) | Plugin headers, Composer PSR-4, activation hooks | `blame-the-tech-core.php`, `composer.json`, the autoloader |
| 2 | [Custom Post Types for Headless](02-custom-post-types-for-headless.md) | `show_in_graphql`, `capability_type` | `includes/post-types.php` — `incident`, `tech_review` |
| 3 | [Taxonomies & the Scapegoat Model](03-taxonomies-and-the-scapegoat-model.md) | `register_taxonomy`, term counts, `meta_box_cb` | `includes/taxonomies.php` + 14 seeded terms |
| 4 | [Post Meta, Status & Moderation](04-post-meta-status-and-moderation.md) | `register_post_meta`, `register_post_status` | `includes/statuses.php`, `includes/admin/incident-columns.php` |
| 5 | [Roles, Capabilities & the Editor Experience](05-roles-capabilities-and-the-editor-experience.md) | `map_meta_cap`, `add_role`, `admin_init` guards | `includes/roles.php` — `incident_reporter` |

## What This Module Registers

Every name below is fixed by the contract. This table is a map to the contract, not a copy of
it — follow the links for field lists, term slugs and the capability matrix.

| Kind | Names | Contract section |
|---|---|---|
| Post types | `incident`, `tech_review` | [§1](../appendix/03-content-model-reference.md#1-post-types) |
| Taxonomies | `scapegoat`, `severity`, `tech_stack` | [§2](../appendix/03-content-model-reference.md#2-taxonomies) |
| Seeded terms | 10 scapegoats, 4 severities, 10 tech stacks | [§2](../appendix/03-content-model-reference.md#seeded-terms) |
| Roles | `incident_reporter` | [§6](../appendix/03-content-model-reference.md#6-roles-and-capabilities) |

> **`scapegoat` is a taxonomy, not a post type with a relationship field.** That decision is
> made and justified in §2 of the contract, and Lesson 03.3 walks the measurement behind it
> using the `EXPLAIN` skills from Lesson 02.3. It also names what the decision costs — terms
> have no revisions and no long-form editorial body.

## How to Work

1. **Read the lesson, then implement in order.** Lesson 03.1 creates the plugin every later
   lesson adds a file to; 03.2 must precede 03.3 because taxonomies attach to post types.
2. **After each registration, check wp-admin *and* WP-CLI.** `wp post-type list` and
   `wp taxonomy list` tell you what WordPress actually registered, which is not always what you
   thought you wrote.
3. **Run the Verification block, including the negative case.** In this module the negative
   case is the point: an `incident_reporter` must fail to publish.
4. **Commit after every lesson.** `git add -A && git commit -m "feat(wp): register the incident
   post type"`.
