---
title: 'SCF Field Groups as Code'
module: 4
lesson: 1
teaches: [scf-local-json, field-groups-as-code, scf-field-types, no-db-migration-on-deploy]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/acf-json/group_incident_details.json']
requires: [3.2, 3.5]
---

# Lesson 04.1 — SCF Field Groups as Code

## Quick Overview

SCF stores field groups in the database by default, as `acf-field-group` posts with each field
as a child post. That works beautifully for a single site maintained through wp-admin and
terribly for anything deployed from a repository: the content model becomes invisible to git,
unreviewable in a pull request, and impossible to move between environments without an
export/import step that someone will eventually forget. **Local JSON** fixes it. Point
`acf/settings/save_json` at a directory inside your plugin, add that directory to
`acf/settings/load_json`, and every save in the SCF UI writes a JSON file you can diff, review
and deploy.

With that in place you build `Incident Details` — the group from
[appendix 03 §4.1](../appendix/03-content-model-reference.md#41-incident-details) — using the
UI, and watch each field appear in the JSON. You will meet the field types the rest of the
module reuses: Date Time Picker, Number with min and max, Select with kebab-case values, Range
with a default, Textarea, Text and True/False. Two fields carry design intent rather than
convenience. `stack_trace` is rendered inside `<pre>` and **escaped** — never
`dangerouslySetInnerHTML`, a rule Module 14 enforces in exactly one component. And `is_verified`
is writable by an editor in wp-admin and ignored when a client supplies it, which is the trust
boundary Lesson 06.2 enforces at the mutation.

By the end of this lesson you will have:

- SCF installed and Local JSON writing to
  `blame-the-tech-core/includes/acf-json/`, with the loader registered in the plugin bootstrap
- `group_incident_details.json` tracked in git, containing every field in §4.1 with the exact
  field names
- A `git diff` that shows a field-model change as a reviewable text change
- Kebab-case select values for `environment` and `resolution_status`, ready to become GraphQL
  enums in Lesson 06.1
- An incident authored by hand in wp-admin with every field populated
- A written note on why there is no database migration step on deploy because of this decision

## Classic WP Analogy

You have almost certainly done all three of the usual things. You have built field groups in the
SCF UI and moved them between environments by exporting JSON and importing it on the other side.
You have used SCF's "Generate PHP" button and pasted `acf_add_local_field_group()` into
`functions.php`. Or you have hand-rolled meta boxes with `add_meta_box`, `wp_nonce_field` and a
`save_post` handler, which is what everyone did before ACF and its descendants existed. Local JSON is the fourth
option and it is strictly better than the first two: you keep the UI (unlike hand-written PHP)
and you keep the version control (unlike database storage), with no export step at all.

Under the hood nothing changes about storage of *content*. `get_field('downtime_minutes', $id)`
still reads `wp_postmeta`, still writes the paired `_downtime_minutes` reference row, and every
performance characteristic you learned in Lesson 02.3 still applies. Local JSON versions the
*schema*, not the data. That is exactly the split you want, and it is the reason a field rename
is a reviewable diff while a content change is not.

**Where the analogy breaks down:** in Classic WordPress the field group's job ends at the
wp-admin form. If you rename `downtime_minutes` to `downtime_mins`, you break your own theme
templates and you fix them in the same commit, in the same language, in the same repository —
five minutes of work. Here that field name is a link in a chain: the SCF field name determines
the GraphQL field name, which determines the generated TypeScript type name in Module 10, which
appears in components in Modules 08 and 14, and possibly in a committed `schema.graphql` that CI
compares against. A field rename is an API breaking change with consumers in another language.
The SCF UI still makes it a two-second edit, and that mismatch between how easy it is and how
expensive it is, is the thing to be careful about.

---

## Key Concepts

### 1. Three places a field group can live, and the one this course picks

SCF gives you three storage strategies for the *schema* of your fields. They are not
equivalent, and the difference only shows up on the day you deploy.

| | SCF UI only (database) | **Local JSON** | `acf_add_local_field_group()` in PHP |
|---|---|---|---|
| Where the definition lives | `wp_posts` rows, `post_type = acf-field-group` | `includes/acf-json/*.json` | a `.php` file |
| In git | ❌ never | ✅ | ✅ |
| Reviewable in a pull request | ❌ nothing to read | ✅ a text diff | ✅ a text diff |
| Editable in the SCF UI | ✅ | ✅ (after one "Sync" click) | ❌ read-only, greyed out |
| Works on a fresh container with an empty database | ❌ **the fields vanish** | ✅ | ✅ |
| Needs a step in the deploy | ✅ export/import, every release | ❌ none | ❌ none |
| Merge conflicts | not possible — nothing to merge, so changes are silently lost instead | JSON conflicts, resolvable | PHP conflicts, resolvable |

**The verdict: Local JSON.** It is the only option that keeps both properties you need — the
field group is a tracked file *and* you can still build it with a mouse. Everything in Modules
04 through 06 assumes it.

The honest case for the third column, because it does exist: `acf_add_local_field_group()` is
right when the field group is **generated** rather than authored. If a group's choices come from
another system — a list of regions pulled from a config file, a set of feature flags, a
per-locale variant — you want PHP, because a JSON file cannot contain a `foreach`. It is also
right when you want the field group to be genuinely immutable in wp-admin, since a PHP-declared
group cannot be edited there at all. Neither applies to the five groups in this course, all of
which are hand-authored and stable, so the UI-plus-JSON combination wins.

> **What Local JSON does *not* version is content.** `get_field('downtime_minutes', $id)` still
> reads `wp_postmeta`. The field *definitions* become code; the *values* stay data, exactly as
> they were. That split is the whole point — a field rename is a reviewable diff, an incident's
> downtime is not.

### 2. How Local JSON actually works: two filters and a directory

Two filters, one write path, one read path.

```
                       SAVE  (you click "Update" in the SCF UI)
  ┌──────────────┐         ┌────────────────────────┐        ┌──────────────────────────┐
  │  SCF UI      │────────▶│ acf/settings/save_json │───────▶│ includes/acf-json/       │
  │  wp-admin    │         │  returns ONE directory │        │  group_<key>.json        │
  └──────────────┘         └────────────────────────┘        └──────────────────────────┘
                                                                        │
                       LOAD  (every request, before `init` finishes)    │
  ┌──────────────┐         ┌────────────────────────┐                   │
  │ SCF core     │◀────────│ acf/settings/load_json │◀──────────────────┘
  │ local store  │         │  receives an ARRAY of  │
  └──────────────┘         │  directories to scan   │
        │                  └────────────────────────┘
        ▼
   field groups are registered as "local" — no database row required
```

Three details that decide whether this works on the first try:

| Detail | Why it matters |
|---|---|
| `save_json` returns a **string**, `load_json` receives an **array** | Two different shapes for two different jobs. There is one place to write and many places to read from — SCF's own bundled groups, a theme, your plugin. |
| The default load path is removed | SCF's default is `get_stylesheet_directory() . '/acf-json'`. In this project the theme is a redirect stub with no business owning the content model, so you `unset()` the default and add the plugin's directory. |
| The directory must exist and be writable | SCF does not create it. A missing directory means saves land in the database silently and you discover it on the next fresh container. |

The filename is `{$field_group['key']}.json`. SCF generates keys in the UI as
`group_` plus a hex timestamp — `group_663f2a1b4c5d6.json` — which is unreadable in a diff and
unhelpful in a file list. Two ways out, and this course uses the first:

1. **Author the JSON with a readable key.** A field group key is an arbitrary unique string, so
   `group_incident_details` is legal and produces `group_incident_details.json`. Subsequent UI
   saves write back to the same filename, because the filename is derived from the key.
2. **Rename on write** with `acf/json/save_file_name` (SCF 6.2+), which receives the filename,
   the field group and the load path, and lets you return a slug of the title instead. Use this
   when a group was built in the UI first and already has a generated key you do not want to
   change.

> **SCF 6.2 also added plural variants.** `acf/json/save_paths` and `acf/json/load_paths` do the
> same jobs with array-shaped values and support multiple save locations. The singular filters
> this lesson uses are still supported and still the documented default, and they are the pair
> you will see in every existing codebase, so learn them first.

### 3. Why this is what keeps the deploy boring

Module 24 deploys WordPress to Fly.io with a `release_command` — a container that runs once,
before the new version takes traffic, and whose exit code decides whether the release proceeds.
Compare the two versions of that command.

```
FIELD GROUPS IN THE DATABASE              FIELD GROUPS AS LOCAL JSON
──────────────────────────────────        ──────────────────────────────────
wp core update-db                         wp core update-db
wp plugin activate --all                  wp plugin activate --all
??? import the field groups ???           wp blame migrate
   · from where? the repo has none        wp rewrite flush --hard
   · which version? whatever was in
     the dump someone took last month     (done — 4 lines, all idempotent)
   · what if it half-applies?
wp blame migrate
wp rewrite flush --hard
```

The left column has no good answer to "from where". The field group definitions only exist in a
database, so the only mechanism is exporting them out of one environment and importing them into
another, by hand, in the right order, every release. That is the origin of an entire genre of bug:
staging has the field, production does not, the GraphQL query resolves to `null`, and the front
end renders an empty div with no error anywhere.

The right column has nothing to do because the field group **arrived with the code**. The
container image contains `includes/acf-json/group_incident_details.json`; SCF reads it on the
first request; the field exists. There is no state to synchronise because there is no state.

### 4. SCF fields or Gutenberg blocks? The decision this project makes twice

Both are "custom content in WordPress", and choosing wrongly is expensive in both directions.
The question is not which is more powerful — it is **who composes the page, and is the content
queried as data**.

| | SCF field group | Gutenberg blocks |
|---|---|---|
| Shape | fixed — the same nine fields on every incident | free — whatever the editor drags in, in any order |
| Stored as | one `wp_postmeta` row per field | one serialised HTML string in `post_content` |
| Queryable | ✅ `meta_query`, sortable, filterable, facetable | ❌ you cannot `WHERE` on a block attribute |
| GraphQL shape | a typed object with named fields | a **list** of a union of block types (Module 14) |
| Editor freedom | none, by design | total, by design |
| Good for | `incident`, `tech_review` — records | marketing pages — layouts |
| Bad for | a landing page that changes weekly | anything you need to sort or filter by |

**The verdict, split by post type:**

- `incident` and `tech_review` use **SCF fields**, because the front end filters by
  `severity`, sorts by `downtime_minutes`, computes `blameScore` from `blame_confidence`, and
  renders forty of them in a list. Every one of those operations is a query over structured data.
  A block attribute cannot be queried, so a block-based incident would make
  `/incidents?severity=s1-catastrophic` impossible to answer without loading and parsing every
  post.
- `page` uses **blocks**, because the HOBT landing page and the About page are compositions an
  editor should own. Modules 13 and 14 build six custom blocks for exactly this, and Next renders
  them from `editorBlocks` as a discriminated union.

The HOBT page is the interesting one, because it gets **both**. Its body is blocks. Its
`hobtPromo` field group (Lesson 04.3) holds `price_usd`, `seats_left` and `demo_booking_url` —
values the *application* needs to reason about, not decorate with. `seats_left` drives a revalidate
interval; `demo_booking_url` is a redirect target after a form submit. Those are data, so they are
fields, even though they appear on a page that is otherwise editor-composed.

> **The cost, stated plainly:** the boundary is a judgement call and you will get it wrong at
> least once. The tell is a request like "can we reorder the ratings on a review?" — reordering is
> composition, and if you find yourself adding `rating_1_position` fields, the answer was blocks.
> Moving a field group to blocks later means writing a migration that parses meta into block
> markup, which is real work. Ask "will anything ever query this?" before you decide.

### 5. SCF and `register_post_meta()` are two views of the same row

Lesson 03.4 already registered every `incident` meta key with a type, a `sanitize_callback` and
an `auth_callback`. SCF is about to build a form over the same keys. Nothing collides, as long as
you understand which layer does what.

```
   wp-admin form            REST / GraphQL              wp_postmeta
   ─────────────            ──────────────              ───────────
   SCF field group   ─┐                              ┌─ downtime_minutes  = 145
   (this lesson)      ├──▶  register_post_meta  ──▶  │
   createIncident    ─┘     · type                   └─ _downtime_minutes = field_incident_downtime
   (Module 06)              · sanitize_callback
   wp post meta update      · auth_callback
   (WP-CLI)                 · show_in_rest
```

| Layer | Owns | Does **not** own |
|---|---|---|
| SCF field group | the editing UI, labels, validation messages, the `_fieldname` reference row | authorisation, the canonical sanitiser |
| `register_post_meta()` | type, sanitiser, REST projection, `auth_callback` | any UI at all |

Two consequences worth internalising. First, **the field name is the contract**. SCF writes to
`wp_postmeta.meta_key = 'downtime_minutes'`; Module 03 registered `downtime_minutes`; a typo
produces two meta keys that never meet, an editing form that appears to work, and a GraphQL field
that is permanently `null`. Second, **`update_field()` goes through the registered sanitiser**,
because SCF ultimately calls `update_metadata()` and WordPress applies `sanitize_meta()` there.
So `sanitize_occurred_at()` from Lesson 03.4 is a genuine backstop under the SCF form, not a
parallel implementation of it.

The paired `_downtime_minutes` row is SCF's own bookkeeping: it stores the field *key*, which is
how `get_field()` knows which field definition to apply when formatting the value. It is why
`get_post_meta()` and `get_field()` can return different things for the same key — the first
returns `"145"`, the second returns `145.0` after the Number field's formatting.

### 6. The nine fields, and the settings that carry meaning

The field list is fixed by
[appendix 03 §4.1](../appendix/03-content-model-reference.md#41-incident-details) and is not
repeated here. What is worth stating is which SCF *setting* each field needs, because that is
where the intent lives.

| Field | SCF type | The setting that matters |
|---|---|---|
| `occurred_at` | `date_time_picker` | `return_format: Y-m-d\TH:i:sP` — ISO 8601 out, so the front end can hand it straight to `Date`. SCF always **stores** `Y-m-d H:i:s`; `return_format` only affects reads. |
| `downtime_minutes` | `number` | `min: 0`, `max: 100000`. The browser enforces it; Lesson 03.4's `clamp_number()` enforces it for everyone else. |
| `estimated_cost_usd` | `number` | `required: 0` — optional, and an empty Number field is `''`, not `0`. Guard for that in Module 08. |
| `environment` | `select` | `choices` are **kebab-case values** with human labels. The value is what lands in the database and what Lesson 06.1 maps to the `IncidentEnvironment` enum. |
| `resolution_status` | `select` | Same, and `allow_null: 0` so there is always a value. |
| `blame_confidence` | `range` | `default_value: 73`. A default on the field, not in a resolver — one place, and the SCF UI honours it too. |
| `stack_trace` | `textarea` | `new_lines: ""`. Do **not** let SCF apply `wpautop`; a stack trace is text, rendered in `<pre>` and escaped. |
| `reporter_display_name` | `text` | Deliberately denormalised. Public reporters are not classic WordPress authors, so there is no `post_author` to read a display name from. |
| `is_verified` | `true_false` | `ui: 1` for a switch instead of a checkbox — and a `prepare_field` filter, which is Key Concept 7. |

`environment` is the one to look at twice. The choices are `production`, `staging`, `development`
and `works-on-my-machine` — kebab-case, matching Lesson 03.4's `INCIDENT_ENVIRONMENTS` constant
exactly. GraphQL enum values are `SCREAMING_SNAKE_CASE` by convention, and Lesson 06.1 registers
`IncidentEnvironment` with a resolver that maps between the two. Storing the SCREAMING form now
to "save a step later" would put a GraphQL naming convention inside your database, where it does
not belong.

### 7. `is_verified`: read-only means "absent from the form", not "greyed out"

`is_verified` is a moderation fact. An editor may set it; a reporter editing their own pending
incident may not. SCF has a filter for exactly this shape of rule:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/acf.php (fragment)
add_filter( 'acf/prepare_field/name=is_verified', __NAMESPACE__ . '\\hide_verified_from_reporters' );
```

The instinct is to set `$field['disabled'] = true` and call it done. **Do not.** A disabled input
is not submitted by the browser, and SCF renders a True/False field as a hidden `0` input
followed by the visible switch. Disable the switch and the hidden `0` still posts, so opening an
incident and pressing Update silently sets `is_verified` to false. You built a permission check
that destroys data.

Returning `false` from `acf/prepare_field` removes the field from the form entirely, and SCF only
writes the keys that appear in `$_POST['acf']`. The value is untouched, which is the behaviour you
actually wanted.

| Approach | Value preserved? | Verdict |
|---|---|---|
| `$field['disabled'] = true` | ❌ silently reset to `false` on the next Update | ❌ never |
| `$field['readonly'] = true` | ❌ same hidden-input problem for `true_false` | ❌ |
| `return false` — field absent | ✅ nothing submitted, nothing written | ✅ **this** |

> **Hiding a field is not the security boundary and must never be treated as one.** The wp-admin
> form is one of four write paths to that meta key. The others are the REST API (guarded by the
> `auth_callback` from Lesson 03.4), WP-CLI (guarded by nothing — it is root by definition), and
> the `createIncident` mutation (which ignores a client-supplied `is_verified` outright, in Lesson
> 06.2). A UI-only check would be defence in *one* layer, which is defence in none.

Non-moderators can still *see* the verification state: Lesson 03.4 added a Verified column to the
incidents list table. Read-only in the truest sense — visible, not editable, and not silently
resettable.

### 8. Why this course uses SCF, and not ACF

If you have built Classic WordPress sites you know Advanced Custom Fields, and you know the shape
of the decision this section used to describe: three of the five field groups here need a
Repeater or an options page, both of which were **ACF PRO** features behind a paid licence. That
decision is gone, and the reason is worth understanding rather than just accepting.

**What happened.** In October 2024, during the WP Engine dispute, WordPress.org forked ACF and
took over its plugin slug. The fork is **Secure Custom Fields**. It began as a fork of ACF free,
but has since absorbed the PRO field types, and as of 6.9.5 it ships Repeater, Flexible Content,
Clone, Gallery, Options Pages and Blocks in the wordpress.org plugin.

**What it buys this project**, concretely:

| | ACF PRO | **SCF** |
|---|---|---|
| Repeater, Flexible Content, Options Pages | paid licence | included |
| Install | zip from your account | `wp plugin install secure-custom-fields` |
| Licence key in `.env` | required | **none** — see [appendix 04](../appendix/04-env-reference.md) |
| CI can install it unattended | no | yes |
| Module 23's contract tests | half of them skip | both halves run |

That last row is the one that changed the course rather than just its shopping list. A contract
test that only runs where a licensed plugin is installed is a contract test that gets skipped in
CI — the one place it matters — and Lesson 23.5 used to have to apologise for exactly that.

**What does not change, and this is the important part.** SCF is a *fork*, so it keeps ACF's
internals wholesale:

- The functions are still `acf_*` — `acf_add_local_field_group()`, `acf_get_field_groups()`,
  `acf_add_options_page()`, and `get_field()` / `have_rows()` exactly as you know them.
- The hooks are still `acf/init`, `acf/settings/save_json`, `acf/settings/load_json`.
- Local JSON still lives in `acf-json/`, in the same format, and the field group post type in
  wp-admin is still `acf-field-group`.
- It defines `ACF_VERSION` and the `ACF` class, which is how third-party integrations built for
  ACF — **including WPGraphQL for ACF, which this course depends on** — keep working unmodified.

So every `acf_`-prefixed identifier in this course is deliberate, not a leftover. Renaming them
would break the plugin. When you read `acf` in code here, read it as "the API SCF inherited"; when
you read SCF in prose, read it as "the plugin you install".

> **The one caveat, stated plainly.** WPGraphQL for ACF has no *official* SCF support —
> [issue #264](https://github.com/wp-graphql/wpgraphql-acf/issues/264) has been open since
> February 2026 with no maintainer response. It works because SCF satisfies the
> `class_exists( 'ACF' )` check and keeps the field-group data structure, and this course verified
> the whole path end to end on SCF 6.9.5 with WPGraphQL for ACF 3.0.0: Repeater resolving as a
> typed object list, Flexible Content as a union, an options page as a root field, and Local JSON
> loading with `show_in_graphql` intact. But "works and is tested by me" is not "supported", and
> on a client project that distinction belongs in writing. ACF PRO remains a drop-in alternative
> if you would rather buy the support relationship.

---
## Task

> **Order matters in this lesson more than in most.** Local JSON has to be switched on *before*
> the first field group exists. Build the group first and it lands in the database, where the SCF
> UI will not re-emit it as JSON until you edit and save it again.

### Step 1: Install SCF

```bash
cd wordpress-headless
docker compose run --rm wpcli wp plugin install secure-custom-fields --activate
docker compose run --rm wpcli wp plugin list --fields=name,version,status --format=csv
```

Write that version number down next to the ones from Lesson 02.2. Module 24 installs plugins at
image-build time with an explicit `--version=`, and "whatever was latest that day" is not a
reproducible build.

**Verify §1:**

- [ ] `secure-custom-fields` shows `active`.
- [ ] `http://localhost:8080/wp-admin/edit.php?post_type=acf-field-group` loads and is empty.
- [ ] `docker compose logs --tail=40 wordpress` shows no new PHP warning.

### Step 2: Create the JSON directory before anything can write to it

```bash
mkdir -p wp-content/plugins/blame-the-tech-core/includes/acf-json
ls -ld wp-content/plugins/blame-the-tech-core/includes/acf-json
```

**Verify §2:**

- [ ] The directory exists. SCF does not create it, and a missing directory means saves fall back
      to the database with no error shown anywhere.
- [ ] It is **not** gitignored: `git check-ignore -v wp-content/plugins/blame-the-tech-core/includes/acf-json`
      must print **nothing**. The root `.gitignore` excludes `wp-content/plugins/*` and re-includes
      this plugin — confirm the re-inclusion reaches this far down before you rely on it.

### Step 3: Write the SCF integration file

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/acf.php
<?php
/**
 * SCF integration: Local JSON paths, admin visibility, and field-level rules.
 *
 * Field DEFINITIONS live in includes/acf-json/ and are tracked in git.
 * Field VALUES live in wp_postmeta / wp_termmeta and are not.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

defined( 'ABSPATH' ) || exit;

/**
 * The one directory SCF writes field groups to, and the one this plugin reads
 * them from. Inside the plugin, so it ships in the Module 24 container image.
 */
const SCF_JSON_DIR = PLUGIN_DIR . '/includes/acf-json';

add_filter( 'acf/settings/save_json', __NAMESPACE__ . '\\acf_json_save_path' );
add_filter( 'acf/settings/load_json', __NAMESPACE__ . '\\acf_json_load_paths' );
add_filter( 'acf/json/save_file_name', __NAMESPACE__ . '\\acf_json_file_name', 10, 3 );
add_filter( 'acf/settings/show_admin', __NAMESPACE__ . '\\acf_show_admin' );
add_filter( 'acf/prepare_field/name=is_verified', __NAMESPACE__ . '\\hide_verified_from_reporters' );
add_action( 'admin_notices', __NAMESPACE__ . '\\acf_json_writability_notice' );

/**
 * Where SCF SAVES a field group. Returns a single directory (a string).
 *
 * Falls back to whatever SCF proposed if our directory is missing, so a broken
 * checkout degrades to SCF's default rather than throwing away the save.
 *
 * @param string $path SCF's default — the active theme's acf-json directory.
 */
function acf_json_save_path( string $path ): string {
	return is_dir( SCF_JSON_DIR ) ? SCF_JSON_DIR : $path;
}

/**
 * Where SCF LOADS field groups from. Receives — and returns — an ARRAY.
 *
 * SCF's default entry is the active theme. The `btt-headless` theme is a
 * redirect stub that owns no part of the content model (Lesson 03.1 Key
 * Concept 1), so it is removed by value rather than by index: another plugin
 * may legitimately have added a path before us.
 *
 * @param string[] $paths Directories SCF will scan for *.json.
 * @return string[]
 */
function acf_json_load_paths( array $paths ): array {
	$theme_dir = get_stylesheet_directory() . '/acf-json';

	$paths = array_values(
		array_filter(
			$paths,
			static fn( string $path ): bool => $path !== $theme_dir
		)
	);

	$paths[] = SCF_JSON_DIR;

	return $paths;
}

/**
 * Name the file after the group TITLE instead of its key.
 *
 * SCF's default filename is "{$key}.json", and a key generated by the UI looks
 * like `group_663f2a1b4c5d6` — unreadable in a file list and worse in a diff.
 *
 * The trade: renaming a field group renames its file, and the old file is left
 * behind. `git status` shows the new one as untracked; delete the stale one in
 * the same commit.
 *
 * @param string               $filename  SCF's proposed filename.
 * @param array<string, mixed> $post      The field group being saved.
 * @param string               $load_path The directory it is being written to.
 */
function acf_json_file_name( string $filename, array $post, string $load_path ): string {
	$slug = str_replace( '-', '_', sanitize_title( (string) ( $post['title'] ?? '' ) ) );

	return '' === $slug ? $filename : 'group_' . $slug . '.json';
}

/**
 * Hide the field-group builder in production.
 *
 * There is nothing to build there: definitions arrive as JSON with the code,
 * and an edit made in production would be overwritten by the next deploy.
 *
 * @param bool $show SCF's default, true.
 */
function acf_show_admin( bool $show ): bool {
	return $show && 'production' !== wp_get_environment_type();
}

/**
 * Remove `is_verified` from the form for anyone who cannot moderate.
 *
 * Returning FALSE removes the field entirely, so it never appears in
 * $_POST['acf'] and SCF never writes it. Setting `disabled` instead would let
 * the True/False field's hidden `0` input post anyway, and pressing Update
 * would silently un-verify the incident. See Key Concept 7.
 *
 * @param array<string, mixed>|false $field The prepared field, or false.
 * @return array<string, mixed>|false
 */
function hide_verified_from_reporters( array|false $field ): array|false {
	return current_user_can( 'edit_others_incidents' ) ? $field : false;
}

/**
 * One admin notice for the one environment problem this setup has.
 *
 * The plugin directory is a bind mount owned by your host user; PHP in the
 * container runs as www-data. On Docker Desktop that is papered over. On Linux
 * it is not, and SCF silently stops emitting JSON.
 */
function acf_json_writability_notice(): void {
	if ( ! current_user_can( 'manage_options' ) || ! function_exists( 'acf_get_setting' ) ) {
		return;
	}

	if ( is_dir( SCF_JSON_DIR ) && wp_is_writable( SCF_JSON_DIR ) ) {
		return;
	}

	printf(
		'<div class="notice notice-warning"><p><strong>%s</strong> %s <code>%s</code></p></div>',
		esc_html__( 'SCF Local JSON is not writable.', 'blame-the-tech-core' ),
		esc_html__( 'Field group saves will go to the database instead. Fix the directory, then run:', 'blame-the-tech-core' ),
		esc_html( 'sudo chown -R 33:33 includes/acf-json' )
	);
}
```

> **`33:33` is `www-data` in Debian-based images**, which is what both the `wordpress` and
> `wpcli` containers run as. You only need this on Linux; on Docker Desktop the bind-mount driver
> makes the question moot. It is a development-only concern either way — production never writes
> JSON, it only reads it.

### Step 4: Load the file from the plugin bootstrap

One line, in the established place.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
	private const INCLUDES = array(
		'includes/post-types.php',                 // Lesson 03.2
		'includes/taxonomies.php',                 // Lesson 03.3
		'includes/statuses.php',                   // Lesson 03.4
		'includes/admin/incident-columns.php',     // Lesson 03.4
		'includes/roles.php',                      // Lesson 03.5
		'includes/acf.php',                        // Lesson 04.1
	);
```

**Verify §4:**

- [ ] Reload `http://localhost:8080/wp-admin/`. No `Failed opening required` in
      `docker compose logs --tail=40 wordpress`.
- [ ] No orange "SCF Local JSON is not writable" notice. If you see it, Step 3's callout is for
      you.

### Step 5: Write the field group

This is the deliverable. Nine fields, the names fixed by
[appendix 03 §4.1](../appendix/03-content-model-reference.md#41-incident-details), at
`wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/acf-json/group_incident_details.json`:

```json
{
	"key": "group_incident_details",
	"title": "Incident Details",
	"fields": [
		{
			"key": "field_incident_occurred_at",
			"label": "Occurred at",
			"name": "occurred_at",
			"type": "date_time_picker",
			"instructions": "When the incident started. Cannot be in the future.",
			"required": 1,
			"conditional_logic": 0,
			"wrapper": { "width": "50", "class": "", "id": "" },
			"display_format": "d/m/Y g:i a",
			"return_format": "Y-m-d\\TH:i:sP",
			"first_day": 1
		},
		{
			"key": "field_incident_downtime_minutes",
			"label": "Downtime (min)",
			"name": "downtime_minutes",
			"type": "number",
			"instructions": "",
			"required": 1,
			"conditional_logic": 0,
			"wrapper": { "width": "25", "class": "", "id": "" },
			"default_value": "",
			"min": 0,
			"max": 100000,
			"step": 1,
			"prepend": "",
			"append": "min"
		},
		{
			"key": "field_incident_estimated_cost_usd",
			"label": "Estimated cost (USD)",
			"name": "estimated_cost_usd",
			"type": "number",
			"instructions": "Optional. An empty field reads back as an empty string, not 0.",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "25", "class": "", "id": "" },
			"default_value": "",
			"min": 0,
			"max": 1000000000,
			"step": 1,
			"prepend": "$",
			"append": ""
		},
		{
			"key": "field_incident_environment",
			"label": "Environment",
			"name": "environment",
			"type": "select",
			"instructions": "",
			"required": 1,
			"conditional_logic": 0,
			"wrapper": { "width": "50", "class": "", "id": "" },
			"choices": {
				"production": "Production",
				"staging": "Staging",
				"development": "Development",
				"works-on-my-machine": "Works On My Machine"
			},
			"default_value": "production",
			"allow_null": 0,
			"multiple": 0,
			"ui": 0,
			"ajax": 0,
			"return_format": "value"
		},
		{
			"key": "field_incident_resolution_status",
			"label": "Resolution",
			"name": "resolution_status",
			"type": "select",
			"instructions": "",
			"required": 1,
			"conditional_logic": 0,
			"wrapper": { "width": "50", "class": "", "id": "" },
			"choices": {
				"open": "Open",
				"mitigated": "Mitigated",
				"blamed": "Blamed",
				"wontfix": "Won't Fix"
			},
			"default_value": "open",
			"allow_null": 0,
			"multiple": 0,
			"ui": 0,
			"ajax": 0,
			"return_format": "value"
		},
		{
			"key": "field_incident_blame_confidence",
			"label": "Blame confidence",
			"name": "blame_confidence",
			"type": "range",
			"instructions": "How sure are we, really.",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "", "class": "", "id": "" },
			"default_value": 73,
			"min": 0,
			"max": 100,
			"step": 1,
			"prepend": "",
			"append": "%"
		},
		{
			"key": "field_incident_stack_trace",
			"label": "Stack trace",
			"name": "stack_trace",
			"type": "textarea",
			"instructions": "Plain text. Rendered inside <pre>, escaped, never as HTML.",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "", "class": "", "id": "" },
			"default_value": "",
			"maxlength": 20000,
			"rows": 10,
			"new_lines": ""
		},
		{
			"key": "field_incident_reporter_display_name",
			"label": "Reporter (display)",
			"name": "reporter_display_name",
			"type": "text",
			"instructions": "Denormalised on purpose: public reporters are not WordPress authors.",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "50", "class": "", "id": "" },
			"default_value": "",
			"maxlength": 80
		},
		{
			"key": "field_incident_is_verified",
			"label": "Verified by moderator",
			"name": "is_verified",
			"type": "true_false",
			"instructions": "Moderators only. Ignored when an API client supplies it.",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "50", "class": "", "id": "" },
			"message": "",
			"default_value": 0,
			"ui": 1,
			"ui_on_text": "Verified",
			"ui_off_text": "Unverified"
		}
	],
	"location": [
		[
			{ "param": "post_type", "operator": "==", "value": "incident" }
		]
	],
	"menu_order": 0,
	"position": "normal",
	"style": "default",
	"label_placement": "top",
	"instruction_placement": "label",
	"hide_on_screen": "",
	"active": true,
	"description": "Structured incident data. Field names are fixed by appendix 03 section 4.1.",
	"show_in_rest": 0,
	"show_in_graphql": 1,
	"graphql_field_name": "incidentDetails",
	"map_graphql_types_from_location_rules": 0,
	"graphql_types": "",
	"modified": 1730000000
}
```

Four keys in there are worth a sentence each:

| Key | Why it is that value |
|---|---|
| `"key": "group_incident_details"` | A readable key, so SCF's `{$key}.json` naming and Step 3's `save_file_name` filter agree on the same filename. Keys must be unique across the whole install; the `group_`/`field_` prefixes are SCF's convention, not a requirement. |
| `"show_in_rest": 0` | SCF's own REST layer stays off. Lesson 03.4 already registered every one of these keys with `register_post_meta( ..., show_in_rest => true )`, which is the projection the block editor uses. Two layers exposing the same key produce two differently-shaped REST fields. |
| `"show_in_graphql": 1` + `"graphql_field_name"` | Read by WPGraphQL for SCF, which you install in Lesson 04.2. Harmless until then. |
| `"modified"` | A Unix timestamp SCF compares against the database copy to decide whether to offer a "Sync". A fixed value here means a fresh clone does not immediately claim to be out of date. |

### Step 6: Author one incident by hand

Open `http://localhost:8080/wp-admin/post-new.php?post_type=incident`. The **Incident Details**
box should be below the editor, with all nine fields.

Fill every field. Give it a title you will recognise, set Severity to `S2 — Major` and a
Scapegoat, then Publish.

**Verify §6:**

- [ ] All nine fields render, in the order they appear in the JSON, with the two-column widths
      from the `wrapper.width` values.
- [ ] The `is_verified` switch is present (you are an administrator, so
      `edit_others_incidents` is true).
- [ ] `blame_confidence` starts at 73 without you touching it.
- [ ] `environment` offers four options and no empty one.
- [ ] `git status` shows **no change** to `group_incident_details.json`. Authoring content must
      not touch the schema file. If it did, you edited the field group instead of a post.

### Step 7: Prove the group is a file, not a row

```bash
docker compose run --rm wpcli wp db query \
  "SELECT COUNT(*) AS db_groups FROM wp_posts WHERE post_type='acf-field-group';"
```

**Verify §7:**

- [ ] `db_groups` is `0`. The field group has never been in the database and the form still
      rendered. That is the property Module 24's deploy depends on.
- [ ] Open `http://localhost:8080/wp-admin/edit.php?post_type=acf-field-group`. **Incident
      Details** is listed with a *Sync available* marker. Do **not** click Sync yet — you only
      need it when you want to edit the group in the UI, and Lesson 04.2 walks that round trip.

### Step 8: Write down why the deploy has no migration step

Create `docs/adr/0004-field-groups-as-code.md` — the next free number in `docs/adr/`, following
the two records Lessons 01.3 and 02.1 created and the one Lesson 03.1 added.

Five sentences, your own words: the decision (Local JSON in the plugin), the two alternatives you
rejected and why (database storage has no diff and no deploy story; `acf_add_local_field_group()`
gives up the UI), the consequence you are accepting (a JSON merge conflict is now possible, and
renaming a group leaves a stale file), and the payoff (Module 24's `release_command` has nothing
to say about field groups). ADR numbers are permanent and never reused.

---
## Verification

```bash
cd wordpress-headless

# 1. SCF is installed and active
docker compose run --rm wpcli wp plugin list --status=active --field=name | grep secure-custom-fields
# Expected: secure-custom-fields

# 2. Exactly one field group file, with the readable filename
ls wp-content/plugins/blame-the-tech-core/includes/acf-json/
# Expected: group_incident_details.json   (and nothing else)

# 3. SCF loaded it, with the GraphQL name Lesson 04.2 will need
docker compose run --rm wpcli wp eval '$g = acf_get_field_group("group_incident_details"); echo $g ? $g["title"] . " | " . ( $g["graphql_field_name"] ?? "?" ) : "MISSING";'
# Expected: Incident Details | incidentDetails

# 4. All nine field names, in order, spelled exactly as the contract spells them
docker compose run --rm wpcli wp eval 'echo implode( ",", wp_list_pluck( acf_get_fields( "group_incident_details" ), "name" ) );'
# Expected: occurred_at,downtime_minutes,estimated_cost_usd,environment,resolution_status,blame_confidence,stack_trace,reporter_display_name,is_verified

# 5. The LOAD path is the plugin directory, and the theme is no longer scanned
docker compose run --rm wpcli wp eval 'echo implode( "\n", acf_get_setting( "load_json" ) );'
# Expected: one line ending in plugins/blame-the-tech-core/includes/acf-json
#           and NO line containing /themes/

# 6. The SAVE path is a single string pointing at the same directory
docker compose run --rm wpcli wp eval 'echo acf_get_setting( "save_json" );'
# Expected: /var/www/html/wp-content/plugins/blame-the-tech-core/includes/acf-json

# 7. The field group is not a database row and has never been one
docker compose run --rm wpcli wp db query "SELECT COUNT(*) AS db_groups FROM wp_posts WHERE post_type='acf-field-group';"
# Expected: 0

# 8. Values round-trip through SCF onto the meta keys Lesson 03.4 registered
ID=$(docker compose run --rm wpcli wp post create --post_type=incident \
  --post_title='SCF smoke test' --post_name=acf-smoke-test --post_status=draft --porcelain | tr -d '\r')
docker compose run --rm wpcli wp eval "update_field( 'downtime_minutes', 145, $ID ); update_field( 'occurred_at', '2024-11-15 09:20:00', $ID ); update_field( 'blame_confidence', 91, $ID );"
docker compose run --rm wpcli wp post meta list "$ID" --fields=meta_key,meta_value --format=csv
# Expected: downtime_minutes,145
#           _downtime_minutes,field_incident_downtime_minutes   <- SCF's key reference row
#           blame_confidence,91  and its paired _blame_confidence

# 9. return_format is applied on READ, not on write
docker compose run --rm wpcli wp eval "echo get_post_meta( $ID, 'occurred_at', true ), ' -> ', get_field( 'occurred_at', $ID );"
# Expected: 2024-11-15 09:20:00 -> 2024-11-15T09:20:00+00:00
#           (the offset follows the site timezone, which is UTC here)

# 10. NEGATIVE: Lesson 03.4's sanitiser still overrules the SCF form
docker compose run --rm wpcli wp eval "update_field( 'occurred_at', '2999-01-01 00:00:00', $ID ); var_export( get_post_meta( $ID, 'occurred_at', true ) );"
# Expected: ''  — sanitize_occurred_at() rejects a future date no matter who wrote it.
#           NOT '2999-01-01T00:00:00+00:00'. The form is a convenience, not the boundary.

# 11. NEGATIVE: the definition genuinely comes from the file
mv wp-content/plugins/blame-the-tech-core/includes/acf-json /tmp/acf-json.bak
docker compose run --rm wpcli wp eval 'var_export( (bool) acf_get_field_group( "group_incident_details" ) );'
# Expected: false — no directory, no field group, anywhere.
#           This is exactly what a database-stored group does on a fresh container,
#           except that here it is one `git checkout` away from fixed.
mv /tmp/acf-json.bak wp-content/plugins/blame-the-tech-core/includes/acf-json
docker compose run --rm wpcli wp eval 'var_export( (bool) acf_get_field_group( "group_incident_details" ) );'
# Expected: true

# 12. NEGATIVE: nothing was written into the theme
ls wp-content/themes/btt-headless/acf-json 2>/dev/null || echo 'no theme acf-json — correct'
# Expected: no theme acf-json — correct

# 13. Remove the smoke-test incident
docker compose run --rm wpcli wp post delete "$ID" --force
# Expected: Success: Deleted post

# 14. What is staged is the schema, and only the schema
git status --short wp-content/plugins/blame-the-tech-core/
# Expected: includes/acf.php and includes/acf-json/group_incident_details.json,
#           plus includes/Plugin.php. Nothing under vendor/, no .env.

# 15. No PHP notices from any of the above
docker compose logs --tail=60 wordpress | grep -iE 'php (warning|notice|fatal)' || echo clean
# Expected: clean
```

Check 11 is the one to keep in your head. It is the whole lesson in three commands: the field
model is a file, files are in git, and git is what the deploy already ships.

## Control Questions

1. You have a field group whose `choices` list has to be built from a locale table that changes
   per environment. Local JSON cannot express that. Say which of the three storage strategies you
   would move it to, what you give up by moving, and how you would keep the rest of the groups
   where they are.
2. Setting `$field['disabled'] = true` on `is_verified` looks like the obvious way to make it
   read-only. Describe the exact sequence of events that ends with a verified incident becoming
   unverified, and say which HTML element is responsible.
3. `wp db query "SELECT COUNT(*) FROM wp_posts WHERE post_type='acf-field-group'"` returns `0`,
   yet the Incident Details box renders in wp-admin. Explain where the definition came from, and
   then state what the same query would return on a colleague's machine after they clicked *Sync*
   — and whether that changes what gets deployed.
4. `acf/settings/save_json` returns a string and `acf/settings/load_json` returns an array. Give
   the reason the two shapes differ, and describe what SCF does if you mistakenly return an array
   from the save filter.
5. A stakeholder asks for a long "postmortem" section on each incident, with headings, images and
   pull quotes, arranged differently for every incident. Argue for either an SCF field or blocks
   using the test in Key Concept 4, and name the one future request that would make you regret
   your answer.

## Learn More

- [SCF — Local JSON](https://www.advancedcustomfields.com/resources/local-json/) — the official
  description of both filters, the sync behaviour, and the "why" in SCF's own words
- [SCF — `acf_add_local_field_group()`](https://www.advancedcustomfields.com/resources/register-fields-via-php/) —
  the third strategy from Key Concept 1, including the array format Local JSON files use
- [SCF field types](https://developer.wordpress.org/secure-custom-fields/features/fields/) — the
  authoritative answer to "is Repeater free?", which you want before you plan a content model
- [SCF — `acf/prepare_field`](https://www.advancedcustomfields.com/resources/acf-prepare_field/) —
  the filter Step 3 uses, including the "return false to remove the field" behaviour
- [`register_post_meta()` reference](https://developer.wordpress.org/reference/functions/register_post_meta/) —
  re-read `sanitize_callback` and `auth_callback` now that a second layer writes the same keys
- [`sanitize_meta()` reference](https://developer.wordpress.org/reference/functions/sanitize_meta/) —
  the four lines of core that make Lesson 03.4's sanitiser apply to SCF's writes for free
- [SCF — Date Time Picker](https://www.advancedcustomfields.com/resources/date-time-picker/) — the
  distinction between the stored format and `return_format`, which check 9 demonstrates
