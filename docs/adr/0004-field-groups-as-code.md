<!-- docs/adr/0004-field-groups-as-code.md -->

# ADR 0004 — Field groups as code, via SCF Local JSON

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** Yuri Sokyrko
- **Supersedes:** —
- **Superseded by:** —

## Context

`incident` needs a fixed, queryable set of fields — `occurred_at`, `downtime_minutes`,
`environment`, `blame_confidence` and the rest of appendix 03 §4.1 — built with a form editors
already know, not hand-rolled meta boxes. SCF (the WordPress.org fork of ACF, chosen over ACF
PRO because Repeater, Flexible Content and Options Pages ship free and installable from CI with
no licence key — Lesson 04.1 Key Concept 8) stores a field group's *definition* one of three
ways: as `acf-field-group` posts in the database, as PHP calling
`acf_add_local_field_group()`, or as JSON on disk. Module 24 deploys by building a container
image and running a `release_command` once, before the new version takes traffic — there is no
step in that pipeline for "now import the field groups", and no database dump this project ships
is a source of truth for what the schema should be in production.

## Decision

Field group definitions live as JSON in
`blame-the-tech-core/includes/acf-json/`, tracked in git and shipped inside the plugin so the
container image carries the schema. `includes/acf.php` points `acf/settings/save_json` at that
one directory and `acf/settings/load_json` at that directory only — removing the theme's default
`acf-json` path, since `btt-headless` is a redirect stub that owns none of the content model
(ADR 0003). Field *values* keep living in `wp_postmeta`, read and written exactly as before
through `register_post_meta()`'s sanitisers; only the schema moves into code.

## Alternatives Considered

| Alternative | How it would work | Why not |
|---|---|---|
| Field groups in the database (SCF UI only) | Build groups through the SCF UI; move them between environments by export/import | No diff, nothing to review in a pull request, and nothing for `release_command` to run — the only mechanism is a manual export/import someone will eventually skip, and a fresh container has no groups at all until that step happens |
| `acf_add_local_field_group()` in PHP | Register each group's array shape directly in a `.php` file | Also code, also deployable with no migration step, but the trade is the SCF UI itself: a PHP-declared group is read-only in wp-admin, so building and tweaking a group by hand — the workflow this project's editors already use — is gone. Right for a group that is *generated* from another data source; wrong for five hand-authored, stable groups |
| Local JSON in the plugin | **Chosen.** `save_json`/`load_json` write and read one directory inside `blame-the-tech-core`, editable in the SCF UI and diffable in git | What I pay is below |

## Consequences

### Positive

- **The deploy has nothing to do.** `wp core update-db`, `wp plugin activate --all`, done — the
  field group arrived with the container image, and `acf_get_field_group()` returns it with zero
  rows in `wp_posts` where `post_type = 'acf-field-group'`.
- **A field rename is a reviewable text diff**, not a silent database difference between staging
  and production that a GraphQL query resolves to `null` for with no error anywhere.
- **The UI is not sacrificed to get this.** Building `Incident Details` still happens by clicking
  through the SCF field editor; the JSON file is a save target, not a replacement workflow.

### Negative

- **A JSON merge conflict is now possible** where none was before — two branches editing the same
  field group produce a real conflict to resolve, instead of the database silently keeping
  whichever save happened last.
- **Renaming a group leaves a stale file behind.** `acf/json/save_file_name` names the file after
  the group's title, so a rename writes a new file and orphans the old one; deleting the stale
  file is a step I have to remember to do in the same commit.
- **Hiding a field in the form is not a security boundary**, and Local JSON does not change that:
  `is_verified` is removed from reporters' forms via `acf/prepare_field`, but the real boundary is
  still the `auth_callback` on `register_post_meta()` and the mutation resolver in Lesson 06.2 —
  the JSON file only controls what wp-admin renders.

### Neutral

- **The theme's `acf-json` directory is deliberately never populated.** `btt-headless` has no
  content-model responsibility, so removing it from `load_json` is a statement of ownership, not
  a missing feature.

## Related

- ADR 0003 — server-side code lives in a plugin, which is why `includes/acf-json/` ships inside
  `blame-the-tech-core` rather than the theme
- Lesson 04.1 — SCF Field Groups as Code, and the `acf.php` integration this ADR describes
